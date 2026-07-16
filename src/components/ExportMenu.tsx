import { useEffect, useRef, useState } from "react";
import { fmtDuration } from "../util";

const icProps = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const IcChevronRight = () => <svg {...icProps}><path d="M9 6l6 6-6 6" /></svg>;

export interface ExportMenuProps {
  open: boolean;
  onClose: () => void;
  hasSelection: boolean;
  selectionDuration?: number;
  onExport: (type: "premiere" | "davinci" | "finalcut" | "file", range: "selection" | "full") => void;
}

export default function ExportMenu({
  open, onClose, hasSelection, selectionDuration, onExport
}: ExportMenuProps) {
  const [submenu, setSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setSubmenu(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={menuRef} className="export-menu">
      {/* 구간 내보내기 */}
      <div
        className={`export-item ${!hasSelection ? "disabled" : ""}`}
        onMouseEnter={() => hasSelection && setSubmenu("selection")}
        onMouseLeave={() => setSubmenu(null)}
      >
        <button
          disabled={!hasSelection}
          onClick={() => hasSelection && setSubmenu(submenu === "selection" ? null : "selection")}
        >
          {selectionDuration != null && hasSelection ? (
            <>
              <span className="export-label">구간 내보내기</span>
              <span className="export-duration">{fmtDuration(selectionDuration)}</span>
            </>
          ) : (
            <>구간 내보내기</>
          )}
          {hasSelection && <IcChevronRight />}
        </button>
        {submenu === "selection" && hasSelection && (
          <div className="export-submenu">
            <button onClick={() => { onExport("premiere", "selection"); onClose(); }}>
              프리미어 프로로 보내기
            </button>
            <button onClick={() => { onExport("davinci", "selection"); onClose(); }}>
              다빈치로 보내기
            </button>
            <button onClick={() => { onExport("finalcut", "selection"); onClose(); }}>
              파이널컷으로 보내기
            </button>
            <div className="export-divider" />
            <button onClick={() => { onExport("file", "selection"); onClose(); }}>
              파일로 저장
            </button>
          </div>
        )}
      </div>

      {/* 영상 전체 내보내기 */}
      <div
        className="export-item"
        onMouseEnter={() => setSubmenu("full")}
        onMouseLeave={() => setSubmenu(null)}
      >
        <button
          onClick={() => setSubmenu(submenu === "full" ? null : "full")}
        >
          <span className="export-label">영상 전체 내보내기</span>
          <IcChevronRight />
        </button>
        {submenu === "full" && (
          <div className="export-submenu">
            <button onClick={() => { onExport("premiere", "full"); onClose(); }}>
              프리미어 프로로 보내기
            </button>
            <button onClick={() => { onExport("davinci", "full"); onClose(); }}>
              다빈치로 보내기
            </button>
            <button onClick={() => { onExport("finalcut", "full"); onClose(); }}>
              파이널컷으로 보내기
            </button>
            <div className="export-divider" />
            <button onClick={() => { onExport("file", "full"); onClose(); }}>
              파일로 저장
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
