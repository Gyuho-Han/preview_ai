// P3 기본페이지 — 탭(대시보드 / 영상 업로드 / 맥락 설정)
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, pickVideos, pickFolder, pickPlan, isTauri } from "../api";
import type { Clip, PlanContext } from "../types";
import { toast, confirmDialog } from "../ui/feedback";
import { colorClass, fmtDuration } from "../util";

type Tab = "dashboard" | "upload" | "context";

// HH:MM:SS
function fmtHMS(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
// m'ss"
function fmtMinSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
}

// Catmull-Rom → 부드러운 베지어 경로
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// 맥락 설정 — 칩 그룹(읽기 뷰)
function ChipGroup({ label, items }: { label: string; items?: string[] }) {
  const list = items ?? [];
  return (
    <div className="ctx-group">
      <div className="ctx-label">{label}</div>
      <div className="chips">
        {list.length ? (
          list.map((x) => <span className="chip" key={x}>{x}</span>)
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>—</span>
        )}
      </div>
    </div>
  );
}

// 맥락 설정 — 가중치 바(Pro 목업)
function WeightRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="weight-row">
      <span className="weight-label">{label}</span>
      <span className="weight-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="weight-pct">{pct}%</span>
    </div>
  );
}

// 추천도 분포 곡선 (KDE 근사) — 라이브러리 없이 SVG로 직접 렌더
function DistChart({ scores, onPick }: { scores: number[]; onPick?: (min: number) => void }) {
  const W = 1000, H = 300, padL = 34, padR = 966, top = 26, base = 250;
  const step = 2, bw = 7;
  const N = 100 / step + 1;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverScore, setHoverScore] = useState<number | null>(null);
  const densityAt = (x: number) => scores.reduce((a, s) => a + Math.exp(-((x - s) ** 2) / (2 * bw * bw)), 0);
  const density = Array.from({ length: N }, (_, i) => densityAt(i * step));
  const maxD = Math.max(...density, 1e-9);
  const X = (score: number) => padL + (score / 100) * (padR - padL);
  const Y = (dv: number) => base - (dv / maxD) * (base - top);
  const pts = density.map((dv, i) => [X(i * step), Y(dv)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${padR} ${base} L ${padL} ${base} Z`;

  const argmax = (from: number) => {
    let bi = -1;
    density.forEach((dv, i) => {
      if (i * step >= from && (bi < 0 || dv > density[bi])) bi = i;
    });
    return bi;
  };
  const peakAll = argmax(0);
  const peakGreen = scores.some((s) => s >= 80) ? argmax(80) : -1;

  const ticks = [0, 25, 50, 75, 100];

  const move = (e: React.MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const vbX = ((e.clientX - r.left) / r.width) * W;
    const s = Math.max(0, Math.min(100, Math.round(((vbX - padL) / (padR - padL)) * 100)));
    setHoverScore(s);
  };
  const click = () => {
    if (hoverScore == null || !onPick) return;
    onPick(hoverScore >= 80 ? 80 : hoverScore >= 50 ? 50 : 0);
  };
  const hCount = hoverScore != null ? scores.filter((s) => Math.abs(s - hoverScore) <= 2).length : 0;

  return (
    <svg
      ref={svgRef}
      className="dist-chart"
      viewBox={`0 0 ${W} ${H + 40}`}
      role="img"
      aria-label="추천도 분포"
      onMouseMove={move}
      onMouseLeave={() => setHoverScore(null)}
      onClick={click}
      style={{ cursor: onPick ? "pointer" : "default" }}
    >
      <defs>
        <clipPath id="dcRed"><rect x={padL} y="0" width={X(50) - padL} height={base} /></clipPath>
        <clipPath id="dcYel"><rect x={X(50)} y="0" width={X(80) - X(50)} height={base} /></clipPath>
        <clipPath id="dcGrn"><rect x={X(80)} y="0" width={padR - X(80)} height={base} /></clipPath>
        <clipPath id="dcLow"><rect x={padL} y="0" width={X(80) - padL} height={base} /></clipPath>
      </defs>

      <path d={area} className="dc-fill-red" clipPath="url(#dcRed)" />
      <path d={area} className="dc-fill-yel" clipPath="url(#dcYel)" />
      <path d={area} className="dc-fill-grn" clipPath="url(#dcGrn)" />

      <line x1={padL} y1={base} x2={padR} y2={base} className="dc-base" />
      <line x1={X(50)} y1={top - 6} x2={X(50)} y2={base} className="dc-thresh" />
      <line x1={X(80)} y1={top - 6} x2={X(80)} y2={base} className="dc-thresh-grn" />

      <path d={line} className="dc-line" clipPath="url(#dcLow)" />
      <path d={line} className="dc-line-grn" clipPath="url(#dcGrn)" />

      {peakAll >= 0 && <circle cx={pts[peakAll][0]} cy={pts[peakAll][1]} r="9" className="dc-dot" />}
      {peakGreen >= 0 && <circle cx={pts[peakGreen][0]} cy={pts[peakGreen][1]} r="9" className="dc-dot-grn" />}

      {/* AI 선별 라벨 */}
      <g transform={`translate(${X(80)}, ${top - 6})`}>
        <rect className="dc-pill" x="6" y="-16" rx="9" width="86" height="30" />
        <text className="dc-pill-t" x="49" y="4" textAnchor="middle">AI 선별</text>
      </g>

      {ticks.map((t) => (
        <text key={t} className="dc-tick" x={X(t)} y={base + 34} textAnchor="middle">{t}</text>
      ))}

      {hoverScore != null && (() => {
        const hx = X(hoverScore);
        const hy = Y(densityAt(hoverScore));
        const tipW = 128;
        const tipX = Math.min(Math.max(hx - tipW / 2, padL), padR - tipW);
        return (
          <g pointerEvents="none">
            <line x1={hx} y1={top - 6} x2={hx} y2={base} className="dc-guide" />
            <circle cx={hx} cy={hy} r="7" className="dc-hoverdot" />
            <g transform={`translate(${tipX}, ${top})`}>
              <rect className="dc-tip" x="0" y="-4" rx="8" width={tipW} height="34" />
              <text className="dc-tip-t" x={tipW / 2} y="18" textAnchor="middle">{hoverScore}점 · {hCount}개</text>
            </g>
          </g>
        );
      })()}
    </svg>
  );
}

export default function ProjectHome() {
  const { pid = "" } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [ctx, setCtx] = useState<PlanContext & { name?: string }>();
  const [clips, setClips] = useState<Clip[]>([]);
  const [dragging, setDragging] = useState(false);
  const [editCtx, setEditCtx] = useState(false);
  const [profile, setProfile] = useState("여행 브이로그");
  const [feedbackOn, setFeedbackOn] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api.listClips(pid).then(setClips).catch(() => {});
  }, [pid]);

  useEffect(() => {
    api.getProject(pid).then(setCtx).catch(() => {});
    refresh();
  }, [pid, refresh]);

  useEffect(() => {
    const active = clips.some((c) => c.status === "queued");
    if (!active) return;
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [clips, refresh]);

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
    setClips((list) => list.filter((x) => x.id !== c.id));
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

  const doneClips = useMemo(() => clips.filter((c) => c.status === "done"), [clips]);
  const done = doneClips.length;
  const queued = useMemo(() => clips.filter((c) => c.status === "queued"), [clips]);
  const analyzing = queued.length;
  const analyzingPct = analyzing
    ? Math.round(queued.reduce((a, c) => a + (c.progress || 0), 0) / analyzing)
    : 0;

  // 추천도 분포
  const dist = useMemo(() => {
    const g = doneClips.filter((c) => colorClass(c.color) === "rec").length;
    const y = doneClips.filter((c) => colorClass(c.color) === "ok").length;
    const r = doneClips.filter((c) => colorClass(c.color) === "low").length;
    return { g, y, r, total: g + y + r };
  }, [doneClips]);
  const pctOf = (n: number) => (dist.total ? Math.round((n / dist.total) * 100) : 0);

  // 통계 + 점수 배열(분포 곡선용)
  const scores = useMemo(() => doneClips.map((c) => c.recommendation ?? 0), [doneClips]);
  const stats = useMemo(() => {
    const total = doneClips.reduce((a, c) => a + (c.duration_sec || 0), 0);
    const durs = doneClips.map((c) => c.duration_sec || 0).filter((d) => d > 0);
    return {
      total,
      avg: doneClips.length ? total / doneClips.length : 0,
      speech: doneClips.filter((c) => c.has_speech).length,
      max: durs.length ? Math.max(...durs) : 0,
      min: durs.length ? Math.min(...durs) : 0,
    };
  }, [doneClips]);

  return (
    <div>
      <div className="row spread page-head">
        <div className="row" style={{ gap: 10 }}>
          <Link to="/home" className="back-link" title="프로젝트 목록">‹</Link>
          <h1>{ctx?.name || ctx?.title || "프로젝트"}</h1>
        </div>
        <span className="done-badge">{done}개 완료{analyzing > 0 ? ` · ${analyzing}개 분석 중` : ""}</span>
      </div>

      {/* 탭 */}
      <div className="subtabs">
        <button className={tab === "dashboard" ? "on" : ""} onClick={() => setTab("dashboard")}>대시보드</button>
        <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>영상 업로드</button>
        <button className={tab === "context" ? "on" : ""} onClick={() => setTab("context")}>맥락 설정</button>
      </div>

      {/* ===== 대시보드 ===== */}
      {tab === "dashboard" && (
        done === 0 ? (
          analyzing > 0 ? (
            <div className="card analyzing-card">
              <div className="an-title"><span className="spinner" /> {analyzing}개 분석 중…</div>
              <div className="progress" style={{ marginTop: 14 }}><div style={{ width: `${analyzingPct}%` }} /></div>
              <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
                전체 진행률 {analyzingPct}% · 완료되는 대로 추천도 분포가 여기에 나타납니다.
              </p>
              <div className="an-list">
                {queued.map((c) => (
                  <div className="an-item" key={c.id}>
                    <span className="an-name">{c.filename}</span>
                    <span className="an-stage">{c.status === "error" ? "오류" : `${c.stage} ${c.progress}%`}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-art">📊</div>
              <h3>아직 분석된 영상이 없습니다</h3>
              <p>영상을 업로드하면 추천도 분포와 AI 픽이 여기에 표시됩니다.</p>
              <button onClick={() => setTab("upload")}>영상 업로드 →</button>
            </div>
          )
        ) : (
          <>
            {analyzing > 0 && (
              <div className="an-banner">
                <span className="spinner" /> {analyzing}개 분석 중 · {analyzingPct}% — 완료되는 대로 반영됩니다.
              </div>
            )}
            {/* 통계 */}
            <div className="stat-row">
              <div className="card stat-card">
                <div className="stat-label">총 분량</div>
                <div className="stat-num">{fmtHMS(stats.total)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">총 영상</div>
                <div className="stat-num">{done}</div>
                <div className="stat-sub">음성 있음 {stats.speech}개</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">평균 길이</div>
                <div className="stat-num">{fmtMinSec(stats.avg)}</div>
                <div className="stat-sub">최장 {fmtDuration(stats.max)} · 최단 {fmtDuration(stats.min)}</div>
              </div>
            </div>

            {/* 추천도 분포 곡선 */}
            <div className="card dash-card">
              <div className="dash-head">
                <h2>추천도 분포</h2>
                <span className="muted">{done}개 · 1% 단위 채점</span>
              </div>
              <DistChart scores={scores} onPick={(min) => nav(`/project/${pid}/table${min ? `?min=${min}` : ""}`)} />
              <div className="dist-segs">
                <button className="dist-seg-card" onClick={() => nav(`/project/${pid}/table`)}>
                  <div className="seg-top"><i className="dot bg-low" /> 낮음 · 0–49%</div>
                  <div className="seg-num c-low">{dist.r}</div>
                  <div className="seg-pct">{pctOf(dist.r)}%</div>
                </button>
                <button className="dist-seg-card" onClick={() => nav(`/project/${pid}/table?min=50`)}>
                  <div className="seg-top"><i className="dot bg-ok" /> 보통 · 50–79%</div>
                  <div className="seg-num c-ok">{dist.y}</div>
                  <div className="seg-pct">{pctOf(dist.y)}%</div>
                </button>
                <button className="dist-seg-card is-rec" onClick={() => nav(`/project/${pid}/table?min=80`)}>
                  <div className="seg-top"><i className="dot bg-rec" /> 추천 · 80%+</div>
                  <div className="seg-num c-rec">{dist.g}</div>
                  <div className="seg-pct">{pctOf(dist.g)}%</div>
                </button>
              </div>
            </div>

            {/* 빠른 접근 */}
            <div className="card qa-card">
              <div className="dash-head">
                <h2>빠른 접근</h2>
                <span className="muted">사용 패턴 기반 추천</span>
              </div>
              <button className="qa-item" onClick={() => nav(`/project/${pid}/table?min=80`)}>
                <span className="qa-ic is-rec">★</span>
                <span className="qa-text"><b>AI 선별 씬 보기</b><small>추천 80%+ · {dist.g}개</small></span>
                <span className="qa-tag is-rec">자주 사용</span>
              </button>
              <button className="qa-item" onClick={() => setTab("upload")}>
                <span className="qa-ic">⬆</span>
                <span className="qa-text"><b>영상 추가 업로드</b><small>더 많이 분석할수록 선별이 정확해져요</small></span>
                <span className="qa-tag">다음 단계</span>
              </button>
              <button className="qa-item" onClick={() => setTab("context")}>
                <span className="qa-ic">⚙</span>
                <span className="qa-text"><b>추천 기준 조정</b><small>AI 선별 기준을 내 방식으로</small></span>
                <span className="qa-tag">다음 단계</span>
              </button>
            </div>
          </>
        )
      )}

      {/* ===== 영상 업로드 ===== */}
      {tab === "upload" && (
        <div className="card">
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
          <input ref={fileInput} type="file" accept=".mp4,.mov,.mxf,.m4v,video/*" multiple style={{ display: "none" }} onChange={onFilesPicked} />
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
                      {c.status === "done" ? "완료" : c.status === "error" ? "오류" : `${c.stage} ${c.progress}%`}
                    </span>
                    <button className="row-delete" title="영상 삭제" onClick={() => deleteClip(c)}>×</button>
                  </span>
                </div>
                <div className="progress"><div style={{ width: `${c.progress}%` }} /></div>
                {c.status === "error" && c.error && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4, color: "var(--red)", whiteSpace: "pre-wrap" }}>{c.error}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== 맥락 설정 ===== */}
      {tab === "context" && (
        <div className="ctx-wrap">
          {/* 프로젝트 맥락 (실제 데이터) */}
          <div className="card">
            <div className="dash-head">
              <h2>프로젝트 맥락</h2>
              <div className="row" style={{ gap: 8 }}>
                <button className="secondary sm" onClick={reuploadPlan}>기획안 재업로드</button>
                <button className="secondary sm" onClick={() => setEditCtx((v) => !v)}>
                  {editCtx ? "완료" : "수정"}
                </button>
              </div>
            </div>
            {ctx && (editCtx ? (
              <>
                <label>핵심 주제</label>
                <input value={ctx.topic ?? ""} onChange={(e) => setCtx({ ...ctx, topic: e.target.value })} />
                <label>키워드 (쉼표 · 추천도 기준)</label>
                <input value={(ctx.keywords ?? []).join(", ")} onChange={(e) => setCtx({ ...ctx, keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                <label>장소</label>
                <input value={(ctx.locations ?? []).join(", ")} onChange={(e) => setCtx({ ...ctx, locations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                <label>등장인물</label>
                <input value={(ctx.characters ?? []).join(", ")} onChange={(e) => setCtx({ ...ctx, characters: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                <label>카메라</label>
                <input value={(ctx.cameras ?? []).join(", ")} onChange={(e) => setCtx({ ...ctx, cameras: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                <button style={{ marginTop: 14 }} onClick={async () => { await saveCtx(); setEditCtx(false); }}>
                  저장 + 추천도 재계산
                </button>
              </>
            ) : (
              <>
                <ChipGroup label="등장인물" items={ctx.characters} />
                <ChipGroup label="핵심 키워드" items={ctx.keywords} />
                <ChipGroup label="장소" items={ctx.locations} />
                <ChipGroup label="카메라" items={ctx.cameras} />
              </>
            ))}
          </div>

          {/* 추천지수 기준 (Pro · 목업) */}
          <div className="card">
            <div className="dash-head">
              <h2>추천지수 기준 <span className="pro-tag">Pro</span></h2>
              <button className="secondary sm" disabled>수정</button>
            </div>
            <div className="weight-list">
              <WeightRow label="연관성 (기획안 키워드)" pct={60} />
              <WeightRow label="서사강도 (감정·사건)" pct={40} />
            </div>
            <p className="ctx-desc muted" style={{ marginTop: 10 }}>
              기술품질(초점·너무 짧음·화면 안 보임)은 점수에 넣지 않고 ⚠ 경고로 따로 표시해요.
            </p>
          </div>

          {/* 추천 프로파일 (Pro · 목업) */}
          <div className="card">
            <div className="dash-head"><h2>추천 프로파일 <span className="pro-tag">Pro</span></h2></div>
            <p className="ctx-desc muted">콘텐츠 종류에 맞는 추천 기준을 골라요. 프로파일마다 가중치가 달라져요.</p>
            <div className="profile-opts">
              {[["🧭", "여행 브이로그"], ["🎬", "다큐 관찰"], ["🎙", "인터뷰 중심"]].map(([ic, p]) => (
                <button key={p} className={`profile-opt ${profile === p ? "on" : ""}`} onClick={() => setProfile(p)}>
                  <span className="profile-ic">{ic}</span> {p}
                </button>
              ))}
            </div>
          </div>

          {/* 커스텀 씬 유형 (Pro · 목업) */}
          <div className="card">
            <div className="dash-head"><h2>커스텀 씬 유형 <span className="pro-tag">Pro</span></h2></div>
            <p className="ctx-desc muted">AI가 자동 분류할 씬 유형을 내 프로젝트에 맞게 정의해요.</p>
            <div className="chips">
              {["메인 씬", "돌발", "하이라이트", "B-roll", "인터뷰"].map((s) => (
                <span className="chip" key={s}>{s}</span>
              ))}
              <button className="chip chip-add">+ 내 유형 추가</button>
            </div>
          </div>

          {/* 내 피드백 즉시 반영 (Pro · 목업) */}
          <div className="card row spread">
            <div>
              <div className="dash-head" style={{ marginBottom: 4 }}>
                <h2>내 피드백 즉시 반영 <span className="pro-tag">Pro</span></h2>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                내가 수정한 점수를 추천에 바로 적용해 나에게 맞춰진 AI로 길들여요.
              </p>
            </div>
            <button
              className={`switch ${feedbackOn ? "on" : ""}`}
              onClick={() => setFeedbackOn((v) => !v)}
              aria-label="피드백 즉시 반영"
            >
              <span />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
