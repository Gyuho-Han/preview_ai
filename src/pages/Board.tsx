// 보드 — 유저가 하트로 찜한 클립 모음. 핀터레스트식 그리드.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import { colorClass, scoreLabel, fmtTC } from "../util";
import { useLabels, toggleFavorite } from "../labels";
import ThumbScrub from "../components/ThumbScrub";

function ClipCard({ clip, pid, onFav }: { clip: Clip; pid: string; onFav: () => void }) {
  const nav = useNavigate();
  const cc = colorClass(clip.color);
  return (
    <div className="board-card" onClick={() => nav(`/project/${pid}/clip/${clip.id}`)}>
      <div className="bc-thumb" onClick={(e) => e.stopPropagation()}>
        <ThumbScrub clip={clip} />
        <button className="heart on" onClick={(e) => { e.stopPropagation(); onFav(); }} title="찜 해제">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10z" fill="currentColor" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
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

  useEffect(() => {
    api.listClips(pid).then((cs) => setClips(cs.filter((c) => c.status === "done"))).catch(() => {});
  }, [pid]);

  const byId = useMemo(() => {
    const m = new Map<string, Clip>();
    clips.forEach((c) => m.set(c.id, c));
    return m;
  }, [clips]);

  const favClips = labels.favorites.map((id) => byId.get(id)).filter(Boolean) as Clip[];

  return (
    <div>
      <div className="row spread page-head">
        <h1>보드 <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>찜한 클립</span></h1>
      </div>

      {favClips.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">♥</div>
          <h3>찜한 클립이 없어요</h3>
          <p>표나 상세페이지에서 하트를 누르면 여기에 모여요.</p>
        </div>
      ) : (
        <div className="board-grid">
          {favClips.map((c) => (
            <ClipCard key={c.id} clip={c} pid={pid} onFav={() => toggleFavorite(pid, c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
