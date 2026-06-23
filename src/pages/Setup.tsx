// 첫 실행 셋업 화면 — 의존성 체크 + 누락분만 다운로드 (진행률 표시)
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SetupItem, SetupSnapshot } from "../types";

const STATUS_LABEL: Record<string, string> = {
  present: "설치됨",
  done: "완료",
  pending: "필요",
  downloading: "다운로드 중",
  error: "오류",
  blocked: "대기",
};

function icon(s: string): string {
  if (s === "present" || s === "done") return "✓";
  if (s === "downloading") return "⏳";
  if (s === "error") return "✕";
  if (s === "blocked") return "⚠";
  return "○";
}

export default function Setup({ onReady }: { onReady: () => void }) {
  const [snap, setSnap] = useState<SetupSnapshot>();
  const [installing, setInstalling] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    api.setupStatus().then(setSnap).catch(() => {});
    return () => clearInterval(poll.current);
  }, []);

  async function startInstall() {
    setInstalling(true);
    await api.setupInstall();
    poll.current = setInterval(async () => {
      const s = await api.setupProgress();
      setSnap(s);
      if (!s.installing) {
        clearInterval(poll.current);
        setInstalling(false);
      }
    }, 1000);
  }

  if (!snap) {
    return (
      <div className="empty">
        <span className="spinner" /> 의존성 확인 중…
      </div>
    );
  }

  // 자동설치 대상(모델/Whisper)만 진행률 계산 — ffmpeg/ollama 서버는 별도
  const installable = snap.items.filter((i) => i.kind === "ollama_model" || i.kind === "hf_model");
  const missing = installable.filter((i) => i.status !== "present" && i.status !== "done");
  const overall = installable.length
    ? Math.round(installable.reduce((a, i) => a + (i.status === "present" || i.status === "done" ? 100 : i.pct), 0) / installable.length)
    : 100;

  const ollama = snap.items.find((i) => i.name === "ollama");
  const ffmpeg = snap.items.find((i) => i.name === "ffmpeg");

  return (
    <div style={{ maxWidth: 640, margin: "40px auto" }}>
      <h1>설치 준비</h1>
      <p className="muted">
        로컬에서 분석에 필요한 구성요소를 확인합니다. 이미 있는 항목은 건너뛰고, 없는 것만 내려받습니다.
      </p>

      {ollama && ollama.status !== "present" && (
        <div className="card" style={{ borderColor: "var(--yellow)", marginBottom: 12 }}>
          ⚠ Ollama 서버에 연결할 수 없습니다. 데스크탑 앱에서는 자동 실행되며, 개발 모드라면 별도 터미널에서{" "}
          <code>ollama serve</code>를 켜주세요.
        </div>
      )}

      <div className="card">
        {snap.items.map((it) => (
          <Row key={it.name} item={it} />
        ))}
      </div>

      {ffmpeg && ffmpeg.status !== "present" && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          ffmpeg가 없습니다. 배포된 앱에는 동봉되지만, 개발 모드라면 <code>brew install ffmpeg</code> 또는{" "}
          <code>conda install -c conda-forge ffmpeg</code>로 설치하세요.
        </p>
      )}

      {!snap.all_ready && missing.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="row spread" style={{ marginBottom: 6 }}>
            <span className="muted">전체 진행률</span>
            <span className="muted">{overall}%</span>
          </div>
          <div className="progress" style={{ height: 10 }}>
            <div style={{ width: `${overall}%` }} />
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        {snap.all_ready ? (
          <button onClick={onReady}>시작하기</button>
        ) : (
          <button onClick={startInstall} disabled={installing}>
            {installing ? <><span className="spinner" /> 설치 중… ({overall}%)</> : `필요한 ${missing.length}개 설치`}
          </button>
        )}
        <button className="secondary" onClick={() => api.setupStatus().then(setSnap)} disabled={installing}>
          다시 확인
        </button>
        {snap.all_ready && <span className="c-green">✓ 모든 준비 완료</span>}
      </div>
    </div>
  );
}

function Row({ item }: { item: SetupItem }) {
  const cls = item.status === "error" ? "c-red" : item.status === "present" || item.status === "done" ? "c-green" : "muted";
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="row spread">
        <span>
          <span className={cls} style={{ marginRight: 8 }}>{icon(item.status)}</span>
          {item.label}
        </span>
        <span className={`${cls}`} style={{ fontSize: 12 }}>
          {STATUS_LABEL[item.status] ?? item.status}
          {item.status === "downloading" && ` ${item.pct}%`}
        </span>
      </div>
      {item.status === "downloading" && (
        <div className="progress" style={{ marginTop: 6 }}>
          <div style={{ width: `${item.pct}%` }} />
        </div>
      )}
      {item.detail && (item.status === "downloading" || item.status === "error" || item.status === "blocked") && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{item.detail}</div>
      )}
    </div>
  );
}
