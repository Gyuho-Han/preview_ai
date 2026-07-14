"""베스트 파이프라인 오케스트레이션.

[영상] → ffmpeg/ffprobe 전처리(오디오·필름스트립 1회 디코드·장면검출)
       → Silero VAD 말소리 구간 → (있으면) Qwen3-ASR(MLX) 구간별 자막
       → Qwen2.5-VL 키프레임 장면 설명 (모든 영상)
       → Qwen3 융합: 자막(음성)+시각설명(타임스탬프)+기획서 맥락 → 프리뷰 노트
       → bge-m3 임베딩 → 추천도(연관성×서사강도, 기술품질은 경고로 분리)
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


def _fmt_ts(sec: float) -> str:
    """초 → mm:ss (1시간 이상이면 h:mm:ss)."""
    sec = int(round(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _build_scenes(keyframe_times: list[float], scene_descs: list[str]) -> list[dict]:
    """타임스탬프별 장면 목록을 '실제' 키프레임 시각으로 구성.
    (LLM이 시각을 지어내지 않도록, 장면 검출로 얻은 진짜 시각을 쓴다.)
    t(초)는 상세페이지에서 정확한 시크·자막 매핑에 사용."""
    return [
        {"time": _fmt_ts(t), "t": round(t, 2), "desc": (d or "").strip()}
        for t, d in zip(keyframe_times, scene_descs)
        if (d or "").strip()
    ]


def _attach_scene_speech(scenes: list[dict], segments: list[dict]) -> None:
    """각 장면에 그 구간의 음성 자막을 붙인다 (상세페이지 '장면별 오디오' 표시용).

    장면 i의 구간 = [장면 i 시각, 장면 i+1 시각). 첫 장면은 0초부터, 마지막
    장면은 끝까지 커버해 어떤 자막 세그먼트도 누락되지 않는다."""
    if not scenes:
        return
    bounds = [s["t"] for s in scenes]
    for i, sc in enumerate(scenes):
        lo = 0.0 if i == 0 else bounds[i]
        hi = bounds[i + 1] if i + 1 < len(bounds) else float("inf")
        texts = [
            (seg.get("text") or "").strip()
            for seg in segments
            if lo <= float(seg.get("start", 0.0)) < hi
        ]
        sc["speech"] = " ".join(t for t in texts if t).strip()


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
                  frames_dir: str | None = None,
                  plan_context: dict | None = None) -> dict:
    """단일 영상 → 표 1행에 들어갈 분석 결과 dict.

    frames_dir: 키프레임(썸네일+호버 스크럽용)을 영구 보관할 클립별 디렉토리.
                없으면 임시(workdir) 경로를 그대로 반환 → 곧 정리됨.
    plan_context: 기획서 맥락(주제·인물·장소·톤앤무드·키워드 등). 최종 요약이
                  자막·시각설명뿐 아니라 프로젝트 방향까지 반영하도록 LLM에 전달."""
    plan_keywords = plan_keywords or []
    workdir = tempfile.mkdtemp(prefix="preview_")

    def _p(stage: str, pct: int) -> None:
        if progress:
            progress(stage, pct)

    try:
        # 1. 전처리 — 디코드 1회(필름스트립)로 장면검출·스크럽 프레임까지 해결.
        #    필름스트립은 frames_dir에 바로 저장해 별도 복사/재추출이 없다.
        _p("전처리(ffmpeg/키프레임/VAD)", 10)
        strip_dir = os.path.join(frames_dir, "strip") if frames_dir else None
        if strip_dir:
            os.makedirs(strip_dir, exist_ok=True)
        pre = preprocess.preprocess(video_path, workdir, strip_dir=strip_dir)

        # 2. STT — VAD가 찾은 '말소리 구간'만 잘라 인식 (비음성 환각 차단)
        #    STT(mlx) 로드/추론 실패가 클립 전체를 죽이지 않도록 방어:
        #    실패 시 자막만 비우고 VLM·추천도 등 나머지 단계는 정상 진행한다.
        transcript = stt.Transcript(text="", segments=[])
        if pre.has_speech and pre.audio_path:
            _p("음성 인식(Qwen3-ASR)", 35)
            try:
                transcript = stt.transcribe(pre.audio_path, regions=pre.speech_regions)
            except Exception as e:  # noqa: BLE001 — STT 실패는 치명적이지 않게
                import sys
                import traceback
                print(f"[stt] 자막 생성 실패 — 자막 없이 VLM 단독으로 진행: {e}",
                      file=sys.stderr)
                traceback.print_exc()
                transcript = stt.Transcript(text="", segments=[])
        else:
            _p("음성 없음 — VLM 단독 분기", 35)

        # 3. VLM 장면 설명 (모든 영상)
        _p("장면 설명(VLM)", 55)
        scene_descs = vlm.describe_keyframes(pre.keyframes)

        # 4. 콘텐츠 융합 분석 — 장면 설명에 실제 키프레임 시각을 붙여 전달
        #    (LLM이 클립의 시간 흐름을 따라 요약을 구성)
        _p("콘텐츠 분석(Qwen3)", 75)
        scenes = _build_scenes(pre.keyframe_times, scene_descs)
        _attach_scene_speech(scenes, transcript.segments)  # 장면별 오디오 자막 매핑
        content = llm.analyze_content(
            transcript.text, scenes, plan_keywords, plan_context=plan_context,
        )

        # 5. 추천도
        _p("추천도 계산(임베딩)", 90)
        clip_text = " ".join(
            [transcript.text]
            + scene_descs
            + content.get("keywords", [])
        ).strip()
        if plan_embedding:
            relevance = embed.relevance_score(clip_text, plan_embedding)
        else:
            relevance = 0.0  # 기획안 미업로드 시 연관성 0 (서사강도만 반영)
        if "narrative_score" not in content:
            import sys
            print("[llm] narrative_score 없음(스키마 미준수) — 0으로 처리", file=sys.stderr)
            llm_narrative = 0.0
        else:
            try:
                llm_narrative = float(content["narrative_score"])
            except (TypeError, ValueError):
                import sys
                print(f"[llm] narrative_score 형식 이상(값: {content['narrative_score']!r}) — 0으로 처리",
                      file=sys.stderr)
                llm_narrative = 0.0
        narrative = scoring.narrative_score(llm_narrative, pre.motion_score, pre.face_score)
        rec = scoring.recommendation(relevance, narrative)
        warnings = scoring.quality_warnings(pre.focus_score, pre.duration_sec, pre.blank_ratio)

        _p("완료", 100)

        # 표/상세용 보존 데이터
        #   - thumbnail: 첫 VLM 키프레임(대표 장면)
        #   - frames/frame_times: 전처리에서 만든 필름스트립을 그대로 사용
        thumb = None
        frames = list(pre.strip_frames)
        frame_times = list(pre.strip_times)
        if frames_dir:
            os.makedirs(frames_dir, exist_ok=True)
            if pre.keyframes:
                thumb = os.path.join(frames_dir, "thumb.jpg")
                shutil.copyfile(pre.keyframes[0], thumb)
            if not frames and pre.keyframes:   # 필름스트립 실패 폴백: VLM 키프레임 복사
                for i, kf in enumerate(pre.keyframes):
                    d = os.path.join(frames_dir, f"{i:03d}.jpg")
                    shutil.copyfile(kf, d)
                    frames.append(d)
                frame_times = list(pre.keyframe_times)
            if thumb is None and frames:
                thumb = frames[0]
        else:
            # frames_dir 없음(임시 모드): 워크디렉토리 정리로 곧 사라지는 경로들
            if not frames and pre.keyframes:
                frames = list(pre.keyframes)
                frame_times = list(pre.keyframe_times)
            thumb = frames[0] if frames else None
        return {
            "filename": os.path.basename(video_path),
            "filepath": video_path,
            "thumbnail": thumb,
            "frames": frames,                       # 호버 스크럽 필름스트립
            "frame_times": frame_times,              # 각 프레임 시각(초)
            "duration_sec": pre.duration_sec,
            "date": pre.recorded_date,
            "place": content.get("place", ""),
            "camera": pre.camera,  # 영상 메타데이터에서 추출한 카메라 제조사·모델
            "people": content.get("people", []),
            "one_line": content.get("one_line", ""),
            "summary": content.get("summary", ""),
            # 타임스탬프별 장면: 실제 키프레임 시각 + VLM 설명 (LLM 추측 아님)
            "scenes": scenes,
            "keywords": content.get("keywords", []),
            "ai_comment": content.get("ai_comment", ""),
            "has_speech": pre.has_speech,
            "transcript": transcript.text,
            "transcript_segments": transcript.segments,
            "scene_descriptions": scene_descs,
            "focus_score": pre.focus_score,
            "audio_rms_dbfs": pre.audio_rms_dbfs,
            "relevance": relevance,
            "narrative": narrative,
            "warnings": warnings,
            "recommendation": rec,
            "color": scoring.color_for(rec),
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
