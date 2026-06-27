// P3 기본페이지 — 좌 60% 영상 업로드/진행률, 우 40% 맥락 수정, 하단 탭바
import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { api, pickVideos, pickFolder, pickPlan, isTauri } from "../api";
import type { Clip, PlanContext } from "../types";
import { toast, confirmDialog } from "../ui/feedback";

export default function ProjectHome() {
  const { pid = "" } = useParams();
  const [ctx, setCtx] = useState<PlanContext & { name?: string }>();
  const [clips, setClips] = useState<Clip[]>([]);
  const [dragging, setDragging] = useState(false);
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
      toast(`영상 ${paths.length}개 추가 — 분석을 시작합니다.`);
      refresh();
    } else {
      fileInput.current?.click();
    }
  }

  async function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !files.length) return;
    const count = files.length;
    await api.analyzeUpload(pid, files);
    e.target.value = "";
    toast(`영상 ${count}개 추가 — 분석을 시작합니다.`);
    refresh();
  }

  // 끌어다 놓기로 영상 추가 (브라우저/데모). 영상 파일만 통과.
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    const vids = dropped.filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|mxf|m4v)$/i.test(f.name)
    );
    if (!vids.length) {
      if (dropped.length) toast("영상 파일만 추가할 수 있어요 (MP4·MOV·MXF).", "error");
      return;
    }
    await api.analyzeUpload(pid, vids);
    toast(`영상 ${vids.length}개 추가 — 분석을 시작합니다.`);
    refresh();
  }

  // 폴더 전체 추가 — 원본을 복사하지 않고 폴더 안 영상을 경로로 분석 (Tauri 폴더 다이얼로그)
  async function addFolder() {
    const folder = await pickFolder();
    if (!folder) return;
    try {
      const r = await api.analyzeFolder(pid, folder);
      toast(`영상 ${r.found}개 발견 · ${r.queued}개 분석 시작` +
        (r.found - r.queued > 0 ? ` (이미 분석된 ${r.found - r.queued}개 제외)` : ""));
      refresh();
    } catch (e) {
      toast(`폴더 분석 실패: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function reuploadPlan() {
    const path = await pickPlan();
    if (!path) return;
    const result = await api.uploadPlan(pid, path);
    setCtx((c) => ({ ...c, ...result }));
    // 기획안 변경 → 기존 클립 추천도 재계산
    await api.recomputeScores(pid);
    refresh();
    toast("기획안 반영 완료 — 추천도를 재계산했습니다.");
  }

  async function deleteClip(c: Clip) {
    const ok = await confirmDialog({
      title: "영상 삭제",
      msg: `'${c.filename}' 영상을 목록에서 삭제할까요?`,
      confirmText: "삭제",
      danger: true,
    });
    if (!ok) return;
    setClips((list) => list.filter((x) => x.id !== c.id)); // 낙관적 업데이트
    try {
      await api.deleteClip(c.id);
      toast("영상을 삭제했습니다.");
    } catch {
      toast("삭제에 실패했습니다.", "error");
      refresh();
    }
  }

  async function saveCtx() {
    if (!ctx) return;
    await api.updatePlan(pid, ctx as PlanContext);
    await api.recomputeScores(pid);
    refresh();
    toast("맥락 저장 + 추천도 재계산 완료");
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
          <div
            className={`dropzone ${dragging ? "drag" : ""}`}
            onClick={addVideos}
            onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
            onDrop={onDrop}
          >
            <div className="dropzone-icon">⬆</div>
            <div className="dropzone-title">{dragging ? "여기에 놓으세요" : "영상을 끌어다 놓거나 클릭"}</div>
            <div className="muted" style={{ fontSize: 12 }}>MP4 · MOV · MXF · M4V</div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".mp4,.mov,.mxf,.m4v,video/*"
            multiple
            style={{ display: "none" }}
            onChange={onFilesPicked}
          />
          {isTauri && (
            <button className="secondary" style={{ width: "100%", marginTop: 8, justifyContent: "center" }} onClick={addFolder}>
              📁 폴더 전체 추가 (복사 없이 경로로 분석)
            </button>
          )}

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
