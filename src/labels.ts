// 유저 직접 분류 — 즐겨찾기(하트)만. 색태그·폴더는 과했다는 판단으로 걷어냄(2026-07-15).
// 지금은 브라우저 localStorage에 프로젝트별로 저장한다(백엔드 영속화는 다음 단계).
// 여러 화면(표·상세·보드)이 같은 상태를 공유하도록 외부 스토어 + useSyncExternalStore.
import { useSyncExternalStore } from "react";

export interface ProjectLabels {
  favorites: string[];
}

const blank = (): ProjectLabels => ({ favorites: [] });
const keyOf = (pid: string) => `preview.labels.${pid}`;

const cache: Record<string, ProjectLabels> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ensure(pid: string): ProjectLabels {
  if (!cache[pid]) {
    try {
      const raw = localStorage.getItem(keyOf(pid));
      const p = raw ? (JSON.parse(raw) as Partial<ProjectLabels>) : {};
      cache[pid] = { favorites: p.favorites ?? [] };
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

export function toggleFavorite(pid: string, cid: string) {
  const s = ensure(pid);
  const has = s.favorites.includes(cid);
  commit(pid, { favorites: has ? s.favorites.filter((x) => x !== cid) : [...s.favorites, cid] });
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export function useLabels(pid: string): ProjectLabels {
  return useSyncExternalStore(subscribe, () => ensure(pid));
}
