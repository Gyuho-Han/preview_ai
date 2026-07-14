"""런타임 설정.

우선순위: 환경변수 > models.config(TOML) > RAM 용량 자동 선택.
models.config 한 곳에서 모델·가중치·임계값을 손쉽게 바꿀 수 있다.
"""
from __future__ import annotations

import os
import dataclasses
import subprocess


def _total_ram_gb() -> int:
    """macOS 통합 메모리(GB) 추정. 실패 시 16으로 가정."""
    try:
        out = subprocess.check_output(["sysctl", "-n", "hw.memsize"])
        return round(int(out.strip()) / (1024**3))
    except Exception:
        return 16


def _find_config_file() -> str | None:
    """models.config 위치 탐색: 환경변수 → 프로젝트 루트 → 사이드카 디렉토리."""
    if os.environ.get("MODELS_CONFIG"):
        p = os.environ["MODELS_CONFIG"]
        return p if os.path.exists(p) else None
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (
        os.path.join(here, "..", "models.config"),  # 프로젝트 루트 (기본)
        os.path.join(here, "models.config"),         # 사이드카 디렉토리
    ):
        if os.path.exists(cand):
            return os.path.abspath(cand)
    return None


def _load_config_file() -> dict:
    """TOML 파싱. tomllib(3.11+) 없거나 파일 없으면 빈 dict."""
    path = _find_config_file()
    if not path:
        return {}
    try:
        import tomllib  # Python 3.11+
    except ModuleNotFoundError:
        try:
            import tomli as tomllib  # 폴백 (pip install tomli)
        except ModuleNotFoundError:
            print("[config] tomllib/tomli 없음 — models.config 무시, 자동 선택 사용")
            return {}
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
        print(f"[config] models.config 로드: {path}")
        return data
    except Exception as e:
        print(f"[config] models.config 파싱 실패({e}) — 자동 선택 사용")
        return {}


_FILE = _load_config_file()


def _pick(env_key: str, *path: str, default=None):
    """환경변수 > 파일 > default. 파일 값이 빈 문자열이면 무시(자동 선택용)."""
    if env_key in os.environ and os.environ[env_key] != "":
        return os.environ[env_key]
    node = _FILE
    for k in path:
        if not isinstance(node, dict) or k not in node:
            return default
        node = node[k]
    if isinstance(node, str) and node.strip() == "":
        return default
    return node


