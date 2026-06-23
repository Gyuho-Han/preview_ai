"""VLM — Qwen2.5-VL로 키프레임 장면 설명 생성 (모든 영상)."""
from __future__ import annotations

import ollama

from config import settings
from llm import chat_content

_PROMPT = (
    "이 영상 키프레임을 한국어로 1~2문장으로 묘사하세요. "
    "장소, 등장 인물 수와 행동, 분위기를 구체적으로. 추측은 자제하고 보이는 것만."
)


def describe_keyframes(keyframe_paths: list[str]) -> list[str]:
    """각 키프레임에 대한 장면 설명 리스트를 반환."""
    client = ollama.Client(host=settings.ollama_host)
    descriptions: list[str] = []
    for path in keyframe_paths:
        try:
            resp = client.chat(
                model=settings.vlm_model,
                messages=[{"role": "user", "content": _PROMPT, "images": [path]}],
                options={"temperature": 0.2},
                keep_alive="2m",
            )
            descriptions.append(chat_content(resp).strip())
        except Exception as e:  # 한 프레임 실패가 전체를 막지 않게
            descriptions.append(f"(장면 분석 실패: {e})")
    return descriptions
