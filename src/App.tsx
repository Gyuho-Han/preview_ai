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

  // 프로젝트 내부 뷰는 딱 둘: 대시보드 / 표(→ 상세). 계층이 드러나도록
  // 전역 탭이 아니라 프로젝트가 열려 있을 때만 나오는 컨텍스트 스위치로 둔다.
  const isProjectRoot = /\/project\/[^/]+$/.test(pathname);
  const isTable = pathname.endsWith("/table");
  const isBoard = pathname.endsWith("/board");
  const isClip = pathname.includes("/clip/");
  const inProject = Boolean(pid) && (isProjectRoot || isTable || isBoard || isClip);

  const modeLabel =
    mode === "tauri" || mode === "browser" ? "사이드카 연결됨"
    : mode === "mock" ? "데모 모드"
    : mode === "offline" ? "사이드카 미연결" : "연결 중…";

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/home" className="brand">Preview<span className="brand-dot">.AI</span></Link>

        <nav className="projnav">
          {inProject && (
            <>
              <Link
                to={`/project/${pid}`}
                className={`projnav-item ${isProjectRoot ? "active" : ""}`}
              >
                대시보드
              </Link>
              <Link
                to={`/project/${pid}/table`}
                className={`projnav-item ${isTable || isClip ? "active" : ""}`}
              >
                표
              </Link>
              <Link
                to={`/project/${pid}/board`}
                className={`projnav-item ${isBoard ? "active" : ""}`}
              >
                보드
              </Link>
            </>
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

      <main className="content">
        {gate === "checking" && (
          <div className="empty"><span className="spinner" /> 시작 준비 중…</div>
        )}
        {gate === "setup" && <Setup onReady={() => setGate("ready")} />}
        {gate === "ready" && <Outlet />}
      </main>

      <FeedbackHost />
    </div>
  );
}
