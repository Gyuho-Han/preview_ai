// 목 데이터 — 사이드카/Tauri 없이 `npm run dev`로 UI 흐름 전체를 미리보기.
// 데모 프로젝트에는 날짜·장소가 다양하게 클러스터링된 클립을 미리 심어두어,
// 표의 날짜 섹션 + 장소 병합 + 추천도 분포를 데이터 없이도 바로 확인할 수 있다.

import type { Clip, PlanContext, ProjectSummary, Scene } from "./types";

const now = Date.now() / 1000;

const projects: Record<string, ProjectSummary & Partial<PlanContext>> = {
  demo: {
    id: "demo",
    name: "블렌타이어 다큐 (데모)",
    shooting_period: "2026-05-01 ~ 2026-05-20",
    updated_at: now,
    clip_count: 0,
    topic: "스코틀랜드 블렌타이어 이주 한인 가족의 일상",
    characters: ["김씨 가족", "현지 이웃"],
    locations: ["블렌타이어 숙소", "마을 거리", "기차역", "부엌", "언덕"],
    cameras: ["FX3", "DJI"],
    keywords: ["이주", "가족", "라면", "일상", "향수", "스코틀랜드"],
    tone_mood: "따뜻하고 잔잔한",
  },
};

// 추천도 = 0.6×연관성 + 0.4×서사강도 (scoring.py와 동일). 색은 임계값(80/50) 기준.
function scoreOf(relevance: number, narrative: number) {
  const rec = Math.round(0.6 * relevance + 0.4 * narrative);
  const color: Clip["color"] = rec >= 80 ? "green" : rec >= 50 ? "yellow" : "red";
  return { rec, color };
}

interface Spec {
  date: string;
  place: string;
  camera: string;
  people: string[];
  one_line: string;
  relevance: number;
  narrative: number;
  has_speech?: boolean;
  warnings?: string[];
  focus?: number;
  dur?: number;
  keywords?: string[];
  transcript?: string;
}

