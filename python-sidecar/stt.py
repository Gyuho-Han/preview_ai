"""STT — MLX Whisper (whisper-large-v3-turbo). 음성이 있을 때만 호출."""
from __future__ import annotations

from dataclasses import dataclass, field

from config import settings


@dataclass
class Transcript:
    text: str
    segments: list[dict] = field(default_factory=list)  # {start, end, text}
    language: str = "ko"


def transcribe(audio_path: str) -> Transcript:
    """mlx_whisper로 자막+세그먼트 타임스탬프 생성."""
    import mlx_whisper  # 지연 임포트 (무거운 모듈)

    result = mlx_whisper.transcribe(
        audio_path,
        path_or_hf_repo=settings.whisper_model,
        word_timestamps=False,
    )
    segments = [
        {
            "start": round(s.get("start", 0.0), 2),
            "end": round(s.get("end", 0.0), 2),
            "text": s.get("text", "").strip(),
        }
        for s in result.get("segments", [])
    ]
    return Transcript(
        text=result.get("text", "").strip(),
        segments=segments,
        language=result.get("language", "ko"),
    )
