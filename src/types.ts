// 도메인 타입 — 사이드카 응답 스키마와 1:1

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
  quality?: number;
  recommendation?: number;
  color?: ScoreColor;
}
