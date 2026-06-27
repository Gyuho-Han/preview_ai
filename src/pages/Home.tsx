// P1 홈 — 프로젝트 카드 목록(최근 수정순) + 새 프로젝트 버튼
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ProjectSummary } from "../types";
import { fmtDate } from "../util";

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
    if (!confirm(`'${p.name}' 프로젝트를 삭제할까요? 분석된 클립도 함께 삭제됩니다.`)) return;
    const prev = projects;
    setProjects((list) => list.filter((x) => x.id !== p.id)); // 낙관적 업데이트
    try {
      await api.deleteProject(p.id);
    } catch {
      setProjects(prev); // 실패 시 롤백
      alert("삭제에 실패했습니다.");
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
        <p className="muted">불러오는 중…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          아직 프로젝트가 없습니다. <Link to="/new">새 프로젝트</Link>를 만들어 시작하세요.
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