// 날짜 안에서 장소가 연속으로 묶이도록 배열 순서를 구성 (실제 촬영 흐름 모사)
const DEMO_SPECS: Spec[] = [
  // 2026-05-01 — 숙소 3 · 거리 2
  { date: "2026-05-01", place: "블렌타이어 숙소", camera: "FX3", people: ["김씨 가족"], one_line: "숙소 도착 첫날, 짐을 풀며 새 보금자리를 둘러보는 가족", relevance: 78, narrative: 70, has_speech: true, transcript: "여기가 앞으로 우리 집이네… 생각보다 넓다.", keywords: ["이주", "가족", "숙소"] },
  { date: "2026-05-01", place: "블렌타이어 숙소", camera: "FX3", people: ["김씨 가족"], one_line: "부엌에서 라면을 끓이며 스코틀랜드에서의 첫 식사를 준비", relevance: 88, narrative: 75, has_speech: true, transcript: "엄마 이거 진짜 오랜만이다… 여기서 이렇게 먹으니까 더 맛있네.", keywords: ["라면", "가족", "향수"] },
  { date: "2026-05-01", place: "블렌타이어 숙소", camera: "FX3", people: [], one_line: "창밖으로 보이는 흐린 스코틀랜드 하늘 인서트", relevance: 55, narrative: 35, has_speech: false, keywords: ["인서트", "스코틀랜드"] },
  { date: "2026-05-01", place: "마을 거리", camera: "DJI", people: [], one_line: "비 내리는 마을 거리를 위에서 담은 드론 인서트", relevance: 60, narrative: 48, has_speech: false, keywords: ["드론", "마을", "비"] },
  { date: "2026-05-01", place: "마을 거리", camera: "DJI", people: ["김씨 가족"], one_line: "우산 없이 거리를 걷는 가족의 뒷모습", relevance: 82, narrative: 78, has_speech: false, keywords: ["가족", "산책", "비"] },

  // 2026-05-03 — 기차역 2 · 거리 3
  { date: "2026-05-03", place: "기차역", camera: "FX3", people: ["김씨 가족"], one_line: "기차역 플랫폼에서 열차를 기다리는 가족", relevance: 70, narrative: 60, has_speech: true, transcript: "몇 분 남았지? 곧 온대.", keywords: ["기차역", "가족", "이동"] },
  { date: "2026-05-03", place: "기차역", camera: "FX3", people: [], one_line: "지나가는 기차를 담은 흔들린 핸드헬드 (초점 약함)", relevance: 40, narrative: 30, has_speech: false, warnings: ["초점 나감"], focus: 28, keywords: ["기차", "인서트"] },
  { date: "2026-05-03", place: "마을 거리", camera: "FX3", people: ["현지 이웃"], one_line: "현지 이웃과 마주쳐 인사를 나누는 장면", relevance: 76, narrative: 72, has_speech: true, transcript: "Hello! 오늘 날씨 좋네요.", keywords: ["이웃", "교류", "마을"] },
  { date: "2026-05-03", place: "마을 거리", camera: "DJI", people: [], one_line: "마을 전경을 담은 드론 상승샷", relevance: 58, narrative: 50, has_speech: false, keywords: ["드론", "마을", "전경"] },
  { date: "2026-05-03", place: "마을 거리", camera: "FX3", people: ["김씨 가족"], one_line: "동네 상점 앞에서 물건을 고르는 가족", relevance: 66, narrative: 55, has_speech: true, transcript: "이거 하나 사볼까?", keywords: ["일상", "상점", "가족"] },

  // 2026-05-07 — 부엌 4 · 숙소 1
  { date: "2026-05-07", place: "부엌", camera: "FX3", people: ["김씨 가족"], one_line: "어머니가 김치를 담그며 고향 이야기를 꺼내는 장면", relevance: 92, narrative: 85, has_speech: true, transcript: "고향에선 이맘때 다들 김장했는데… 여기서도 해먹어야지.", keywords: ["김치", "향수", "어머니"] },
  { date: "2026-05-07", place: "부엌", camera: "FX3", people: ["김씨 가족"], one_line: "김치를 버무리는 손을 담은 클로즈업 인서트", relevance: 74, narrative: 60, has_speech: false, keywords: ["김치", "인서트", "손"] },
  { date: "2026-05-07", place: "부엌", camera: "FX3", people: [], one_line: "냄비에서 피어오르는 김 인서트", relevance: 48, narrative: 40, has_speech: false, keywords: ["인서트", "요리"] },
  { date: "2026-05-07", place: "부엌", camera: "FX3", people: ["김씨 가족"], one_line: "온 가족이 식탁에 둘러앉아 저녁을 먹으며 웃는 장면", relevance: 90, narrative: 88, has_speech: true, transcript: "다 같이 먹으니까 진짜 좋다.", keywords: ["가족", "식사", "일상"] },
  { date: "2026-05-07", place: "블렌타이어 숙소", camera: "DJI", people: [], one_line: "식사 후 정리하는 부엌을 담은 롱샷", relevance: 52, narrative: 42, has_speech: false, keywords: ["일상", "정리"] },

  // 2026-05-12 — 언덕 2 · 거리 2
  { date: "2026-05-12", place: "언덕", camera: "DJI", people: [], one_line: "해질녘 언덕에서 마을을 내려다보는 B롤", relevance: 80, narrative: 74, has_speech: false, keywords: ["언덕", "노을", "B롤"] },
  { date: "2026-05-12", place: "언덕", camera: "DJI", people: ["김씨 가족"], one_line: "언덕 위에서 가족이 나란히 앉아 대화하는 장면", relevance: 85, narrative: 80, has_speech: true, transcript: "여기 오길 잘한 것 같아.", keywords: ["가족", "대화", "언덕"] },
  { date: "2026-05-12", place: "마을 거리", camera: "FX3", people: ["현지 이웃"], one_line: "이웃집을 방문해 차를 마시며 이야기하는 장면", relevance: 72, narrative: 65, has_speech: true, transcript: "Thank you for having us.", keywords: ["이웃", "교류", "차"] },
  { date: "2026-05-12", place: "마을 거리", camera: "FX3", people: [], one_line: "골목길을 걷는 발걸음 인서트 (너무 짧음)", relevance: 45, narrative: 38, has_speech: false, warnings: ["너무 짧음"], dur: 6, keywords: ["인서트", "골목"] },

  // 2026-05-20 — 숙소 2 · 부엌 2
  { date: "2026-05-20", place: "블렌타이어 숙소", camera: "FX3", people: ["김씨 가족"], one_line: "떠나기 전 짐을 싸며 지난 시간을 되돌아보는 가족", relevance: 89, narrative: 90, has_speech: true, transcript: "벌써 갈 시간이라니… 시간 진짜 빠르다.", keywords: ["이주", "회상", "가족"] },
  { date: "2026-05-20", place: "블렌타이어 숙소", camera: "FX3", people: ["김씨 가족"], one_line: "마지막 밤, 창가에서 소감을 나누는 인터뷰", relevance: 94, narrative: 86, has_speech: true, transcript: "이곳에서의 시간이 우리에겐 정말 큰 선물이었어요.", keywords: ["인터뷰", "향수", "마무리"] },
  { date: "2026-05-20", place: "부엌", camera: "FX3", people: ["김씨 가족"], one_line: "마지막 아침 식사를 준비하는 부엌", relevance: 77, narrative: 70, has_speech: true, transcript: "마지막 아침이네. 든든하게 먹자.", keywords: ["식사", "가족", "아침"] },
  { date: "2026-05-20", place: "부엌", camera: "DJI", people: [], one_line: "말끔히 정리된 빈 부엌을 담은 마무리 인서트", relevance: 50, narrative: 44, has_speech: false, keywords: ["인서트", "마무리"] },
];

