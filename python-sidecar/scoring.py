"""추천도 계산 — 0.7×연관성 + 0.3×기술품질 (가중치는 config 설정값)."""
from __future__ import annotations

from config import settings


def quality_score(focus: float, audio_rms_dbfs: float, has_speech: bool) -> float:
    """기술품질 0~100. 음성 없으면 초점 가중↑."""
    # 오디오 점수: -45dBFS(무음 경계)~ -10dBFS(양호)를 0~100으로
    if has_speech:
        audio = max(0.0, min(100.0, (audio_rms_dbfs + 45) / 35 * 100))
        return round(0.6 * focus + 0.4 * audio, 1)
    # 음성 없는 B롤·인서트: 초점이 사실상 전부
    return round(focus, 1)


def recommendation(relevance: float, quality: float) -> int:
    score = settings.weight_relevance * relevance + settings.weight_quality * quality
    return int(round(max(0.0, min(100.0, score))))


def color_for(score: int) -> str:
    if score >= settings.threshold_green:
        return "green"
    if score >= settings.threshold_yellow:
        return "yellow"
    return "red"
