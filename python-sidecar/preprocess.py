"""전처리 — ffmpeg(오디오 추출·음성 유무 감지) + OpenCV(키프레임·초점)."""
from __future__ import annotations

import glob as _glob
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
    camera: str = ""                # 카메라 제조사·모델 (메타 태그, 없으면 "")
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


def _extract_camera(video_path: str) -> str:
    """카메라 제조사·모델 추출. QuickTime/일반 메타 태그(make/model)를 우선 사용.
    예: DJI 드론 → "DJI FC3582", iPhone → "Apple iPhone 15 Pro". 없으면 ''."""
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags",
             "-of", "json", video_path]
        )
        data = json.loads(out)
        tags: dict = {}
        if "format" in data:
            tags.update(data["format"].get("tags", {}) or {})
        for s in data.get("streams", []):
            tags.update(s.get("tags", {}) or {})

        # 키를 소문자로 정규화해 ...make / ...model 로 끝나는 태그를 찾는다.
        low = {k.lower(): v for k, v in tags.items() if isinstance(v, str) and v.strip()}

        def find(suffix: str) -> str:
            for k, v in low.items():
                if k.endswith(suffix):
                    return v.strip()
            return ""

        make, model = find("make"), find("model")
        if make and model:
            # 중복 표기 방지: model에 make가 이미 들어있으면 model만
            return model if make.lower() in model.lower() else f"{make} {model}"
        return model or make or ""
    except Exception:
        return ""


def extract_filmstrip(video_path: str, out_dir: str, interval: float = 1.0,
                      max_frames: int = 1800) -> tuple[list[str], list[float]]:
    """표 호버 스크럽용 필름스트립 — `interval`초마다 1장씩 작은 jpg로 추출.
    ffmpeg fps 필터로 한 번의 디코드 패스에서 뽑아 빠르다. (VLM 키프레임과 별개)"""
    os.makedirs(out_dir, exist_ok=True)
    interval = max(0.5, float(interval))
    rate = 1.0 / interval  # 예: 5초 → 0.2fps
    pattern = os.path.join(out_dir, "%04d.jpg")
    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path,
         "-vf", f"fps={rate:.6g},scale=160:-2",
         "-frames:v", str(max_frames), "-q:v", "6", pattern],
        check=True, capture_output=True,
    )
    files = sorted(_glob.glob(os.path.join(out_dir, "*.jpg")))
    times = [round(i * interval, 2) for i in range(len(files))]
    return files, times


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


def _uniform_times(duration: float) -> list[float]:
    """길이에 비례한 N장 균등 간격 시각(폴백)."""
    minutes = max(duration / 60.0, 0.01)
    n = int(min(settings.keyframe_max,
                max(settings.keyframe_min, round(minutes * settings.keyframe_per_minute))))
    return [duration * (i + 0.5) / n for i in range(n)]


def _detect_scene_times(video_path: str, duration: float) -> list[float]:
    """장면 전환을 검출해 각 장면의 대표 시각(중앙)을 반환.

    저해상도 HSV 히스토그램의 Bhattacharyya 거리로 컷을 찾고, 장면 구간의
    중앙 프레임을 대표로 삼는다. 장면 수가 너무 많으면(상한 초과) 균등 추려내고,
    너무 적으면 균등 샘플링으로 폴백한다."""
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(fps / max(settings.scene_sample_fps, 0.1))))

    boundaries = [0.0]          # 장면 시작 시각들
    prev_hist = None
    frame_idx = 0
    while True:
        if not cap.grab():
            break
        if frame_idx % step == 0:
            ok, frame = cap.retrieve()
            if ok and frame is not None:
                small = cv2.resize(frame, (160, 90))
                hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
                hist = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
                cv2.normalize(hist, hist)
                if prev_hist is not None:
                    d = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA)
                    if d > settings.scene_threshold:
                        boundaries.append(frame_idx / fps)
                prev_hist = hist
        frame_idx += 1
    cap.release()

    edges = boundaries + [duration]
    scene_mids = [(edges[i] + edges[i + 1]) / 2 for i in range(len(edges) - 1)]
    scene_mids = [t for t in scene_mids if 0 <= t <= duration]

    if len(scene_mids) < settings.keyframe_min:
        return _uniform_times(duration)           # 장면이 거의 없으면 균등 폴백
    if len(scene_mids) > settings.keyframe_max:    # 너무 많으면 균등 추려내기
        idxs = [round(i * (len(scene_mids) - 1) / (settings.keyframe_max - 1))
                for i in range(settings.keyframe_max)]
        scene_mids = [scene_mids[i] for i in sorted(set(idxs))]
    return scene_mids


def _sample_keyframes(video_path: str, duration: float, workdir: str
                      ) -> tuple[list[str], list[float], float]:
    """장면 전환 기반(기본) 또는 균등 간격으로 키프레임 추출 + 라플라시안 초점 점수."""
    if getattr(settings, "scene_detect", True):
        try:
            times_sel = _detect_scene_times(video_path, duration)
        except Exception:
            times_sel = _uniform_times(duration)   # 검출 실패 시 균등 폴백
    else:
        times_sel = _uniform_times(duration)

    cap = cv2.VideoCapture(video_path)
    paths: list[str] = []
    times: list[float] = []
    focus_vals: list[float] = []

    for i, t in enumerate(times_sel):
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
    camera = _extract_camera(video_path)

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
        camera=camera,
        keyframes=keyframes,
        keyframe_times=times,
        focus_score=focus,
    )
