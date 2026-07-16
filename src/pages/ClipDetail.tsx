// P5 상세페이지 — 얇은 헤더 + 근거 / 영상 플레이어(고정) / 2+1 컬럼(장면 · 요약·키워드·코멘트·추천도 구성)
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import { fmtTC, colorClass, scoreLabel } from "../util";
import { useLabels, toggleFavorite } from "../labels";

// 추천도 = 0.6×연관성 + 0.4×서사강도 (scoring.py / models.config)
const W_RELEVANCE = 60;
const W_NARRATIVE = 40;

type PreviewState = { ready: boolean; generating: boolean; error: string | null };

// 클립 플레이어 — 평소엔 왼쪽 컬럼에 크게, 도킹되면 오른쪽 컬럼 안에 작게(sticky).
// 도킹 전환 시 <video> DOM이 통째로 옮겨가며 새로 마운트되므로, 재생 위치/상태를 ref에 저장해뒀다가 복원한다.
function PlayerBlock({
  cid, pid, preview, videoRef, fav, compact, savedTimeRef, wasPlayingRef,
}: {
  cid: string; pid: string; preview?: PreviewState;
  videoRef: React.RefObject<HTMLVideoElement>; fav: boolean; compact?: boolean;
  savedTimeRef: React.MutableRefObject<number>; wasPlayingRef: React.MutableRefObject<boolean>;
}) {
  return (
    <div className={`player-wrap ${compact ? "compact" : ""}`}>
      <div className="player-frame">
        {preview?.ready ? (
          <video
            ref={videoRef}
            className="clip-video"
            src={api.videoUrl(cid)}
            controls
            preload="metadata"
            onTimeUpdate={(e) => { savedTimeRef.current = e.currentTarget.currentTime; }}
            onPlay={() => { wasPlayingRef.current = true; }}
            onPause={() => { wasPlayingRef.current = false; }}
          />
        ) : preview?.error ? (
          <div className="player-ph">미리보기를 만들 수 없습니다: {(preview?.error || "").slice(0, 160)}</div>
        ) : (
          <div className="player-ph"><span className="spinner" /> 미리보기 생성 중…</div>
        )}
      </div>
      {/* 클립 액션 — 찜(즉시 동작) · 구간선택/추출(편집 흐름). 도킹 시엔 공간 절약을 위해 생략 */}
      {!compact && (
        <div className="player-actions">
          <button className={`pa-fav ${fav ? "on" : ""}`} onClick={() => toggleFavorite(pid, cid)}>
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10z" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
            {fav ? "찜함" : "찜하기"}
          </button>
          <span className="pa-spacer" />
          <button className="secondary sm" disabled title="곧 제공됩니다">✂ 구간 선택</button>
          <button className="secondary sm" disabled title="곧 제공됩니다">↗ 프리미어로 보내기</button>
        </div>
      )}
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

// 추천도 구성 — 평소엔 두 줄 막대만(컴팩트), 호버하면 계산 근거를 상세 팝오버로
function Breakdown({ clip }: { clip: Clip }) {
  const rel = clip.relevance ?? 0;
  const nar = clip.narrative ?? 0;
  const rec = clip.recommendation ?? 0;
  const relC = Math.round((rel * W_RELEVANCE) / 100 * 10) / 10;
  const narC = Math.round((nar * W_NARRATIVE) / 100 * 10) / 10;
  const kw = (clip.keywords ?? []).slice(0, 2).join("·");
  const relWhy = rel >= 75 ? `기획안 키워드 ${kw ? `‘${kw}’와(과) ` : ""}강하게 맞아 높게 나왔어요`
    : rel >= 50 ? "기획 방향과 부분적으로 맞아요"
    : "기획안과의 접점이 약해 낮게 나왔어요";
  const narWhy = nar >= 75 ? (clip.has_speech ? "대화와 감정 흐름이 뚜렷해요" : "움직임·구도가 역동적이에요")
    : nar >= 50 ? "무난하지만 결정적 순간은 약한 편이에요"
    : "사건·감정이 옅어 낮게 나왔어요";
  return (
    <div className="rec-compact" tabIndex={0}>
      <div className="rc-row">
        <span className="rc-label">연관성</span>
        <div className="rc-track"><div className="rc-fill b-rel" style={{ width: `${rel}%` }} /></div>
        <span className="rc-num">{rel}</span>
      </div>
      <div className="rc-row">
        <span className="rc-label">서사강도</span>
        <div className="rc-track"><div className="rc-fill b-nar" style={{ width: `${nar}%` }} /></div>
        <span className="rc-num">{nar}</span>
      </div>
      <span className="rc-hint">근거 자세히 보기 →</span>

      <div className="rc-detail" role="tooltip">
        <div className="rcd-title">추천도 {rec}점, 이렇게 계산됐어요</div>
        <div className="rcd-line">
          <span className="rcd-name">연관성</span>
          <span className="rcd-calc"><b>{rel}</b> × 60% = <b>{relC}</b></span>
        </div>
        <div className="rcd-desc">{relWhy}</div>
        <div className="rcd-line">
          <span className="rcd-name">서사강도</span>
          <span className="rcd-calc"><b>{nar}</b> × 40% = <b>{narC}</b></span>
        </div>
        <div className="rcd-desc">{narWhy}</div>
        <div className="rcd-total">{relC} + {narC} = <b>{rec}점</b></div>
        <div className="rcd-note">기술품질(초점·너무 짧음 등)은 점수에 넣지 않고 ⚠ 경고로만 알려드려요.</div>
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
  const [docked, setDocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const titleTopRef = useRef<HTMLDivElement>(null); // 제목 맨 위 얇은 마커 — 이게 가려지기 '시작'하는 순간 바로 도킹
  const savedTimeRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const flipFromRef = useRef<DOMRect | null>(null); // 전환 직전 플레이어 위치(FLIP 시작점)
  const labels = useLabels(pid);

  // 도킹 전환으로 <video>가 새로 마운트된 직후, 저장해둔 재생 위치/상태를 복원
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = savedTimeRef.current;
    if (wasPlayingRef.current) v.play().catch(() => {});
  }, [docked]);

  // FLIP 전환 — 플레이어가 "사라졌다 나타나는" 게 아니라, 이전 자리에서 새 자리로
  // 실제로 이동·축소되며 날아가게 한다(아이폰 PiP 느낌).
  // 옵저버에서 기억해둔 시작 rect → 새로 마운트된 frame의 rect 차이를 역변환으로 깔고 풀어준다.
  useEffect(() => {
    const from = flipFromRef.current;
    flipFromRef.current = null;
    const frame = document.querySelector<HTMLElement>(".clip-detail .player-frame");
    if (!from || !frame) return;
    const to = frame.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const s = from.width / to.width;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(s - 1) < 0.01) return;
    frame.style.transformOrigin = "top left";
    frame.style.transition = "none";
    frame.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    // 두 번의 rAF: 역변환이 확실히 그려진 다음 프레임에 트랜지션 시작
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        frame.style.transition = "transform .6s cubic-bezier(.22,1,.36,1)";
        frame.style.transform = "";
      });
    });
    const t = setTimeout(() => {
      frame.style.transition = "";
      frame.style.transformOrigin = "";
    }, 700);
    return () => clearTimeout(t);
  }, [docked]);

  // 상단바 높이 → 미니플레이어 sticky 오프셋 기준(CSS 변수)
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clip]);

  // 제목 맨 위가 상단바 뒤로 가려지기 '시작'하는 순간 즉시 도킹.
  // 헤더 전체가 아니라 얇은 마커 하나만 관찰해야, 헤더 일부가 아직 남아있어도(=완전히
  // 사라지길 기다리지 않고) 살짝만 가려져도 바로 반응한다.
  useEffect(() => {
    const root = document.querySelector(".content");
    const marker = titleTopRef.current;
    if (!root || !marker) return;
    const topbarH = topbarRef.current?.offsetHeight ?? 48;
    const io = new IntersectionObserver(
      ([entry]) => {
        // 상태 바꾸기 직전, 지금 플레이어가 있는 자리를 FLIP 시작점으로 기억
        const frame = document.querySelector<HTMLElement>(".clip-detail .player-frame");
        if (frame) flipFromRef.current = frame.getBoundingClientRect();
        setDocked(!entry.isIntersecting);
      },
      { root, rootMargin: `-${topbarH}px 0px 0px 0px`, threshold: 0 }
    );
    io.observe(marker);
    return () => io.disconnect();
  }, [clip]);

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
  const fav = labels.favorites.includes(cid);

  return (
    <div className="clip-detail">
      {/* 상단바 — 스크롤에 고정되는 유일한 요소 */}
      <div className="clip-topbar" ref={topbarRef}>
        <Link to={`/project/${pid}/table`} className="clip-back">‹ 표로 돌아가기</Link>
        <div className="clip-nav">
          <button className="clip-navbtn" disabled={!prev} onClick={() => prev && nav(`/project/${pid}/clip/${prev.id}`)}>‹ 이전</button>
          <button className="clip-navbtn" disabled={!next} onClick={() => next && nav(`/project/${pid}/clip/${next.id}`)}>다음 ›</button>
        </div>
      </div>

      {/* 헤더 — 스크롤하면 위로 사라짐(고정 안 함) */}
      <header className="clip-head">
        <div ref={titleTopRef} />
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

      {/* 2컬럼(하단) — 왼쪽: 플레이어 + 영상 내용 / 오른쪽: 요약·키워드·구성 */}
      <div className="detail-grid2">
        <div className="detail-main">
          {/* 도킹 전엔 여기(왼쪽 상단)에 크게 표시. 도킹되면 오른쪽 컬럼으로 옮겨가며 이 자리는 비워 영상내용이 올라온다 */}
          {!docked && (
            <PlayerBlock
              cid={cid} pid={pid} preview={preview} videoRef={videoRef} fav={fav}
              savedTimeRef={savedTimeRef} wasPlayingRef={wasPlayingRef}
            />
          )}

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
                  className={`${preview?.ready ? "scene-clickable" : ""} ${!s.desc && s.speech ? "scene-dialogue" : ""}`}
                  onClick={() => preview?.ready && seekTo(s.t ?? parseTs(s.time))}
                >
                  <span className="scene-time">{s.time || "—"}</span>
                  <span className="scene-body">
                    {s.desc && <span className="scene-desc">{s.desc}</span>}
                    {s.speech && (
                      !s.desc
                        ? <span className="scene-quote"><span className="scene-quote-ic">🗣</span>{s.speech}</span>
                        : <span className="scene-speech">“{s.speech}”</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 오른쪽 — 영상요약(강조) · 키워드 · 추천도 구성(컴팩트+호버) */}
        {/* 등장인물 섹션은 표페이지 컬럼 재설계와 묶어서 다음에 다룸 */}
        <div className="detail-side">
          <section className="ds-sec ds-hero">
            <h2 className="ds-hero-h">영상 요약</h2>
            <p className="ds-summary">{clip.summary || "—"}</p>
          </section>

          <section className="ds-sec">
            <h2>핵심 키워드</h2>
            <div>
              {keywords.map((k) => <span key={k} className="tag">{k}</span>)}
              {keywords.length === 0 && <span className="muted">—</span>}
            </div>
          </section>

          <section className="ds-sec">
            <div className="ds-sec-head">
              <h2>추천도 구성</h2>
              <span className={`ds-score c-${cc}`}>{clip.recommendation ?? 0}점</span>
            </div>
            <Breakdown clip={clip} />
          </section>

          {/* 도킹되면 여기(오른쪽 컬럼 하단 빈 공간)에 작게 자리잡고, 스크롤해도 sticky로 따라옴 */}
          {docked && (
            <div className="ds-sec ds-player-sec">
              <PlayerBlock
                cid={cid} pid={pid} preview={preview} videoRef={videoRef} fav={fav} compact
                savedTimeRef={savedTimeRef} wasPlayingRef={wasPlayingRef}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
