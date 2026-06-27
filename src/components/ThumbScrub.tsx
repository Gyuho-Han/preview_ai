// 표 썸네일 호버 스크럽(B) — 마우스를 칸 위에서 좌우로 움직이면 키프레임을
// 넘겨 미리보기. 실제 영상 재생/복사 없이 키프레임 이미지만 사용(전 코덱 호환).
import { useRef, useState } from "react";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtDuration } from "../util";

export default function ThumbScrub({ clip }: { clip: Clip }) {
  const n = clip.frame_times?.length || clip.frames?.length || 0;
  const [idx, setIdx] = useState(0);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function scrub(e: React.MouseEvent) {
    if (n <= 1 || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setIdx(Math.round(p * (n - 1)));
  }

  const showIdx = hover ? idx : 0;
  const src = n > 0 ? api.frameUrl(clip.id, showIdx) : api.thumbUrl(clip.id);
  const pct = n > 1 ? (idx / (n - 1)) * 100 : 0;
  const t = clip.frame_times?.[showIdx];

  return (
    <div
      ref={ref}
      className="thumb-scrub"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setIdx(0); }}
      onMouseMove={scrub}
      title={n > 1 ? "마우스를 좌우로 움직여 미리보기" : ""}
    >
      <img
        className="thumb"
        src={src}
        alt=""
        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
      />
      {hover && n > 1 && (
        <>
          <div className="scrub-bar"><div style={{ width: `${pct}%` }} /></div>
          {t != null && <span className="scrub-time">{fmtDuration(t)}</span>}
        </>
      )}
    </div>
  );
}
