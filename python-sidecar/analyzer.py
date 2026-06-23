"""베스트 파이프라인 오케스트레이션 (문서 2번 그대로).

[영상] → ffmpeg(오디오/키프레임/음성감지)
       → (음성 있음) MLX Whisper 자막
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
import vlm

# 진행률 콜백 시그니처: (stage: str, pct: int) -> None
ProgressCb = Callable[[str, int], None]


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
                  thumb_dir: str | None = None) -> dict:
    """단일 영상 → 표 1행에 들어갈 분석 결과 dict.

    thumb_dir: 썸네일을 영구 보관할 디렉토리(없으면 임시 → 정리됨)."""
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
            _p("음성 인식(Whisper)", 35)
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

        # 표 1행 (P4 9개 컬럼 + 상세 P5 데이터)
        # 썸네일은 workdir 정리 전에 영구 디렉토리로 복사
        thumb = None
        if pre.keyframes:
            if thumb_dir:
                os.makedirs(thumb_dir, exist_ok=True)
                thumb = os.path.join(
                    thumb_dir,
                    f"{os.path.splitext(os.path.basename(video_path))[0]}_thumb.jpg",
                )
                shutil.copyfile(pre.keyframes[0], thumb)
            else:
                thumb = pre.keyframes[0]
        return {
            "filename": os.path.basename(video_path),
            "filepath": video_path,
            "thumbnail": thumb,
            "duration_sec": pre.duration_sec,
            "date": pre.recorded_date,
            "place": content.get("place", ""),
            "camera": "",  # 메타데이터에서 추후 추출
            "people": content.get("people", []),
            "one_line": content.get("one_line", ""),
            "summary": content.get("summary", ""),
            "scenes": content.get("scenes", []),
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
