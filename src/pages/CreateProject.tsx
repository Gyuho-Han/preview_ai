// P2 프로젝트 생성 — 기획안 업로드 → AI 자동완성 → 유저 확인&수정
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, pickPlan, isTauri } from "../api";
import type { PlanContext } from "../types";

const EMPTY: PlanContext = {
  title: "", shooting_period: "", topic: "",
  characters: [], locations: [], cameras: [], keywords: [], tone_mood: "",
};

export default function CreateProject() {
  const nav = useNavigate();
  const [pid, setPid] = useState<string | null>(null);
  const [ctx, setCtx] = useState<PlanContext>(EMPTY);
  const [extra, setExtra] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [planName, setPlanName] = useState("");
  const planInput = useRef<HTMLInputElement>(null);

  async function ensureProject(): Promise<string> {
    let id = pid;
    if (!id) {
      const res = await api.createProject("", extra);
      id = res.id;
      setPid(id);
    }
    return id;
  }

  async function handleUploadPlan() {
    if (isTauri) {
      const path = await pickPlan();
      if (!path) return;
      setPlanName(path.split("/").pop() || path);
      setAnalyzing(true);
      try {
        const id = await ensureProject();
        const result = await api.uploadPlan(id, path);
        setCtx({ ...EMPTY, ...result });
      } catch (e) {
        alert(`기획안 분석 실패: ${e}`);
      } finally {
        setAnalyzing(false);
      }
    } else {
      planInput.current?.click();
    }
  }

  async function onPlanPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPlanName(file.name);
    setAnalyzing(true);
    try {
      const id = await ensureProject();
      const result = await api.uploadPlanFile(id, file);
      setCtx({ ...EMPTY, ...result });
    } catch (err) {
      alert(`기획안 분석 실패: ${err}`);
    } finally {
      setAnalyzing(false);
      e.target.value = "";
    }
  }

  function field(key: keyof PlanContext, val: string) {
    setCtx({ ...ctx, [key]: val });
  }
  function listField(key: keyof PlanContext, val: string) {
    setCtx({ ...ctx, [key]: val.split(",").map((s) => s.trim()).filter(Boolean) });
  }

  async function save() {
    let id = pid;
    if (!id) {
      const res = await api.createProject(ctx.title || "새 프로젝트", extra);
      id = res.id;
    }
    await api.updatePlan(id, ctx);
    nav(`/project/${id}`);
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1>새 프로젝트</h1>
      <p className="muted">
        기획안을 업로드하면 AI가 프로젝트 정보를 자동으로 채웁니다. 추천도 정확도의 핵심 입력값입니다.
      </p>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row spread">
          <div>
            <strong>기획안 (PDF / 문서)</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {planName || "아직 업로드되지 않음"}
            </div>
          </div>
          <button onClick={handleUploadPlan} disabled={analyzing}>
            {analyzing ? <><span className="spinner" /> 분석 중…</> : "기획안 업로드"}
          </button>
          <input
            ref={planInput}
            type="file"
            accept=".pdf,.txt,.md"
            style={{ display: "none" }}
            onChange={onPlanPicked}
          />
        </div>
        <label>추가 맥락 (선택)</label>
        <textarea
          rows={2}
          placeholder="기획안에 없는 보충 설명을 적어주세요."
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
      </div>

      <h2>AI 자동완성 결과 (확인 & 수정)</h2>
      <div className="card">
        <label>프로젝트명</label>
        <input value={ctx.title} onChange={(e) => field("title", e.target.value)} />
        <label>촬영 기간</label>
        <input value={ctx.shooting_period} onChange={(e) => field("shooting_period", e.target.value)} />
        <label>핵심 주제</label>
        <input value={ctx.topic} onChange={(e) => field("topic", e.target.value)} />
        <label>등장인물 (쉼표로 구분)</label>
        <input value={ctx.characters.join(", ")} onChange={(e) => listField("characters", e.target.value)} />
        <label>장소 (쉼표로 구분)</label>
        <input value={ctx.locations.join(", ")} onChange={(e) => listField("locations", e.target.value)} />
        <label>카메라/장비 (쉼표로 구분)</label>
        <input value={ctx.cameras.join(", ")} onChange={(e) => listField("cameras", e.target.value)} />
        <label>키워드 (쉼표로 구분 · 추천도 기준)</label>
        <input value={ctx.keywords.join(", ")} onChange={(e) => listField("keywords", e.target.value)} />
        <label>톤 & 무드</label>
        <input value={ctx.tone_mood} onChange={(e) => field("tone_mood", e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button onClick={save}>저장하고 계속</button>
        <button className="secondary" onClick={() => nav("/")}>취소</button>
      </div>
    </div>
  );
}
