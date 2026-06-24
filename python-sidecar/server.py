"""Preview AI 사이드카 HTTP 서버 (FastAPI).

Tauri Rust 코어가 localhost:8765로 호출. 분석은 백그라운드 작업으로 돌고,
진행률과 결과는 인메모리 스토어에 저장 → 프론트가 폴링.

상태 영속화는 MVP에선 JSON 파일(앱 데이터 디렉토리)로 간단히 처리.
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import analyzer
import setup_deps
from config import settings

app = FastAPI(title="Preview AI Sidecar", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# 처리되지 않은 예외도 CORS 헤더와 함께 JSON으로 반환한다.
# (FastAPI 기본 500 응답은 CORS 헤더가 빠져 브라우저에서 CORS 오류로 보임)
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={"Access-Control-Allow-Origin": "*"},
    )

# ---- 인메모리 스토어 (단일 사이드카 프로세스) -------------------------------
_lock = threading.Lock()
_projects: dict[str, dict] = {}      # project_id -> {meta, plan_context}
_clips: dict[str, dict] = {}         # clip_id -> 분석 결과 + 진행률
_executor = ThreadPoolExecutor(max_workers=settings.concurrency)

DATA_DIR = os.environ.get(
    "PREVIEW_DATA_DIR",
    os.path.join(os.path.expanduser("~"), "Library", "Application Support", "preview-ai"),
)
os.makedirs(DATA_DIR, exist_ok=True)
_DB_PATH = os.path.join(DATA_DIR, "db.json")


def _persist() -> None:
    with _lock:
        # 임베딩 등 큰 필드는 빼고 저장
        slim_projects = {
            pid: {k: v for k, v in p.items() if not k.startswith("_plan_embedding")}
            for pid, p in _projects.items()
        }
        data = {"projects": slim_projects, "clips": _clips}
    tmp = _DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, _DB_PATH)


def _load() -> None:
    if not os.path.exists(_DB_PATH):
        return
    try:
        with open(_DB_PATH, encoding="utf-8") as f:
            data = json.load(f)
        _projects.update(data.get("projects", {}))
        _clips.update(data.get("clips", {}))
    except Exception:
        pass


_load()


# ---- 스키마 ----------------------------------------------------------------
class ProjectCreate(BaseModel):
    name: str = ""
    extra_context: str = ""


class PlanContext(BaseModel):
    title: str = ""
    shooting_period: str = ""
    topic: str = ""
    characters: list[str] = []
    locations: list[str] = []
    cameras: list[str] = []
    keywords: list[str] = []
    tone_mood: str = ""


class AnalyzeRequest(BaseModel):
    project_id: str
    video_paths: list[str]


# ---- 헬스/설정 -------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "ram_gb": settings.ram_gb,
        "models": {
            "llm": settings.llm_model,
            "vlm": settings.vlm_model,
            "embed": settings.embed_model,
            "asr": settings.asr_model,
        },
        "concurrency": settings.concurrency,
    }


# ---- 첫 실행 셋업 (의존성 체크 + 누락분 설치) ------------------------------
@app.get("/setup/status")
def setup_status() -> dict:
    """모든 의존성 재검사 후 상태 반환."""
    return setup_deps.check_status()


@app.post("/setup/install")
def setup_install() -> dict:
    """누락된 항목만 백그라운드 설치 시작."""
    setup_deps.install_missing()
    return {"started": True}


@app.get("/setup/progress")
def setup_progress() -> dict:
    """현재 진행률 스냅샷(가벼운 폴링용, 재검사 안 함)."""
    return setup_deps.snapshot()


# ---- P1 프로젝트 -----------------------------------------------------------
@app.get("/projects")
def list_projects() -> list[dict]:
    with _lock:
        items = [
            {
                "id": pid,
                "name": p.get("name", ""),
                "shooting_period": p.get("shooting_period", ""),
                "updated_at": p.get("updated_at", 0),
                "clip_count": sum(1 for c in _clips.values() if c["project_id"] == pid),
            }
            for pid, p in _projects.items()
        ]
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return items


@app.post("/projects")
def create_project(body: ProjectCreate) -> dict:
    import time

    pid = str(uuid.uuid4())
    with _lock:
        _projects[pid] = {
            "name": body.name or "새 프로젝트",
            "extra_context": body.extra_context,
            "updated_at": time.time(),
        }
    _persist()
    return {"id": pid}


@app.get("/projects/{pid}")
def get_project(pid: str) -> dict:
    with _lock:
        p = _projects.get(pid)
    if not p:
        raise HTTPException(404, "project not found")
    return {"id": pid, **{k: v for k, v in p.items() if not k.startswith("_")}}


def _remove_clip_files(clip: dict) -> None:
    """클립의 썸네일·업로드 원본 파일을 디스크에서 정리(베스트 에포트)."""
    for key in ("thumbnail", "filepath"):
        path = clip.get(key)
        # 업로드 모드로 복사된 파일만 삭제(앱 데이터 디렉토리 내부). Tauri 로컬
        # 원본 경로는 사용자 소유이므로 건드리지 않는다.
        if path and os.path.isfile(path) and os.path.abspath(path).startswith(os.path.abspath(DATA_DIR)):
            try:
                os.remove(path)
            except OSError:
                pass


@app.delete("/clips/{cid}")
def delete_clip(cid: str) -> dict:
    """단일 클립(영상 분석 결과) 삭제."""
    with _lock:
        clip = _clips.pop(cid, None)
    if not clip:
        raise HTTPException(404, "clip not found")
    _remove_clip_files(clip)
    _persist()
    return {"ok": True, "id": cid}


@app.delete("/projects/{pid}")
def delete_project(pid: str) -> dict:
    """프로젝트 + 소속 클립 전부 삭제."""
    with _lock:
        if pid not in _projects:
            raise HTTPException(404, "project not found")
        _projects.pop(pid, None)
        clip_ids = [cid for cid, c in _clips.items() if c.get("project_id") == pid]
        removed = [_clips.pop(cid) for cid in clip_ids]
    for clip in removed:
        _remove_clip_files(clip)
    # 업로드 디렉토리 통째로 정리
    upload_dir = os.path.join(DATA_DIR, "uploads", pid)
    if os.path.isdir(upload_dir):
        import shutil
        shutil.rmtree(upload_dir, ignore_errors=True)
    _persist()
    return {"ok": True, "id": pid, "deleted_clips": len(removed)}


# ---- P2 기획안 분석 (AI 자동완성) ------------------------------------------
@app.post("/projects/{pid}/plan")
async def upload_plan(pid: str, file: UploadFile = File(...)) -> dict:
    import time

    with _lock:
        if pid not in _projects:
            raise HTTPException(404, "project not found")
    # 업로드 파일 저장
    dest = os.path.join(DATA_DIR, f"{pid}_plan{os.path.splitext(file.filename or '')[1]}")
    with open(dest, "wb") as f:
        f.write(await file.read())

    context = analyzer.analyze_plan_document(dest)
    with _lock:
        p = _projects[pid]
        p.update({k: v for k, v in context.items() if not k.startswith("_plan_text")})
        p["_plan_embedding"] = context.get("_plan_embedding", [])
        if not p.get("name") or p["name"] == "새 프로젝트":
            p["name"] = context.get("title", p.get("name", ""))
        p["updated_at"] = time.time()
    _persist()
    return {k: v for k, v in context.items() if not k.startswith("_")}


@app.put("/projects/{pid}/plan")
def update_plan(pid: str, body: PlanContext) -> dict:
    """유저 확인&수정 → 맥락 저장. 키워드 바뀌면 임베딩 재계산(추천도 재계산 트리거)."""
    import time

    import embed as embed_mod

    with _lock:
        p = _projects.get(pid)
        if not p:
            raise HTTPException(404, "project not found")
        p.update(body.model_dump())
        basis = " ".join([body.topic] + body.keywords).strip()
        p["_plan_embedding"] = embed_mod.embed(basis) if basis else []
        p["updated_at"] = time.time()
    _persist()
    return {"ok": True}


# ---- P3/P4 분석 작업 큐 ----------------------------------------------------
def _run_analysis(clip_id: str, project_id: str, video_path: str) -> None:
    with _lock:
        plan_emb = _projects.get(project_id, {}).get("_plan_embedding") or None
        plan_kw = _projects.get(project_id, {}).get("keywords", [])

    def _progress(stage: str, pct: int) -> None:
        with _lock:
            c = _clips.get(clip_id)
            if c:
                c["stage"] = stage
                c["progress"] = pct

    try:
        result = analyzer.analyze_video(
            video_path, plan_emb, plan_kw, progress=_progress,
            thumb_dir=os.path.join(DATA_DIR, "thumbs"),
        )
        with _lock:
            _clips[clip_id].update(result)
            _clips[clip_id]["status"] = "done"
            _clips[clip_id]["progress"] = 100
    except Exception as e:
        import traceback
        # 백그라운드 스레드 예외는 기본적으로 콘솔에 안 찍히므로 명시적으로 출력
        traceback.print_exc()
        with _lock:
            _clips[clip_id]["status"] = "error"
            _clips[clip_id]["error"] = f"{type(e).__name__}: {e}"
    _persist()


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    with _lock:
        if req.project_id not in _projects:
            raise HTTPException(404, "project not found")
    clip_ids = []
    for path in req.video_paths:
        cid = str(uuid.uuid4())
        with _lock:
            _clips[cid] = {
                "id": cid,
                "project_id": req.project_id,
                "filename": os.path.basename(path),
                "filepath": path,
                "status": "queued",
                "stage": "대기 중",
                "progress": 0,
            }
        _executor.submit(_run_analysis, cid, req.project_id, path)
        clip_ids.append(cid)
    return {"clip_ids": clip_ids}


@app.post("/projects/{pid}/analyze_upload")
async def analyze_upload(pid: str, files: list[UploadFile] = File(...)) -> dict:
    """브라우저에서 영상 바이트를 직접 업로드 → 디스크 저장 후 분석 큐 투입.
    Tauri(로컬 경로) 없이도 실제 분석이 가능하게 하는 경로."""
    with _lock:
        if pid not in _projects:
            raise HTTPException(404, "project not found")
    upload_dir = os.path.join(DATA_DIR, "uploads", pid)
    os.makedirs(upload_dir, exist_ok=True)

    clip_ids = []
    for f in files:
        dest = os.path.join(upload_dir, f.filename or f"{uuid.uuid4()}.mov")
        with open(dest, "wb") as out:
            out.write(await f.read())
        cid = str(uuid.uuid4())
        with _lock:
            _clips[cid] = {
                "id": cid,
                "project_id": pid,
                "filename": os.path.basename(dest),
                "filepath": dest,
                "status": "queued",
                "stage": "대기 중",
                "progress": 0,
            }
        _executor.submit(_run_analysis, cid, pid, dest)
        clip_ids.append(cid)
    return {"clip_ids": clip_ids}


@app.get("/projects/{pid}/clips")
def list_clips(pid: str) -> list[dict]:
    with _lock:
        items = [c for c in _clips.values() if c["project_id"] == pid]
    # P4 기본 정렬: 촬영 날짜 오름차순(같으면 파일명)
    items.sort(key=lambda c: (c.get("date", ""), c.get("filename", "")))
    return items


@app.get("/clips/{cid}")
def get_clip(cid: str) -> dict:
    with _lock:
        c = _clips.get(cid)
    if not c:
        raise HTTPException(404, "clip not found")
    return c


@app.post("/projects/{pid}/recompute")
def recompute_scores(pid: str) -> dict:
    """기획안 재업로드/수정 시 기존 클립 추천도 재계산 (P3 요구사항)."""
    import embed as embed_mod
    import scoring

    with _lock:
        plan_emb = _projects.get(pid, {}).get("_plan_embedding") or None
        clips = [c for c in _clips.values()
                 if c["project_id"] == pid and c.get("status") == "done"]
    for c in clips:
        clip_text = " ".join(
            [c.get("transcript", "")]
            + c.get("scene_descriptions", [])
            + c.get("keywords", [])
        ).strip()
        relevance = (embed_mod.relevance_score(clip_text, plan_emb)
                     if plan_emb else 0.0)
        rec = scoring.recommendation(relevance, c.get("quality", 0.0))
        with _lock:
            c["relevance"] = relevance
            c["recommendation"] = rec
            c["color"] = scoring.color_for(rec)
    _persist()
    return {"updated": len(clips)}


@app.get("/thumb/{cid}")
def thumb(cid: str):
    """클립 썸네일 jpg 반환 (분석 중 임시 디렉토리 정리 전이면)."""
    from fastapi.responses import FileResponse

    with _lock:
        c = _clips.get(cid)
    if not c or not c.get("thumbnail") or not os.path.exists(c["thumbnail"]):
        raise HTTPException(404, "no thumbnail")
    return FileResponse(c["thumbnail"])


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
