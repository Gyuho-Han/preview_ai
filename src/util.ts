import type { Clip, TierLabel } from "./types";

export function fmtDuration(sec?: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 타임코드 표기 HH:MM:SS — 상업 편집 싱크용(프레임 단위 소스 TC는 백엔드 메타데이터 필요).
export function fmtTC(sec?: number): string {
  if (sec == null) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

// 추천지수 색 토큰: green/yellow/red(백엔드 threshold 기준값)를
// rec(추천)/ok(보통)/low(낮음) 라벨 색으로 매핑 — 여기 한 곳만 바꾸면 전체 반영.
export function colorClass(color?: string): string {
  return color === "green" ? "rec" : color === "yellow" ? "ok" : "low";
}

export function scoreLabel(color?: string): string {
  const cc = colorClass(color);
  return cc === "rec" ? "추천" : cc === "ok" ? "보통" : "낮음";
}

// ---- 수기 분류(상/중/하) ----------------------------------------------------

export const TIERS: TierLabel[] = ["high", "mid", "low"];

export function tierText(l: TierLabel): string {
  return l === "high" ? "상" : l === "mid" ? "중" : "하";
}

// 티어 색은 추천도 색 토큰(rec/ok/low)을 그대로 재사용 — 상=로열블루, 중=앰버, 하=회색
export function tierClass(l: TierLabel): string {
  return l === "high" ? "rec" : l === "mid" ? "ok" : "low";
}

// 화면·필터가 실제로 따르는 분류: 수기 라벨 > AI 제안 > 추천도 점수 밴드(80/50).
// 대시보드의 ?min=80|50 딥링크도 이 함수 하나로 일관되게 동작한다.
export function effectiveTier(c: Clip): TierLabel {
  if (c.user_label) return c.user_label;
  if (c.ai_label) return c.ai_label;
  const r = c.recommendation ?? 0;
  return r >= 80 ? "high" : r >= 50 ? "mid" : "low";
}

export function fmtDate(ts?: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("ko-KR");
}

// "2026-05-07" → { md: "5월 7일", wd: "수", iso }. 파싱 실패 시 원문 유지.
const WD = ["일", "월", "화", "수", "목", "금", "토"];
export function fmtDateLabel(date?: string): { md: string; wd: string } {
  if (!date) return { md: "날짜 미상", wd: "" };
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { md: date, wd: "" };
  const [, y, mo, d] = m;
  const wd = WD[new Date(Number(y), Number(mo) - 1, Number(d)).getDay()] ?? "";
  return { md: `${Number(mo)}월 ${Number(d)}일`, wd };
}

// 문자열 → 안정적인 색 인덱스 (같은 인물/카메라는 늘 같은 색)
function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h % mod;
}

// 인물 아바타 색 — 라이트/다크 모두에서 읽히는 8색 팔레트(배경 soft + 진한 글자)
const PERSON_PALETTE = [
  ["rgba(109,124,255,0.18)", "#6d7cff"],
  ["rgba(52,211,153,0.18)", "#10b981"],
  ["rgba(217,119,6,0.18)", "#d97706"],
  ["rgba(236,72,153,0.18)", "#ec4899"],
  ["rgba(37,99,235,0.16)", "#2563eb"],
  ["rgba(168,85,247,0.18)", "#a855f7"],
  ["rgba(14,165,183,0.18)", "#0ea5b7"],
  ["rgba(239,68,68,0.16)", "#ef4444"],
];
export function personColor(name: string): { bg: string; fg: string } {
  const [bg, fg] = PERSON_PALETTE[hashIndex(name, PERSON_PALETTE.length)];
  return { bg, fg };
}
export function initialOf(name: string): string {
  const t = name.trim();
  return t ? t.slice(0, 1) : "?";
}

// 카메라 칩 색 — 인물과 겹치지 않게 별도 팔레트
const CAMERA_PALETTE = [
  ["rgba(14,165,183,0.16)", "#0e9aad"],
  ["rgba(168,85,247,0.16)", "#9333ea"],
  ["rgba(217,119,6,0.16)", "#c2760a"],
  ["rgba(37,99,235,0.14)", "#2563eb"],
  ["rgba(16,185,129,0.16)", "#0f9d6b"],
];
export function cameraColor(name: string): { bg: string; fg: string } {
  const [bg, fg] = CAMERA_PALETTE[hashIndex(name, CAMERA_PALETTE.length)];
  return { bg, fg };
}
