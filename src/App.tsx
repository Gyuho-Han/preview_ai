import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { initApi, api } from "./api";
import Setup from "./pages/Setup";
import { FeedbackHost } from "./ui/feedback";

type Gate = "checking" | "setup" | "ready";
type Theme = "dark" | "light";

export default function App() {
  const [mode, setMode] = useState<string>("…");
  const [gate, setGate] = useState<Gate>("checking");
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "light"
  );
  const { pathname } = useLocation();
  const pidMatch = pathname.match(/\/project\/([^/]+)/);
  const pid = pidMatch ? pidMatch[1] : null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    (async () => {
      let m = "offline";
      try {
        const r = await initApi();
        m = r.mode;
      } catch {
        /* offline */
      }
      setMode(m);
      try {
        const s = await api.setupStatus();
        setGate(s.all_ready ? "ready" : "setup");
      } catch {
        setGate("ready");
      }
    })();
  }, []);

  // 상단 중앙 내비 — 프로젝트가 열려 있어야 하는 탭은 pid 없으면 비활성
  const isProjectRoot = /\/project\/[^/]+$/.test(pathname);
  const isTable = pathname.endsWith("/table");
  const isClip = pathname.includes("/clip/");
  const nav: { label: string; to: string | null; active: boolean }[] = [
    { label: "홈", to: "/home", active: pathname.startsWith("/home") },
    { label: "프로젝트 생성", to: "/new", active: pathname.startsWith("/new") },
    { label: "기본페이지", to: pid ? `/project/${pid}` : null, active: isProjectRoot },
    { label: "표 페이지", to: pid ? `/project/${pid}/table` : null, active: isTable },
    { label: "상세페이지", to: null, active: isClip },
  ];

  const modeLabel =
    mode === "tauri" || mode === "browser" ? "사이드카 연결됨"
    : mode === "mock" ? "데모 모드"
    : mode === "offline" ? "사이드카 미연결" : "연결 중…";

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/home" className="brand">Preview<span className="brand-dot">.AI</span></Link>

        <nav className="topnav">
          {nav.map((n) =>
            n.to ? (
              <Link key={n.label} to={n.to} className={`topnav-item ${n.active ? "active" : ""}`}>
                {n.label}
              </Link>
            ) : (
              <span key={n.label} className={`topnav-item ${n.active ? "active" : "disabled"}`}>
                {n.label}
              </span>
            )
          )}
        </nav>

        <div className="topbar-right">
          <span className={`conn-dot mode-${mode}`} title={modeLabel} />
          <button
            className="theme-toggle"
            title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      {/* 플랜 · 사용량 바 (목업 — 프로토타입 반영) */}
      <div className="planbar">
        <div className="plan-usage">
          <span className="plan-chip">FREE</span>
          <div className="usage-bar"><div style={{ width: "33%" }} /></div>
          <span className="usage-text">180분 남음</span>
        </div>
        <div className="plan-right">
          <div className="plan-seg">
            <button className="on">무료</button>
            <button>Basic</button>
            <button>Pro</button>
          </div>
          <button className="upgrade">업그레이드</button>
        </div>
      </div>

      <main className="content">
        {gate === "checking" && (
          <div className="empty"><span className="spinner" /> 시작 준비 중…</div>
        )}
        {gate === "setup" && <Setup onReady={() => setGate("ready")} />}
        {gate === "ready" && <Outlet />}
      </main>

      {/* 하단 탭바 (프로토타입 반영) */}
      <nav className="bottomnav">
        <Link to="/home" className={`bnav ${pathname.startsWith("/home") ? "active" : ""}`}>
          <BIcon name="home" /><span>홈</span>
        </Link>
        <Link
          to={pid ? `/project/${pid}` : "/home"}
          className={`bnav ${isProjectRoot ? "active" : ""}`}
        >
          <BIcon name="grid" /><span>기본</span>
        </Link>
        <Link
          to={pid ? `/project/${pid}/table` : "/home"}
          className={`bnav ${isTable ? "active" : ""}`}
        >
          <BIcon name="list" /><span>표</span>
        </Link>
      </nav>

      <FeedbackHost />
    </div>
  );
}

function BIcon({ name }: { name: "home" | "grid" | "list" }) {
  const paths: Record<string, JSX.Element> = {
    home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    grid: <g fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></g>,
    list: <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></g>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20">{paths[name]}</svg>;
}