@dataclasses.dataclass
class Settings:
    ollama_host: str = ""
    llm_model: str = ""
    vlm_model: str = ""
    embed_model: str = ""
    asr_model: str = ""

    # 추천지수 = weight_relevance×연관성 + weight_narrative×서사강도 (합=1).
    # 기술품질(초점·음량 등)은 점수에 섞지 않고 경고로 별도 표시한다 (scoring.quality_warnings).
    weight_relevance: float = 0.6
    weight_narrative: float = 0.4
    threshold_green: int = 80
    threshold_yellow: int = 50

    # 서사강도 내부 신호 가중치(합=1) — LLM 판단·움직임·얼굴존재를 어떻게 섞을지.
    weight_llm_narrative: float = 0.6
    weight_motion: float = 0.25
    weight_face: float = 0.15

    # 기술품질 경고 임계값 — 보수적으로(진짜 심각한 것만).
    focus_warn: float = 15.0        # focus_score 미만이면 "초점 나감"
    min_duration_warn: float = 1.0  # 초 미만이면 "너무 짧음"
    blank_ratio_warn: float = 0.5   # 필름스트립의 이 비율 이상이 암전/과노출이면 "화면 거의 안 보임"

    keyframe_min: int = 1
    keyframe_max: int = 8
    keyframe_per_minute: float = 1.0
    silence_dbfs: float = -45.0

    # 장면 전환 검출 (키프레임을 균등 간격 대신 장면 경계에서 선택)
    scene_detect: bool = True
    scene_threshold: float = 0.5      # 히스토그램 Bhattacharyya 거리 컷 임계값(0~1)

    # VAD(Silero) — 말소리 판정 확률 임계값 / 클립에 말소리가 있다고 볼 최소 총량(초)
    vad_threshold: float = 0.5
    vad_min_total_speech: float = 0.6

    # 동시 분석 클립 수(0=RAM 기준 자동). 올리면 전처리가 추론과 겹쳐 빨라짐.
    concurrency_override: int = 0

    # 표 호버 스크럽 필름스트립 간격(초). 기본 1초당 1프레임.
    scrub_interval: float = 1.0

    ram_gb: int = dataclasses.field(default_factory=_total_ram_gb)

    def __post_init__(self) -> None:
        # --- 단순 값: 환경변수 > 파일 > 코드 기본 ---
        self.ollama_host = _pick("OLLAMA_HOST", "ollama", "host",
                                 default="http://localhost:11434")
        self.embed_model = _pick("EMBED_MODEL", "models", "embed", default="bge-m3")
        # STT: Qwen3-ASR (MLX). 8-bit 기본(품질 ≈ bf16, 용량/속도 유리).
        # 최고 정확도는 -bf16, 최경량은 -4bit 변형으로 교체 가능.
        self.asr_model = _pick("ASR_MODEL", "models", "asr",
                               default="mlx-community/Qwen3-ASR-1.7B-8bit")

        # 추천도/전처리 파라미터 (파일 우선)
        self.weight_relevance = float(_pick("WEIGHT_RELEVANCE", "scoring", "weight_relevance", default=0.6))
        self.weight_narrative = float(_pick("WEIGHT_NARRATIVE", "scoring", "weight_narrative", default=0.4))
        self.threshold_green = int(_pick("THRESHOLD_GREEN", "scoring", "threshold_green", default=80))
        self.threshold_yellow = int(_pick("THRESHOLD_YELLOW", "scoring", "threshold_yellow", default=50))
        self.weight_llm_narrative = float(_pick("WEIGHT_LLM_NARRATIVE", "scoring", "weight_llm_narrative", default=0.6))
        self.weight_motion = float(_pick("WEIGHT_MOTION", "scoring", "weight_motion", default=0.25))
        self.weight_face = float(_pick("WEIGHT_FACE", "scoring", "weight_face", default=0.15))
        self.focus_warn = float(_pick("FOCUS_WARN", "scoring", "focus_warn", default=15.0))
        self.min_duration_warn = float(_pick("MIN_DURATION_WARN", "scoring", "min_duration_warn", default=1.0))
        self.blank_ratio_warn = float(_pick("BLANK_RATIO_WARN", "scoring", "blank_ratio_warn", default=0.5))
        self.silence_dbfs = float(_pick("SILENCE_DBFS", "preprocess", "silence_dbfs", default=-45.0))
        self.keyframe_min = int(_pick("KEYFRAME_MIN", "preprocess", "keyframe_min", default=1))
        self.keyframe_max = int(_pick("KEYFRAME_MAX", "preprocess", "keyframe_max", default=8))
        self.keyframe_per_minute = float(_pick("KEYFRAME_PER_MINUTE", "preprocess", "keyframe_per_minute", default=1.0))
        self.scene_detect = bool(_pick("SCENE_DETECT", "preprocess", "scene_detect", default=True))
        self.scene_threshold = float(_pick("SCENE_THRESHOLD", "preprocess", "scene_threshold", default=0.5))
        self.vad_threshold = float(_pick("VAD_THRESHOLD", "preprocess", "vad_threshold", default=0.5))
        self.vad_min_total_speech = float(_pick("VAD_MIN_TOTAL_SPEECH", "preprocess", "vad_min_total_speech", default=0.6))
        self.concurrency_override = int(_pick("CONCURRENCY", "runtime", "concurrency", default=0))
        self.scrub_interval = float(_pick("SCRUB_INTERVAL", "preprocess", "scrub_interval", default=1.0))

        # --- LLM/VLM: 지정 없으면 RAM 티어로 자동 선택 ---
        llm = _pick("LLM_MODEL", "models", "llm", default=None)
        if llm is None:
            llm = "qwen3:30b" if self.ram_gb >= 48 else "qwen3:14b" if self.ram_gb >= 24 else "qwen3:8b"
        self.llm_model = llm

        vlm = _pick("VLM_MODEL", "models", "vlm", default=None)
        if vlm is None:
            vlm = "qwen2.5vl:7b" if self.ram_gb >= 24 else "qwen2.5vl:3b"
        self.vlm_model = vlm

    @property
    def concurrency(self) -> int:
        # models.config [runtime] concurrency / 환경변수 CONCURRENCY 로 강제 가능(0=자동)
        if self.concurrency_override and self.concurrency_override > 0:
            return self.concurrency_override
        if self.ram_gb >= 48:
            return 3
        if self.ram_gb >= 24:
            return 2
        return 1


settings = Settings()
