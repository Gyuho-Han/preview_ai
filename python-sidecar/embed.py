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


def relevance_score(clip_text: str, plan_embedding: list[float]) -> float:
    """클립 텍스트 vs 기획안 임베딩 → 0~100.
    코사인(-1~1)을 0~1로 매핑 후 100 스케일."""
    clip_emb = embed(clip_text)
    cos = cosine(clip_emb, plan_embedding)
    return round(max(0.0, min(100.0, (cos + 1) / 2 * 100)), 1)
