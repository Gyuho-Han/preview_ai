"""런타임 설정 — RAM 자동 감지로 모델 티어 선택."""
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


@dataclasses.dataclass
class Settings:
    # Ollama
    ollama_host: str = os.environ.get("OLLAMA_HOST", "http://localhost:11434")

    # 모델 (RAM 티어에 따라 __post_init__에서 결정)
    llm_model: str = "qwen3:8b"
    vlm_model: str = "qwen2.5vl:3b"
    embed_model: str = os.environ.get("EMBED_MODEL", "bge-m3")
    whisper_model: str = "mlx-community/whisper-large-v3-turbo"

    # 추천도 가중치 (문서 6번 공식 — 설정값으로 분리)
    weight_relevance: float = 0.7
    weight_quality: float = 0.3

    # 추천도 색상 임계값
    threshold_green: int = 80
    threshold_yellow: int = 50

    # 키프레임 샘플링
    keyframe_min: int = 1
    keyframe_max: int = 8
    keyframe_per_minute: float = 1.0

    # 무음 판정 (RMS dBFS) — 이 값보다 작으면 "음성 없음"으로 분기
    silence_dbfs: float = -45.0

    ram_gb: int = dataclasses.field(default_factory=_total_ram_gb)

    def __post_init__(self) -> None:
        # 환경변수 우선, 없으면 RAM 티어로 자동 선택
        if "LLM_MODEL" in os.environ:
            self.llm_model = os.environ["LLM_MODEL"]
        elif self.ram_gb >= 48:
            self.llm_model = "qwen3:30b"
        elif self.ram_gb >= 24:
            self.llm_model = "qwen3:14b"
        else:
            self.llm_model = "qwen3:8b"

        if "VLM_MODEL" in os.environ:
            self.vlm_model = os.environ["VLM_MODEL"]
        elif self.ram_gb >= 24:
            self.vlm_model = "qwen2.5vl:7b"
        else:
            self.vlm_model = "qwen2.5vl:3b"

    @property
    def concurrency(self) -> int:
        if self.ram_gb >= 48:
            return 3
        if self.ram_gb >= 24:
            return 2
        return 1


settings = Settings()
