// 목 데이터 — 사이드카/Tauri 없이 `npm run dev`로 UI 흐름 전체를 미리보기.
// 분석 진행률을 시뮬레이션해 P3 진행바와 P4 실시간 표를 그대로 확인할 수 있다.

import type { Clip, PlanContext, ProjectSummary } from "./types";

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
    locations: ["블렌타이어 숙소", "마을 거리"],
    cameras: ["FX3", "DJI"],
    keywords: ["이주", "가족", "라면", "일상", "향수", "스코틀랜드"],
    tone_mood: "따뜻하고 잔잔한",
  },
};

const clips: Record<string, Clip> = {};

function seedClip(i: number): Clip {
  const rec = [92, 74, 38, 81, 56][i % 5];
  const color = rec >= 80 ? "green" : rec >= 50 ? "yellow" : "red";
  return {
    id: `clip-${i}`,
    project_id: "demo",
    filename: `A00${i}_C00${i}.MOV`,
    filepath: `/Volumes/SSD/footage/A00${i}.MOV`,
    status: "done",
    stage: "완료",
    progress: 100,
    duration_sec: 60 + i * 37,
    date: `2026-05-${String(((i * 3) % 20) + 1).padStart(2, "0")}`,
    place: ["블렌타이어 숙소", "마을 거리", "기차역", "부엌", "언덕"][i % 5],
    camera: ["FX3", "DJI", "FX3", "FX3", "DJI"][i % 5],
    people: i % 3 === 0 ? ["김씨 가족"] : [],
    one_line: [
      "숙소에서 가족이 라면을 나눠 먹으며 대화하는 장면",
      "비 내리는 마을 거리를 우산 없이 걷는 인서트",
      "흔들린 핸드헬드 기차역 풍경 (초점 약함)",
      "부엌에서 어머니가 김치를 담그며 고향 이야기를 함",
      "해질녘 언덕에서 마을을 내려다보는 B롤",
    ][i % 5],
    summary: "데모 요약: 자막과 키프레임 시각 설명을 융합해 생성된 3~5줄 요약이 여기에 표시됩니다.",
    scenes: [
      { time: "00:05", desc: "도입 — 인물 등장" },
      { time: "00:42", desc: "핵심 대화/행동" },
    ],
    keywords: ["가족", "라면", "일상", "이주"].slice(0, 2 + (i % 3)),
    ai_comment: "기획안 핵심 키워드와 잘 맞고 초점도 양호. 메인 시퀀스 후보.",
    has_speech: i % 3 !== 2,
    transcript: i % 3 !== 2 ? "엄마 이거 진짜 오랜만이다… 여기서 이렇게 먹으니까 더 맛있네." : "",
    scene_descriptions: ["블렌타이어 숙소에서 여러 명이 식탁에 둘러앉아 라면을 먹는 장면."],
    focus_score: [88, 72, 30, 85, 79][i % 5],
    audio_rms_dbfs: i % 3 !== 2 ? -22 : -99,
    relevance: [95, 76, 40, 83, 58][i % 5],
    quality: [85, 70, 33, 78, 80][i % 5],
    recommendation: rec,
    color,
  };
}

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
  async analyzeVideos(_pid: string, paths: string[]): Promise<{ clip_ids: string[] }> {
    const ids: string[] = [];
    paths.forEach((path, idx) => {
      const id = `clip-${Object.keys(clips).length + idx}`;
      const i = Object.keys(clips).length + idx;
      clips[id] = {
        id,
        project_id: "demo",
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
          clips[id] = { ...seedClip(i), id, status: "done" };
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
      .filter((c) => c.project_id === pid || pid === "demo")
      .sort((a, b) => a.filename.localeCompare(b.filename));
  },
  async getClip(cid: string): Promise<Clip> {
    return clips[cid] ?? seedClip(0);
  },
};
