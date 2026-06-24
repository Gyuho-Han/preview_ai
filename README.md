# Preview AI

다큐팀용 **로컬** 영상 분석·프리뷰 노트 자동화 데스크탑 앱.
영상을 업로드하면 자동으로 자막·장면 설명·키워드·추천도를 뽑아 스프레드시트로 정리합니다.
영상은 외부로 전송되지 않습니다 (모델 전부 로컬 실행).

> 환경: macOS (Apple Silicon) · Tauri · 로컬 모델만(Ollama / MLX)
> 상세 설계: `../Preview-AI_MVP_모델·파이프라인_추천.md`

## 아키텍처

```
Tauri 프론트(React)  ──invoke──▶  Rust 코어  ──HTTP:8765──▶  Python 사이드카  ──11434──▶  Ollama
  P1~P5 UI                        커맨드 프록시              ffmpeg·Qwen3-ASR·VLM·임베딩    Qwen3·Qwen2.5-VL·bge-m3
```

UI와 분석 로직이 분리돼 있어(개발자 지침) 추후 웹 전환 시 사이드카를 그대로 재사용할 수 있습니다.

| 레이어 | 위치 | 역할 |
|---|---|---|
| 프론트 | `src/` | P1 홈 · P2 생성 · P3 기본 · P4 표 · P5 상세 (폰트: Pretendard self-host) |
| Rust 코어 | `src-tauri/` | Ollama·사이드카 자동 실행/정리 + 커맨드 프록시 |
| 분석 워커 | `python-sidecar/` | 베스트 파이프라인 전 단계 |

Rust 코어(`src-tauri/src/sidecar.rs`)가 앱 시작 시 Ollama 서버와 Python 사이드카를
자동으로 띄우고 종료 시 정리합니다. 폰트는 `src/fonts/`에 Pretendard 가변 woff2를
직접 포함(self-host)해 CDN·온라인 없이 동작합니다.

## 분석 파이프라인 (`python-sidecar/analyzer.py`)

1. **전처리** `preprocess.py` — ffmpeg로 16kHz wav 추출 + 음성 유무 감지, OpenCV로 키프레임 N장 + 초점(라플라시안) 측정
2. **STT** `stt.py` — 음성이 있을 때만 Qwen3-ASR(MLX, `Qwen3-ASR-1.7B-8bit`)로 자막 생성
3. **VLM** `vlm.py` — 모든 영상에 Qwen2.5-VL로 키프레임 장면 설명 (음성 없는 B롤도 분석)
4. **융합** `llm.py` — Qwen3로 자막+시각설명 → 한줄요약·장면목록·키워드·인물 (JSON)
5. **추천도** `embed.py` + `scoring.py` — `0.7×연관성(bge-m3 코사인) + 0.3×기술품질(초점+오디오)`
   - 색상: 80%↑ 초록 / 50~79% 노랑 / 49%↓ 빨강
   - 가중치·임계값은 `config.py`에서 조정

RAM을 감지해 모델 티어를 자동 선택합니다(16GB→8b/3b, 24~32GB→14b/7b, 48GB+→30b/7b).

## 모델 설정 (`models.config`)

프로젝트 루트의 `models.config`(TOML) 한 곳에서 모델·추천도 가중치·임계값을 바꿉니다.
수정 후 **앱(또는 사이드카)을 재시작**하면 적용됩니다.

```toml
[models]
llm   = "qwen3:8b"        # ""로 비우면 RAM 용량에 맞춰 자동 선택
vlm   = "qwen2.5vl:3b"
embed = "bge-m3"
asr   = "mlx-community/Qwen3-ASR-1.7B-8bit"

[scoring]
weight_relevance = 0.7
weight_quality   = 0.3
threshold_green  = 80
threshold_yellow = 50
```

우선순위는 **환경변수 > `models.config` > RAM 자동 선택**. 일회성으로 바꿀 땐 환경변수가 편합니다:

```bash
LLM_MODEL=qwen3:14b VLM_MODEL=qwen2.5vl:7b npm run tauri:dev
```

> Python 3.11+는 표준 `tomllib`로 읽어 추가 설치가 없습니다. 3.10 이하라면 `pip install tomli`.

## 사전 준비

```bash
# 1) 시스템 도구 (Ollama 데몬은 앱이 자동 실행하므로 따로 띄울 필요 없음)
brew install ffmpeg ollama

# 2) Python 환경 — conda 환경 이름은 'preview' 권장 (앱이 자동 탐색)
conda create -n preview python=3.11 -y
conda activate preview
cd python-sidecar && pip install -r requirements.txt
```

