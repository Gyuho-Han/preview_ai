export function fmtDuration(sec?: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function colorClass(color?: string): string {
  return color === "green" ? "green" : color === "yellow" ? "yellow" : "red";
}

export function fmtDate(ts?: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("ko-KR");
}
