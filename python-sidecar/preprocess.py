"""전처리 — ffmpeg/ffprobe + OpenCV.

효율 설계:
- ffprobe 1회로 길이·촬영일·카메라를 한꺼번에 조회(기존 3회 → 1회).
- 영상 디코드는 필름스트립(ffmpeg, 저해상도 1fps) 1회가 전부.
  장면 전환 검출은 그 필름스트립 jpg들로 수행하고(추가 디코드 없음),
  선택된 시각만 OpenCV 시크로 풀해상도 키프레임을 뽑는다.
  (기존: 장면검출 전체 프레임 스캔 + 키프레임 + 필름스트립 = 3회 디코드)
- 음성 유무는 RMS(1차, 값싼 필터) → Silero VAD(2차, 말소리 전용)로 판정하고
  말소리 구간을 STT에 넘겨 비음성 환각을 차단한다.
"""
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

import vad
from config import settings


@dataclass
class Preprocessed:
    duration_sec: float
    audio_path: str | None          # 추출된 16kHz mono wav (음성 없으면 None)
    has_speech: bool
    audio_rms_dbfs: float
    recorded_date: str = ""         # 촬영 날짜 YYYY-MM-DD (메타 → 파일시간 폴백)
    camera: str = ""                # 카메라 제조사·모델 (메타 태그, 없으면 "")
    speech_regions: list[tuple[float, float]] = field(default_factory=list)  # VAD 말소리 구간(초)
    keyframes: list[str] = field(default_factory=list)  # 풀해상도 jpg (VLM 입력)
    keyframe_times: list[float] = field(default_factory=list)
    strip_frames: list[str] = field(default_factory=list)  # 호버 스크럽용 저해상도 jpg
    strip_times: list[float] = field(default_factory=list)
    focus_score: float = 0.0        # 0~100 (라플라시안 분산 정규화)


# ---- 메타데이터 (ffprobe 1회) ----------------------------------------------
def _probe(video_path: str) -> tuple[float, str, str]:
    """(duration_sec, recorded_date, camera)를 단일 ffprobe 호출로 조회."""
    import datetime

    duration, date, camera = 0.0, "", ""
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error",
             "-show_entries", "format=duration:format_tags:stream_tags",
             "-of", "json", video_path]
        )
        data = json.loads(out)

        fmt = data.get("format", {}) or {}
        try:
            duration = float(fmt.get("duration", 0.0) or 0.0)
        except (TypeError, ValueError):
            duration = 0.0

        # 태그 통합(format 우선, stream 보충)
        tags: dict = {}
        for s in data.get("streams", []):
            tags.update(s.get("tags", {}) or {})
        tags.update(fmt.get("tags", {}) or {})
        low = {k.lower(): v for k, v in tags.items()
               if isinstance(v, str) and v.strip()}

        # 촬영 날짜: creation_time 계열 태그. 예: "2026-05-01T10:23:45Z" → "2026-05-01"
        for k, v in low.items():
            if k.endswith("creation_time"):
                date = v[:10]
                break

        # 카메라: ...make / ...model 로 끝나는 태그
        def find(suffix: str) -> str:
            for k, v in low.items():
                if k.endswith(suffix):
                    return v.strip()
            return ""

        make, model = find("make"), find("model")
        if make and model:
            camera = model if make.lower() in model.lower() else f"{make} {model}"
        else:
            camera = model or make or ""
    except Exception:
        pass

    if not date:  # 파일 수정 시각 폴백
        try:
            ts = os.path.getmtime(video_path)
            date = datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
        except Exception:
            date = ""
    return duration, date, camera


# ---- 오디오 -----------------------------------------------------------------
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
    """16kHz mono wav 추출 (Qwen3-ASR/Silero VAD 입력 규격)."""
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


# ---- 필름스트립 (유일한 전체 디코드 패스) -----------------------------------
def extract_filmstrip(video_path: str, out_dir: str, interval: float = 1.0,
                      max_frames: int = 1800) -> tuple[list[str], list[float]]:
    """`interval`초마다 1장씩 작은 jpg 추출. 표 호버 스크럽 + 장면검출에 공용.
    ffmpeg fps 필터로 한 번의 디코드 패스에서 뽑는다."""
    os.makedirs(out_dir, exist_ok=True)
    interval = max(0.5, float(interval))
    rate = 1.0 / interval  # 예: 1초 → 1fps
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


