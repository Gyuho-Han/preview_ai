// P3 기본페이지 — 좌 60% 영상 업로드/진행률, 우 40% 맥락 수정, 하단 탭바
import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { api, pickFolder, pickPlan, isTauri } from "../api";
import type { Clip, PlanContext } from "../types";

export default function ProjectHome() {
  const { pid = "" } = useParams();
  const [ctx, setCtx] = useState<PlanContext & { name?: string }>();
  const [clips, setClips] = useState<Clip[]>([]);
  const [folderPath, setFolderPath] = useState("");   // 브라우저 모드 경로 입력
  const [scanMsg, setScanMsg] = useState("");

  const refresh = useCallback(() => {
    api.listClips(pid).then(setClips).catch(() => {});
  }, [pid]);

  useEffect(() => {
    api.getProject(pid).then(setCtx).catch(() => {});
    refresh();
  }, [pid, refresh]);

  // 분석 중인 클립이 있으면 폴링
  useEffect(() => {
    const active = clips.some((c) => c.status === "queued");
    if (!active) return;
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [clips, refresh]);

  // 폴더 경로 방식: 영상은 복사하지 않고 원본 경로 그대로 분석.
  // Tauri: 네이티브 폴더 다이얼로그 / 브라우저: 경로 직접 입력.
  async function scanFolder(folder: string) {
    if (!folder.trim()) return;
    setScanMsg("폴더 스캔 중…");
    try {
      const r = await api.analyzeFolder(pid, folder.trim());
      setScanMsg(`영상 ${r.found}개 발견 · ${r.queued}개 분석 시작` +
        (r.found - r.queued > 0 ? ` (이미 분석된 ${r.found - r.queued}개 제외)` : ""));
      refresh();
    } catch (e) {
      setScanMsg(`실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function pickAndScan() {
    const folder = await pickFolder();
    if (!folder) return;
    setFolderPath(folder);
    await scanFolder(folder);
  }

  async function reuploadPlan() {
    const path = await pickPlan();
    if (!path) return;
    const result = await api.uploadPlan(pid, path);
    setCtx((c) => ({ ...c, ...result }));
    // 기획안 변경 → 기존 클립 추천도 재계산
    await api.recomputeScores(pid);
    refresh();
  }

  async function deleteClip(c: Clip) {
    if (!confirm(`'${c.filename}' 영상을 목록에서 삭제할까요?`)) return;
    setClips((list) => list.filter((x) => x.id !== c.id)); // 낙관적 업데이트
    try {
      await api.deleteClip(c.id);
    } catch {
      alert("삭제에 실패했습니다.");
      refresh();
    }
  }

  async function saveCtx() {
    if (!ctx) return;
    await api.updatePlan(pid, ctx as PlanContext);
    await api.recomputeScores(pid);
    refresh();
    alert("맥락 저장 + 추천도 재계산 완료");
  }

  const done = clips.filter((c) => c.status === "done").length;

  return (
    <div>
      <div className="row spread">
        <h1>{ctx?.name || ctx?.title || "프로젝트"}</h1>
        <Link to={`/project/${pid}/table`} className="btn">표 보기 ({done})</Link>
      </div>

      <div className="split" style={{ marginTop: 12 }}>
        {/* 좌 60% — 업로드 + 진행률 */}
        <div className="card" style={{ overflow: "auto" }}>
          {isTauri ? (
            <div className="dropzone" onClick={pickAndScan}>
              <div style={{ fontSize: 28 }}>📁</div>
              <div>영상 폴더 선택</div>
              <div className="muted" style={{ fontSize: 12 }}>
                폴더 안의 영상을 복사 없이 경로로 분석 (MP4 · MOV · MXF)
              </div>
            </div>
          ) : (
            <div className="card" style={{ background: "var(--panel-2)" }}>
              <label>영상 폴더 경로</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  placeholder="/Users/이름/Footage 처럼 폴더 경로 입력"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && scanFolder(folderPath)}
                />
                <button onClick={() => scanFolder(folderPath)}>분석</button>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                사이드카가 같은 PC에서 해당 폴더의 영상을 복사 없이 읽어 분석합니다.
              </div>
            </div>
          )}
          {scanMsg && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{scanMsg}</p>}

          <h2>분석 진행</h2>
          {clips.length === 0 ? (
            <p className="muted">아직 추가된 영상이 없습니다.</p>
          ) : (
            clips.map((c) => (
              <div key={c.id} style={{ marginBottom: 12 }}>
                <div className="row spread">
                  <span>{c.filename}</span>
                  <span className="row" style={{ gap: 8, alignItems: "center" }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {c.status === "done" ? "완료" : c.status === "error" ? `오류` : `${c.stage} ${c.progress}%`}
                    </span>
                    <button
                      className="row-delete"
                      title="영상 삭제"
                      onClick={() => deleteClip(c)}
                    >
                      ×
                    </button>
                  </span>
                </div>
                <div className="progress">
                  <div style={{ width: `${c.progress}%` }} />
                </div>
                {c.status === "error" && c.error && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4, color: "#e5484d", whiteSpace: "pre-wrap" }}>
                    {c.error}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 우 40% — 맥락 수정 */}
        <div className="card" style={{ overflow: "auto" }}>
          <div className="row spread">
            <h2 style={{ margin: 0 }}>프로젝트 맥락</h2>
            <button className="secondary" onClick={reuploadPlan}>기획안 재업로드</button>
          </div>
          {ctx && (
            <>
              <label>핵심 주제</label>
              <input value={ctx.topic ?? ""} onChange={(e) => setCtx({ ...ctx, topic: e.target.value })} />
              <label>키워드 (쉼표 · 추천도 기준)</label>
              <input
                value={(ctx.keywords ?? []).join(", ")}
                onChange={(e) => setCtx({ ...ctx, keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
              <label>장소</label>
              <input
                value={(ctx.locations ?? []).join(", ")}
                onChange={(e) => setCtx({ ...ctx, locations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
              <label>등장인물</label>
              <input
                value={(ctx.characters ?? []).join(", ")}
                onChange={(e) => setCtx({ ...ctx, characters: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
              <button style={{ marginTop: 14 }} onClick={saveCtx}>저장 + 추천도 재계산</button>
            </>
          )}
        </div>
      </div>

      {/* 하단 탭바 */}
      <div className="tabbar">
        <Link to={`/project/${pid}`} className="btn secondary">기본</Link>
        <Link to={`/project/${pid}/table`} className="btn secondary">표</Link>
      </div>
    </div>
  );
}
