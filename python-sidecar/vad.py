"""VAD — Silero(ONNX, pysilero-vad)로 '말소리' 구간만 골라낸다.

기존 RMS(평균 음량) 기준은 바람·엔진·음악 같은 비음성 소음도 전부 통과시켜
Qwen3-ASR이 중국어 혼입·반복 환각을 일으키는 원인이 됐다. Silero VAD는
음성/비음성을 구분하는 전용 모델(수 MB, 오프라인)이라 이를 근본적으로 막는다.

반환된 구간은 stt.transcribe()가 구간별로 잘라 인식하는 데 사용한다.
"""
from __future__ import annotations

import threading
import wave

from config import settings

# 구간 병합/정리 파라미터 (초)
_MERGE_GAP = 0.6      # 이 간격 이하로 붙어 있는 말소리 구간은 하나로 병합
_MIN_REGION = 0.3     # 이보다 짧은 구간은 잡음으로 보고 폐기
_PAD = 0.25           # 구간 앞뒤 여유(음절 잘림 방지)

_detector = None
_lock = threading.Lock()
_unavailable = False


def _get_detector():
    """Silero VAD 지연 로드 + 캐시. 미설치 시 None(호출측 RMS 폴백)."""
    global _detector, _unavailable
    if _detector is not None or _unavailable:
        return _detector
    with _lock:
        if _detector is None and not _unavailable:
            try:
                from pysilero_vad import SileroVoiceActivityDetector

                _detector = SileroVoiceActivityDetector()
            except Exception as e:  # noqa: BLE001 — 미설치/로드 실패 → 폴백
                import sys
                print(f"[vad] Silero VAD 사용 불가({e}) — RMS 폴백", file=sys.stderr)
                _unavailable = True
    return _detector


def available() -> bool:
    """Silero VAD 사용 가능 여부(설치·로드 성공). /health 진단용."""
    return _get_detector() is not None


def speech_regions(wav_path: str) -> list[tuple[float, float]] | None:
    """16kHz mono 16-bit wav → 말소리 구간 [(start_sec, end_sec), ...].

    - Silero 미설치/실패: None (호출측이 기존 RMS 기준으로 폴백)
    - 말소리 없음: []
    """
    det = _get_detector()
    if det is None:
        return None

    try:
        with wave.open(wav_path, "rb") as wf:
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
                return None  # 규격 밖 오디오는 폴백
            rate = wf.getframerate()
            pcm = wf.readframes(wf.getnframes())
    except Exception:
        return None

    chunk_bytes = det.chunk_bytes()            # 512샘플 × 2바이트 (16kHz 기준 32ms)
    chunk_sec = (chunk_bytes // 2) / float(rate)
    threshold = settings.vad_threshold

    # 파일 단위로 직렬화(모델이 상태를 가짐) 후 청크별 음성 확률 계산
    flags: list[bool] = []
    with _lock:
        det.reset()
        for off in range(0, len(pcm) - chunk_bytes + 1, chunk_bytes):
            prob = det(pcm[off:off + chunk_bytes])
            flags.append(prob >= threshold)

    # 연속 청크 → 구간, 짧은 틈 병합, 짧은 구간 폐기, 패딩
    duration = len(pcm) / 2 / float(rate)
    raw: list[list[float]] = []
    for i, is_speech in enumerate(flags):
        if not is_speech:
            continue
        t0, t1 = i * chunk_sec, (i + 1) * chunk_sec
        if raw and t0 - raw[-1][1] <= _MERGE_GAP:
            raw[-1][1] = t1
        else:
            raw.append([t0, t1])

    regions: list[tuple[float, float]] = []
    for t0, t1 in raw:
        if t1 - t0 < _MIN_REGION:
            continue
        regions.append((max(0.0, t0 - _PAD), min(duration, t1 + _PAD)))

    # 패딩으로 겹친 구간 재병합
    merged: list[tuple[float, float]] = []
    for t0, t1 in regions:
        if merged and t0 <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], t1))
        else:
            merged.append((t0, t1))
    return merged


def total_speech(regions: list[tuple[float, float]]) -> float:
    """구간 총 길이(초)."""
    return sum(t1 - t0 for t0, t1 in regions)