# ---- 키프레임 선택 -----------------------------------------------------------
def _uniform_times(duration: float) -> list[float]:
    """길이에 비례한 N장 균등 간격 시각(폴백)."""
    minutes = max(duration / 60.0, 0.01)
    n = int(min(settings.keyframe_max,
                max(settings.keyframe_min, round(minutes * settings.keyframe_per_minute))))
    return [duration * (i + 0.5) / n for i in range(n)]


def _detect_scene_times(strip_frames: list[str], strip_times: list[float],
                        duration: float) -> list[float]:
    """필름스트립 jpg들로 장면 전환을 검출해 각 장면의 대표 시각(중앙)을 반환.

    저해상도 HSV 히스토그램의 Bhattacharyya 거리로 컷을 찾는다. 이미 추출된
    작은 이미지를 읽기만 하므로 영상 재디코드가 없다. 장면 수가 상한을 넘으면
    균등 추려내고, 너무 적으면 균등 샘플링으로 폴백한다."""
    if len(strip_frames) < 2:
        return _uniform_times(duration)

    boundaries = [strip_times[0]]           # 장면 시작 시각들
    prev_hist = None
    for path, t in zip(strip_frames, strip_times):
        img = cv2.imread(path)
        if img is None:
            continue
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        if prev_hist is not None:
            d = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA)
            if d > settings.scene_threshold:
                boundaries.append(t)
        prev_hist = hist

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


def _grab_keyframes(video_path: str, times_sel: list[float], workdir: str
                    ) -> tuple[list[str], list[float], float]:
    """선택된 시각만 시크해 풀해상도 키프레임 저장 + 라플라시안 초점 점수."""
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


# ---- 메인 -------------------------------------------------------------------
def preprocess(video_path: str, workdir: str | None = None,
               strip_dir: str | None = None) -> Preprocessed:
    """영상 1개 전처리. strip_dir을 주면 필름스트립을 거기 영구 보관(호버 스크럽용)."""
    workdir = workdir or tempfile.mkdtemp(prefix="preview_")
    duration, recorded_date, camera = _probe(video_path)

    # 오디오: RMS(값싼 1차 필터) → Silero VAD(말소리 구간)
    audio_path = None
    rms = -99.0
    has_speech = False
    regions: list[tuple[float, float]] = []
    if _has_audio_stream(video_path):
        audio_path = extract_audio(video_path, workdir)
        rms = _measure_rms_dbfs(audio_path)
        if rms > settings.silence_dbfs:
            found = vad.speech_regions(audio_path)
            if found is None:                  # VAD 미설치 폴백: 기존 RMS 기준
                has_speech = True
            else:
                regions = found
                has_speech = vad.total_speech(regions) >= settings.vad_min_total_speech

    # 필름스트립(유일한 전체 디코드) → 장면검출 → 선택 시각만 풀해상도 시크
    strip_frames: list[str] = []
    strip_times: list[float] = []
    try:
        strip_frames, strip_times = extract_filmstrip(
            video_path, strip_dir or os.path.join(workdir, "strip"),
            interval=settings.scrub_interval,
        )
    except Exception:
        strip_frames, strip_times = [], []

    if settings.scene_detect and strip_frames:
        try:
            times_sel = _detect_scene_times(strip_frames, strip_times, duration)
        except Exception:
            times_sel = _uniform_times(duration)
    else:
        times_sel = _uniform_times(duration)

    keyframes, times, focus = _grab_keyframes(video_path, times_sel, workdir)

    return Preprocessed(
        duration_sec=round(duration, 2),
        audio_path=audio_path if has_speech else None,
        has_speech=has_speech,
        audio_rms_dbfs=round(rms, 1),
        recorded_date=recorded_date,
        camera=camera,
        speech_regions=regions,
        keyframes=keyframes,
        keyframe_times=times,
        strip_frames=strip_frames,
        strip_times=strip_times,
        focus_score=focus,
    )
