// 목 데이터 — 사이드카/Tauri 없이 `npm run dev`로 UI 흐름 전체를 미리보기.
// 데모 프로젝트에는 날짜·장소가 다양하게 클러스터링된 클립을 미리 심어두어,
// 표의 날짜 섹션 + 장소 병합 + 추천도 분포를 데이터 없이도 바로 확인할 수 있다.

import type { Clip, LabelStatus, PlanContext, ProjectSummary, Scene, TierLabel } from "./types";

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
  shot_time?: string;      // HH:MM 24시간제
  lens?: string;
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

// ---- 데모 시드 생성기 — 8일 × 하루 11~15개 = 총 100개 ----
// 손으로 쓴 장소별 씬 템플릿을 하루 촬영 흐름(장소 블록)에 맞춰 순환 배치해,
// 날짜 안에서 장소가 연속으로 묶이도록(실제 촬영 흐름 모사) 만든다.
// 시드 고정 PRNG라 새로고침해도 늘 같은 데이터가 나온다.
let _seed = 20260501;
function rnd(): number {
  _seed = (_seed * 1103515245 + 12345) % 2147483648;
  return _seed / 2147483648;
}
const between = (lo: number, hi: number) => lo + Math.round(rnd() * (hi - lo));

interface Tpl {
  people: string[];
  camera?: string; // 미지정이면 FX3 위주로 랜덤
  line: string;
  rel: [number, number];
  nar: [number, number];
  speech?: string;
  kw: string[];
}

