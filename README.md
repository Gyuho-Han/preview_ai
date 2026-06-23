# Preview AI

다큐팀용 **로컬** 영상 분석·프리뷰 노트 자동화 데스크탑 앱.
영상을 업로드하면 자동으로 자막·장면 설명·키워드·추천도를 뽑아 스프레드시트로 정리합니다.
영상은 외부로 전송되지 않습니다 (모델 전부 로컬 실행).

> 환경: macOS (Apple Silicon) · Tauri · 로컬 모델만(Ollama / MLX)
> 상세 설계: `../Preview-AI_MVP_모델·파이프라인_추천.md`

## 아키텍처

```
Tauri 프론트(React)  ──invoke──▶  Rust 코어  ──HTTP:8765──▶  Python 사이드카  ──11434──▶  Ollama
  P1~P5 UI                        커맨드 프록시              ffmpeg·Whisper·VLM·임베딩      Qwen3·Qwen2.5-VL·bge-m3
```

UI와 분석 로직이 분리돼 있어(개발자 지침) 추후 웹 전환 시 사이드카를 그대로 재사용할 수 있습니다.

| 레이어 | 위치 | 역할 |
|---|---|---|
| 프론트 | `src/` | P1 홈 · P2 생성 · P3 기본 · P4 표 · P5 상세 |
| Rust 코어 | `src-tauri/` | 사이드카 수명 관리 + 커맨드 프록시 |
| 분석 워커 | `python-sidecar/` | 베스트 파이프라인 전 단계 |

## 분석 파이프라인 (`python-sidecar/analyzer.py`)

1. **전처리** `preprocess.py` — ffmpeg로 16kHz wav 추출 + 음성 유무 감지, OpenCV로 키프레임 N장 + 초점(라플라시안) 측정
2. **STT** `stt.py` — 음성이 있을 때만 MLX Whisper(`whisper-large-v3-turbo`)로 자막+타임스탬프
3. **VLM** `vlm.py` — 모든 영상에 Qwen2.5-VL로 키프레임 장면 설명 (음성 없는 B롤도 분석)
4. **융합** `llm.py` — Qwen3로 자막+시각설명 → 한줄요약·장면목록·키워드·인물 (JSON)
5. **추천도** `embed.py` + `scoring.py` — `0.7×연관성(bge-m3 코사인) + 0.3×기술품질(초점+오디오)`
   - 색상: 80%↑ 초록 / 50~79% 노랑 / 49%↓ 빨강
   - 가중치·임계값은 `config.py`에서 조정

RAM을 감지해 모델 티어를 자동 선택합니다(16GB→8b/3b, 24~32GB→14b/7b, 48GB+→30b/7b).

## 사전 준비

```bash
# 1) 시스템 도구
brew install ffmpeg ollama
ollama serve            # 별도 터미널에서 데몬 실행

# 2) 로컬 모델 받기 (RAM에 맞게)
ollama pull qwen3:8b        # 또는 qwen3:14b / qwen3:30b
ollama pull qwen2.5vl:3b    # 또는 qwen2.5vl:7b
ollama pull bge-m3

# 3) Python 사이드카
cd python-sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## 개발 실행

```bash
npm install

# 방법 A — UI만 빠르게 미리보기 (사이드카 없이 목 데이터로 P1~P5 흐름 확인)
npm run dev                 # http://localhost:1420  → 우상단 "데모 모드"

# 방법 B — 사이드카 붙여 실제 분석
npm run sidecar:dev         # 터미널 1: uvicorn :8765
npm run dev                 # 터미널 2: 브라우저에서 실제 분석 호출

# 방법 C — 데스크탑 앱 (Rust 빌드 필요)
npm run tauri:dev
```

> 방법 A는 Tauri/사이드카/Ollama 설치 전에도 화면 전체를 둘러볼 수 있게 `src/mock.ts`가
> 분석 진행률까지 시뮬레이션합니다.

## 배포 빌드

```bash
# 사이드카를 단일 실행파일로 번들 (PyInstaller)
cd python-sidecar
pyinstaller --onefile --name preview-sidecar server.py
# 결과물을 Tauri가 기대하는 이름으로 복사 (target triple 접미사 필수)
mkdir -p ../src-tauri/bin
cp dist/preview-sidecar ../src-tauri/bin/preview-sidecar-aarch64-apple-darwin

# 앱 빌드 (.app / .dmg)
cd ..
npm run tauri:build
```

`src-tauri/icons/icon.icns`는 아직 비어 있습니다 — `npm run tauri icon path/to/logo.png`로 생성하세요.

## 개발 우선순위 (MVP)

1. ✅ 영상 → Whisper/VLM → 표 자동 완성 (수직 슬라이스)
2. ✅ 기획안 업로드 + 추천도 계산
3. ✅ 필터 · 상세페이지

추후 사이클: Twelve Labs(드라마틱 지수), NLE 직접 연동, 자연어 검색, 웹 전환.
