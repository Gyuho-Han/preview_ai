// 표 썸네일 호버 미리보기(B)
//  - 평소: 대표 썸네일
//  - 호버: 1초당 1프레임 필름스트립을 자동 재생(플립북처럼 "그냥 플레이")
//  - 아래 바를 클릭/드래그하면 그 위치(시간)로 직접 이동(자동재생 일시정지)
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtDuration } from "../util";

const FRAME_MS = 130; // 자동재생 속도(프레임당 ms)

export default function ThumbScrub({ clip }: { clip: Clip }) {
  const n = clip.frame_times?.length || clip.frames?.length || 0;
  const [idx, setIdx] = useState(0);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [broken, setBroken] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // 호버 중(드래그 아닐 때) 자동 재생 — 프레임을 순환
  useEffect(() => {
    if (!hover || dragging || n <= 1) return;
    const iv = setInterval(() => setIdx((p) => (p + 1) % n), FRAME_MS);
    return () => clearInterval(iv);
  }, [hover, dragging, n]);

  function seekFromX(clientX: number) {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || n <= 1) return;
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setIdx(Math.round(p * (n - 1)));
  }

  // 드래그 중 전역 마우스 추적
  useEffect(() => {
    if (!dragging) return;
    const mv = (e: MouseEvent) => seekFromX(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging, n]);

  const active = hover || dragging;
  const src = active && n > 0 ? api.frameUrl(clip.id, idx) : api.thumbUrl(clip.id);
  const pct = n > 1 ? (idx / (n - 1)) * 100 : 0;
  const t = clip.frame_times?.[idx];

  return (
    <div
      className="thumb-scrub"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); if (!dragging) setIdx(0); }}
    >
      {broken ? (
        <div className="thumb thumb-ph">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 8h3l1.2-1.8h5.6L15 8h5v10H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>
      ) : (
        <img
          className="thumb"
          src={src}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
        />
      )}
      {active && t != null && <span className="scrub-time">{fmtDuration(t)}</span>}
      {n > 1 && (
        <div
          ref={barRef}
          className={`scrub-bar ${active ? "on" : ""}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setHover(true);
            setDragging(true);
            seekFromX(e.clientX);
          }}
        >
          <div className="scrub-fill" style={{ width: `${pct}%` }} />
          <div className="scrub-handle" style={{ left: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
