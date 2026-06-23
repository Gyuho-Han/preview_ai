import { useEffect, useState } from "react";
import { Outlet, Link } from "react-router-dom";
import { initApi, api } from "./api";
import Setup from "./pages/Setup";

type Gate = "checking" | "setup" | "ready";

export default function App() {
  const [mode, setMode] = useState<string>("…");
  const [gate, setGate] = useState<Gate>("checking");

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
      // 의존성 셋업 확인 — 준비 안 됐으면 셋업 화면으로 게이팅
      try {
        const s = await api.setupStatus();
        setGate(s.all_ready ? "ready" : "setup");
      } catch {
        // 사이드카 미연결 등 — 일단 앱은 띄우되 셋업은 건너뜀
        setGate("ready");
      }
    })();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">🎬 Preview AI</Link>
        <span className={`mode mode-${mode}`}>
          {mode === "tauri" && "로컬 앱 · 사이드카 연결됨"}
          {mode === "browser" && "브라우저 · 사이드카 연결됨"}
          {mode === "mock" && "데모 모드 (목 데이터)"}
          {mode === "offline" && "사이드카 미연결"}
          {mode === "…" && "연결 중…"}
        </span>
      </header>
      <main className="content">
        {gate === "checking" && (
          <div className="empty"><span className="spinner" /> 시작 준비 중…</div>
        )}
        {gate === "setup" && <Setup onReady={() => setGate("ready")} />}
        {gate === "ready" && <Outlet />}
      </main>
    </div>
  );
}
