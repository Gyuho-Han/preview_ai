"""STT — Qwen3-ASR via mlx-audio. VAD가 골라낸 '말소리 구간'만 인식한다.

- mlx-community/Qwen3-ASR-* 저장소는 mlx-audio 라이브러리용으로 변환된 것이라
  양자화(8-bit/4-bit) 가중치를 그대로 로드할 수 있다(전용 dequantize 지원).
- 모델은 무겁기 때문에 프로세스당 1회만 로드해 재사용한다(스레드 안전).
- 비음성(바람·음악·소음) 구간을 ASR에 넣으면 중국어 혼입·반복 환각이 생기므로,
  preprocess의 Silero VAD 구간별로 오디오를 잘라 개별 인식하고 타임스탬프를
  구간 시작 시각만큼 보정한다. 사후 텍스트 필터(한자 제거·반복 감지)는 2차 방어선.
"""
from __future__ import annotations

import inspect
import os
import re
import threading
import wave
from collections import Counter
from dataclasses import dataclass, field

from config import settings


@dataclass
class Transcript:
    text: str
    segments: list[dict] = field(default_factory=list)  # {start, end, text}
    language: str = "ko"


# CJK 한자(Han) 범위 — 한국어 자막에 섞여 나오는 중국어 오인식/환각을 잡는다.
# 반드시 명시적 이스케이프로 쓸 것: 예전에 리터럴 문자('豈-﫿')로 쓰다가
# 호환 한자 U+F900('豈')가 모양이 같은 일반 한자 U+8C48로 저장되는 바람에
# 범위가 U+8C48–U+FAFF로 벌어져 한글 음절(U+AC00–U+D7A3) 전체가 "한자"로
# 판정 → 한국어 자막이 통째로 삭제되는 버그가 있었다.
#   U+3400-4DBF: 확장 A / U+4E00-9FFF: 통합 한자 / U+F900-FAFF: 호환 한자
_HAN_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+")


def _han_ratio(text: str) -> float:
    """공백 제외 글자 중 한자(Han) 비율."""
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    han = sum(len(m) for m in _HAN_RE.findall("".join(chars)))
    return han / len(chars)


def _hangul_ratio(text: str) -> float:
    """공백 제외 글자 중 한글 음절(가~힣) 비율."""
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    hangul = sum(1 for c in chars if "가" <= c <= "힣")
    return hangul / len(chars)


def _is_chinese_hallucination(text: str) -> bool:
    """한자 위주 + 한글 거의 없음 → 중국어 환각 덩어리로 판정.
    (한자 비율만 보면 한국어·중국어가 반반 섞인 텍스트에서 멀쩡한
    한국어까지 통째로 버리게 되므로, 한글 비율을 함께 본다)"""
    return _han_ratio(text) >= 0.5 and _hangul_ratio(text) < 0.2


def _strip_chinese(text: str) -> str:
    """한국어 자막에 섞인 중국어(한자) 런을 걷어내고 공백/구두점을 정리."""
    if not _HAN_RE.search(text):
        return text
    cleaned = _HAN_RE.sub(" ", text)                 # 한자 런 → 공백
    cleaned = re.sub(r"\s+([,.!?…、。])", r"\1", cleaned)  # 붕 뜬 구두점 앞 공백 제거
    cleaned = re.sub(r"\s{2,}", " ", cleaned)        # 중복 공백 축소
    return cleaned.strip()


def _filter_chinese(text: str, segments: list[dict]) -> tuple[str, list[dict]]:
    """Qwen3-ASR(다국어) 이 한국어 발화를 중국어로 오인식/환각한 부분을 제거.

    - 세그먼트가 있으면: 한자 비중이 높은 세그먼트(중국어 덩어리)는 통째로 버리고,
      나머지는 섞인 한자 런만 걷어낸다. 전체 텍스트는 살아남은 세그먼트로 재구성.
    - 세그먼트가 없으면: 전체가 대부분 한자면 환각으로 보고 비운다(음성 없음 처리 →
      VLM 장면 설명이 커버). 아니면 섞인 한자 런만 제거한다.
    """
    if segments:
        kept: list[dict] = []
        for s in segments:
            st = (s.get("text") or "").strip()
            if not st or _is_chinese_hallucination(st):  # 빈/중국어 덩어리 세그먼트 폐기
                continue
            cleaned = _strip_chinese(st)
            if cleaned:
                kept.append({**s, "text": cleaned})
        return " ".join(s["text"] for s in kept).strip(), kept
    if _is_chinese_hallucination(text):
        return "", []
    return _strip_chinese(text), []


def _is_degenerate(text: str) -> bool:
    """ASR 반복 환각 감지 (단어 + n-gram 수준).

    말소리가 없는데 소음이 음성으로 잡히면 모델이 한 단어나 짧은 구절을
    수백 번 반복하는 'repetition loop'에 빠진다(예: "안녕. 안녕. 안녕…",
    "감사합니다 감사합니다…"). 한 토큰 또는 한 2~3그램이 전체의 절반 안팎을
    차지하면 환각으로 보고 버린다.
    """
    words = text.split()
    n_words = len(words)
    if n_words < 8:
        return False
    if Counter(words).most_common(1)[0][1] / n_words >= 0.5:
        return True
    for n in (2, 3):
        if n_words < n * 4:
            continue
        grams = [" ".join(words[i:i + n]) for i in range(n_words - n + 1)]
        top = Counter(grams).most_common(1)[0][1]
        if top * n / n_words >= 0.5:
            return True
    return False


