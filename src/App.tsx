import { useEffect, useState } from "react";
import { Outlet, Link } from "react-router-dom";
import { initApi } from "./api";

export default function App() {
  const [mode, setMode] = useState<string>("…");

  useEffect(() => {
    initApi()
      .then((r) => setMode(r.mode))
      .catch(() => setMode("offline"));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          🎬 Preview AI
        </Link>
        <span className={`mode mode-${mode}`}>
          {mode === "tauri" && "로컬 앱 · 사이드카 연결됨"}
          {mode === "browser" && "브라우저 · 사이드카 연결됨"}
          {mode === "mock" && "데모 모드 (목 데이터)"}
          {mode === "offline" && "사이드카 미연결"}
          {mode === "…" && "연결 중…"}
        </span>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
