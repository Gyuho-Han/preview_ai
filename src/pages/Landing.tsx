// 앱 진입 전 인트로(랜딩) — 서비스 핵심을 설명. 세련·미니멀 + 은은한 모션.
// 히어로에 "자동 분석 과정" 데모를 자동 재생(루프)한다. "시작하기"로 앱 진입.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const FEATURES = [
  {
    icon: "🔒",
    tag: "100% 로컬 · 보안",
    title: "영상은 기기를 떠나지 않습니다",
    desc: "자막·장면 인식·임베딩까지 모든 AI 모델이 로컬에서 실행됩니다. 민감한 촬영본을 외부 서버에 올릴 필요가 없습니다.",
  },
  {
    icon: "✨",
    tag: "자동 분석",
    title: "넣기만 하면 자동으로 읽어냅니다",
    desc: "음성은 자막으로, 화면은 장면 설명으로. 둘을 융합해 한줄요약·키워드·등장인물·추천도를 자동으로 만들어냅니다.",
  },
  {
    icon: "📊",
    tag: "스프레드시트 정리",
    title: "수백 개의 클립을 한 장의 표로",
    desc: "촬영본이 쌓여도 장소·카메라·인물·추천도로 즉시 필터하고 정렬. 찾는 컷을 몇 초 만에 찾습니다.",
  },
];

const STEPS = [
  { n: "01", t: "영상 추가", d: "MP4·MOV·MXF를 끌어다 놓기" },
  { n: "02", t: "자동 분석", d: "로컬 모델이 자막·장면·키워드 추출" },
  { n: "03", t: "표로 확인", d: "추천도 순으로 정리된 프리뷰 노트" },
];

// 히어로 자동 분석 데모 — 입력 → 분석 중 → 결과 를 무한 루프
const STAGES = ["전처리", "자막 추출 · ASR", "장면 설명 · VLM", "콘텐츠 융합 · LLM"];
type Phase = "idle" | "analyzing" | "result";

function HeroDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState(0);
  const [score, setScore] = useState(0);

  useEffect(() => {
    const ids: number[] = [];
    const clearAll = () => ids.forEach((t) => { clearTimeout(t); clearInterval(t); });

    const run = () => {
      setPhase("idle");
      setStage(0);
      setScore(0);
      ids.push(window.setTimeout(() => setPhase("analyzing"), 1100));
      STAGES.forEach((_, i) =>
        ids.push(window.setTimeout(() => setStage(i), 1100 + i * 760))
      );
      ids.push(window.setTimeout(() => setPhase("result"), 1100 + 3100));
      ids.push(
        window.setTimeout(() => {
          let v = 0;
          const iv = window.setInterval(() => {
            v += 4;
            if (v >= 92) { v = 92; clearInterval(iv); }
            setScore(v);
          }, 26);
          ids.push(iv);
        }, 1100 + 3100 + 200)
      );
      ids.push(window.setTimeout(run, 1100 + 3100 + 4200)); // 루프
    };
    run();
    return clearAll;
  }, []);

  const analyzing = phase === "analyzing";
  const result = phase === "result";

  return (
    <div className="proc-card">
      <div className="proc-head">
        <span className="proc-dot" />
        <span className="proc-dot" />
        <span className="proc-dot" />
        <span className="proc-title">Preview AI · 자동 분석</span>
      </div>

      {/* 클립 + 상태 */}
      <div className="proc-clip">
        <span className="proc-thumb">▶</span>
        <span className="proc-meta">
          <span className="proc-file">A012_C007.MOV</span>
          <span className="proc-dur">02:14 · FX3</span>
        </span>
        <span className={`proc-status ${result ? "ok" : ""}`}>
          {phase === "idle" && "분석 대기"}
          {analyzing && (<><span className="spinner" /> {STAGES[stage]}</>)}
          {result && "완료 ✓"}
        </span>
      </div>

      {/* 진행 바 */}
      <div className="proc-track">
        <div
          className="proc-fill"
          style={{ width: analyzing || result ? "100%" : "0%" }}
        />
      </div>

      {/* 결과 */}
      <div className={`proc-result ${result ? "show" : ""}`}>
        <div className="proc-grid">
          <div>
            <div className="proc-label">한줄요약</div>
            <p className="proc-summary">부엌에서 어머니가 김치를 담그며 고향 이야기를 나눈다.</p>
            <div className="proc-label">주요 장면</div>
            <ul className="proc-scenes">
              <li><b>00:05</b> 인물 등장 · 부엌 전경</li>
              <li><b>00:48</b> 김치를 담그며 대화</li>
              <li><b>01:30</b> 창밖을 응시</li>
            </ul>
            <div className="proc-tags">
              {["가족", "김치", "고향", "일상"].map((k) => (
                <span className="tag" key={k}>{k}</span>
              ))}
            </div>
          </div>
          <div className="proc-scorebox">
            <div className="proc-score-num c-green">{score}<small>%</small></div>
            <div className="proc-score-cap">추천도</div>
            <div className="proc-score-sub">연관성 95 · 품질 88</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const nav = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = root.querySelectorAll("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { root, threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const start = () => nav("/home");

  return (
    <div className="landing" ref={rootRef}>
      <div className="landing-aurora" aria-hidden="true" />
      <div className="landing-grid-bg" aria-hidden="true" />

      <header className="landing-nav">
        <span className="landing-brand">🎬 Preview AI</span>
        <button className="secondary" onClick={start}>건너뛰기 →</button>
      </header>

      {/* HERO */}
      <section className="landing-hero">
        <div className="hero-copy">
          <div className="hero-eyebrow" data-reveal>
            다큐멘터리 팀을 위한 로컬 영상 분석
          </div>
          <h1 className="hero-title" data-reveal style={{ transitionDelay: "60ms" }}>
            촬영본을 넣으면,
            <br />
            <span className="grad">프리뷰 노트가 완성됩니다.</span>
          </h1>
          <p className="hero-sub" data-reveal style={{ transitionDelay: "140ms" }}>
            자막·장면 설명·키워드·추천도를 자동으로 뽑아 한 장의 표로 정리합니다.
            <br />
            그리고 영상은 단 한 번도 기기를 떠나지 않습니다.
          </p>
          <div className="hero-cta" data-reveal style={{ transitionDelay: "220ms" }}>
            <button onClick={start}>시작하기 →</button>
            <span className="hero-hint">스크롤해서 더 알아보기 ↓</span>
          </div>
        </div>

        <div className="hero-demo" data-reveal style={{ transitionDelay: "300ms" }}>
          <HeroDemo />
        </div>
      </section>

      {/* FEATURES */}
      <section className="landing-section">
        <div className="section-head" data-reveal>
          <span className="section-eyebrow">CORE</span>
          <h2>분석은 맡기고, 판단에 집중하세요</h2>
        </div>
        <div className="feat-grid">
          {FEATURES.map((f, i) => (
            <div className="feat-card" data-reveal key={f.tag} style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="feat-icon">{f.icon}</div>
              <div className="feat-tag">{f.tag}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FLOW */}
      <section className="landing-section">
        <div className="section-head" data-reveal>
          <span className="section-eyebrow">HOW IT WORKS</span>
          <h2>세 단계면 충분합니다</h2>
        </div>
        <div className="flow">
          {STEPS.map((s, i) => (
            <div className="flow-step" data-reveal key={s.n} style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="flow-n">{s.n}</div>
              <div className="flow-t">{s.t}</div>
              <div className="flow-d">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CLOSING */}
      <section className="landing-final">
        <div className="final-aurora" aria-hidden="true" />
        <h2 data-reveal>지금, 첫 프로젝트를 만들어 보세요.</h2>
        <p data-reveal style={{ transitionDelay: "80ms" }}>
          설치는 한 번, 인터넷 없이도 동작합니다.
        </p>
        <button data-reveal style={{ transitionDelay: "160ms" }} onClick={start}>
          시작하기 →
        </button>
      </section>
    </div>
  );
}