로컬 모델(`qwen3:8b` · `qwen2.5vl:3b` · `bge-m3` · Qwen3-ASR)은 **미리 받을 필요가 없습니다** —
앱 첫 실행 시 셋업 화면이 없는 것만 자동으로 받습니다(아래 "첫 실행 셋업" 참고).
미리 받고 싶다면 `ollama pull qwen3:8b qwen2.5vl:3b bge-m3`.

## 개발 실행

```bash
npm install

# 데스크탑 앱 — 이 명령 하나로 Ollama·Python 사이드카·UI가 모두 자동 실행됨
npm run tauri:dev
```

`npm run tauri:dev` 는 dev 모드에서 다음을 자동으로 처리한다:

- **Ollama**: 11434에 이미 떠 있으면 재사용, 없으면 시스템 `ollama serve` 자동 실행
- **Python 사이드카**: conda `preview` 환경의 python으로 `server.py`를 자동 실행
  (8765가 이미 떠 있으면 재사용 — uvicorn을 따로 띄울 필요 없음)

> conda 환경이 표준 위치(`~/miniconda3` `~/anaconda3` `~/miniforge3` 등)의 `preview`가 아니면,
> 사이드카가 쓸 python 경로를 환경변수로 지정한다:
> `PREVIEW_PYTHON=/path/to/python npm run tauri:dev`

UI만 빠르게 미리보기(사이드카·Ollama 없이 목 데이터로 P1~P5 흐름 확인):

```bash
npm run dev                 # http://localhost:1420  → 우상단 "데모 모드"
```

> `npm run dev`는 `src/mock.ts`가 분석 진행률까지 시뮬레이션하므로 설치 전에도 화면을 둘러볼 수 있다.

## 첫 실행 셋업 (방법 B — 바이너리 동봉 + 모델은 첫 실행 시 다운로드)

사용자는 **이 앱 하나만 설치**하면 됩니다. Ollama를 따로 깔 필요가 없습니다.

- 앱 시작 시 Rust가 Ollama 서버를 확보합니다(시스템에 있으면 재사용, 없으면 동봉 바이너리 실행).
- 첫 실행 셋업 화면이 의존성을 검사하고 **없는 것만** 내려받습니다:
  - 이미 받은 모델/Qwen3-ASR은 건너뜀 (`ollama list` + HF 캐시 확인)
  - 누락분만 다운로드하며 항목별 + 전체 **진행률(%)**을 표시
- ffmpeg는 앱에 동봉되며, 개발 모드에서 없으면 안내만 표시합니다.

관련 코드: `python-sidecar/setup_deps.py`(검사·설치), `src/pages/Setup.tsx`(진행률 UI),
`src-tauri/src/sidecar.rs`(Ollama 자동 실행). 모델 가중치는 앱에 내장하지 않으므로
설치 파일이 가볍고 공증이 빠릅니다(첫 실행 시 1회 인터넷 필요).

## 배포 빌드

```bash
# 1) 번들 바이너리 준비 (ollama·ffmpeg 복사 + 사이드카 PyInstaller)
bash scripts/prepare-binaries.sh

# 2) 앱 빌드 (.app / .dmg)
npm run tauri:build
```

`scripts/prepare-binaries.sh`는 시스템의 `ollama`/`ffmpeg`를 Tauri가 요구하는
타깃 트리플 이름(`bin/ollama-aarch64-apple-darwin` 등)으로 복사하고, 사이드카를
단일 실행파일로 묶습니다. 동봉 바이너리 목록(`externalBin`)은 `npm run tauri:build`가
빌드 전용 설정 `src-tauri/tauri.bundle.conf.json`을 자동 적용해 주입합니다 —
그래서 `npm run tauri:dev`(개발)에선 이 바이너리들이 필요 없습니다.

> 아이콘은 플레이스홀더가 `src-tauri/icons/`에 포함돼 있습니다(네이비 배경 ▶). 실제 로고로
> 교체하려면 `npm run tauri icon path/to/logo.png` 한 번이면 전체 세트가 생성됩니다.
> MLX는 Apple Silicon 전용이며, 배포하려면 Apple 코드 서명·공증이 필요합니다.

## 개발 우선순위 (MVP)

1. ✅ 영상 → Qwen3-ASR/VLM → 표 자동 완성 (수직 슬라이스)
2. ✅ 기획안 업로드 + 추천도 계산
3. ✅ 필터 · 상세페이지

추후 사이클: Twelve Labs(드라마틱 지수), NLE 직접 연동, 자연어 검색, 웹 전환.
