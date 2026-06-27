import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import Home from "./pages/Home";
import CreateProject from "./pages/CreateProject";
import ProjectHome from "./pages/ProjectHome";
import TableView from "./pages/TableView";
import ClipDetail from "./pages/ClipDetail";
import "./fonts/pretendard.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route path="new" element={<CreateProject />} />
          <Route path="project/:pid" element={<ProjectHome />} />
          <Route path="project/:pid/table" element={<TableView />} />
          <Route path="project/:pid/clip/:cid" element={<ClipDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
