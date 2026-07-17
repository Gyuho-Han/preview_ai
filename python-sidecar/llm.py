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


def _chat_json(prompt: str, system: str, temperature: float = 0.2) -> dict:
    """Qwen3에 JSON 강제 출력 요청. 파싱 실패 시 명확한 에러를 발생시킨다.

    - num_ctx를 크게 잡아 긴 한글 기획안이 잘리지 않게 한다.
    - Qwen3 'thinking' 모드를 끈다(format=json과 충돌·지연 방지).
      구버전 ollama-python은 think 인자를 모르므로 안전하게 폴백한다.
    - keep_alive 30m: 클립 배치 분석 중 모델이 언로드/재로드되지 않게 유지.
    """
    client = ollama.Client(host=settings.ollama_host)
    kwargs = dict(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        format="json",
        options={"temperature": temperature, "num_ctx": _NUM_CTX},
        keep_alive="30m",
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
        "기획안에 실제로 적힌 내용만 추출하고, 없는 정보는 지어내지 않는다. "
        "반드시 JSON만 출력한다."
    )
    prompt = f"""다음 기획안에서 정보를 추출해 아래 JSON 스키마로 답하라.
규칙:
- 기획안에 명시된 내용만 쓴다. 확실하지 않으면 빈 문자열("")/빈 배열([])로 둔다.
- keywords는 영상 검색·매칭에 쓸 핵심 명사(주제·소재·행위·장소류) 5~12개.
  조사·수식어 없이 명사형으로. (예: "해녀", "물질", "제주 바다", "세대 갈등")
- topic은 이 다큐가 무엇을 다루는지 한 문장으로.
- characters는 실명·호칭 등 기획안에 등장하는 인물 표기 그대로.

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
    return _chat_json(prompt, system, temperature=0.1)


def analyze_content(transcript_text: str, scenes: list[dict],
                    plan_keywords: list[str],
                    plan_context: dict | None = None) -> dict:
    """음성 자막 + 시각설명(VLM) + 기획서 맥락 융합 → 프리뷰 노트 (P4/P5).

    최종 영상 요약은 세 가지를 모두 근거로 삼는다.
      1) 음성 인식 자막(있을 때)  2) VLM 키프레임 장면 설명  3) 프로젝트 기획서 맥락
    scenes는 [{"time": "01:23", "desc": "..."}] 형태 — 타임스탬프를 함께 주면
    LLM이 클립의 시간 흐름을 따라 요약을 구성할 수 있어 품질이 좋아진다.
    기획서 맥락은 이 클립이 프로젝트에서 갖는 '의미·방향'을 잡는 참고이며,
    클립(자막·장면)에 실제로 없는 사실을 지어내는 근거로 쓰지 않는다.
    """
    plan_context = plan_context or {}
    system = (
        "너는 다큐멘터리 편집자를 위해 촬영 원본 클립의 프리뷰 노트를 만드는 전문가다. "
        "음성 자막, 시각 장면 설명, 프로젝트 기획서 맥락을 종합하되, "
        "실제 클립(자막·장면)에 없는 내용은 지어내지 않는다. 반드시 JSON만 출력한다."
    )
    scene_block = "\n".join(
        f"- [{s.get('time', '')}] {s.get('desc', '')}" for s in scenes if s.get("desc")
    ) or "(시각 설명 없음)"

    # --- 기획서 맥락 블록 (값이 있는 항목만 노출) ---
    def _join(v) -> str:
        return ", ".join(str(x) for x in v) if isinstance(v, (list, tuple)) else str(v)

    ctx_fields = [
        ("프로젝트", plan_context.get("title")),
        ("기획 주제", plan_context.get("topic")),
        ("주요 인물", plan_context.get("characters")),
        ("주요 장소", plan_context.get("locations")),
        ("톤&무드", plan_context.get("tone_mood")),
        ("추가 맥락", plan_context.get("extra_context")),
        # 키워드는 plan_context 우선, 없으면 인자로 받은 plan_keywords 사용
        ("키워드", plan_context.get("keywords") or plan_keywords),
    ]
    ctx_lines = [f"- {label}: {_join(val)}" for label, val in ctx_fields if val]
    plan_block = "\n".join(ctx_lines) or "(기획서 맥락 없음)"

    has_transcript = bool(transcript_text.strip())
    summary_rule = (
        "요약의 중심은 [음성 자막]의 발화 내용이다. 누가 무슨 이야기를 하는지 먼저 잡고, "
        "[시각 설명]으로 상황·장소·행동을 보충하라."
        if has_transcript else
        "음성이 없는 클립(B롤/인서트)이다. [시각 설명]의 시간 흐름을 따라 "
        "무엇이 어떻게 찍혔는지 서술하라."
    )
    # summary 2문장(전개)의 중심 소스는 음성 유무로 갈린다 (docs/analysis-fields.md §1-④)
    summary_flow_src = "발화 요지" if has_transcript else "시각적 전개"
    prompt = f"""아래 [음성 자막] + [시각 설명] + [기획서 맥락]을 종합해 JSON으로 답하라.

규칙:
- {summary_rule}
- 자막과 시각 설명에 실제로 담긴 내용만 근거로 쓴다. 기획서 맥락은 이 클립이
  기획 의도와 어떻게 맞닿는지 해석하는 참고로만 쓴다(없는 사실을 지어내지 마라).
- one_line: 편집자가 5초 안에 클립을 판단할 수 있게 "누가/어디서/무엇" 중심 한 문장.
  "이 영상은", "~하는 클립" 같은 군더더기 없이 내용만.
- summary: 재생하지 않고도 클립 내용을 파악할 수 있게, 아래 역할의 3문장으로 쓴다.
  1문장(핵심): 누가/어디서/무엇을 담은 클립인지 — 클립의 정체를 한 번에.
  2문장(전개): 시간 흐름에 따라 {summary_flow_src} 중심으로 내용이 어떻게 진행되는지.
  3문장(특이점): 편집 판단에 영향을 줄 정보 — 인상적인 발화(짧은 인용 가능),
  화면·소리의 특이사항, 클립의 끝맺음 등. 특이점이 없으면 억지로 채우지 말고
  2문장으로 끝낸다. 각 문장은 자막·시각 설명에서 확인되는 내용만 쓴다.
- keywords: 검색에 쓸 명사 5~10개. 기획서 키워드와 겹치는 것이 있으면 반드시 포함.
- people: 자막·장면에서 확인되는 인물/역할만. 기획서의 인물 이름과 대조해 일치하면
  그 이름을 쓰되, 확인 안 되면 "남성 1명" 같은 관찰 표현으로.
- place: 장면에서 추정되는 장소. 기획서의 장소 목록과 일치하면 그 표기를 사용.
- ai_comment: 이 클립이 기획 주제·톤과 어떻게 맞닿는지 + 편집에서 어떤 용도로
  쓸 만한지(인터뷰/브릿지/오프닝 등) 한두 문장.
- 타임스탬프(장면 시각)는 시스템이 별도로 생성하므로 너는 만들지 마라.

스키마:
{{
  "one_line": "한 줄 요약",
  "summary": "핵심/전개/특이점 3문장 요약",
  "keywords": ["키워드 5~10개"],
  "people": ["등장인물/역할"],
  "place": "추정 장소",
  "ai_comment": "기획 의도 연결 + 편집 활용 코멘트"
}}

[기획서 맥락]
{plan_block}

[음성 자막]
\"\"\"
{transcript_text[:5000] or "(음성 없음)"}
\"\"\"

[시각 설명] (시각 순, [mm:ss] = 장면 시각):
{scene_block}"""
    return _chat_json(prompt, system)
