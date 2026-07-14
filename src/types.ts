// 도메인 타입 — 사이드카 응답 스키마와 1:1

export type SetupItemStatus =
  | "present"
  | "pending"
  | "downloading"
  | "done"
  | "error"
  | "blocked";

export interface SetupItem {
  name: string;
  label: string;
  kind: string;
  status: SetupItemStatus;
  pct: number;
  detail: string;
}

export interface SetupSnapshot {
  installing: boolean;
  all_ready: boolean;
  items: SetupItem[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  shooting_period: string;
  updated_at: number;
  clip_count: number;
}

export interface PlanContext {
  title: string;
  shooting_period: string;
  topic: string;
  characters: string[];
  locations: string[];
  cameras: string[];
  keywords: string[];
  tone_mood: string;
}

export interface Scene {
  time: string;
  desc: string;
  t?: number;       // 장면 시각(초) — 정확한 시크·자막 매핑용
  speech?: string;  // 이 장면 구간([이 장면, 다음 장면))의 음성 자막
}

export type ClipStatus = "queued" | "done" | "error";
export type ScoreColor = "green" | "yellow" | "red";

export interface Clip {
  id: string;
  project_id: string;
  filename: string;
  filepath: string;
  status: ClipStatus;
  stage: string;
  progress: number;
  error?: string;

  thumbnail?: string;
  frames?: string[];          // 호버 스크럽용 키프레임 경로(서버 보관)
  frame_times?: number[];     // 각 키프레임의 실제 시각(초)
  duration_sec?: number;
  date?: string;
  place?: string;
  camera?: string;
  people?: string[];
  one_line?: string;
  summary?: string;
  scenes?: Scene[];
  keywords?: string[];
  ai_comment?: string;
  has_speech?: boolean;
  transcript?: string;
  transcript_segments?: { start: number; end: number; text: string }[];
  scene_descriptions?: string[];
  focus_score?: number;
  audio_rms_dbfs?: number;
  relevance?: number;
  narrative?: number;
  warnings?: string[];       // 기술품질 경고(초점 나감·너무 짧음·화면 거의 안 보임 등). 점수와 무관, 참고용.
  recommendation?: number;
  color?: ScoreColor;
}
