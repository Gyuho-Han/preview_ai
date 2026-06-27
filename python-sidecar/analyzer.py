"""베스트 파이프라인 오케스트레이션 (문서 2번 그대로).

[영상] → ffmpeg(오디오/키프레임/음성감지)
       → (음성 있음) Qwen3-ASR(MLX) 자막
       → Qwen2.5-VL 키프레임 장면 설명 (모든 영상)
       → Qwen3 융합 (한줄요약·장면·키워드·인물)
       → bge-m3 임베딩 → 추천도(0.7×연관성 + 0.3×기술품질)
"""
from __future__ import annotations

import os
import shutil
import tempfile
from typing import Callable

import embed
import llm
import preprocess
import scoring
import stt
from config import settings
import vlm

# 진행률 콜백 시그니처: (stage: str, pct: int) -> None
ProgressCb = Callable[[str, int], None]


def _fmt_ts(sec: float) -> str:
    """초 → mm:ss (1시간 이상이면 h:mm:ss)."""
    sec = int(round(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _build_scenes(keyframe_times: list[float], scene_descs: list[str]) -> list[dict]:
    """타임스탬프별 장면 목록을 '실제' 키프레임 시각으로 구성.
    (LLM이 시각을 지어내지 않도록, 장면 검출로 얻은 진짜 시각을 쓴다.)"""
    return [
        {"time": _fmt_ts(t), "desc": (d or "").strip()}
        for t, d in zip(keyframe_times, scene_descs)
        if (d or "").strip()
    ]


def analyze_plan_document(path: str) -> dict:
    """P2 — 기획안 분석 + 키워드 임베딩 저장(추천도 기준점)."""
    from pdf_parse import extract_text

    text = extract_text(path)
    context = llm.analyze_plan(text)
    # 추천도 기준 임베딩: 주제 + 키워드를 합쳐 임베딩
    basis = " ".join(
        [context.get("topic", "")] + context.get("keywords", [])
    ).strip() or text[:2000]
    context["_plan_embedding"] = embed.embed(basis)
    context["_plan_text_used"] = basis
    return context


def analyze_video(video_path: str,
                  plan_embedding: list[float] | None = None,
                  plan_keywords: list[str] | None = None,
                  progress: ProgressCb | None = None,
                  frames_dir: str | None = None) -> dict:
    """단일 영상 → 표 1행에 들어갈 분석 결과 dict.

    frames_dir: 키프레임(썸네일+호버 스크럽용)을 영구 보관할 클립별 디렉토리.
                없으면 임시(workdir) 경로를 그대로 반환 → 곧 정리됨."""
    plan_keywords = plan_keywords or []
    workdir = tempfile.mkdtemp(prefix="preview_")

    def _p(stage: str, pct: int) -> None:
        if progress:
            progress(stage, pct)

    try:
        # 2. 전처리
        _p("전처리(ffmpeg/키프레임)", 10)
        pre = preprocess.preprocess(video_path, workdir)

        # 3. STT (음성 있을 때만)
        transcript = stt.Transcript(text="", segments=[])
        if pre.has_speech and pre.audio_path:
            _p("음성 인식(Qwen3-ASR)", 35)
            transcript = stt.transcribe(pre.audio_path)
        else:
            _p("음성 없음 — VLM 단독 분기", 35)

        # 4. VLM 장면 설명 (모든 영상)
        _p("장면 설명(VLM)", 55)
        scene_descs = vlm.describe_keyframes(pre.keyframes)

        # 5. 콘텐츠 융합 분석
        _p("콘텐츠 분석(Qwen3)", 75)
        content = llm.analyze_content(transcript.text, scene_descs, plan_keywords)

        # 6. 추천도
        _p("추천도 계산(임베딩)", 90)
        clip_text = " ".join(
            [transcript.text]
            + scene_descs
            + content.get("keywords", [])
        ).strip()
        if plan_embedding:
            relevance = embed.relevance_score(clip_text, plan_embedding)
        else:
            relevance = 0.0  # 기획안 미업로드 시 연관성 0 (기술품질만 반영)
        quality = scoring.quality_score(
            pre.focus_score, pre.audio_rms_dbfs, pre.has_speech
        )
        rec = scoring.recommendation(relevance, quality)

        _p("완료", 100)

        # 표/상세용 보존 데이터
        #   - thumbnail: 첫 VLM 키프레임(대표 장면)
        #   - frames/frame_times: 표 호버 스크럽용 필름스트립(5초당 1장)
        thumb = None
        frames: list[str] = []
        frame_times: list[float] = []
        if frames_dir:
            os.makedirs(frames_dir, exist_ok=True)
            if pre.keyframes:
                thumb = os.path.join(frames_dir, "thumb.jpg")
                shutil.copyfile(pre.keyframes[0], thumb)
            # 스크럽 필름스트립(5초당 1프레임) — VLM 키프레임과 별개로 촘촘히
            try:
                frames, frame_times = preprocess.extract_filmstrip(
                    video_path, os.path.join(frames_dir, "strip"),
                    interval=settings.scrub_interval,
                )
            except Exception:
                frames, frame_times = [], []
            if not frames and pre.keyframes:   # 폴백: VLM 키프레임 사용
                for i, kf in enumerate(pre.keyframes):
                    d = os.path.join(frames_dir, f"{i:03d}.jpg")
                    shutil.copyfile(kf, d)
                    frames.append(d)
                frame_times = list(pre.keyframe_times)
            if thumb is None and frames:
                thumb = frames[0]
        elif pre.keyframes:
            frames = list(pre.keyframes)
            frame_times = list(pre.keyframe_times)
            thumb = frames[0]
        return {
            "filename": os.path.basename(video_path),
            "filepath": video_path,
            "thumbnail": thumb,
            "frames": frames,                       # 호버 스크럽 필름스트립(5초 간격)
            "frame_times": frame_times,              # 각 프레임 시각(초)
            "duration_sec": pre.duration_sec,
            "date": pre.recorded_date,
            "place": content.get("place", ""),
            "camera": pre.camera,  # 영상 메타데이터에서 추출한 카메라 제조사·모델
            "people": content.get("people", []),
            "one_line": content.get("one_line", ""),
            "summary": content.get("summary", ""),
            # 타임스탬프별 장면: 실제 키프레임 시각 + VLM 설명 (LLM 추측 아님)
            "scenes": _build_scenes(pre.keyframe_times, scene_descs),
            "keywords": content.get("keywords", []),
            "ai_comment": content.get("ai_comment", ""),
            "has_speech": pre.has_speech,
            "transcript": transcript.text,
            "transcript_segments": transcript.segments,
            "scene_descriptions": scene_descs,
            "focus_score": pre.focus_score,
            "audio_rms_dbfs": pre.audio_rms_dbfs,
            "relevance": relevance,
            "quality": quality,
            "recommendation": rec,
            "color": scoring.color_for(rec),
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
