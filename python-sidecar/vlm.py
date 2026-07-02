"""VLM — Qwen2.5-VL로 키프레임 장면 설명 생성 (모든 영상).

Qwen2.5-VL은 다국어 모델이라 프롬프트가 한국어여도 이따금 일본어·중국어로
응답한다. 시스템 메시지로 한국어를 강제하고, 응답의 한글 비율을 검사해
한국어가 아니면 1회 재시도한다.
"""
from __future__ import annotations

import ollama

from config import settings
from llm import chat_content

_SYSTEM = (
    "너는 영상 키프레임을 묘사하는 도우미다. 어떤 경우에도 반드시 "
    "한국어(한글)로만 답한다. 일본어·중국어·영어로 답하지 마라."
)
_PROMPT = (
    "이 영상 키프레임을 한국어 1~2문장으로 묘사하세요. "
    "장소(실내/실외·환경), 인물 수와 하고 있는 행동, 화면 구도(클로즈업/와이드 등), "
    "분위기를 구체적으로. 보이는 것만 쓰고 추측·수식은 자제하세요."
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
