// P4 표 페이지 — 9컬럼 스프레드시트, 추천도 색상바, 필터, 정렬, 페이지네이션, 실시간
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtDuration, colorClass } from "../util";
import ThumbScrub from "../components/ThumbScrub";

const PAGE_SIZE = 50;

export default function TableView() {
  const { pid = "" } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [clips, setClips] = useState<Clip[]>([]);
  const [page, setPage] = useState(1);

  // 필터 (대시보드에서 ?min= 로 진입하면 추천도 필터 초기값 반영)
  const [fPlace, setFPlace] = useState("");
  const [fCamera, setFCamera] = useState("");
  const [fPerson, setFPerson] = useState("");
  const [fMinScore, setFMinScore] = useState(Number(sp.get("min")) || 0);

  const refresh = useCallback(() => {
    api.listClips(pid).then(setClips).catch(() => {});
  }, [pid]);

  useEffect(() => { refresh(); }, [refresh]);
  // 실시간 업데이트 (분석 진행 중)
  useEffect(() => {
    const active = clips.some((c) => c.status === "queued");
    if (!active) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [clips, refresh]);

  const places = useMemo(() => [...new Set(clips.map((c) => c.place).filter(Boolean))], [clips]);
  const cameras = useMemo(() => [...new Set(clips.map((c) => c.camera).filter(Boolean))], [clips]);

  const filtered = useMemo(() => {
    return clips
      .filter((c) => c.status === "done")
      .filter((c) => !fPlace || c.place === fPlace)
      .filter((c) => !fCamera || c.camera === fCamera)
      .filter((c) => !fPerson || (c.people ?? []).some((p) => p.includes(fPerson)))
      .filter((c) => (c.recommendation ?? 0) >= fMinScore)
      // 기본 정렬: 촬영 날짜 오름차순 (같으면 파일명)
      .sort((a, b) => {
        const d = (a.date ?? "").localeCompare(b.date ?? "");
        return d !== 0 ? d : a.filename.localeCompare(b.filename);
      });
  }, [clips, fPlace, fCamera, fPerson, fMinScore]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const analyzing = clips.filter((c) => c.status === "queued").length;

  return (
    <div>
      <div className="row spread">
        <h1>표 <span className="muted" style={{ fontSize: 14 }}>{filtered.length}개</span></h1>
        <Link to={`/project/${pid}`} className="btn secondary">← 기본 페이지</Link>
      </div>
      {analyzing > 0 && (
        <p className="muted"><span className="spinner" /> {analyzing}개 분석 중 — 완료되는 대로 표에 추가됩니다.</p>
      )}

      <div className="filters">
        <select value={fPlace} onChange={(e) => setFPlace(e.target.value)}>
          <option value="">장소 전체</option>
          {places.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fCamera} onChange={(e) => setFCamera(e.target.value)}>
          <option value="">카메라 전체</option>
          {cameras.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="등장인물" value={fPerson} onChange={(e) => setFPerson(e.target.value)} />
        <select value={fMinScore} onChange={(e) => setFMinScore(Number(e.target.value))}>
          <option value={0}>추천도 전체</option>
          <option value={80}>80%+ (초록)</option>
          <option value={50}>50%+ (노랑 이상)</option>
        </select>
      </div>

      {pageItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">🔍</div>
          <h3>표시할 클립이 없습니다</h3>
          <p>{clips.length === 0 ? "기본 페이지에서 영상을 추가하면 분석 결과가 여기에 정리됩니다." : "필터 조건에 맞는 클립이 없습니다. 조건을 바꿔보세요."}</p>
          <Link to={`/project/${pid}`} className="btn secondary">← 기본 페이지로</Link>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>썸네일</th><th>파일명</th><th>길이</th><th>날짜</th><th>장소</th>
              <th>카메라</th><th>등장인물</th><th>한줄요약</th><th>추천도</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c) => (
              <tr key={c.id} onClick={() => nav(`/project/${pid}/clip/${c.id}`)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <ThumbScrub clip={c} />
                </td>
                <td>{c.filename}</td>
                <td>{fmtDuration(c.duration_sec)}</td>
                <td className="muted">{c.date || "—"}</td>
                <td>{c.place || "—"}</td>
                <td>{c.camera || "—"}</td>
                <td>{(c.people ?? []).join(", ") || "—"}</td>
                <td style={{ maxWidth: 280 }}>{c.one_line || "—"}</td>
                <td>
                  <div className="score">
                    <div className="score-bar">
                      <div className={`bg-${colorClass(c.color)}`} style={{ width: `${c.recommendation ?? 0}%` }} />
                    </div>
                    <span className={`score-num c-${colorClass(c.color)}`}>{c.recommendation ?? 0}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
          <span>{page} / {totalPages}</span>
          <button className="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button>
        </div>
      )}
    </div>
  );
}