def _dedupe_segments(segments: list[dict]) -> list[dict]:
    """같은 문장이 3회 이상 연달아 나오는 환각 꼬리를 1회로 축약."""
    out: list[dict] = []
    run = 0
    for s in segments:
        if out and s["text"] == out[-1]["text"]:
            run += 1
            if run >= 2:          # 3번째 반복부터 버림
                out[-1]["end"] = s.get("end", out[-1]["end"])
                continue
        else:
            run = 0
        out.append(dict(s))
    return out


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


def _generate_kwargs(model) -> dict:
    """지원하는 인자만 골라서 전달(라이브러리 버전 차이 방어).
    - language: 한국어 다큐 힌트
    - repetition_penalty: 반복 환각 억제
    - temperature 0.0: 그리디(일관성)
    """
    desired = {
        "language": "ko",
        "repetition_penalty": 1.3,
        "repetition_context_size": 64,
        "temperature": 0.0,
    }
    try:
        params = inspect.signature(model.generate).parameters
        return {k: v for k, v in desired.items() if k in params}
    except (TypeError, ValueError):
        return {}


def _run_asr(model, audio_path: str, kwargs: dict) -> tuple[str, list[dict], str]:
    """단일 wav → (text, segments, language). 세그먼트 시각은 파일 기준."""
    with _infer_lock:                       # MLX 추론 직렬화(경합 방지)
        result = model.generate(audio_path, **kwargs)

    text = (getattr(result, "text", "") or "").strip()
    language = getattr(result, "language", "") or "ko"

    segments: list[dict] = []
    for s in getattr(result, "segments", None) or []:
        if isinstance(s, dict):
            segments.append({
                "start": round(float(s.get("start", 0.0) or 0.0), 2),
                "end": round(float(s.get("end", 0.0) or 0.0), 2),
                "text": (s.get("text") or "").strip(),
            })
    return text, segments, language


def _slice_wav(src_path: str, dest_path: str, start: float, end: float) -> bool:
    """16-bit mono wav에서 [start, end) 구간을 잘라 저장(재인코딩 없음)."""
    try:
        with wave.open(src_path, "rb") as wf:
            rate = wf.getframerate()
            n = wf.getnframes()
            a = max(0, min(n, int(start * rate)))
            b = max(a, min(n, int(end * rate)))
            if b - a < int(0.1 * rate):     # 0.1초 미만은 스킵
                return False
            wf.setpos(a)
            data = wf.readframes(b - a)
            params = wf.getparams()
        with wave.open(dest_path, "wb") as out:
            out.setparams(params)
            out.writeframes(data)
        return True
    except Exception:
        return False


def transcribe(audio_path: str,
               regions: list[tuple[float, float]] | None = None) -> Transcript:
    """16kHz mono wav → 자막 텍스트(+세그먼트).

    regions가 주어지면(=Silero VAD 결과) 말소리 구간만 잘라 개별 인식한다.
    비음성 구간이 ASR에 들어가지 않아 중국어 혼입·반복 환각이 원천 차단되고,
    구간 시작 시각을 더해 타임스탬프도 실제 영상 기준으로 정확해진다.
    """
    model = _get_model()
    kwargs = _generate_kwargs(model)

    all_segments: list[dict] = []
    texts: list[str] = []
    language = "ko"

    if regions:
        workdir = os.path.dirname(audio_path)
        for i, (t0, t1) in enumerate(regions):
            piece = os.path.join(workdir, f"speech_{i:03d}.wav")
            if not _slice_wav(audio_path, piece, t0, t1):
                continue
            try:
                text, segs, language = _run_asr(model, piece, kwargs)
            finally:
                try:
                    os.remove(piece)
                except OSError:
                    pass
            # 구간 단위 필터: 중국어 제거 → 반복 환각이면 구간 통째로 폐기
            text, segs = _filter_chinese(text, segs)
            if not text or _is_degenerate(text):
                continue
            if segs:
                for s in segs:              # 구간 시작 시각으로 보정
                    s["start"] = round(s["start"] + t0, 2)
                    s["end"] = round(s["end"] + t0, 2)
            else:                           # 모델이 세그먼트를 안 주면 구간으로 대체
                segs = [{"start": round(t0, 2), "end": round(t1, 2), "text": text}]
            all_segments.extend(segs)
            texts.append(text)
    else:
        # VAD 불가 폴백: 파일 전체 인식(기존 동작)
        text, segs, language = _run_asr(model, audio_path, kwargs)
        text, segs = _filter_chinese(text, segs)
        if text and not _is_degenerate(text):
            texts.append(text)
            all_segments = segs

    all_segments = _dedupe_segments(all_segments)
    full_text = " ".join(texts).strip()
    if not full_text:
        return Transcript(text="", segments=[], language=language)
    return Transcript(text=full_text, segments=all_segments, language=language)
