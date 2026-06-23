"""기획안 PDF/문서 → 텍스트 (PyMuPDF)."""
from __future__ import annotations

import os


def extract_text(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        try:
            return "\n".join(page.get_text() for page in doc).strip()
        finally:
            doc.close()
    # txt / md 등 일반 텍스트
    if ext in (".txt", ".md", ".markdown"):
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read().strip()
    raise ValueError(f"지원하지 않는 기획안 형식: {ext}")
