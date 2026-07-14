// 보드 — 유저가 직접 모은 클립(즐겨찾기 · 폴더). 핀터레스트식 그리드.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import { colorClass, scoreLabel, fmtTC } from "../util";
import {
  useLabels, renameFolder, deleteFolder, addFolder, toggleFavorite,
} from "../labels";
import { confirmDialog } from "../ui/feedback";
import ThumbScrub from "../components/ThumbScrub";

function ClipCard({ clip, pid, fav, onFav }: { clip: Clip; pid: string; fav: boolean; onFav: () => void }) {
  const nav = useNavigate();
  const cc = colorClass(clip.color);
  return (
    <div className="board-card" onClick={() => nav(`/project/${pid}/clip/${clip.id}`)}>
      <div className="bc-thumb" onClick={(e) => e.stopPropagation()}>
        <ThumbScrub clip={clip} />
        <button className={`heart ${fav ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); onFav(); }} title="즐겨찾기">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10z" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="bc-body">
        <div className="bc-line">{clip.one_line || clip.filename}</div>
        <div className="bc-meta">
          <span className={`score-num c-${cc}`}>{clip.recommendation ?? 0}</span>
          <span className={`c-${cc}`} style={{ fontWeight: 700 }}>{scoreLabel(clip.color)}</span>
          <span className="muted">· {clip.place || "—"} · {fmtTC(clip.duration_sec)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Board() {
  const { pid = "" } = useParams();
  const labels = useLabels(pid);
  const [clips, setClips] = useState<Clip[]>([]);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  useEffect(() => {
    api.listClips(pid).then((cs) => setClips(cs.filter((c) => c.status === "done"))).catch(() => {});
  }, [pid]);

  const byId = useMemo(() => {
    const m = new Map<string, Clip>();
    clips.forEach((c) => m.set(c.id, c));
    return m;
  }, [clips]);
  const favSet = useMemo(() => new Set(labels.favorites), [labels.favorites]);

  const favClips = labels.favorites.map((id) => byId.get(id)).filter(Boolean) as Clip[];

  async function onDeleteFolder(id: string, name: string) {
    const ok = await confirmDialog({ title: "폴더 삭제", msg: `'${name}' 폴더를 삭제할까요? 클립 자체는 지워지지 않아요.`, confirmText: "삭제", danger: true });
    if (ok) deleteFolder(pid, id);
  }

  const empty = labels.favorites.length === 0 && labels.folders.length === 0;

  return (
    <div>
      <div className="row spread page-head">
        <h1>보드 <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>내가 모은 클립</span></h1>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="board-newinput"
            placeholder="새 폴더 이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { addFolder(pid, newName.trim()); setNewName(""); } }}
          />
          <button className="sm" disabled={!newName.trim()} onClick={() => { addFolder(pid, newName.trim()); setNewName(""); }}>+ 폴더</button>
        </div>
      </div>

      {empty && (
        <div className="empty-state">
          <div className="empty-art">📌</div>
          <h3>아직 모은 클립이 없어요</h3>
          <p>표나 상세페이지에서 하트를 누르거나 색 태그·폴더에 담으면 여기에 모여요.</p>
        </div>
      )}

      {/* 즐겨찾기 */}
      {favClips.length > 0 && (
        <section className="board-sec">
          <div className="board-sec-head">
            <h2>♥ 즐겨찾기 <span className="board-count">{favClips.length}</span></h2>
          </div>
          <div className="board-grid">
            {favClips.map((c) => (
              <ClipCard key={c.id} clip={c} pid={pid} fav={favSet.has(c.id)} onFav={() => toggleFavorite(pid, c.id)} />
            ))}
          </div>
        </section>
      )}

      {/* 폴더 */}
      {labels.folders.map((f) => {
        const items = f.clipIds.map((id) => byId.get(id)).filter(Boolean) as Clip[];
        return (
          <section className="board-sec" key={f.id}>
            <div className="board-sec-head">
              {renaming === f.id ? (
                <input
                  className="board-renameinput"
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => { if (renameVal.trim()) renameFolder(pid, f.id, renameVal.trim()); setRenaming(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { if (renameVal.trim()) renameFolder(pid, f.id, renameVal.trim()); setRenaming(null); }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <h2>📁 {f.name} <span className="board-count">{items.length}</span></h2>
              )}
              <div className="row" style={{ gap: 6 }}>
                <button className="secondary sm" onClick={() => { setRenaming(f.id); setRenameVal(f.name); }}>이름변경</button>
                <button className="secondary sm" onClick={() => onDeleteFolder(f.id, f.name)}>삭제</button>
              </div>
            </div>
            {items.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>비어 있어요. 상세페이지에서 📁 폴더로 클립을 담아보세요.</p>
            ) : (
              <div className="board-grid">
                {items.map((c) => (
                  <ClipCard key={c.id} clip={c} pid={pid} fav={favSet.has(c.id)} onFav={() => toggleFavorite(pid, c.id)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
