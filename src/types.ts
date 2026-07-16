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

// 수기 분류 라벨 — 상(high)/중(mid)/하(low). 백엔드 labeling.py와 동일 문자열.
export type TierLabel = "high" | "mid" | "low";

// GET /projects/{pid}/label_status — 표 툴바 진행 칩용
export interface LabelStatus {
  n_labels: number;
  needed: number;
  ai_active: boolean;
  inherited: boolean;          // 자체 학습 전, 이전 프로젝트 취향(시드)을 승계 중
  w_relevance: number | null;  // 학습된 연관성 가중치(취향 해석용)
  loo_acc: number | null;      // leave-one-out 일치도(0~1)
}

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
  shot_time?: string;       // 촬영 시각(HH:MM 24시간제) — 사이드카 메타데이터 연동 예정
  lens?: string;            // 사용 렌즈(예: "24-70mm F/2.8") — 사이드카 메타데이터 연동 예정
  resolution?: string;      // 촬영 해상도(예: "4K", "1920x1080") — 사이드카 메타데이터 연동 예정
  fps?: number;             // 촬영 프레임레이트 — 사이드카 메타데이터 연동 예정
  people?: string[];
  subject?: string;        // 대상(Object) — 이 컷의 주인공: 인물이면 인물, 아니면 사물·풍경 등
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

  // 수기 분류 + AI 제안 (백엔드 영속, 학습 데이터)
  user_label?: TierLabel;    // 사용자가 직접 찍은 상/중/하
  ai_label?: TierLabel;      // 미라벨 클립에 대한 개인화 모델 제안(20개 학습 후)
  ai_label_conf?: number;    // 제안 확신도 0~1
}
