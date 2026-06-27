"""LLM — Qwen3 (Ollama). 기획안 구조화 + 콘텐츠 융합 분석. JSON 출력."""
from __future__ import annotations

import json
import sys

import ollama

from config import settings

# Ollama 기본 컨텍스트(num_ctx)는 2048~4096 토큰으로 매우 작다.
# 한글은 토큰 밀도가 높아 기획안 수천 자만 넣어도 이를 초과하는데,
# 그러면 Ollama가 프롬프트를 "조용히" 잘라버려 모델이 스키마 지시나
# 본문 대부분을 못 보고 빈/엉뚱한 JSON을 낸다(= 분석이 안 되는 것처럼 보임).
# 따라서 충분히 큰 컨텍스트를 명시적으로 지정한다.
_NUM_CTX = 16384


def chat_content(resp) -> str:
    """ollama chat 응답에서 message.content 추출 (dict/pydantic 모두 지원)."""
    if isinstance(resp, dict):
        return resp["message"]["content"]
    return resp.message.content


def _chat_json(prompt: str, system: str) -> dict:
    """Qwen3에 JSON 강제 출력 요청. 파싱 실패 시 명확한 에러를 발생시킨다.

    - num_ctx를 크게 잡아 긴 한글 기획안이 잘리지 않게 한다.
    - Qwen3 'thinking' 모드를 끈다(format=json과 충돌·지연 방지).
      구버전 ollama-python은 think 인자를 모르므로 안전하게 폴백한다.
    """
    client = ollama.Client(host=settings.ollama_host)
    kwargs = dict(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        format="json",
        options={"temperature": 0.2, "num_ctx": _NUM_CTX},
        keep_alive="3m",
    )
    try:
        resp = client.chat(think=False, **kwargs)
    except TypeError:
        # think 인자 미지원 구버전 → 소프트 스위치로 대체
        kwargs["messages"][0]["content"] = system + " /no_think"
        resp = client.chat(**kwargs)

    raw = chat_content(resp)
    # Qwen3가 think를 못 끈 경우 남는 <think>...</think> 블록 제거
    if "</think>" in raw:
        raw = raw.split("</think>", 1)[1]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start : end + 1])
            except json.JSONDecodeError:
                pass
    # 조용히 {}를 돌려주면 UI에 빈 값만 떠 원인을 알 수 없다 → 명확히 알린다.
    print(f"[llm] JSON 파싱 실패. 원문 일부: {raw[:300]!r}", file=sys.stderr)
    raise ValueError("LLM이 유효한 JSON을 반환하지 않았습니다. (모델/Ollama 상태 확인)")


def analyze_plan(plan_text: str) -> dict:
    """기획안 텍스트 → 프로젝트 맥락 JSON (P2 AI 자동완성)."""
    system = (
        "너는 다큐멘터리 기획안을 분석해 촬영 맥락을 구조화하는 도우미다. "
        "반드시 JSON만 출력한다."
    )
    prompt = f"""다음 기획안에서 정보를 추출해 아래 JSON 스키마로 답하라.
모르면 빈 문자열/빈 배열로 둔다.

스키마:
{{
  "title": "프로젝트명",
  "shooting_period": "촬영 기간",
  "topic": "핵심 주제 한 문장",
  "characters": ["등장인물"],
  "locations": ["장소"],
  "cameras": ["카메라/장비"],
  "keywords": ["주제 키워드 5~12개"],
  "tone_mood": "톤 앤 무드"
}}

기획안:
\"\"\"
{plan_text[:12000]}
\"\"\""""
    return _chat_json(prompt, system)


def analyze_content(transcript_text: str, scene_descriptions: list[str],
                    plan_keywords: list[str]) -> dict:
    """자막 + 시각설명 융합 → 한줄요약·장면목록·키워드·인물 (P4/P5)."""
    system = (
        "너는 영상 클립을 분석해 다큐 편집자를 위한 프리뷰 노트를 만든다. "
        "반드시 JSON만 출력한다."
    )
    scenes = "\n".join(f"- {d}" for d in scene_descriptions) or "(시각 설명 없음)"
    prompt = f"""아래 자막과 시각 설명을 종합해 JSON으로 답하라.

스키마:
{{
  "one_line": "한 줄 요약 (편집자가 5초 안에 판단 가능하게)",
  "summary": "3~5줄 요약",
  "keywords": ["키워드 5~10개"],
  "people": ["추정 등장인물/역할"],
  "place": "추정 장소",
  "ai_comment": "편집 관점 코멘트 한두 문장"
}}
※ 타임스탬프(장면 시각)는 시스템이 별도로 생성하므로 너는 만들지 마라.

참고 기획안 키워드: {", ".join(plan_keywords) or "(없음)"}

자막:
\"\"\"
{transcript_text[:5000] or "(음성 없음)"}
\"\"\"

시각 설명(키프레임별):
{scenes}"""
    return _chat_json(prompt, system)
