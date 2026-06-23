// P5 상세페이지 — 영상 1개를 5초 안에 판단. 메타+추천도 / 요약·장면·키워드 / AI코멘트
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtDuration, colorClass } from "../util";

export default function ClipDetail() {
  const { pid = "", cid = "" } = useParams();
  const nav = useNavigate();
  const [clip, setClip] = useState<Clip>();
  const [siblings, setSiblings] = useState<Clip[]>([]);

  useEffect(() => {
    api.getClip(cid).then(setClip).catch(() => {});
    api.listClips(pid).then((cs) => setSiblings(cs.filter((c) => c.status === "done"))).catch(() => {});
  }, [pid, cid]);

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
          <div style={{ textAlign: "center" }}>
            <div className={`big-score c-${cc}`}>{clip.recommendation ?? 0}%</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>추천도</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              연관성 {clip.relevance ?? 0} · 품질 {clip.quality ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* 중단: 요약 / 장면 / 키워드 */}
      <div className="detail-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>영상 요약</h2>
          <p>{clip.summary || "—"}</p>

          <h2>타임스탬프별 주요 장면</h2>
          <ul className="scene-list">
            {(clip.scenes ?? []).length === 0 && <li className="muted">장면 정보 없음</li>}
            {(clip.scenes ?? []).map((s, i) => (
              <li key={i}>
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
            <h2 style={{ marginTop: 0 }}>NLE 추출</h2>
            <button className="secondary" disabled style={{ width: "100%", marginBottom: 8 }}>Premiere Pro로 추출</button>
            <button className="secondary" disabled style={{ width: "100%" }}>DaVinci Resolve로 추출</button>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>추후 사이클에서 활성화됩니다.</p>
          </div>
          {clip.transcript && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2 style={{ marginTop: 0 }}>자막 (Whisper)</h2>
              <p className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{clip.transcript}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
