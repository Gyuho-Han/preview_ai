"""VLM — Qwen2.5-VL로 키프레임 장면 설명 생성 (모든 영상).

장면 설명(영상내용)의 작성 기준은 docs/analysis-fields.md §3 참고 —
요약·키워드·추천도 임베딩이 모두 이 설명을 근거로 하므로, 제1 원칙은
"프레임에 실제로 보이는 것만 기록"(객체 환각·추측 차단)이다.

Qwen2.5-VL은 다국어 모델이라 프롬프트가 한국어여도 이따금 일본어·중국어로
응답한다. 시스템 메시지로 한국어를 강제하고, 응답의 한글 비율을 검사해
한국어가 아니면 1회 재시도한다.
"""
from __future__ import annotations

import ollama

from config import settings
from llm import chat_content

_SYSTEM = (
    "너는 다큐멘터리 편집자를 위해 영상 키프레임에 실제로 보이는 것만 기록하는 "
    "도우미다. 어떤 경우에도 반드시 한국어(한글)로만 답한다. "
    "일본어·중국어·영어로 답하지 마라."
)
# 작성 기준: docs/analysis-fields.md §3 — 피사체→행동→환경→구도 우선순위,
# 관찰만 기록(정지 프레임 1장에서 확인 불가한 것은 추측 금지)
_PROMPT = (
    "이 영상 키프레임에 실제로 보이는 것만 한국어 1~2문장으로 기록하세요.\n"
    "이 순서로: ①피사체(인물 수·눈에 띄는 외형, 중심 사물) ②하고 있는 행동·상황 "
    "③장소·환경(실내/실외, 조명·날씨) ④구도(클로즈업/미디엄/와이드)는 두드러질 때만.\n"
    "- 간판·문서·자막 등 판독 가능한 글자가 있으면 그대로 기록하세요.\n"
    "- 정지 화면 한 장에서 확인할 수 없는 것(움직임의 방향, 전후 상황, "
    "인물의 감정·의도)은 추측하지 마세요. 불확실한 것은 쓰지 마세요.\n"
    "- 분위기를 단정하는 수식(예: '평화로운') 대신 그렇게 보이게 하는 요소"
    "(빛·날씨·표정)를 쓰세요.\n"
    "- '이 장면은', '화면에는' 같은 군더더기 없이 내용부터 시작하세요."
)
_PROMPT_RETRY = (
    "반드시 한국어(한글)로만 답하세요. 일본어나 중국어로 쓰지 마세요.\n" + _PROMPT
)


def _is_korean(text: str) -> bool:
    """한글 음절 비율로 한국어 응답인지 판정(구두점·숫자·고유명사 감안해 낮은 임계값)."""
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return True
    hangul = sum(1 for c in chars if "가" <= c <= "힣")
    return hangul / len(chars) >= 0.2


def _describe_one(client: ollama.Client, path: str, prompt: str) -> str:
    resp = client.chat(
        model=settings.vlm_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": prompt, "images": [path]},
        ],
        options={"temperature": 0.2},
        # 30m: 클립 배치 분석 동안 VLM이 언로드/재로드되지 않게 유지
        keep_alive="30m",
    )
    return chat_content(resp).strip()


def describe_keyframes(keyframe_paths: list[str]) -> list[str]:
    """각 키프레임에 대한 장면 설명 리스트를 반환. 비한국어 응답은 1회 재시도."""
    client = ollama.Client(host=settings.ollama_host)
    descriptions: list[str] = []
    for path in keyframe_paths:
        try:
            desc = _describe_one(client, path, _PROMPT)
            if not _is_korean(desc):
                desc = _describe_one(client, path, _PROMPT_RETRY)
            descriptions.append(desc)
        except Exception as e:  # 한 프레임 실패가 전체를 막지 않게
            descriptions.append(f"(장면 분석 실패: {e})")
    return descriptions
