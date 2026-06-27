// P5 상세페이지 — 영상 1개를 5초 안에 판단. 메타+추천도 / 요약·장면·키워드 / AI코멘트
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtDuration, colorClass } from "../util";

const DONUT_C = 2 * Math.PI * 52;

type PreviewState = { ready: boolean; generating: boolean; error: string | null };

// "mm:ss" 또는 "h:mm:ss" → 초
function parseTs(t?: string): number {
  if (!t) return 0;
  const parts = t.split(":").map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// 추천도 원형 게이지 (마운트 시 채워지는 애니메이션)
function DonutScore({ value, cc }: { value: number; cc: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 80);
    return () => clearTimeout(t);
  }, []);
  const offset = DONUT_C * (1 - (shown ? value : 0) / 100);
  return (
    <div className="rec-donut">
      <svg viewBox="0 0 120 120" className={`c-${cc}`}>
        <circle className="rec-track" cx="60" cy="60" r="52" />
        <circle
          className="rec-prog"
          cx="60"
          cy="60"
          r="52"
          style={{ strokeDasharray: DONUT_C, strokeDashoffset: offset }}
        />
      </svg>
      <div className="rec-center">
        <div className={`rec-num c-${cc}`}>{value}<small>%</small></div>
        <div className="rec-cap">추천도</div>
      </div>
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
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (!clip) return <p className="muted">불러오는 중…</p>;

  const idx = siblings.findIndex((c) => c.id === cid);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const cc = colorClass(clip.color);

  return (
    <div>
      <div className="row spread">
        <Link to={`/project/${pid}/table`} className="btn secondary">← 표로 돌아가기</Link>
        <div className="row">
          <button className="secondary" disabled={!prev} onClick={() => prev && nav(`/project/${pid}/clip/${prev.id}`)}>← 이전</button>
          <button className="secondary" disabled={!next} onClick={() => next && nav(`/project/${pid}/clip/${next.id}`)}>다음 →</button>
        </div>
      </div>

      {/* 상단: 메타 + 추천도 */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="detail-grid">
          <div>
            <h1 style={{ marginBottom: 8 }}>{clip.filename}</h1>
            <div className="meta-row">
              <span>길이 {fmtDuration(clip.duration_sec)}</span>
              <span>날짜 {clip.date || "—"}</span>
              <span>장소 {clip.place || "—"}</span>
              <span>카메라 {clip.camera || "—"}</span>
              <span>등장인물 {(clip.people ?? []).join(", ") || "—"}</span>
              <span>{clip.has_speech ? "🎙 음성 있음" : "🔇 음성 없음 (VLM 분석)"}</span>
            </div>
            <p style={{ marginTop: 14, fontSize: 15 }}>{clip.one_line}</p>
          </div>
          <div className="rec-box">
            <DonutScore value={clip.recommendation ?? 0} cc={cc} />
            <div className="rec-sub">연관성 {clip.relevance ?? 0} · 품질 {clip.quality ?? 0}</div>
          </div>
        </div>
      </div>

      {/* 영상 재생 (온디맨드 H.264 변환 → 오디오 포함, 전 코덱) */}
      <div className="card" style={{ marginTop: 14 }}>
        {preview?.ready ? (
          <video ref={videoRef} className="clip-video" src={api.videoUrl(cid)} controls preload="metadata" />
        ) : preview?.error ? (
          <div className="muted">미리보기를 만들 수 없습니다: {(preview?.error || "").slice(0, 160)}</div>
        ) : (
          <div className="muted"><span className="spinner" /> 미리보기 생성 중… (최초 1회 코덱 변환)</div>
        )}
      </div>

      {/* 중단: 요약 / 장면 / 키워드 */}
      <div className="detail-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>영상 요약</h2>
          <p>{clip.summary || "—"}</p>

          <h2>타임스탬프별 주요 장면 {preview?.ready && <span className="muted" style={{ fontSize: 12 }}>(클릭하면 그 지점 재생)</span>}</h2>
          <ul className="scene-list">
            {(clip.scenes ?? []).length === 0 && <li className="muted">장면 정보 없음</li>}
            {(clip.scenes ?? []).map((s, i) => (
              <li
                key={i}
                className={preview?.ready ? "scene-clickable" : ""}
                onClick={() => preview?.ready && seekTo(parseTs(s.time))}
              >
                <span className="scene-time">{s.time || "—"}</span>
                <span>{s.desc}</span>
              </li>
            ))}
          </ul>

          <h2>핵심 키워드</h2>
          <div>
            {(clip.keywords ?? []).map((k) => <span key={k} className="tag">{k}</span>)}
            {(clip.keywords ?? []).length === 0 && <span className="muted">—</span>}
          </div>
        </div>

        {/* 하단(우측): AI 코멘트 + 추출 버튼 (비활성 UI) */}
        <div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>AI 코멘트</h2>
            <p>{clip.ai_comment || "—"}</p>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="row spread" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>NLE 추출</h2>
              <span className="soon-badge">곧 제공</span>
            </div>
            <button className="secondary" disabled style={{ width: "100%", marginBottom: 8, justifyContent: "center" }}>Premiere Pro로 추출</button>
            <button className="secondary" disabled style={{ width: "100%", justifyContent: "center" }}>DaVinci Resolve로 추출</button>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>추후 사이클에서 활성화됩니다.</p>
          </div>
          {clip.transcript && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2 style={{ marginTop: 0 }}>자막 (Qwen3-ASR)</h2>
              <p className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{clip.transcript}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
