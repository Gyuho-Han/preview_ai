"""Preview AI 사이드카 HTTP 서버 (FastAPI).

Tauri Rust 코어가 localhost:8765로 호출. 분석은 백그라운드 작업으로 돌고,
진행률과 결과는 인메모리 스토어에 저장 → 프론트가 폴링.

상태 영속화는 MVP에선 JSON 파일(앱 데이터 디렉토리)로 간단히 처리.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# PyInstaller 번들로 실행될 때(배포 빌드): 같은 폴더(Contents/MacOS)에 동봉된
# ffmpeg/ffprobe/ollama를 subprocess 호출이 찾을 수 있도록 PATH 맨 앞에 추가.
if getattr(sys, "frozen", False):
    os.environ["PATH"] = (
        os.path.dirname(sys.executable) + os.pathsep + os.environ.get("PATH", "")
    )

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


def _log_vad_status() -> None:
    """시작 시 VAD 가용 여부를 명확히 출력(조용한 폴백으로 인한 환각 재발 방지)."""
    import sys

    import vad as vad_mod
    if vad_mod.available():
        print("[vad] Silero VAD 활성 — 말소리 구간만 STT에 전달됩니다.")
    else:
        print("[vad] 경고: pysilero-vad 미설치/로드 실패 — 예전 RMS 방식으로 폴백 중. "
              "비음성 클립에서 자막 환각이 재발합니다. 해결: 사이드카 파이썬 환경에서 "
              "`pip install pysilero-vad` 후 재시작", file=sys.stderr)


_log_vad_status()


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


class FolderRequest(BaseModel):
    folder: str
    recursive: bool = True


# ---- 헬스/설정 -------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    import vad as vad_mod

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
        # false면 pysilero-vad 미설치 → 비음성 클립에서 ASR 환각이 재발한다.
        # (conda preview 환경에서 `pip install pysilero-vad` 후 사이드카 재시작)
        "vad": vad_mod.available(),
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
    """클립의 썸네일·업로드 원본·키프레임·미리보기 파일을 디스크에서 정리(베스트 에포트)."""
    import shutil as _sh

    for key in ("thumbnail", "filepath"):
        path = clip.get(key)
        # 업로드 모드로 복사된 파일만 삭제(앱 데이터 디렉토리 내부). Tauri 로컬
        # 원본 경로는 사용자 소유이므로 건드리지 않는다.
        if path and os.path.isfile(path) and os.path.abspath(path).startswith(os.path.abspath(DATA_DIR)):
            try:
                os.remove(path)
            except OSError:
                pass
    # 키프레임 디렉토리(frames/<cid>) + 미리보기(previews/<cid>.mp4) 정리
    cid = clip.get("id")
    if cid:
        _sh.rmtree(os.path.join(DATA_DIR, "frames", cid), ignore_errors=True)
        try:
            os.remove(os.path.join(DATA_DIR, "previews", f"{cid}.mp4"))
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
def _ensure_plan_embedding(pid: str) -> list[float] | None:
    """기획안 임베딩 반환. 없으면 topic/keywords로 재계산해 캐시.

    임베딩은 디스크에 저장하지 않으므로(_persist에서 제외) 사이드카 재시작 후엔
    사라진다. 예전엔 이때 relevance가 조용히 0이 되어 '기획서 기반 분석이 안 되는'
    버그가 있었다 → 재시작 후 첫 분석 때 지연 재계산한다."""
    with _lock:
        proj = _projects.get(pid) or {}
        emb = proj.get("_plan_embedding")
        basis = " ".join(
            [proj.get("topic", "")] + list(proj.get("keywords") or [])
        ).strip()
    if emb:
        return emb
    if not basis:
        return None
    try:
        import embed as embed_mod
        emb = embed_mod.embed(basis)
    except Exception:
        return None
    with _lock:
        if pid in _projects:
            _projects[pid]["_plan_embedding"] = emb
    return emb


def _run_analysis(clip_id: str, project_id: str, video_path: str) -> None:
    plan_emb = _ensure_plan_embedding(project_id)
    with _lock:
        proj = _projects.get(project_id, {}) or {}
        plan_kw = proj.get("keywords", [])
        # 최종 요약이 기획서 방향까지 반영하도록 full context를 함께 전달
        plan_context = {
            "title": proj.get("title", "") or proj.get("name", ""),
            "topic": proj.get("topic", ""),
            "characters": proj.get("characters", []),
            "locations": proj.get("locations", []),
            "tone_mood": proj.get("tone_mood", ""),
            "keywords": plan_kw,
            "extra_context": proj.get("extra_context", ""),
        }

    def _progress(stage: str, pct: int) -> None:
        with _lock:
            c = _clips.get(clip_id)
            if c:
                c["stage"] = stage
                c["progress"] = pct

    try:
        result = analyzer.analyze_video(
            video_path, plan_emb, plan_kw, progress=_progress,
            frames_dir=os.path.join(DATA_DIR, "frames", clip_id),
            plan_context=plan_context,
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


VIDEO_EXTS = {".mp4", ".mov", ".mxf", ".m4v", ".avi", ".mts", ".m2ts", ".mkv"}


@app.post("/projects/{pid}/analyze_folder")
def analyze_folder(pid: str, req: FolderRequest) -> dict:
    """폴더 경로를 받아 그 안의 영상들을 '복사 없이' 경로 그대로 분석 큐에 투입.
    이미 같은 경로로 분석된 파일은 건너뛴다(중복 방지)."""
    with _lock:
        if pid not in _projects:
            raise HTTPException(404, "project not found")
    folder = os.path.expanduser(req.folder.strip())
    if not folder or not os.path.isdir(folder):
        raise HTTPException(400, f"폴더를 찾을 수 없습니다: {req.folder}")

    # 영상 파일 수집(재귀 옵션), 정렬
    found: list[str] = []
    if req.recursive:
        for root, _dirs, files in os.walk(folder):
            for f in files:
                if not f.startswith(".") and os.path.splitext(f)[1].lower() in VIDEO_EXTS:
                    found.append(os.path.join(root, f))
    else:
        for f in os.listdir(folder):
            p = os.path.join(folder, f)
            if os.path.isfile(p) and not f.startswith(".") and os.path.splitext(f)[1].lower() in VIDEO_EXTS:
                found.append(p)
    found.sort()

    with _lock:
        existing = {c.get("filepath") for c in _clips.values() if c.get("project_id") == pid}
    clip_ids = []
    for path in found:
        if path in existing:
            continue  # 이미 분석한 파일은 건너뜀
        cid = str(uuid.uuid4())
        with _lock:
            _clips[cid] = {
                "id": cid, "project_id": pid,
                "filename": os.path.basename(path), "filepath": path,
                "status": "queued", "stage": "대기 중", "progress": 0,
            }
        _executor.submit(_run_analysis, cid, pid, path)
        clip_ids.append(cid)
    return {"clip_ids": clip_ids, "found": len(found), "queued": len(clip_ids)}


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


# 표(P4)·프로젝트 홈에 필요한 필드만 목록으로 반환.
# transcript/segments/scene_descriptions/frames 경로 같은 큰 필드는 상세(/clips/{cid})에서만.
# (표가 1.5초 간격으로 폴링하므로 목록 페이로드가 크면 클립 수에 비례해 낭비가 커진다)
_LIST_FIELDS = (
    "id", "project_id", "filename", "status", "stage", "progress", "error",
    "duration_sec", "date", "place", "camera", "people", "one_line",
    "keywords", "recommendation", "color", "has_speech", "frame_times",
)


@app.get("/projects/{pid}/clips")
def list_clips(pid: str) -> list[dict]:
    with _lock:
        items = [
            {k: c[k] for k in _LIST_FIELDS if k in c}
            for c in _clips.values() if c["project_id"] == pid
        ]
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

    plan_emb = _ensure_plan_embedding(pid)
    with _lock:
        snapshot = [
            (cid, " ".join(
                [c.get("transcript", "")]
                + c.get("scene_descriptions", [])
                + c.get("keywords", [])
            ).strip(), c.get("quality", 0.0))
            for cid, c in _clips.items()
            if c["project_id"] == pid and c.get("status") == "done"
        ]

    # 임베딩 계산(네트워크 호출)은 락 밖에서, 결과 반영은 락 안에서 일괄 적용
    results: list[tuple[str, float, int]] = []
    for cid, clip_text, quality in snapshot:
        relevance = (embed_mod.relevance_score(clip_text, plan_emb)
                     if plan_emb else 0.0)
        results.append((cid, relevance, scoring.recommendation(relevance, quality)))

    with _lock:
        for cid, relevance, rec in results:
            c = _clips.get(cid)
            if not c:
                continue  # 재계산 중 삭제된 클립
            c["relevance"] = relevance
            c["recommendation"] = rec
            c["color"] = scoring.color_for(rec)
    _persist()
    return {"updated": len(results)}


@app.get("/thumb/{cid}")
def thumb(cid: str):
    """클립 썸네일 jpg 반환 (분석 중 임시 디렉토리 정리 전이면)."""
    from fastapi.responses import FileResponse

    with _lock:
        c = _clips.get(cid)
    if not c or not c.get("thumbnail") or not os.path.exists(c["thumbnail"]):
        raise HTTPException(404, "no thumbnail")
    return FileResponse(c["thumbnail"])


@app.get("/clips/{cid}/frame/{idx}")
def clip_frame(cid: str, idx: int):
    """표 호버 스크럽용: cid 클립의 idx번째 키프레임 jpg 반환."""
    from fastapi.responses import FileResponse

    with _lock:
        c = _clips.get(cid)
    frames = (c or {}).get("frames") or []
    if not frames:
        if c and c.get("thumbnail") and os.path.exists(c["thumbnail"]):
            return FileResponse(c["thumbnail"])
        raise HTTPException(404, "no frames")
    i = max(0, min(idx, len(frames) - 1))
    if not os.path.exists(frames[i]):
        raise HTTPException(404, "frame missing")
    return FileResponse(frames[i])


# ---- 웹 미리보기(H.264+AAC) 온디맨드 변환 + 스트리밍 -----------------------
_preview_executor = ThreadPoolExecutor(max_workers=2)
_preview_state: dict[str, dict] = {}   # cid -> {generating, ready, error}


def _preview_path(cid: str) -> str:
    return os.path.join(DATA_DIR, "previews", f"{cid}.mp4")


def _generate_preview(cid: str) -> None:
    import subprocess

    path = _preview_path(cid)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with _lock:
            _preview_state[cid] = {"generating": False, "ready": True, "error": None}
        return
    with _lock:
        src = (_clips.get(cid) or {}).get("filepath")
    if not src or not os.path.isfile(src):
        with _lock:
            _preview_state[cid] = {"generating": False, "ready": False,
                                   "error": "원본 파일을 찾을 수 없습니다."}
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp.mp4"
    # 어떤 코덱(ProRes/MXF 등)이든 웹 재생용 H.264 영상 + AAC 오디오로 변환.
    # 540p·faststart로 가볍게(시크 가능). 오디오 없으면 ffmpeg가 알아서 영상만 출력.
    cmd = [
        "ffmpeg", "-y", "-i", src,
        "-vf", "scale=-2:540",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", tmp,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        os.replace(tmp, path)
        with _lock:
            _preview_state[cid] = {"generating": False, "ready": True, "error": None}
    except subprocess.CalledProcessError as e:
        msg = (e.stderr.decode("utf-8", "ignore")[-400:] if e.stderr else str(e))
        with _lock:
            _preview_state[cid] = {"generating": False, "ready": False, "error": msg}
    except Exception as e:  # noqa: BLE001
        with _lock:
            _preview_state[cid] = {"generating": False, "ready": False, "error": str(e)}
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


@app.get("/clips/{cid}/preview")
def preview_status(cid: str) -> dict:
    """미리보기 상태 조회. 없으면 백그라운드 변환을 시작한다."""
    path = _preview_path(cid)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return {"ready": True, "generating": False, "error": None}
    with _lock:
        st = _preview_state.get(cid)
        if st and (st["generating"] or st.get("error")):
            return st
        _preview_state[cid] = {"generating": True, "ready": False, "error": None}
    _preview_executor.submit(_generate_preview, cid)
    return {"ready": False, "generating": True, "error": None}


@app.get("/video/{cid}")
def video(cid: str, request: Request):
    """변환된 미리보기를 HTTP Range로 스트리밍(시크 지원)."""
    from fastapi.responses import FileResponse, StreamingResponse

    path = _preview_path(cid)
    if not (os.path.exists(path) and os.path.getsize(path) > 0):
        raise HTTPException(404, "preview not ready")
    size = os.path.getsize(path)
    rng = request.headers.get("range")
    if not rng:
        return FileResponse(path, media_type="video/mp4",
                            headers={"Accept-Ranges": "bytes"})
    try:
        rng = rng.split("=", 1)[1]
        s_str, _, e_str = rng.partition("-")
        start = int(s_str) if s_str else 0
        end = int(e_str) if e_str else size - 1
    except (IndexError, ValueError):
        start, end = 0, size - 1
    end = min(end, size - 1)
    start = max(0, min(start, end))
    length = end - start + 1

    def _iter():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(131072, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Type": "video/mp4",
    }
    return StreamingResponse(_iter(), status_code=206, headers=headers)


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
