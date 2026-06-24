// API 계층 — Tauri 환경에서는 invoke(Rust→사이드카), 일반 브라우저(vite dev)에서는
// 사이드카 HTTP를 직접 호출하거나 목 데이터로 폴백한다.
// 덕분에 UI를 Tauri 없이도 `npm run dev`로 개발할 수 있다.

import type { Clip, PlanContext, ProjectSummary, SetupSnapshot } from "./types";
import { mockApi } from "./mock";

const SIDECAR = "http://127.0.0.1:8765";

export const isTauri =
  typeof window !== "undefined" &&
  "__TAURI_IPC__" in (window as unknown as Record<string, unknown>);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/tauri");
  return invoke<T>(cmd, args);
}

// 사이드카 직접 호출 (브라우저 dev 모드용)
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SIDECAR}${path}`, init);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* 본문 없음 */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

async function sidecarUp(): Promise<boolean> {
  try {
    const r = await fetch(`${SIDECAR}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

// 브라우저 dev에서 사이드카가 떠있지 않으면 목 데이터 사용
let useMock = false;
export async function initApi(): Promise<{ mode: string }> {
  if (isTauri) {
    await invoke("wait_for_sidecar");
    return { mode: "tauri" };
  }
  useMock = !(await sidecarUp());
  return { mode: useMock ? "mock" : "browser" };
}

export const api = {
  thumbUrl(cid: string): string {
    return `${SIDECAR}/thumb/${cid}`;
  },

  // ---- 첫 실행 셋업 (브라우저/Tauri 모두 사이드카 HTTP 직접 사용) ----
  async setupStatus(): Promise<SetupSnapshot> {
    if (useMock) return { installing: false, all_ready: true, items: [] };
    return http("/setup/status");
  },
  async setupInstall(): Promise<{ started: boolean }> {
    if (useMock) return { started: true };
    return http("/setup/install", { method: "POST" });
  },
  async setupProgress(): Promise<SetupSnapshot> {
    if (useMock) return { installing: false, all_ready: true, items: [] };
    return http("/setup/progress");
  },

  async listProjects(): Promise<ProjectSummary[]> {
    if (useMock) return mockApi.listProjects();
    return isTauri ? invoke("list_projects") : http("/projects");
  },

  async createProject(name: string, extraContext: string): Promise<{ id: string }> {
    if (useMock) return mockApi.createProject(name);
    return isTauri
      ? invoke("create_project", { name, extraContext })
      : http("/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, extra_context: extraContext }),
        });
  },

  async getProject(pid: string): Promise<PlanContext & { id: string; name: string }> {
    if (useMock) return mockApi.getProject(pid);
    return isTauri ? invoke("get_project", { pid }) : http(`/projects/${pid}`);
  },

  async uploadPlan(pid: string, filePath: string): Promise<PlanContext> {
    // Tauri: Rust가 로컬 파일 경로를 읽어 멀티파트 전송
    if (useMock) return mockApi.uploadPlan();
    if (isTauri) return invoke("upload_plan", { pid, filePath });
    throw new Error("브라우저 모드에서는 기획안 업로드를 지원하지 않습니다. 앱으로 실행하세요.");
  },

  // 브라우저 모드: 기획안 파일 바이트 업로드 → AI 자동완성
  async uploadPlanFile(pid: string, file: File): Promise<PlanContext> {
    if (useMock) return mockApi.uploadPlan();
    const form = new FormData();
    form.append("file", file);
    return http(`/projects/${pid}/plan`, { method: "POST", body: form });
  },

  async updatePlan(pid: string, context: PlanContext): Promise<{ ok: boolean }> {
    if (useMock) return mockApi.updatePlan();
    return isTauri
      ? invoke("update_plan", { pid, context })
      : http(`/projects/${pid}/plan`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(context),
        });
  },

  // 브라우저 모드: 영상 파일 바이트를 사이드카로 업로드해 분석
  async analyzeUpload(projectId: string, files: FileList | File[]): Promise<{ clip_ids: string[] }> {
    if (useMock) {
      return mockApi.analyzeVideos(projectId, Array.from(files).map((f) => f.name));
    }
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    return http(`/projects/${projectId}/analyze_upload`, { method: "POST", body: form });
  },

  async analyzeVideos(projectId: string, videoPaths: string[]): Promise<{ clip_ids: string[] }> {
    if (useMock) return mockApi.analyzeVideos(projectId, videoPaths);
    return isTauri
      ? invoke("analyze_videos", { projectId, videoPaths })
      : http("/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, video_paths: videoPaths }),
        });
  },

  async listClips(pid: string): Promise<Clip[]> {
    if (useMock) return mockApi.listClips(pid);
    return isTauri ? invoke("list_clips", { pid }) : http(`/projects/${pid}/clips`);
  },

  async getClip(cid: string): Promise<Clip> {
    if (useMock) return mockApi.getClip(cid);
    return isTauri ? invoke("get_clip", { cid }) : http(`/clips/${cid}`);
  },

  async recomputeScores(pid: string): Promise<{ updated: number }> {
    if (useMock) return { updated: 0 };
    return isTauri ? invoke("recompute_scores", { pid }) : http(`/projects/${pid}/recompute`, { method: "POST" });
  },

  async deleteProject(pid: string): Promise<{ ok: boolean }> {
    if (useMock) return mockApi.deleteProject(pid);
    return isTauri ? invoke("delete_project", { pid }) : http(`/projects/${pid}`, { method: "DELETE" });
  },

  async deleteClip(cid: string): Promise<{ ok: boolean }> {
    if (useMock) return mockApi.deleteClip(cid);
    return isTauri ? invoke("delete_clip", { cid }) : http(`/clips/${cid}`, { method: "DELETE" });
  },
};

// 로컬 영상/문서 파일 선택 (Tauri dialog). 브라우저에선 미지원.
export async function pickVideos(): Promise<string[]> {
  if (!isTauri) {
    if (useMock) return mockApi.pickVideos();
    throw new Error("파일 선택은 앱 환경에서만 가능합니다.");
  }
  const { open } = await import("@tauri-apps/api/dialog");
  const sel = await open({
    multiple: true,
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mxf", "m4v"] }],
  });
  if (!sel) return [];
  return Array.isArray(sel) ? sel : [sel];
}

export async function pickPlan(): Promise<string | null> {
  if (!isTauri) {
    if (useMock) return "mock-plan.pdf";
    throw new Error("파일 선택은 앱 환경에서만 가능합니다.");
  }
  const { open } = await import("@tauri-apps/api/dialog");
  const sel = await open({
    multiple: false,
    filters: [{ name: "Plan", extensions: ["pdf", "txt", "md"] }],
  });
  return (sel as string) || null;
}
