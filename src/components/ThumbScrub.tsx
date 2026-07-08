// 표 썸네일 호버 미리보기
//  - 호버 즉시: 필름스트립 플립북으로 미리보기(변환 대기 동안 바로 움직임)
//  - 동시에 웹 재생용 미리보기(mp4) 변환을 요청하고, 준비되면 실제 영상 재생으로 전환
//  - 아래 타임라인 바를 드래그하면: (영상 준비 전) 프레임 스크럽 / (영상 재생 중) 영상 위치 이동
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtDuration } from "../util";

const FRAME_MS = 130; // 플립북 속도(프레임당 ms)

export default function ThumbScrub({ clip }: { clip: Clip }) {
  const n = clip.frame_times?.length || clip.frames?.length || 0;
  const [idx, setIdx] = useState(0);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [vProg, setVProg] = useState(0); // 영상 진행률 0..1
  const [vDur, setVDur] = useState(0);   // 영상 길이(초)
  const barRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const showVideo = hover && videoReady;

  // 호버 → 웹 재생용 mp4 변환 요청 + 준비될 때까지 폴링
  //  (살짝 스쳐 지나가는 호버엔 변환을 걸지 않도록 약간 지연)
  useEffect(() => {
    if (!hover) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = setTimeout(function poll() {
      api.previewStatus(clip.id)
        .then((st) => {
          if (cancelled) return;
          if (st.ready) { setVideoReady(true); return; }
          if (st.error) return;              // 변환 실패 → 플립북 유지
          timer = setTimeout(poll, 1200);    // 변환 중 → 계속 폴링
        })
        .catch(() => {});
    }, 220);
    return () => { cancelled = true; clearTimeout(start); clearTimeout(timer); };
  }, [hover, clip.id]);

  // 플립북(영상 준비 전, 드래그 아닐 때) 자동 재생
  useEffect(() => {
    if (!hover || videoReady || dragging || n <= 1) return;
    const iv = setInterval(() => setIdx((p) => (p + 1) % n), FRAME_MS);
    return () => clearInterval(iv);
  }, [hover, videoReady, dragging, n]);

  // 영상 준비 + 호버 중이면 재생
  useEffect(() => {
    if (hover && videoReady) videoRef.current?.play().catch(() => {});
  }, [hover, videoReady]);

  // 바 위치(clientX) → 프레임/영상 시점으로 이동
  function seekFromX(clientX: number) {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return;
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    if (showVideo) {
      const v = videoRef.current;
      if (v && v.duration) { v.currentTime = p * v.duration; setVProg(p); }
    } else if (n > 1) {
      setIdx(Math.round(p * (n - 1)));
    }
  }

  // 드래그 중 전역 마우스 추적 (showVideo 바뀌면 최신 로직으로 재구독)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, n, showVideo]);

  const active = hover || dragging;
  const imgSrc = active && n > 0 ? api.frameUrl(clip.id, idx) : api.thumbUrl(clip.id);
  const pct = showVideo ? vProg * 100 : n > 1 ? (idx / (n - 1)) * 100 : 0;
  const t = showVideo ? vProg * vDur : clip.frame_times?.[idx];
  const showBar = active && (showVideo || n > 1);

  return (
    <div
      className="thumb-scrub"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        if (!dragging) setIdx(0);
        videoRef.current?.pause();
      }}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          className="thumb thumb-video"
          src={api.videoUrl(clip.id)}
          muted
          loop
          playsInline
          autoPlay
          preload="none"
          onLoadedMetadata={(e) => setVDur((e.target as HTMLVideoElement).duration || 0)}
          onTimeUpdate={(e) => {
            if (dragging) return;
            const v = e.target as HTMLVideoElement;
            if (v.duration) setVProg(v.currentTime / v.duration);
          }}
        />
      ) : (
        <img
          className="thumb"
          src={imgSrc}
          alt=""
          draggable={false}
          onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
        />
      )}

      {active && t != null && <span className="scrub-time">{fmtDuration(t)}</span>}

      {showBar && (
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
