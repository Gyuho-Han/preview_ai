"""LLM — Qwen3 (Ollama). 기획안 구조화 + 콘텐츠 융합 분석. JSON 출력."""
from __future__ import annotations

import json

import ollama

from config import settings


def chat_content(resp) -> str:
    """ollama chat 응답에서 message.content 추출 (dict/pydantic 모두 지원)."""
    if isinstance(resp, dict):
        return resp["message"]["content"]
    return resp.message.content


def _chat_json(prompt: str, system: str) -> dict:
    """Qwen3에 JSON 강제 출력 요청. 파싱 실패 시 빈 dict."""
    client = ollama.Client(host=settings.ollama_host)
    resp = client.chat(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        format="json",
        options={"temperature": 0.2},
        keep_alive="3m",
    )
    raw = chat_content(resp)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start : end + 1])
            except json.JSONDecodeError:
                pass
    return {}


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
{plan_text[:6000]}
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
  "scenes": [{{"time": "mm:ss 또는 빈값", "desc": "장면 설명"}}],
  "keywords": ["키워드 5~10개"],
  "people": ["추정 등장인물/역할"],
  "place": "추정 장소",
  "ai_comment": "편집 관점 코멘트 한두 문장"
}}

참고 기획안 키워드: {", ".join(plan_keywords) or "(없음)"}

자막:
\"\"\"
{transcript_text[:5000] or "(음성 없음)"}
\"\"\"

시각 설명(키프레임별):
{scenes}"""
    return _chat_json(prompt, system)
