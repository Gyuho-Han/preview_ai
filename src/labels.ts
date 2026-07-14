// 유저 직접 분류 — 하트(즐겨찾기) · 색 태그 · 폴더(보드).
// 지금은 브라우저 localStorage에 프로젝트별로 저장한다(백엔드 영속화는 다음 단계).
// 여러 화면(표·상세·보드)이 같은 상태를 공유하도록 외부 스토어 + useSyncExternalStore.
import { useSyncExternalStore } from "react";

export type LabelColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export const TAG_COLORS: { id: LabelColor; label: string; hex: string }[] = [
  { id: "red", label: "빨강", hex: "#ef4444" },
  { id: "orange", label: "주황", hex: "#f59e0b" },
  { id: "yellow", label: "노랑", hex: "#eab308" },
  { id: "green", label: "초록", hex: "#22c55e" },
  { id: "blue", label: "파랑", hex: "#3b82f6" },
  { id: "purple", label: "보라", hex: "#a855f7" },
];
export const colorHex = (c: LabelColor) => TAG_COLORS.find((x) => x.id === c)?.hex || "#888";

export interface Folder { id: string; name: string; clipIds: string[] }
export interface ProjectLabels {
  favorites: string[];
  tags: Record<string, LabelColor[]>;
  folders: Folder[];
}

const blank = (): ProjectLabels => ({ favorites: [], tags: {}, folders: [] });
const keyOf = (pid: string) => `preview.labels.${pid}`;

const cache: Record<string, ProjectLabels> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ensure(pid: string): ProjectLabels {
  if (!cache[pid]) {
    try {
      const raw = localStorage.getItem(keyOf(pid));
      const p = raw ? (JSON.parse(raw) as Partial<ProjectLabels>) : {};
      cache[pid] = { favorites: p.favorites ?? [], tags: p.tags ?? {}, folders: p.folders ?? [] };
    } catch {
      cache[pid] = blank();
    }
  }
  return cache[pid];
}

function commit(pid: string, next: ProjectLabels) {
  cache[pid] = next;
  try { localStorage.setItem(keyOf(pid), JSON.stringify(next)); } catch { /* 저장 실패 무시 */ }
  emit();
}

// ---- 뮤테이터 ----
export function toggleFavorite(pid: string, cid: string) {
  const s = ensure(pid);
  const has = s.favorites.includes(cid);
  commit(pid, { ...s, favorites: has ? s.favorites.filter((x) => x !== cid) : [...s.favorites, cid] });
}
export function toggleTag(pid: string, cid: string, color: LabelColor) {
  const s = ensure(pid);
  const cur = s.tags[cid] ?? [];
  const has = cur.includes(color);
  const nextArr = has ? cur.filter((c) => c !== color) : [...cur, color];
  const tags = { ...s.tags };
  if (nextArr.length) tags[cid] = nextArr; else delete tags[cid];
  commit(pid, { ...s, tags });
}
export function addFolder(pid: string, name: string): string {
  const s = ensure(pid);
  const id = `f-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  commit(pid, { ...s, folders: [...s.folders, { id, name: name || "새 폴더", clipIds: [] }] });
  return id;
}
export function renameFolder(pid: string, id: string, name: string) {
  const s = ensure(pid);
  commit(pid, { ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) });
}
export function deleteFolder(pid: string, id: string) {
  const s = ensure(pid);
  commit(pid, { ...s, folders: s.folders.filter((f) => f.id !== id) });
}
export function toggleInFolder(pid: string, folderId: string, cid: string) {
  const s = ensure(pid);
  commit(pid, {
    ...s,
    folders: s.folders.map((f) => {
      if (f.id !== folderId) return f;
      const has = f.clipIds.includes(cid);
      return { ...f, clipIds: has ? f.clipIds.filter((x) => x !== cid) : [...f.clipIds, cid] };
    }),
  });
}

// ---- 훅 ----
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export function useLabels(pid: string): ProjectLabels {
  return useSyncExternalStore(subscribe, () => ensure(pid));
}