function makeScenes(spec: Spec): Scene[] {
  const scenes: Scene[] = [
    { time: "00:03", desc: "도입 — 장소와 상황 소개", t: 3 },
  ];
  if (spec.has_speech && spec.transcript) {
    scenes.push({ time: "00:21", desc: "핵심 대화/행동", t: 21, speech: spec.transcript });
  } else {
    scenes.push({ time: "00:18", desc: "핵심 장면 전개", t: 18 });
  }
  scenes.push({ time: "00:34", desc: "마무리 — 다음 장면으로 연결", t: 34 });
  return scenes;
}

let clipSeq = 0;
function makeClip(spec: Spec, id: string, project_id: string): Clip {
  const { rec, color } = scoreOf(spec.relevance, spec.narrative);
  const n = ++clipSeq;
  return {
    id,
    project_id,
    filename: `A${String(n).padStart(3, "0")}_C${String(n).padStart(3, "0")}.MOV`,
    filepath: `/Volumes/SSD/footage/${spec.date}/A${String(n).padStart(3, "0")}.MOV`,
    status: "done",
    stage: "완료",
    progress: 100,
    duration_sec: spec.dur ?? 24 + (n % 6) * 13,
    date: spec.date,
    place: spec.place,
    camera: spec.camera,
    people: spec.people,
    one_line: spec.one_line,
    summary: `${spec.one_line}. 자막과 키프레임 시각 설명을 융합해 생성된 요약이 여기에 표시됩니다. ${spec.has_speech ? "대화가 있어 맥락 파악이 쉬운 편입니다." : "음성이 없어 화면 설명(VLM) 기반으로 분석했습니다."}`,
    scenes: makeScenes(spec),
    keywords: spec.keywords ?? ["가족", "일상"],
    ai_comment:
      color === "green"
        ? "기획안 핵심 키워드와 잘 맞고 서사도 살아있어요. 메인 시퀀스 후보입니다."
        : color === "yellow"
        ? "쓸 만한 장면이지만 결정적 순간은 약해요. 인서트/보조 컷으로 적합합니다."
        : "기획 방향과의 연결이 약하고 서사도 옅어요. 우선순위는 낮게 두세요.",
    has_speech: spec.has_speech ?? false,
    transcript: spec.transcript ?? "",
    scene_descriptions: [spec.one_line],
    focus_score: spec.focus ?? 82,
    audio_rms_dbfs: spec.has_speech ? -22 : -99,
    relevance: spec.relevance,
    narrative: spec.narrative,
    warnings: spec.warnings ?? [],
    recommendation: rec,
    color,
  };
}

