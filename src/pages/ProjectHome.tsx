// P3 대시보드 — 프로젝트의 두 뷰(대시보드/표) 중 하나. 영상 업로드 + 기획안 + 통계·분포를 한 화면에.
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, pickVideos, pickFolder, pickPlan, isTauri } from "../api";
import type { Clip, PlanContext } from "../types";
import { toast, confirmDialog } from "../ui/feedback";
import { colorClass, fmtDuration } from "../util";

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

// 추천도 분포 — 부드러운 밀도 곡선(KDE 근사), 추천 구간(80+) 강조 + 진입 모션
function LineDist({ scores }: { scores: number[] }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    const t = setTimeout(() => setShown(true), 80);
    return () => clearTimeout(t);
  }, [scores.length]);

  const W = 1000, H = 232, padL = 10, padR = 990, top = 18, base = 196;
  const bw = 8, step = 2, N = 100 / step + 1;
  const densAt = (x: number) => scores.reduce((a, s) => a + Math.exp(-((x - s) ** 2) / (2 * bw * bw)), 0);
  const dens = Array.from({ length: N }, (_, i) => densAt(i * step));
  const maxD = Math.max(...dens, 1e-9);
  const X = (sc: number) => padL + (sc / 100) * (padR - padL);
  const Y = (d: number) => base - (d / maxD) * (base - top);
  const pts = dens.map((d, i) => [X(i * step), Y(d)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${padR} ${base} L ${padL} ${base} Z`;
  const ticks = [0, 50, 80, 100];

  return (
    <svg className={`linedist ${shown ? "in" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="추천도 분포 곡선">
      <defs>
        <linearGradient id="ldFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="ldFillRec" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--rec)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--rec)" stopOpacity="0.04" />
        </linearGradient>
        <clipPath id="ldRec"><rect x={X(80)} y="0" width={padR - X(80)} height={base} /></clipPath>
      </defs>

      {/* 임계선 */}
      <line x1={X(50)} y1={top} x2={X(50)} y2={base} className="ld-thresh" />
      <line x1={X(80)} y1={top} x2={X(80)} y2={base} className="ld-thresh rec" />

      {/* 영역(진입 시 아래에서 차오름) */}
      <g className="ld-grow">
        <path d={area} fill="url(#ldFill)" />
        <path d={area} fill="url(#ldFillRec)" clipPath="url(#ldRec)" />
      </g>
      {/* 곡선(그려지는 모션) */}
      <path d={line} className="ld-line" pathLength={1} />
      <path d={line} className="ld-line rec" pathLength={1} clipPath="url(#ldRec)" />

      <line x1={padL} y1={base} x2={padR} y2={base} className="ld-base" />
      {ticks.map((t) => (
        <text key={t} className="ld-tick" x={X(t)} y={base + 26} textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"}>{t}</text>
      ))}
      <text className="ld-badge" x={X(80) + 8} y={top + 12}>추천 80+</text>
    </svg>
  );
}

export default function ProjectHome() {
  const { pid = "" } = useParams();
  const nav = useNavigate();
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

  const scores = useMemo(() => doneClips.map((c) => c.recommendation ?? 0), [doneClips]);
  const [planOpen, setPlanOpen] = useState(false);

  return (
    <div>
      <div className="row spread page-head">
        <div className="row" style={{ gap: 10 }}>
          <Link to="/home" className="back-link" title="프로젝트 목록">‹</Link>
          <h1>{ctx?.name || ctx?.title || "프로젝트"}</h1>
        </div>
        <span className="done-badge">{done}개 완료{analyzing > 0 ? ` · ${analyzing}개 분석 중` : ""}</span>
      </div>

      {/* 분석 진행 중 */}
      {analyzing > 0 && (
        <div className="card analyzing-card">
          <div className="an-title"><span className="spinner" /> {analyzing}개 분석 중… <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>전체 {analyzingPct}%</span></div>
          <div className="progress" style={{ marginTop: 12 }}><div style={{ width: `${analyzingPct}%` }} /></div>
          <div className="an-list">
            {queued.map((c) => (
              <div className="an-item" key={c.id}>
                <span className="an-name">{c.filename}</span>
                <span className="an-stage">{c.status === "error" ? "오류" : `${c.stage} ${c.progress}%`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 오류난 클립 */}
      {clips.some((c) => c.status === "error") && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>분석 실패</h2>
          {clips.filter((c) => c.status === "error").map((c) => (
            <div key={c.id} className="row spread" style={{ marginBottom: 8 }}>
              <span>{c.filename}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 12, color: "var(--red)" }}>{c.error || "오류"}</span>
                <button className="row-delete" onClick={() => deleteClip(c)}>×</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {done === 0 ? (
        analyzing === 0 && (
          <div className="empty-state">
            <div className="empty-art">📊</div>
            <h3>아직 분석된 영상이 없습니다</h3>
            <p>아래에서 영상을 추가하면 추천도 분포와 통계가 여기에 나타납니다.</p>
          </div>
        )
      ) : (
        <>
          {/* ===== 통계 (얇게) ===== */}
          <div className="stat-strip thin">
            <div className="stat-cell">
              <div className="stat-label">총 영상</div>
              <div className="stat-num">{done}<span className="stat-unit">개</span></div>
              <div className="stat-sub">음성 {stats.speech}개</div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">총 분량</div>
              <div className="stat-num">{fmtHMS(stats.total)}</div>
              <div className="stat-sub">평균 {fmtMinSec(stats.avg)}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">길이 범위</div>
              <div className="stat-num">{fmtDuration(stats.max)}</div>
              <div className="stat-sub">최단 {fmtDuration(stats.min)}</div>
            </div>
          </div>

          {/* ===== 추천도 분포 (히스토그램) ===== */}
          <div className="card dash-card">
            <div className="dash-head">
              <h2>추천도 분포</h2>
              <span className="muted">{done}개 · 1% 단위 채점</span>
            </div>

            <LineDist scores={scores} />

            <div className="dist-segs compact">
              <button className="dist-seg-card" onClick={() => nav(`/project/${pid}/table`)}>
                <div className="seg-top"><i className="dot bg-low" /> 낮음 <span className="seg-range">0–49%</span></div>
                <div className="seg-num c-low">{dist.r}</div>
                <div className="seg-pct">{pctOf(dist.r)}%</div>
              </button>
              <button className="dist-seg-card" onClick={() => nav(`/project/${pid}/table?min=50`)}>
                <div className="seg-top"><i className="dot bg-ok" /> 보통 <span className="seg-range">50–79%</span></div>
                <div className="seg-num c-ok">{dist.y}</div>
                <div className="seg-pct">{pctOf(dist.y)}%</div>
              </button>
              <button className="dist-seg-card is-rec" onClick={() => nav(`/project/${pid}/table?min=80`)}>
                <div className="seg-top"><i className="dot bg-rec" /> 추천 <span className="seg-range">80%+</span></div>
                <div className="seg-num c-rec">{dist.g}</div>
                <div className="seg-pct">{pctOf(dist.g)}%</div>
              </button>
            </div>
            <p className="muted dist-hint">구간을 누르면 해당 클립만 표로 볼 수 있어요.</p>
          </div>
        </>
      )}

      {/* ===== 영상 추가 (아래로 배치) ===== */}
      <div className="card add-card">
        <div
          className={`dropzone compact ${dragging ? "drag" : ""}`}
          onClick={addVideos}
          onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={onDrop}
        >
          <div className="dropzone-icon">⬆</div>
          <div className="dropzone-title">{dragging ? "여기에 놓으세요" : "영상을 끌어다 놓거나 클릭해서 추가"}</div>
          <div className="muted" style={{ fontSize: 12 }}>MP4 · MOV · MXF · M4V — 촬영이 끝날 때마다 계속 추가할 수 있어요</div>
        </div>
        <input ref={fileInput} type="file" accept=".mp4,.mov,.mxf,.m4v,video/*" multiple style={{ display: "none" }} onChange={onFilesPicked} />
        {isTauri && (
          <button className="secondary" style={{ width: "100%", marginTop: 10, justifyContent: "center" }} onClick={addFolder}>
            📁 폴더 전체 추가 (복사 없이 경로로 분석)
          </button>
        )}
      </div>

      {/* ===== 기획안 (평소 접힘 · 클릭 시 펼침) ===== */}
      <div className="card plan-card">
        <button className="plan-head" onClick={() => setPlanOpen((v) => !v)} aria-expanded={planOpen}>
          <span className="plan-head-l">
            <span className="plan-title">기획안</span>
            <span className="plan-topic">{ctx?.topic || "핵심 주제 미설정"}</span>
          </span>
          <span className={`plan-caret ${planOpen ? "open" : ""}`}>▾</span>
        </button>

        {planOpen && (
          <div className="plan-body">
            <KV label="핵심 키워드" items={ctx?.keywords} accent />
            <KV label="등장인물" items={ctx?.characters} />
            <KV label="장소" items={ctx?.locations} />
            <KV label="카메라" items={ctx?.cameras} />
            <div className="plan-foot">
              <span className="muted" style={{ fontSize: 12 }}>기획안을 다시 올리면 키워드·인물·장소가 갱신되고 추천도가 재계산돼요.</span>
              <button className="secondary sm" onClick={reuploadPlan}>기획안 재업로드</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 기획안 펼침 뷰 — 라벨:값 한 줄
function KV({ label, items, accent }: { label: string; items?: string[]; accent?: boolean }) {
  const list = items ?? [];
  return (
    <div className="kv-row">
      <div className="kv-label">{label}</div>
      <div className="kv-val">
        {list.length ? (
          list.map((x) => <span className={`chip ${accent ? "chip-accent" : ""}`} key={x}>{x}</span>)
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>—</span>
        )}
      </div>
    </div>
  );
}
