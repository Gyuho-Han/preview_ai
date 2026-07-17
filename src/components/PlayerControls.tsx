import { useEffect, useRef, useState } from "react";
import ExportMenu from "./ExportMenu";

// 플레이어 타임코드 전용 포맷 — fmtDuration과 달리 0초도 "0:00"으로 표시
function fmtT(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const icProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const IcScissors = () => <svg {...icProps}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M9 9l6 6M9 15l6-6" /></svg>;
const IcClose = () => <svg {...icProps}><path d="M18 6L6 18M6 6l12 12" /></svg>;

export interface PlayerControlsProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTimeChange: (time: number) => void;
  onPlayToggle: () => void;

  selectionMode: boolean;
  onSelectionModeToggle: () => void;
  selectionStart?: number;
  selectionEnd?: number;
  onSelectionChange: (start?: number, end?: number) => void;
  onExport?: (type: "premiere" | "davinci" | "finalcut" | "file", range: "selection" | "full") => void;
}

export default function PlayerControls({
  currentTime, duration, isPlaying,
  onTimeChange, onPlayToggle,
  selectionMode, onSelectionModeToggle,
  selectionStart, selectionEnd,
  onSelectionChange, onExport
}: PlayerControlsProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // 일반 seek 또는 선택 모드에서 드래그
  useEffect(() => {
    if (!barRef.current) return;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;

      const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const t = p * duration;
      setIsSeeking(true);

      if (selectionMode) {
        onSelectionChange(t, undefined);
      } else {
        onTimeChange(t);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isSeeking) return;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const t = p * duration;

      if (selectionMode) {
        onSelectionChange(selectionStart, t);
      } else {
        onTimeChange(t);
      }
    };

    const handleMouseUp = () => {
      setIsSeeking(false);
    };

    barRef.current.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      barRef.current?.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [selectionMode, isSeeking, duration, selectionStart, onSelectionChange, onTimeChange]);

  // 일반 seek 처리 (클릭 또는 짧은 드래그)
  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (selectionMode) return; // 선택 모드에서는 위 Effect에서 처리
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onTimeChange(p * duration);
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  let bgImage = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progressPct}%, rgba(255,255,255,0.25) ${progressPct}%, rgba(255,255,255,0.25) 100%)`;

  // 선택 모드에서 구간이 있으면 3구간 그라디언트
  if (selectionMode && selectionStart != null && selectionEnd != null) {
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    const startPct = (start / duration) * 100;
    const endPct = (end / duration) * 100;
    bgImage = `linear-gradient(to right,
      rgba(255,255,255,0.25) 0%,
      rgba(255,255,255,0.25) ${startPct}%,
      var(--yellow) ${startPct}%,
      var(--yellow) ${endPct}%,
      rgba(255,255,255,0.25) ${endPct}%,
      rgba(255,255,255,0.25) 100%)`;
  }

  const hasSelection = selectionStart != null && selectionEnd != null;
  const selectionDuration = (selectionStart != null && selectionEnd != null)
    ? Math.abs(selectionEnd - selectionStart)
    : undefined;

  return (
    <div className={`control-bar ${selectionMode ? "selection-mode" : ""}`}>
      <button
        className="control-mini"
        onClick={onPlayToggle}
        aria-label={isPlaying ? "일시정지" : "재생"}
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>

      <div
        ref={barRef}
        className="control-track"
        onClick={handleBarClick}
      >
        {/* 진행 막대는 이 얇은 오버레이 div로만 그린다. input은 투명한 클릭 영역일 뿐이라
            포커스/드래그해도 두께가 바뀌지 않는다(예전엔 input 배경이라 만지면 16px로 커졌음). */}
        <div className="control-progress" style={{ backgroundImage: bgImage }} />
        <input
          className="control-range"
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={(e) => onTimeChange(Number(e.target.value))}
          disabled={duration <= 0}
        />
      </div>

      <span className="control-tc">{fmtT(currentTime)} / {fmtT(duration)}</span>

      <button
        className={`control-btn ${selectionMode ? "active" : ""}`}
        onClick={onSelectionModeToggle}
        title={selectionMode ? "구간 선택 종료" : "구간 선택"}
        aria-label="구간 선택"
      >
        <IcScissors />
      </button>

      {selectionMode && (
        <>
          {hasSelection && (
            <button
              className="control-btn export-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              title="내보내기 옵션"
            >
              {fmtT(Math.abs((selectionEnd ?? 0) - (selectionStart ?? 0)))}
              <span style={{ marginLeft: "4px" }}>내보내기▼</span>
            </button>
          )}
          <button
            className="control-btn cancel-btn"
            onClick={onSelectionModeToggle}
            title="선택 취소"
            aria-label="선택 취소"
          >
            <IcClose />
          </button>
        </>
      )}

      <ExportMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        hasSelection={hasSelection}
        selectionDuration={selectionDuration}
        onExport={(type, range) => {
          onExport?.(type, range);
          setMenuOpen(false);
        }}
      />
    </div>
  );
}