const TPL: Record<string, Tpl[]> = {
  "블렌타이어 숙소": [
    { people: ["김씨 가족"], line: "아침 햇살 속 거실에서 하루를 시작하는 가족", rel: [68, 80], nar: [58, 72], speech: "오늘은 날씨가 좀 개려나?", kw: ["일상", "아침", "가족"] },
    { people: ["김씨 가족"], line: "짐을 정리하며 한국에서 가져온 물건을 꺼내 보는 장면", rel: [75, 88], nar: [70, 84], speech: "이거 챙겨오길 잘했다, 그치?", kw: ["이주", "향수", "가족"] },
    { people: [], line: "창밖 흐린 하늘과 빗방울 맺힌 유리창 인서트", rel: [45, 60], nar: [32, 48], kw: ["인서트", "날씨", "스코틀랜드"] },
    { people: ["김씨 가족"], line: "거실 소파에서 다음 일정을 의논하는 가족", rel: [62, 76], nar: [55, 70], speech: "내일은 기차 타고 나가볼까?", kw: ["가족", "대화", "계획"] },
    { people: [], camera: "DJI", line: "숙소 외관과 마을을 함께 담은 드론 부감", rel: [55, 70], nar: [45, 60], kw: ["드론", "숙소", "전경"] },
    { people: ["김씨 가족"], line: "아이들이 마당에서 뛰어노는 모습", rel: [70, 84], nar: [64, 80], kw: ["아이", "놀이", "일상"] },
    { people: ["김씨 가족"], line: "하루를 마치고 소감을 나누는 저녁 인터뷰", rel: [82, 94], nar: [78, 90], speech: "처음엔 낯설었는데 이제 좀 집 같아요.", kw: ["인터뷰", "적응", "가족"] },
    { people: [], line: "현관에 나란히 놓인 가족 신발 클로즈업", rel: [50, 64], nar: [42, 58], kw: ["인서트", "디테일", "가족"] },
  ],
  "마을 거리": [
    { people: ["김씨 가족"], line: "장 보러 가는 길, 마을 거리를 걷는 가족", rel: [68, 82], nar: [60, 74], speech: "저기 가게 새로 생겼네.", kw: ["산책", "마을", "일상"] },
    { people: ["현지 이웃"], line: "단골 상점 주인과 안부를 나누는 장면", rel: [72, 86], nar: [66, 80], speech: "Morning! 오늘도 왔네요.", kw: ["이웃", "교류", "상점"] },
    { people: [], camera: "DJI", line: "마을 중심가를 가로지르는 드론 트래킹샷", rel: [55, 70], nar: [46, 60], kw: ["드론", "마을", "전경"] },
    { people: ["김씨 가족"], line: "버스 정류장에서 시간표를 확인하는 가족", rel: [58, 72], nar: [50, 64], kw: ["이동", "마을", "일상"] },
    { people: [], line: "돌담과 이끼 낀 골목 풍경 인서트", rel: [46, 60], nar: [36, 50], kw: ["인서트", "골목", "풍경"] },
    { people: ["김씨 가족", "현지 이웃"], line: "길에서 만난 이웃과 서툰 영어로 대화하는 가족", rel: [78, 90], nar: [72, 86], speech: "We just moved here… 아, 뭐라 하지?", kw: ["교류", "언어", "유머"] },
    { people: [], line: "우체국 앞 붉은 우체통과 오가는 사람들", rel: [44, 58], nar: [34, 48], kw: ["인서트", "마을", "일상"] },
    { people: ["김씨 가족"], line: "비 오는 거리를 우산 하나로 함께 걷는 가족", rel: [74, 88], nar: [70, 84], kw: ["비", "가족", "정서"] },
  ],
  "기차역": [
    { people: ["김씨 가족"], line: "플랫폼에서 열차를 기다리며 노선도를 살피는 가족", rel: [64, 78], nar: [56, 70], speech: "글래스고행이 이거 맞지?", kw: ["기차역", "이동", "가족"] },
    { people: [], line: "도착하는 열차와 플랫폼 풍경 인서트", rel: [48, 62], nar: [38, 52], kw: ["기차", "인서트"] },
    { people: ["김씨 가족"], line: "차창 밖 풍경을 바라보는 아이의 옆모습", rel: [72, 86], nar: [68, 82], kw: ["기차", "아이", "정서"] },
    { people: [], line: "낡은 역사 간판과 시계탑 디테일", rel: [45, 58], nar: [35, 48], kw: ["인서트", "역", "디테일"] },
    { people: ["김씨 가족"], line: "개찰구를 빠져나오며 목적지를 정하는 가족", rel: [60, 74], nar: [52, 66], speech: "이제 어디부터 가볼까?", kw: ["이동", "가족", "여정"] },
    { people: [], camera: "DJI", line: "역을 떠나는 열차를 담은 드론 팔로우샷", rel: [54, 68], nar: [46, 60], kw: ["드론", "기차", "전경"] },
  ],
  "부엌": [
    { people: ["김씨 가족"], line: "어머니가 저녁을 준비하며 고향 음식 이야기를 하는 장면", rel: [84, 95], nar: [78, 90], speech: "여기 재료로도 얼추 비슷하게 되네.", kw: ["요리", "향수", "어머니"] },
    { people: [], line: "끓는 냄비와 피어오르는 김 클로즈업", rel: [46, 60], nar: [38, 52], kw: ["인서트", "요리"] },
    { people: ["김씨 가족"], line: "온 가족이 식탁에 둘러앉아 저녁을 먹는 장면", rel: [85, 95], nar: [80, 92], speech: "다 같이 먹으니까 진짜 좋다.", kw: ["가족", "식사", "일상"] },
    { people: ["김씨 가족"], line: "아이들이 설거지를 돕겠다며 나서는 장면", rel: [66, 80], nar: [60, 76], speech: "내가 할래! 아니 내가!", kw: ["아이", "유머", "일상"] },
    { people: [], line: "찬장에 정리된 한국 양념들 인서트", rel: [52, 66], nar: [42, 56], kw: ["인서트", "디테일", "향수"] },
    { people: ["김씨 가족"], line: "라면을 끓이며 한국 맛이 그립다고 말하는 장면", rel: [80, 92], nar: [74, 88], speech: "역시 이 맛이지. 한국 생각난다.", kw: ["라면", "향수", "가족"] },
    { people: ["김씨 가족", "현지 이웃"], line: "이웃을 초대해 한식을 대접하는 저녁", rel: [82, 94], nar: [78, 92], speech: "Try this — 김치예요, 맵지 않아요.", kw: ["교류", "한식", "이웃"] },
  ],
  "언덕": [
    { people: [], camera: "DJI", line: "해질녘 언덕에서 마을을 내려다보는 드론 부감", rel: [70, 84], nar: [62, 76], kw: ["드론", "노을", "전경"] },
    { people: ["김씨 가족"], line: "언덕 위에 나란히 앉아 이야기를 나누는 가족", rel: [80, 92], nar: [76, 90], speech: "여기 오길 잘한 것 같아.", kw: ["가족", "대화", "정서"] },
    { people: [], line: "바람에 흔들리는 들풀과 양떼 인서트", rel: [50, 64], nar: [40, 54], kw: ["인서트", "자연", "양"] },
    { people: ["김씨 가족"], line: "언덕길을 오르며 숨을 고르는 가족의 뒷모습", rel: [64, 78], nar: [58, 72], kw: ["산책", "가족", "여정"] },
    { people: [], camera: "DJI", line: "구름 그림자가 지나가는 초원을 담은 타임랩스풍 샷", rel: [54, 68], nar: [44, 58], kw: ["드론", "자연", "B롤"] },
  ],
};

