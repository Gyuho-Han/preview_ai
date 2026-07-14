import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import Landing from "./pages/Landing";
import Home from "./pages/Home";
import CreateProject from "./pages/CreateProject";
import ProjectHome from "./pages/ProjectHome";
import TableView from "./pages/TableView";
import Board from "./pages/Board";
import ClipDetail from "./pages/ClipDetail";
import "./fonts/pretendard.css";
import "./styles.css";

// 초기 테마를 렌더 전에 적용해 플래시 방지 (기본: 화이트)
document.documentElement.dataset.theme =
  localStorage.getItem("theme") || "light";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route index element={<Landing />} />
        <Route element={<App />}>
          <Route path="home" element={<Home />} />
          <Route path="new" element={<CreateProject />} />
          <Route path="project/:pid" element={<ProjectHome />} />
          <Route path="project/:pid/table" element={<TableView />} />
          <Route path="project/:pid/board" element={<Board />} />
          <Route path="project/:pid/clip/:cid" element={<ClipDetail />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
