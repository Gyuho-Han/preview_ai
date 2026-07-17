// P5 상세페이지 — 얇은 헤더 + 근거 / 영상 플레이어(고정) / 2+1 컬럼(장면 · 요약·키워드·코멘트·추천도 구성)
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Clip, TierLabel } from "../types";
import { colorClass, scoreLabel } from "../util";
import TierPicker from "../components/TierPicker";
import { useLabels, toggleFavorite } from "../labels";
import PlayerControls from "../components/PlayerControls";

// 추천도 = 0.6×연관성 + 0.4×서사강도 (scoring.py / models.config)
const W_RELEVANCE = 60;
const W_NARRATIVE = 40;

type PreviewState = { ready: boolean; generating: boolean; error: string | null };

interface PlayerBlockProps {
  cid: string;
  preview?: PreviewState;
  videoRef: React.RefObject<HTMLVideoElement>;
  compact?: boolean;
  savedTimeRef: React.MutableRefObject<number>;
  wasPlayingRef: React.MutableRefObject<boolean>;
  durationSec?: number;
  selectionMode: boolean;
  onSelectionModeToggle: () => void;
  selectionStart?: number;
  selectionEnd?: number;
  onSelectionChange: (start?: number, end?: number) => void;
  onExport?: (type: "premiere" | "davinci" | "finalcut" | "file", range: "selection" | "full") => void;
}

