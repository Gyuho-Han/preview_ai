"""첫 실행 의존성 셋업.

각 구성요소(Ollama 서버·LLM/VLM/임베딩 모델·Whisper·ffmpeg)가 이미 있는지
검사하고, **없는 것만** 다운로드한다. 진행률은 인메모리로 추적해 프론트가 폴링.

- Ollama 모델: `ollama pull`의 total/completed로 정확한 % 표시
- Whisper(MLX): HuggingFace 캐시로 다운로드, 캐시 폴더 용량으로 근사 % 표시
- ffmpeg: 설치 여부만 확인(앱 번들 시 동봉되므로 자동 다운로드 대상 아님)
"""
from __future__ import annotations

import os
import shutil
import threading
import time

import ollama

from config import settings

# Whisper 대략 용량(표시용, bytes) — large-v3-turbo ≈ 1.6GB
_WHISPER_APPROX_BYTES = int(1.6 * 1024**3)

_lock = threading.Lock()
# name -> {label, kind, status, pct, detail}
#   status: present | pending | downloading | done | error | blocked
_state: dict[str, dict] = {}
_installing = False


# ---- 존재 여부 검사 --------------------------------------------------------
def _required_models() -> dict[str, str]:
    return {"llm": settings.llm_model, "vlm": settings.vlm_model, "embed": settings.embed_model}


def _ollama_running() -> bool:
    try:
        ollama.Client(host=settings.ollama_host).list()
        return True
    except Exception:
        return False


def _installed_models() -> set[str]:
    try:
        data = ollama.Client(host=settings.ollama_host).list()
        models = data.get("models") if isinstance(data, dict) else getattr(data, "models", [])
        names: set[str] = set()
        for m in models or []:
            if isinstance(m, dict):
                n = m.get("name") or m.get("model")
            else:
                n = getattr(m, "model", None) or getattr(m, "name", None)
            if n:
                names.add(n)
        return names
    except Exception:
        return set()


def _model_present(required: str, installed: set[str]) -> bool:
    """태그 정규화: 'bge-m3'는 'bge-m3:latest'와도 매칭."""
    if required in installed:
        return True
    if ":" not in required and f"{required}:latest" in installed:
        return True
    # required에 태그가 있으면 정확히 일치해야 함
    return False


def _whisper_cache_dir() -> str:
    repo = settings.whisper_model.replace("/", "--")
    home = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    return os.path.join(home, "hub", f"models--{repo}")


def _whisper_present() -> bool:
    snap = os.path.join(_whisper_cache_dir(), "snapshots")
    if not os.path.isdir(snap):
        return False
    for _root, _dirs, files in os.walk(snap):
        if any(f.endswith((".safetensors", ".npz", ".bin")) for f in files):
            return True
    return False


def _dir_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


# ---- 상태 스냅샷 -----------------------------------------------------------
def _set(name: str, **kw) -> None:
    with _lock:
        _state.setdefault(name, {})
        _state[name].update(kw)


def check_status() -> dict:
    """전체 의존성 상태를 재검사해 반환. 진행 중(downloading)인 항목은 보존."""
    running = _ollama_running()
    installed = _installed_models() if running else set()

    def _maybe(name: str, label: str, kind: str, present: bool, detail: str = "") -> None:
        with _lock:
            cur = _state.get(name)
            if cur and cur.get("status") in ("downloading", "done", "error", "blocked"):
                # 단, 실제로 사용 가능해졌으면 present로 갱신(blocked 해제)
                if not (present and cur.get("status") == "blocked"):
                    return  # 진행 중/안내 상태는 덮어쓰지 않음
        _set(name, label=label, kind=kind,
             status="present" if present else "pending",
             pct=100 if present else 0, detail=detail)

    _maybe("ffmpeg", "ffmpeg", "binary", shutil.which("ffmpeg") is not None)
    _maybe("ollama", "Ollama 서버", "service", running)
    for key, model in _required_models().items():
        present = running and _model_present(model, installed)
        _maybe(key, f"{key.upper()} 모델 · {model}", "ollama_model", present, model)
    _maybe("whisper", f"Whisper · {settings.whisper_model.split('/')[-1]}", "hf_model", _whisper_present())

    return snapshot()


def snapshot() -> dict:
    with _lock:
        items = [{"name": k, **v} for k, v in _state.items()]
        # ollama 서버/ffmpeg는 자동설치 대상이 아니므로 ready 계산에서 별도 취급
        ready = all(
            it["status"] in ("present", "done")
            for it in items
            if it["name"] != "ffmpeg"  # ffmpeg는 번들/시스템에 의존, 경고만
        )
        return {"installing": _installing, "all_ready": ready, "items": items}


# ---- 설치 (누락분만) -------------------------------------------------------
def install_missing() -> None:
    global _installing
    with _lock:
        if _installing:
            return
        _installing = True
    threading.Thread(target=_run_install, daemon=True).start()


def _run_install() -> None:
    global _installing
    try:
        check_status()
        if not _ollama_running():
            _set("ollama", status="blocked",
                 detail="Ollama 서버에 연결할 수 없습니다. 앱이 자동 실행하거나 `ollama serve`가 필요합니다.")
            return

        installed = _installed_models()
        for key, model in _required_models().items():
            if _model_present(model, installed):
                _set(key, status="done", pct=100)
                continue
            _pull_model(key, model)

        if _whisper_present():
            _set("whisper", status="done", pct=100)
        else:
            _download_whisper()
    finally:
        with _lock:
            _installing = False
        check_status()


def _pull_model(key: str, model: str) -> None:
    _set(key, status="downloading", pct=0, detail=f"{model} 내려받는 중…")
    try:
        client = ollama.Client(host=settings.ollama_host)
        seen_total = 0
        for ev in client.pull(model, stream=True):
            ev = ev if isinstance(ev, dict) else getattr(ev, "__dict__", {}) or {}
            total = ev.get("total") or 0
            completed = ev.get("completed") or 0
            status = ev.get("status", "")
            if total:
                seen_total = max(seen_total, total)
                _set(key, pct=min(99, int(completed / total * 100)), detail=status)
            else:
                _set(key, detail=status)
        _set(key, status="done", pct=100, detail="완료")
    except Exception as e:
        _set(key, status="error", detail=str(e))


def _download_whisper() -> None:
    _set("whisper", status="downloading", pct=0, detail="다운로드 준비 중…")
    target = _whisper_cache_dir()
    done = {"flag": False, "err": None}

    def _dl() -> None:
        try:
            from huggingface_hub import snapshot_download
            snapshot_download(repo_id=settings.whisper_model)
        except Exception as e:  # noqa: BLE001
            done["err"] = str(e)
        finally:
            done["flag"] = True

    threading.Thread(target=_dl, daemon=True).start()
    while not done["flag"]:
        size = _dir_size(target) if os.path.isdir(target) else 0
        pct = min(99, int(size / _WHISPER_APPROX_BYTES * 100))
        _set("whisper", pct=pct, detail=f"{size // (1024**2)} MB")
        time.sleep(0.8)

    if done["err"]:
        _set("whisper", status="error", detail=done["err"])
    else:
        _set("whisper", status="done", pct=100, detail="완료")
