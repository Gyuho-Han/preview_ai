// P5 상세페이지 — 얇은 헤더 + 근거 / 영상 플레이어(고정) / 2+1 컬럼(장면 · 요약·키워드·코멘트·추천도 구성)
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtTC, colorClass, scoreLabel } from "../util";
import {
  useLabels, toggleFavorite, toggleTag, toggleInFolder, addFolder,
  TAG_COLORS, type ProjectLabels,
} from "../labels";

// 추천도 = 0.6×연관성 + 0.4×서사강도 (scoring.py / models.config)
const W_RELEVANCE = 60;
const W_NARRATIVE = 40;

type PreviewState = { ready: boolean; generating: boolean; error: string | null };

// 유저 분류 바 — 즐겨찾기 · 색 태그 · 폴더
function LabelBar({ pid, cid, labels }: { pid: string; cid: string; labels: ProjectLabels }) {
  const [folderOpen, setFolderOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const fav = labels.favorites.includes(cid);
  const tags = labels.tags[cid] ?? [];
  const inCount = labels.folders.filter((f) => f.clipIds.includes(cid)).length;

  return (
    <div className="label-bar">
      <button className={`lb-heart ${fav ? "on" : ""}`} onClick={() => toggleFavorite(pid, cid)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10z" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        {fav ? "즐겨찾기됨" : "즐겨찾기"}
      </button>

      <span className="lb-divider" />

      <div className="lb-colors">
        {TAG_COLORS.map((c) => (
          <button
            key={c.id}
            className={`lb-color ${tags.includes(c.id) ? "on" : ""}`}
            style={{ background: c.hex }}
            onClick={() => toggleTag(pid, cid, c.id)}
            title={`${c.label} 태그`}
          />
        ))}
      </div>

      <span className="lb-divider" />

      <div className="lb-folder">
        <button className="secondary sm" onClick={() => setFolderOpen((v) => !v)}>
          📁 폴더{inCount > 0 ? ` (${inCount})` : ""}
        </button>
        {folderOpen && (
          <>
            <div className="tt-backdrop" onClick={() => setFolderOpen(false)} />
            <div className="lb-folderpop">
              {labels.folders.length === 0 && <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>아직 폴더가 없어요.</p>}
              {labels.folders.map((f) => (
                <label key={f.id} className="lb-folderitem">
                  <input type="checkbox" checked={f.clipIds.includes(cid)} onChange={() => toggleInFolder(pid, f.id, cid)} />
                  <span>{f.name}</span>
                  <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{f.clipIds.length}</span>
                </label>
              ))}
              <div className="lb-newfolder">
                <input
                  placeholder="새 폴더 이름"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      const id = addFolder(pid, newName.trim());
                      toggleInFolder(pid, id, cid);
                      setNewName("");
                    }
                  }}
                />
                <button
                  className="sm"
                  disabled={!newName.trim()}
                  onClick={() => { const id = addFolder(pid, newName.trim()); toggleInFolder(pid, id, cid); setNewName(""); }}
                >추가</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// "mm:ss" 또는 "h:mm:ss" → 초
function parseTs(t?: string): number {
  if (!t) return 0;
  const parts = t.split(":").map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// 추천도 구성 — 기둥별 가중치·점수 가로 막대
function Breakdown({ clip }: { clip: Clip }) {
  const cc = colorClass(clip.color);
  const rel = clip.relevance ?? 0;
  const nar = clip.narrative ?? 0;
  const rows = [
    { label: "연관성", sub: "기획안 키워드와의 일치", weight: W_RELEVANCE, score: rel, cls: "b-rel" },
    { label: "서사강도", sub: "감정·사건·역동성", weight: W_NARRATIVE, score: nar, cls: "b-nar" },
  ];
  return (
    <div className="breakdown">
      {rows.map((r) => (
        <div className="bd-row" key={r.label}>
          <div className="bd-top">
            <span className="bd-label">{r.label}</span>
            <span className="bd-weight">가중치 {r.weight}%</span>
            <span className="bd-score">{r.score}</span>
          </div>
          <div className="bd-track">
            <div className={`bd-fill ${r.cls}`} style={{ width: `${r.score}%` }} />
          </div>
          <div className="bd-sub">{r.sub}</div>
        </div>
      ))}
      <div className="bd-total">
        <span>추천도</span>
        <span className={`bd-total-num c-${cc}`}>{clip.recommendation ?? 0}<small>%</small></span>
      </div>
      <p className="bd-note muted">
        기술품질(초점·너무 짧음 등)은 점수에 넣지 않고 ⚠ 경고로만 알려요.
      </p>
    </div>
  );
}

export default function ClipDetail() {
  const { pid = "", cid = "" } = useParams();
  const nav = useNavigate();
  const [clip, setClip] = useState<Clip>();
  const [siblings, setSiblings] = useState<Clip[]>([]);
  const [preview, setPreview] = useState<PreviewState>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const labels = useLabels(pid);

  useEffect(() => {
    api.getClip(cid).then(setClip).catch(() => {});
    api.listClips(pid).then((cs) => setSiblings(cs.filter((c) => c.status === "done"))).catch(() => {});
  }, [pid, cid]);

  // 미리보기(H.264 변환) 상태 폴링 — 준비되면 재생 가능
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const st = await api.previewStatus(cid);
        if (cancelled) return;
        setPreview(st);
        if (!st.ready && !st.error && st.generating) timer = setTimeout(poll, 2000);
      } catch {
        /* 사이드카 미연결/목 모드 */
      }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cid]);

  function seekTo(sec: number) {
    const v = videoRef.current;
    if (!v || !preview?.ready) return;
    v.currentTime = sec;
    v.play().catch(() => {});
    v.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!clip) return <p className="muted">불러오는 중…</p>;

  const idx = siblings.findIndex((c) => c.id === cid);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const cc = colorClass(clip.color);
  const scenes = clip.scenes ?? [];
  const keywords = clip.keywords ?? [];

  return (
    <div className="clip-detail">
      {/* 상단 바 */}
      <div className="row spread clip-topbar">
        <Link to={`/project/${pid}/table`} className="btn secondary sm">← 표로 돌아가기</Link>
        <div className="row" style={{ gap: 8 }}>
          <button className="secondary sm" disabled={!prev} onClick={() => prev && nav(`/project/${pid}/clip/${prev.id}`)}>← 이전</button>
          <button className="secondary sm" disabled={!next} onClick={() => next && nav(`/project/${pid}/clip/${next.id}`)}>다음 →</button>
        </div>
      </div>

      {/* 얇은 헤더 — 제목 · 영상개요 · 추천 · 메타 */}
      <header className="clip-head">
        <h1 className="clip-title">{clip.filename}</h1>
        <p className="clip-overview">{clip.one_line || "—"}</p>

        <div className="clip-subrow">
          <span className={`rec-flag c-${cc}`}><span className={`dot bg-${cc}`} />{scoreLabel(clip.color)} {clip.recommendation ?? 0}%</span>
          <span className="clip-divider" />
          <span className="meta-line">
            <span className="mi"><span className="mi-ic">🕐</span>{fmtTC(clip.duration_sec)}</span>
            <span className="mi"><span className="mi-ic">📅</span>{clip.date || "—"}</span>
            <span className="mi strong"><span className="mi-ic">📍</span>{clip.place || "—"}</span>
            <span className="mi"><span className="mi-ic">🎥</span>{clip.camera || "—"}</span>
            {(clip.people ?? []).length > 0 && (
              <span className="mi strong"><span className="mi-ic">👤</span>{(clip.people ?? []).join(", ")}</span>
            )}
            <span className="mi">{clip.has_speech ? "🎙 음성" : "🔇 무음"}</span>
          </span>
        </div>

        {(clip.warnings ?? []).length > 0 && (
          <div className="warn-row" style={{ marginTop: 10 }}>
            {(clip.warnings ?? []).map((w) => <span key={w} className="warn-chip">⚠ {w}</span>)}
          </div>
        )}
      </header>

      {/* 2컬럼 — 왼쪽: 플레이어 + 영상 내용 / 오른쪽: 요약·구성·키워드 */}
      <div className="detail-grid2">
        <div className="detail-main">
          {/* 영상 플레이어 (왼쪽 상단 고정 — 보면서 아래 내용 읽기) */}
          <div className="player-wrap">
            <div className="player-frame">
              {preview?.ready ? (
                <video ref={videoRef} className="clip-video" src={api.videoUrl(cid)} controls preload="metadata" />
              ) : preview?.error ? (
                <div className="player-ph">미리보기를 만들 수 없습니다: {(preview?.error || "").slice(0, 160)}</div>
              ) : (
                <div className="player-ph"><span className="spinner" /> 미리보기 생성 중… (최초 1회 코덱 변환)</div>
              )}
            </div>
            <div className="player-actions">
              <button className="secondary sm" disabled title="곧 제공됩니다">✂ 구간 선택</button>
              <button className="secondary sm" disabled title="곧 제공됩니다">▶ 프리미어 추출</button>
              <span className="soon-inline">곧 제공</span>
            </div>
            <LabelBar pid={pid} cid={cid} labels={labels} />
          </div>

          {/* 영상 내용 (박스) — 읽히는 흐름, 타임스탬프는 앵커 */}
          <div className="card content-card">
            <div className="dash-head" style={{ marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>영상 내용</h2>
              {preview?.ready && <span className="muted" style={{ fontSize: 12 }}>시간을 누르면 그 지점 재생</span>}
            </div>
            <ul className="scene-list narrative">
              {scenes.length === 0 && <li className="muted">장면 정보 없음</li>}
              {scenes.map((s, i) => (
                <li
                  key={i}
                  className={preview?.ready ? "scene-clickable" : ""}
                  onClick={() => preview?.ready && seekTo(s.t ?? parseTs(s.time))}
                >
                  <span className="scene-time">{s.time || "—"}</span>
                  <span className="scene-body">
                    {s.desc}
                    {s.speech && <span className="scene-speech">“{s.speech}”</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 오른쪽 — 요약 · 추천도 구성 · 키워드 (선으로 바인딩) */}
        <div className="detail-side">
          <section className="ds-sec">
            <h2>영상 요약</h2>
            <p style={{ margin: 0 }}>{clip.summary || "—"}</p>
          </section>

          <section className="ds-sec">
            <h2>추천도 구성</h2>
            <Breakdown clip={clip} />
          </section>

          <section className="ds-sec">
            <h2>핵심 키워드</h2>
            <div>
              {keywords.map((k) => <span key={k} className="tag">{k}</span>)}
              {keywords.length === 0 && <span className="muted">—</span>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
