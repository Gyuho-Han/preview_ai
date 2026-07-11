export function fmtDuration(sec?: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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

export function fmtDate(ts?: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("ko-KR");
}
