"""임베딩 — bge-m3 (Ollama). 추천도 '기획안 연관성'을 코사인 유사도로 계산."""
from __future__ import annotations

import math

import ollama

from config import settings


def embed(text: str) -> list[float]:
    client = ollama.Client(host=settings.ollama_host)
    resp = client.embeddings(model=settings.embed_model, prompt=text[:8000])
    # ollama 버전에 따라 dict 또는 pydantic 객체
    if isinstance(resp, dict):
        return resp["embedding"]
    return list(getattr(resp, "embedding", []))


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# bge-m3 코사인 유사도의 실사용 분포에 맞춘 매핑 구간.
# 무관한 한국어 텍스트 쌍도 0.3 안팎이 나오고, 밀접한 쌍은 0.7~0.85 수준이라
# (cos+1)/2 방식은 무관한 클립도 65~80점이 되어 변별력이 없었다.
_COS_LO = 0.30   # 이하 → 0점 (무관)
_COS_HI = 0.85   # 이상 → 100점 (매우 밀접)


def relevance_score(clip_text: str, plan_embedding: list[float]) -> float:
    """클립 텍스트 vs 기획안 임베딩 → 0~100.
    코사인 유사도를 실사용 범위 [0.30, 0.85] 기준으로 선형 매핑."""
    clip_emb = embed(clip_text)
    cos = cosine(clip_emb, plan_embedding)
    scaled = (cos - _COS_LO) / (_COS_HI - _COS_LO)
    return round(max(0.0, min(100.0, scaled * 100)), 1)
