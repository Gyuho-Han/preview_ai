// P3 기본페이지 — 좌 60% 영상 업로드/진행률, 우 40% 맥락 수정, 하단 탭바
import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { api, pickVideos, pickPlan, isTauri } from "../api";
import type { Clip, PlanContext } from "../types";

export default function ProjectHome() {
  const { pid = "" } = useParams();
  const [ctx, setCtx] = useState<PlanContext & { name?: string }>();
  const [clips, setClips] = useState<Clip[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

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

  // Tauri: 네이티브 다이얼로그로 경로 선택(대용량 MXF도 복사 없이 분석)
  // 브라우저: 파일 input으로 바이트 업로드
  async function addVideos() {
    if (isTauri) {
      const paths = await pickVideos();
      if (!paths.length) return;
      await api.analyzeVideos(pid, paths);
      refresh();
    } else {
      fileInput.current?.click();
    }
  }

  async function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !files.length) return;
    await api.analyzeUpload(pid, files);
    e.target.value = "";
    refresh();
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
          <div className="dropzone" onClick={addVideos}>
            <div style={{ fontSize: 28 }}>⬆️</div>
            <div>영상 선택 / 드래그 (MP4 · MOV · MXF)</div>
            <div className="muted" style={{ fontSize: 12 }}>클릭해서 파일 추가</div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".mp4,.mov,.mxf,.m4v,video/*"
            multiple
            style={{ display: "none" }}
            onChange={onFilesPicked}
          />

          <h2>분석 진행</h2>
          {clips.length === 0 ? (
            <p className="muted">아직 추가된 영상이 없습니다.</p>
          ) : (
            clips.map((c) => (
              <div key={c.id} style={{ marginBottom: 12 }}>
                <div className="row spread">
                  <span>{c.filename}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {c.status === "done" ? "완료" : c.status === "error" ? `오류` : `${c.stage} ${c.progress}%`}
                  </span>
                </div>
                <div className="progress">
                  <div style={{ width: `${c.progress}%` }} />
                </div>
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
