// P1 홈 — 프로젝트 카드 목록(최근 수정순) + 새 프로젝트
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ProjectSummary } from "../types";
import { toast, confirmDialog } from "../ui/feedback";

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [prog, setProg] = useState<Record<string, number>>({}); // pid → 분석 완료율(%)
  const [q, setQ] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api
      .listProjects()
      .then(async (list) => {
        setProjects(list);
        // 각 프로젝트의 분석 완료율 계산 (done / total)
        const entries = await Promise.all(
          list.map(async (p) => {
            try {
              const clips = await api.listClips(p.id);
              const total = clips.length || p.clip_count;
              const done = clips.filter((c) => c.status === "done").length;
              return [p.id, total ? Math.round((done / total) * 100) : 0] as const;
            } catch {
              return [p.id, 0] as const;
            }
          })
        );
        setProg(Object.fromEntries(entries));
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  async function deleteProject(e: React.MouseEvent, p: ProjectSummary) {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: "프로젝트 삭제",
      msg: `'${p.name}' 프로젝트를 삭제할까요? 분석된 클립도 함께 삭제됩니다.`,
      confirmText: "삭제",
      danger: true,
    });
    if (!ok) return;
    const prev = projects;
    setProjects((list) => list.filter((x) => x.id !== p.id));
    try {
      await api.deleteProject(p.id);
      toast("프로젝트를 삭제했습니다.");
    } catch {
      setProjects(prev);
      toast("삭제에 실패했습니다.", "error");
    }
  }

  return (
    <div>
      <div className="row spread page-head">
        <h1>내 프로젝트</h1>
        <Link to="/new" className="btn">+ 새 프로젝트</Link>
      </div>

      {!loading && projects.length > 0 && (
        <div className="proj-search">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            placeholder="프로젝트 검색…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="pro-badge">PRO</span>
        </div>
      )}

      {loading ? (
        <div className="proj-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="card proj-card skel-card" key={i}>
              <div className="skel skel-line" style={{ width: "62%", height: 16 }} />
              <div className="skel skel-line" style={{ width: "42%" }} />
              <div className="skel skel-line" style={{ width: "100%", marginTop: 20, height: 6 }} />
              <div className="skel skel-line" style={{ width: "70%", marginTop: 14 }} />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">🎬</div>
          <h3>아직 프로젝트가 없습니다</h3>
          <p>다큐 영상을 분석해 프리뷰 노트를 자동으로 만들어 보세요.</p>
          <Link to="/new" className="btn">+ 새 프로젝트 만들기</Link>
        </div>
      ) : (
        <div className="proj-grid">
          {projects
            .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
            .map((p) => {
            const pct = prog[p.id] ?? 0;
            return (
              <div key={p.id} className="card proj-card" onClick={() => nav(`/project/${p.id}`)}>
                <button className="card-delete" title="프로젝트 삭제" onClick={(e) => deleteProject(e, p)}>×</button>
                <h3>{p.name}</h3>
                <div className="proj-date">{p.shooting_period || "촬영 기간 미정"}</div>
                <div className="proj-progress">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="proj-stats">
                  <span>영상 <b>{p.clip_count}개</b></span>
                  <span>분석 <b className={pct >= 100 ? "c-green" : ""}>{pct}%</b></span>
                </div>
              </div>
            );
          })}

          <Link to="/new" className="card proj-card proj-new">
            <span className="proj-new-plus">+</span>
            <span>새 프로젝트</span>
          </Link>
        </div>
      )}
    </div>
  );
}
