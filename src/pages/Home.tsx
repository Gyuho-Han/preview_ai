// P1 홈 — 프로젝트 카드 목록(최근 수정순) + 새 프로젝트 버튼
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ProjectSummary } from "../types";
import { fmtDate } from "../util";
import { toast, confirmDialog } from "../ui/feedback";

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  async function deleteProject(e: React.MouseEvent, p: ProjectSummary) {
    e.stopPropagation(); // 카드 클릭(이동) 방지
    const ok = await confirmDialog({
      title: "프로젝트 삭제",
      msg: `'${p.name}' 프로젝트를 삭제할까요? 분석된 클립도 함께 삭제됩니다.`,
      confirmText: "삭제",
      danger: true,
    });
    if (!ok) return;
    const prev = projects;
    setProjects((list) => list.filter((x) => x.id !== p.id)); // 낙관적 업데이트
    try {
      await api.deleteProject(p.id);
      toast("프로젝트를 삭제했습니다.");
    } catch {
      setProjects(prev); // 실패 시 롤백
      toast("삭제에 실패했습니다.", "error");
    }
  }

  return (
    <div>
      <div className="row spread">
        <div>
          <h1>프로젝트</h1>
          <p className="muted">다큐 영상을 분석해 프리뷰 노트를 자동으로 만듭니다.</p>
        </div>
        <Link to="/new" className="btn">+ 새 프로젝트</Link>
      </div>

      {loading ? (
        <div className="grid" style={{ marginTop: 18 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="card skel-card" key={i}>
              <div className="skel skel-line" style={{ width: "60%", height: 16 }} />
              <div className="skel skel-line" style={{ width: "40%" }} />
              <div className="skel skel-line" style={{ width: "75%", marginTop: 14 }} />
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
        <div className="grid" style={{ marginTop: 18 }}>
          {projects.map((p) => (
            <div
              key={p.id}
              className="card project-card"
              onClick={() => nav(`/project/${p.id}`)}
            >
              <button
                className="card-delete"
                title="프로젝트 삭제"
                onClick={(e) => deleteProject(e, p)}
              >
                ×
              </button>
              <h3>{p.name}</h3>
              <div className="muted">{p.shooting_period || "촬영 기간 미정"}</div>
              <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                클립 {p.clip_count}개 · 수정 {fmtDate(p.updated_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