// 메타 라인 아이콘 — 이모지 대신 프로그램 톤에 맞춘 단색 라인 아이콘(16px, currentColor)
const icProps = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const IcClock = () => <svg {...icProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
const IcCalendar = () => <svg {...icProps}><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>;
const IcPin = () => <svg {...icProps}><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" /></svg>;
const IcCamera = () => <svg {...icProps}><path d="M4 8h3.2l1.3-2h6.9l1.3 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.3" /></svg>;

// 클립 플레이어 — 평소엔 왼쪽 컬럼에 크게, 도킹되면 오른쪽 컬럼 안에 작게(sticky).
// 도킹 전환 시 <video> DOM이 통째로 옮겨가며 새로 마운트되므로, 재생 위치/상태를 ref에 저장해뒀다가 복원한다.
// 사이드카 미연결/목 모드에서는 실제 영상을 디코딩하지 않는 가벼운 목업(CSS + rAF 진행)을 대신 보여주고,
// 진행바는 실제 플레이어처럼 프레임 안쪽 하단에 오버레이로 두어 input[type=range]로 드래그 seek 가능하게 한다.
function PlayerBlock({
  cid, preview, videoRef, compact, savedTimeRef, wasPlayingRef, durationSec,
  selectionMode, onSelectionModeToggle, selectionStart, selectionEnd, onSelectionChange, onExport
}: PlayerBlockProps) {
  const total = durationSec ?? 0;
  const [mockPlaying, setMockPlaying] = useState(false);
  const [mockT, setMockT] = useState(0);
  const [videoT, setVideoT] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const showMock = !preview?.ready && !preview?.error;

  // 클립이 바뀔 때마다 진행 상태 초기화
  useEffect(() => {
    setMockT(0);
    setMockPlaying(false);
  }, [cid]);

  useEffect(() => {
    if (!showMock || !mockPlaying || total <= 0) return;
    const start = performance.now() - mockT * 1000;
    let raf: number;
    const tick = (now: number) => {
      const next = (now - start) / 1000;
      if (next >= total) { setMockT(total); setMockPlaying(false); return; }
      setMockT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMock, mockPlaying, total]);

  const currentTime = showMock ? mockT : videoT;
  const isPlaying = showMock ? mockPlaying : isVideoPlaying;

  return (
    <div className={`player-wrap ${compact ? "compact" : ""}`}>
      <div className="player-frame">
        {preview?.error ? (
          <div className="player-ph">미리보기를 만들 수 없습니다: {(preview?.error || "").slice(0, 160)}</div>
        ) : preview?.ready ? (
          <video
            ref={videoRef}
            className="clip-video"
            src={api.videoUrl(cid)}
            preload="metadata"
            onTimeUpdate={(e) => { savedTimeRef.current = e.currentTarget.currentTime; setVideoT(e.currentTarget.currentTime); }}
            onPlay={() => { wasPlayingRef.current = true; setIsVideoPlaying(true); }}
            onPause={() => { wasPlayingRef.current = false; setIsVideoPlaying(false); }}
          />
        ) : (
          <>
            <div className="mock-player-stage" onClick={() => total > 0 && setMockPlaying((p) => !p)}>
              <button className="mock-player-play" aria-label={mockPlaying ? "일시정지" : "재생"}>
                {mockPlaying ? "❚❚" : "▶"}
              </button>
              {mockPlaying && <span className="mock-player-note mock-player-note-loop">AI 목업 미리보기 재생 중입니다</span>}
            </div>
          </>
        )}

        {/* 새 공유 컨트롤바 */}
        <PlayerControls
          currentTime={currentTime}
          duration={total}
          isPlaying={isPlaying}
          onTimeChange={(t) => {
            if (showMock) { setMockT(t); } else { if (videoRef.current) videoRef.current.currentTime = t; }
          }}
          onPlayToggle={() => {
            if (showMock) { setMockPlaying((p) => !p); } else { if (videoRef.current) videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause(); }
          }}
          selectionMode={selectionMode}
          onSelectionModeToggle={onSelectionModeToggle}
          selectionStart={selectionStart}
          selectionEnd={selectionEnd}
          onSelectionChange={onSelectionChange}
          onExport={onExport}
        />
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number>();
  const [selectionEnd, setSelectionEnd] = useState<number>();
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

  // 표에서 진입하든, 이전/다음으로 클립을 넘기든 상세페이지는 항상 맨 위에서 시작
  useEffect(() => {
    document.querySelector(".content")?.scrollTo(0, 0);
  }, [cid]);

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

  // 분류(상/중/하) 저장 — 낙관적 반영 후 재조회(20개째엔 AI 제안이 붙어 돌아온다)
  function setLabel(label: TierLabel | null) {
    setClip((c) => c && { ...c, user_label: label ?? undefined, ai_label: label ? undefined : c.ai_label });
    api.setClipLabel(cid, label)
      .then(() => api.getClip(cid).then(setClip))
      .catch(() => {});
  }

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

      {/* 상단바 — 스크롤에 고정되는 유일한 요소. 표로 돌아가기/이전·다음 사이 여유 공간에
          파일명·영상개요를 넣어 압축적으로 활용(한 줄 고정, 넘치면 말줄임) */}
      <div className="clip-topbar" ref={topbarRef}>
        <Link to={`/project/${pid}/table`} className="clip-back" title="표로 돌아가기" aria-label="표로 돌아가기">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div className="clip-topbar-id">
          <span className="clip-topbar-name">{clip.filename}</span>
          <span className="clip-divider" />
          <span className="clip-topbar-overview">{clip.one_line || "—"}</span>
        </div>
        <div className="clip-nav">
          <button className={`pa-fav sm ${fav ? "on" : ""}`} onClick={() => toggleFavorite(pid, cid)}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10z" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="clip-navbtn" disabled={!prev} onClick={() => prev && nav(`/project/${pid}/clip/${prev.id}`)}>‹ 이전</button>
          <button className="clip-navbtn" disabled={!next} onClick={() => next && nav(`/project/${pid}/clip/${next.id}`)}>다음 ›</button>
        </div>
      </div>

      {/* 2컬럼(하단) — 왼쪽: 플레이어 + 영상 내용 / 오른쪽: 추천도·메타 · 요약 · 키워드 · 구성 */}
      <div className="detail-grid2">
        <div className="detail-main">
          {/* 도킹 트리거 마커 — 플레이어 맨 위가 상단바 뒤로 가려지기 시작하는 순간 도킹 */}
          <div ref={titleTopRef} />
          {/* 도킹 전엔 여기(왼쪽 상단)에 크게 표시. 도킹되면 오른쪽 컬럼으로 옮겨가며 이 자리는 비워 영상내용이 올라온다 */}
          {!docked && (
            <PlayerBlock
              cid={cid} preview={preview} videoRef={videoRef} durationSec={clip.duration_sec}
              savedTimeRef={savedTimeRef} wasPlayingRef={wasPlayingRef}
              selectionMode={selectionMode} selectionStart={selectionStart} selectionEnd={selectionEnd}
              onSelectionModeToggle={() => {
                setSelectionMode((m) => !m);
                setSelectionStart(undefined);
                setSelectionEnd(undefined);
              }}
              onSelectionChange={(start, end) => {
                setSelectionStart(start);
                setSelectionEnd(end);
              }}
              onExport={(type: "premiere" | "davinci" | "finalcut" | "file", range: "selection" | "full") => {
                console.log("Export:", { type, range, selectionStart, selectionEnd });
                // TODO: API 호출
              }}
            />
          )}

          {/* 영상 내용 — 타임스탬프는 트랜스크립트 툴처럼 작은 캡션으로, 대화는 왼쪽 억센트 바로만
              구분해 말풍선 없이도 눈에 띄게(설명 텍스트와 같은 톤 유지) */}
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
                        ? <span className="scene-quote">{s.speech}</span>
                        : <span className="scene-speech">{s.speech}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 오른쪽 — 추천도 · 메타정보(2줄 고정, 레이아웃 흔들림 방지) · 영상요약(강조) · 키워드(대상 포함) · 추천도 구성 */}
        <div className="detail-side">
          <section className="ds-sec ds-meta">
            <div className="clip-subrow">
              {/* 분류(상/중/하) — 판단은 사람이. AI 점수(rec-flag)는 근거로 옆에 병치 */}
              <TierPicker
                value={clip.user_label}
                suggestion={clip.ai_label}
                hint={`AI 점수 ${clip.recommendation ?? 0} · ${scoreLabel(clip.color)}`}
                onPick={setLabel}
              />
              <span className={`rec-flag c-${cc}`}><span className={`dot bg-${cc}`} />{scoreLabel(clip.color)} {clip.recommendation ?? 0}%</span>
            </div>
            {/* 항상 6칸(3+3) 그리드 — 값이 없어도 자리를 지켜 다른 클립으로 넘어갈 때 높이가 흔들리지 않는다 */}
            <div className="meta-grid">
              <span className="mi"><IcCalendar />{clip.date || "—"}</span>
              <span className="mi strong"><IcPin />{clip.place || "—"}</span>
              <span className="mi"><IcClock />{clip.shot_time || "—"}</span>
              <span className="mi"><IcCamera />{clip.camera || "—"}</span>
              <span className="mi">{clip.lens || "—"}</span>
              <span className="mi">{[clip.resolution, clip.fps ? `${clip.fps}fps` : null].filter(Boolean).join(" · ") || "—"}</span>
            </div>
            {(clip.warnings ?? []).length > 0 && (
              <div className="warn-row">
                {(clip.warnings ?? []).map((w) => <span key={w} className="warn-chip">⚠ {w}</span>)}
              </div>
            )}
          </section>

          <section className="ds-sec ds-hero">
            <h2 className="ds-hero-h">영상 요약</h2>
            <p className="ds-summary">{clip.summary || "—"}</p>
          </section>

          <section className="ds-sec">
            <h2>핵심 키워드</h2>
            <div className="kw-list">
              {/* 표페이지 '대상' 개념(인물 우선, 없으면 사물·풍경)을 키워드 앞에 함께 노출. 중복은 제거, 최대 3개 */}
              {Array.from(new Set([...((clip.people?.length ? clip.people : clip.subject ? [clip.subject] : [])), ...keywords])).slice(0, 3).map((k) => (
                <span key={k} className="kw-hash">#{k}</span>
              ))}
              {!clip.people?.length && !clip.subject && keywords.length === 0 && <span className="muted">—</span>}
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
                cid={cid} preview={preview} videoRef={videoRef} compact durationSec={clip.duration_sec}
                savedTimeRef={savedTimeRef} wasPlayingRef={wasPlayingRef}
                selectionMode={selectionMode} selectionStart={selectionStart} selectionEnd={selectionEnd}
                onSelectionModeToggle={() => {
                  setSelectionMode((m) => !m);
                  setSelectionStart(undefined);
                  setSelectionEnd(undefined);
                }}
                onSelectionChange={(start, end) => {
                  setSelectionStart(start);
                  setSelectionEnd(end);
                }}
                onExport={(type: "premiere" | "davinci" | "finalcut" | "file", range: "selection" | "full") => {
                console.log("Export:", { type, range, selectionStart, selectionEnd });
                // TODO: API 호출
              }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