const clips: Record<string, Clip> = {};
// 데모 프로젝트 프리시드
DEMO_SPECS.forEach((spec, i) => {
  const id = `demo-${i}`;
  clips[id] = makeClip(spec, id, "demo");
});

export const mockApi = {
  async listProjects(): Promise<ProjectSummary[]> {
    return Object.values(projects).map((p) => ({
      id: p.id,
      name: p.name,
      shooting_period: p.shooting_period,
      updated_at: p.updated_at,
      clip_count: Object.values(clips).filter((c) => c.project_id === p.id).length,
    }));
  },
  async createProject(name: string): Promise<{ id: string }> {
    const id = `p-${Date.now()}`;
    projects[id] = {
      id,
      name: name || "새 프로젝트",
      shooting_period: "",
      updated_at: Date.now() / 1000,
      clip_count: 0,
      keywords: [],
    };
    return { id };
  },
  async getProject(pid: string) {
    const p = projects[pid] ?? projects.demo;
    return {
      id: p.id,
      name: p.name,
      title: p.name,
      shooting_period: p.shooting_period ?? "",
      topic: p.topic ?? "",
      characters: p.characters ?? [],
      locations: p.locations ?? [],
      cameras: p.cameras ?? [],
      keywords: p.keywords ?? [],
      tone_mood: p.tone_mood ?? "",
    };
  },
  async uploadPlan(): Promise<PlanContext> {
    return {
      title: "블렌타이어 다큐 (데모)",
      shooting_period: "2026-05-01 ~ 2026-05-20",
      topic: "스코틀랜드 블렌타이어 이주 한인 가족의 일상",
      characters: ["김씨 가족", "현지 이웃"],
      locations: ["블렌타이어 숙소", "마을 거리"],
      cameras: ["FX3", "DJI"],
      keywords: ["이주", "가족", "라면", "일상", "향수", "스코틀랜드"],
      tone_mood: "따뜻하고 잔잔한",
    };
  },
  async updatePlan(): Promise<{ ok: boolean }> {
    return { ok: true };
  },
  async pickVideos(): Promise<string[]> {
    return ["/demo/A001.MOV", "/demo/A002.MOV", "/demo/A003.MOV"];
  },
  async analyzeVideos(pid: string, paths: string[]): Promise<{ clip_ids: string[] }> {
    const ids: string[] = [];
    const base = Object.keys(clips).length;
    paths.forEach((path, idx) => {
      const id = `clip-${base + idx}`;
      const spec = DEMO_SPECS[(base + idx) % DEMO_SPECS.length];
      clips[id] = {
        id,
        project_id: pid,
        filename: path.split("/").pop() || path,
        filepath: path,
        status: "queued",
        stage: "대기 중",
        progress: 0,
      };
      ids.push(id);
      // 진행률 시뮬레이션
      let pct = 0;
      const timer = setInterval(() => {
        pct += 12 + Math.random() * 18;
        const c = clips[id];
        if (pct >= 100) {
          clearInterval(timer);
          const done = makeClip(spec, id, pid);
          clips[id] = { ...done, filename: c.filename, filepath: c.filepath };
        } else {
          c.progress = Math.round(pct);
          c.stage = pct < 35 ? "전처리" : pct < 60 ? "장면 설명(VLM)" : "콘텐츠 분석";
        }
      }, 600);
    });
    return { clip_ids: ids };
  },
  async listClips(pid: string): Promise<Clip[]> {
    return Object.values(clips)
      .filter((c) => c.project_id === pid)
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.filename.localeCompare(b.filename));
  },
  async getClip(cid: string): Promise<Clip> {
    return clips[cid] ?? clips["demo-0"];
  },
  async deleteProject(pid: string): Promise<{ ok: boolean }> {
    delete projects[pid];
    Object.keys(clips).forEach((cid) => {
      if (clips[cid].project_id === pid) delete clips[cid];
    });
    return { ok: true };
  },
  async deleteClip(cid: string): Promise<{ ok: boolean }> {
    delete clips[cid];
    return { ok: true };
  },
};