// 하루 촬영 계획 — 블록 합계가 곧 그날 클립 수. 전체 합 100개.
const DAY_PLANS: { date: string; blocks: [string, number][] }[] = [
  { date: "2026-05-01", blocks: [["블렌타이어 숙소", 6], ["마을 거리", 5], ["부엌", 4]] },   // 15
  { date: "2026-05-02", blocks: [["마을 거리", 5], ["기차역", 4], ["블렌타이어 숙소", 3]] }, // 12
  { date: "2026-05-03", blocks: [["기차역", 4], ["마을 거리", 5], ["부엌", 4]] },            // 13
  { date: "2026-05-05", blocks: [["부엌", 5], ["블렌타이어 숙소", 3], ["언덕", 3]] },        // 11
  { date: "2026-05-07", blocks: [["부엌", 6], ["마을 거리", 4], ["블렌타이어 숙소", 4]] },   // 14
  { date: "2026-05-12", blocks: [["언덕", 5], ["마을 거리", 4], ["기차역", 3]] },            // 12
  { date: "2026-05-15", blocks: [["마을 거리", 4], ["부엌", 4], ["언덕", 4]] },              // 12
  { date: "2026-05-20", blocks: [["블렌타이어 숙소", 5], ["부엌", 4], ["언덕", 2]] },        // 11
];

// 같은 템플릿이 다시 나올 때 붙는 변형 꼬리표 — 재촬영·보충 촬영 흐름 모사
const VARIANTS = ["", " — 다른 앵글", " — 클로즈업 위주", " (테이크 2)", " (테이크 3)"];

