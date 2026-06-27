"""STT — Qwen3-ASR via mlx-audio. 음성이 있을 때만 호출.

mlx-community/Qwen3-ASR-* 저장소는 mlx-audio 라이브러리용으로 변환된 것이라,
양자화(8-bit/4-bit) 가중치를 그대로 로드할 수 있다(전용 dequantize 지원).
모델은 무겁기 때문에 프로세스당 1회만 로드해 재사용한다(스레드 안전).
"""
from __future__ import annotations

import inspect
import threading
from collections import Counter
from dataclasses import dataclass, field

from config import settings


@dataclass
class Transcript:
    text: str
    segments: list[dict] = field(default_factory=list)  # {start, end, text}
    language: str = "ko"


def _is_degenerate(text: str) -> bool:
    """ASR 반복 환각 감지.

    드론 B롤처럼 말소리가 없는데 소음이 음성으로 잡히면, 모델이 한 단어를
    수백 번 반복하는 'repetition loop'에 빠진다(예: "안녕. 안녕. 안녕…").
    한 토큰이 전체의 절반 이상을 차지하면 환각으로 보고 버린다.
    """
    words = text.split()
    if len(words) < 12:
        return False
    top_count = Counter(words).most_common(1)[0][1]
    return top_count / len(words) >= 0.5


# ---- 모델 싱글톤 (최초 1회 로드 후 재사용) ---------------------------------
_model = None
_model_lock = threading.Lock()
# MLX는 GPU 하나를 쓰므로 여러 클립이 동시에 generate를 호출하면 경합으로 더 느려진다.
# 추론을 직렬화해 클립을 한 번에 하나씩 처리(전체 처리량이 오히려 향상).
_infer_lock = threading.Lock()


def _get_model():
    """mlx-audio STT 모델을 지연 로드 + 캐시. 동시 호출은 락으로 직렬화."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from mlx_audio.stt.utils import load_model  # 지연 임포트(무거운 모듈)

            _model = load_model(settings.asr_model)
    return _model


def transcribe(audio_path: str) -> Transcript:
    """16kHz mono wav → 자막 텍스트(+세그먼트, 모델이 제공할 때).

    mlx-audio의 generate()는 STTOutput(text/segments/language)을 반환한다.
    qwen3-asr는 자체 청킹으로 장시간 오디오를 처리하고 언어를 자동 감지한다.
    """
    model = _get_model()

    # 지원하는 인자만 골라서 전달(라이브러리 버전 차이 방어).
    #  - language: 한국어 다큐 힌트
    #  - repetition_penalty: 반복 환각 억제
    #  - temperature 0.0: 그리디(일관성)
    desired = {
        "language": "ko",
        "repetition_penalty": 1.3,
        "repetition_context_size": 64,
        "temperature": 0.0,
    }
    kwargs: dict = {}
    try:
        params = inspect.signature(model.generate).parameters
        kwargs = {k: v for k, v in desired.items() if k in params}
    except (TypeError, ValueError):
        pass

    with _infer_lock:                       # MLX 추론 직렬화(경합 방지)
        result = model.generate(audio_path, **kwargs)

    text = (getattr(result, "text", "") or "").strip()
    language = getattr(result, "language", "") or "ko"

    # 반복 환각이면 '음성 없음'으로 처리(VLM 장면 설명이 대신 커버).
    if _is_degenerate(text):
        return Transcript(text="", segments=[], language=language)

    segments: list[dict] = []
    for s in getattr(result, "segments", None) or []:
        if isinstance(s, dict):
            segments.append({
                "start": round(float(s.get("start", 0.0) or 0.0), 2),
                "end": round(float(s.get("end", 0.0) or 0.0), 2),
                "text": (s.get("text") or "").strip(),
            })

    return Transcript(text=text, segments=segments, language=language)
