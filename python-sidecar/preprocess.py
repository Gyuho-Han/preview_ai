"""전처리 — ffmpeg(오디오 추출·음성 유무 감지) + OpenCV(키프레임·초점)."""
from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
from dataclasses import dataclass, field

import cv2
import numpy as np

from config import settings


@dataclass
class Preprocessed:
    duration_sec: float
    audio_path: str | None          # 추출된 16kHz mono wav (음성 없으면 None)
    has_speech: bool
    audio_rms_dbfs: float
    recorded_date: str = ""         # 촬영 날짜 YYYY-MM-DD (메타 → 파일시간 폴백)
    keyframes: list[str] = field(default_factory=list)  # jpg 경로들
    keyframe_times: list[float] = field(default_factory=list)
    focus_score: float = 0.0        # 0~100 (라플라시안 분산 정규화)


def _ffprobe_duration(video_path: str) -> float:
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", video_path]
        )
        return float(json.loads(out)["format"]["duration"])
    except Exception:
        return 0.0


def _extract_recorded_date(video_path: str) -> str:
    """촬영 날짜 추출. 컨테이너/스트림 메타(creation_time) 우선,
    실패하면 파일 수정 시각으로 폴백. 반환: 'YYYY-MM-DD' (없으면 '')."""
    import datetime

    # 1) ffprobe로 format/stream의 creation_time 태그 조회
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error",
             "-show_entries", "format_tags=creation_time:stream_tags=creation_time",
             "-of", "json", video_path]
        )
        data = json.loads(out)
        candidates = []
        if "format" in data and "tags" in data["format"]:
            candidates.append(data["format"]["tags"].get("creation_time"))
        for s in data.get("streams", []):
            candidates.append(s.get("tags", {}).get("creation_time"))
        for c in candidates:
            if c:
                # 예: "2026-05-01T10:23:45.000000Z" → "2026-05-01"
                return c[:10]
    except Exception:
        pass

    # 2) 파일 수정 시각 폴백
    try:
        ts = os.path.getmtime(video_path)
        return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except Exception:
        return ""


def _has_audio_stream(video_path: str) -> bool:
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "json", video_path]
        )
        return len(json.loads(out).get("streams", [])) > 0
    except Exception:
        return False


def extract_audio(video_path: str, workdir: str) -> str:
    """16kHz mono wav 추출 (Qwen3-ASR 입력 규격)."""
    out = os.path.join(workdir, "audio.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-ac", "1", "-ar", "16000",
         "-vn", out],
        check=True, capture_output=True,
    )
    return out


def _measure_rms_dbfs(wav_path: str) -> float:
    """ffmpeg volumedetect로 평균 음량(dBFS) 측정."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-i", wav_path, "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True, text=True,
        )
        for line in proc.stderr.splitlines():
            if "mean_volume:" in line:
                return float(line.split("mean_volume:")[1].split("dB")[0].strip())
    except Exception:
        pass
    return -99.0


def _sample_keyframes(video_path: str, duration: float, workdir: str
                      ) -> tuple[list[str], list[float], float]:
    """길이에 비례해 N장 균등 샘플링 + 라플라시안 초점 점수."""
    minutes = max(duration / 60.0, 0.01)
    n = int(min(settings.keyframe_max,
                max(settings.keyframe_min, round(minutes * settings.keyframe_per_minute))))

    cap = cv2.VideoCapture(video_path)
    paths: list[str] = []
    times: list[float] = []
    focus_vals: list[float] = []

    for i in range(n):
        t = duration * (i + 0.5) / n  # 균등 간격 중앙
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        p = os.path.join(workdir, f"kf_{i:02d}.jpg")
        cv2.imwrite(p, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        paths.append(p)
        times.append(round(t, 2))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        focus_vals.append(cv2.Laplacian(gray, cv2.CV_64F).var())

    cap.release()

    # 라플라시안 분산을 0~100으로 정규화 (경험적 스케일: 1000 ≈ 선명)
    if focus_vals:
        avg = float(np.mean(focus_vals))
        focus = max(0.0, min(100.0, 100.0 * (1 - math.exp(-avg / 500.0))))
    else:
        focus = 0.0
    return paths, times, round(focus, 1)


def preprocess(video_path: str, workdir: str | None = None) -> Preprocessed:
    workdir = workdir or tempfile.mkdtemp(prefix="preview_")
    duration = _ffprobe_duration(video_path)
    recorded_date = _extract_recorded_date(video_path)

    audio_path = None
    rms = -99.0
    has_speech = False
    if _has_audio_stream(video_path):
        audio_path = extract_audio(video_path, workdir)
        rms = _measure_rms_dbfs(audio_path)
        has_speech = rms > settings.silence_dbfs

    keyframes, times, focus = _sample_keyframes(video_path, duration, workdir)

    return Preprocessed(
        duration_sec=round(duration, 2),
        audio_path=audio_path if has_speech else None,
        has_speech=has_speech,
        audio_rms_dbfs=round(rms, 1),
        recorded_date=recorded_date,
        keyframes=keyframes,
        keyframe_times=times,
        focus_score=focus,
    )