const DEMO_SPECS: Spec[] = [];
{
  const used: Record<string, number> = {}; // 장소별 템플릿 소비 수 → 순환 + 변형 번호
  for (const day of DAY_PLANS) {
    let minutes = 9 * 60 + between(0, 40); // 하루 촬영은 09시대 시작
    for (const [place, count] of day.blocks) {
      const pool = TPL[place];
      for (let k = 0; k < count; k++) {
        const n = used[place] ?? 0;
        used[place] = n + 1;
        const t = pool[n % pool.length];
        const variant = VARIANTS[Math.min(Math.floor(n / pool.length), VARIANTS.length - 1)];
        minutes += between(6, 28);
        const warn = rnd() < 0.06 ? (rnd() < 0.5 ? ["초점 나감"] : ["너무 짧음"]) : undefined;
        DEMO_SPECS.push({
          date: day.date,
          place,
          camera: t.camera ?? (rnd() < 0.2 ? "DJI" : "FX3"),
          shot_time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
          people: t.people,
          one_line: `${t.line}${variant}`,
          relevance: between(t.rel[0], t.rel[1]),
          narrative: between(t.nar[0], t.nar[1]),
          has_speech: !!t.speech,
          transcript: t.speech,
          warnings: warn,
          focus: warn?.[0] === "초점 나감" ? between(20, 35) : undefined,
          dur: warn?.[0] === "너무 짧음" ? between(4, 8) : undefined,
          keywords: t.kw,
        });
      }
    }
  }
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const REACTIONS = [
  "응, 그러네… 여기 진짜 좋다.",
  "그러게, 생각보다 훨씬 낫다.",
  "우리 잘 온 것 같아.",
  "이 순간 꼭 담아두자.",
  "따뜻하다… 그치?",
];

// 데모 영상 내용 — 스탬프는 최소로. 음성 클립은 대사(자막) 흐름이 내용의 대부분이 되게 한다.
function makeScenes(spec: Spec, dur: number): Scene[] {
  const has = spec.has_speech && !!spec.transcript;
  const subj = spec.people.length
    ? spec.people.join("·")
    : (spec.keywords?.find((k) => !["인서트", "드론", "B롤"].includes(k)) ?? "대상");
  const at = (f: number) => Math.max(0, Math.round(dur * f));
  const out: Scene[] = [];
  out.push({ time: mmss(at(0.05)), t: at(0.05), desc: `${spec.place}에서 장면이 열리며 ${subj}을(를) 비춘다.` });
  if (has) {
    // desc 없이 speech만 있는 비트 = 대사 라인(자막처럼 주 콘텐츠로 표시)
    out.push({ time: mmss(at(0.38)), t: at(0.38), desc: "", speech: spec.transcript });
    out.push({ time: mmss(at(0.64)), t: at(0.64), desc: "", speech: REACTIONS[spec.one_line.length % REACTIONS.length] });
  } else {
    out.push({ time: mmss(at(0.45)), t: at(0.45), desc: `${spec.one_line}. 소리 없이 화면 구성만으로 전달되는 핵심 구간이다.` });
  }
  out.push({ time: mmss(at(0.92)), t: at(0.92), desc: "여운을 남기며 다음 컷으로 자연스럽게 연결된다." });
  return out;
}

let clipSeq = 0;
function makeClip(spec: Spec, id: string, project_id: string): Clip {
  const { rec, color } = scoreOf(spec.relevance, spec.narrative);
  const n = ++clipSeq;
  const dur = spec.dur ?? 24 + (n % 6) * 13;
  return {
    id,
    project_id,
    filename: `A${String(n).padStart(3, "0")}_C${String(n).padStart(3, "0")}.MOV`,
    filepath: `/Volumes/SSD/footage/${spec.date}/A${String(n).padStart(3, "0")}.MOV`,
    status: "done",
    stage: "완료",
    progress: 100,
    duration_sec: dur,
    date: spec.date,
    place: spec.place,
    camera: spec.camera,
    shot_time: spec.shot_time ?? "14:30",
    lens: spec.lens ?? (spec.camera === "DJI" ? "24mm F/2.8" : "24-70mm F/2.8"),
    resolution: spec.camera === "DJI" ? "4K" : "6K",
    fps: spec.camera === "DJI" ? 30 : 24,
    people: spec.people,
    // 대상(Object): 인물이 있으면 인물, 없으면 이 컷의 주된 사물·풍경(일반 키워드 제외)
    subject: spec.people.length
      ? spec.people.join(", ")
      : (spec.keywords?.find((k) => !["인서트", "드론", "B롤"].includes(k)) ?? "장면"),
    one_line: spec.one_line,
    summary: `${spec.one_line}. 자막과 키프레임 시각 설명을 융합해 생성된 요약이 여기에 표시됩니다. ${spec.has_speech ? "대화가 있어 맥락 파악이 쉬운 편입니다." : "음성이 없어 화면 설명(VLM) 기반으로 분석했습니다."}`,
    scenes: makeScenes(spec, dur),
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
    // clip id는 전체 clips 개수 기준으로 유니크하게 뽑되(demo 프리시드와 안 겹치게),
    // spec 선택은 이번 업로드 배치 내 순번(idx)만으로 순환시켜 데모 클립 개수에 영향받지 않게 한다.
    const base = Object.keys(clips).length;
    paths.forEach((path, idx) => {
      const id = `clip-${base + idx}`;
      const spec = DEMO_SPECS[idx % DEMO_SPECS.length];
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

  // ---- 수기 분류(상/중/하) — 백엔드(labeling.py) 흐름을 데모용으로 모사 ----
  // 20개를 채우면 "학습된 것처럼" 미라벨 클립에 제안(ai_label)을 채워
  // 사이드카 없이도 라벨→활성→제안 전환 UX를 그대로 시연할 수 있다.
  async setClipLabel(cid: string, label: TierLabel | null): Promise<{ ok: boolean; n_labels: number; ai_active: boolean }> {
    const c = clips[cid];
    if (!c) return { ok: false, n_labels: 0, ai_active: false };
    if (label) {
      c.user_label = label;
      delete c.ai_label;
      delete c.ai_label_conf;
    } else {
      delete c.user_label;
    }
    const done = Object.values(clips).filter((k) => k.project_id === c.project_id && k.status === "done");
    const n = done.filter((k) => k.user_label).length;
    const active = n >= 20;
    done.forEach((k) => {
      if (active && !k.user_label) {
        const s = k.recommendation ?? 0;
        k.ai_label = s >= 80 ? "high" : s >= 50 ? "mid" : "low";
        k.ai_label_conf = 0.7;
      } else if (!k.user_label) {
        delete k.ai_label;
        delete k.ai_label_conf;
      }
    });
    return { ok: true, n_labels: n, ai_active: active };
  },
  async labelStatus(pid: string): Promise<LabelStatus> {
    const done = Object.values(clips).filter((k) => k.project_id === pid && k.status === "done");
    const n = done.filter((k) => k.user_label).length;
    const active = n >= 20;
    return {
      n_labels: n,
      needed: 20,
      ai_active: active,
      inherited: false,
      w_relevance: active ? 0.6 : null,
      loo_acc: null,
    };
  },
};
