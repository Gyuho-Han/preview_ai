# Preview AI

다큐팀용 **로컬** 영상 분석·프리뷰 노트 자동화 데스크탑 앱.
영상 폴더를 지정하면 그 안의 영상을 **복사 없이 경로로** 읽어 자막·장면 설명·키워드·추천도를 뽑아 스프레드시트로 정리합니다.
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

1. **전처리** `preprocess.py` — ffprobe 1회로 길이·촬영 날짜·**카메라(제조사·모델)** 조회, ffmpeg로 16kHz wav 추출. 영상 디코드는 **필름스트립(저해상도 1fps) 1회가 전부**: 그 프레임으로 장면 전환을 검출하고, 선택된 시각만 풀해상도로 시크해 키프레임 추출 + 초점(라플라시안) 측정 (기존 3회 디코드 → 1회)
2. **VAD** `vad.py` — **Silero VAD**(ONNX, 오프라인)로 오디오에서 '말소리 구간'만 골라냄. RMS 음량은 값싼 1차 필터로만 사용. 바람·엔진·음악 같은 비음성 소음이 ASR에 들어가 중국어 혼입·반복 환각을 일으키던 문제를 원천 차단
3. **STT** `stt.py` — 말소리 구간이 있을 때만 Qwen3-ASR(MLX, `Qwen3-ASR-1.7B-4bit`)로 **구간별로 잘라** 자막 생성(타임스탬프는 구간 시작 시각으로 보정 → 영상 기준 정확). 2차 방어선으로 후처리 필터: 중국어(한자) 덩어리 세그먼트 폐기·한글에 섞인 한자 런 제거(`_filter_chinese`), 단어·n-gram 반복 환각 폐기(`_is_degenerate`), 연속 중복 문장 축약(`_dedupe_segments`)
4. **VLM** `vlm.py` — 키프레임마다 Qwen2.5-VL로 장면 설명 (음성 없는 B롤도 분석). 호출은 키프레임 수(1~8회)만큼만
5. **융합** `llm.py` — Qwen3로 **자막(음성)+시각설명(VLM, 키프레임 시각 포함)+기획서 맥락**(주제·인물·장소·톤앤무드·키워드)을 종합 → 한줄요약·키워드·인물·장소·코멘트 (JSON). 장면 설명에 `[mm:ss]` 시각을 붙여 전달해 LLM이 클립의 **시간 흐름을 따라** 요약을 구성. 요약은 자막·장면의 실제 내용을 근거로 하고, 기획서 맥락은 이 클립이 기획 의도와 어떻게 맞닿는지 해석하는 참고로 사용(인물·장소는 기획서 표기와 대조). 타임스탬프별 장면 목록은 LLM이 아니라 **실제 키프레임 시각**(장면 검출 결과)으로 `analyzer.py`에서 구성 — 상세페이지 타임스탬프가 영상 전체에 걸쳐 정확
6. **추천도** `embed.py` + `scoring.py` — `0.7×연관성(bge-m3 코사인) + 0.3×기술품질(초점+오디오)`
   - 연관성은 코사인 유사도를 **실사용 범위 [0.30, 0.85] 기준으로 0~100에 선형 매핑**(과거 `(cos+1)/2` 방식은 무관한 클립도 65~80점이 나와 변별력이 없었음). 기존 클립은 P3의 "추천도 재계산"으로 갱신
   - 색상: 80%↑ 초록 / 50~79% 노랑 / 49%↓ 빨강
   - 가중치·임계값은 `config.py`에서 조정

RAM을 감지해 모델 티어를 자동 선택합니다(16GB→8b/3b, 24~32GB→14b/7b, 48GB+→30b/7b).

**키프레임 선택(장면 전환 검출)** — VLM은 매 초가 아니라 **장면이 바뀌는 지점**에서만 키프레임을 뽑아
호출합니다. 호버 스크럽용 필름스트립(저해상도 1fps) 프레임의 HSV 히스토그램 Bhattacharyya 거리로 컷을
찾아 각 장면의 중앙 프레임을 대표로 쓰고(**필름스트립을 재사용하므로 장면검출용 추가 디코드 없음**),
장면 수는 `keyframe_min`~`keyframe_max`(기본 1~8)로 제한합니다. 장면이 거의 없으면 균등 간격으로
폴백합니다. 따라서 한 영상당 VLM 호출은 1~8회로, 길이와 무관하게 비용이 통제됩니다.

## 영상 입력 (폴더 경로 방식)

P3에서 **영상 폴더를 지정**하면 사이드카가 그 폴더(하위 폴더 포함)의 영상을 스캔해 **원본을 복사하지 않고
경로 그대로** 분석합니다(대용량 ProRes·MXF에 유리). 이미 분석한 파일은 자동으로 건너뜁니다.

- 앱 모드: "영상 폴더 선택" → 네이티브 폴더 다이얼로그.
- 브라우저 모드: 폴더 경로를 직접 입력(사이드카가 같은 PC에서 읽음).
- 서버: `POST /projects/{pid}/analyze_folder` (`{folder, recursive}`), 대상 확장자 mp4·mov·mxf·m4v·avi·mts·m2ts·mkv.

## 영상 미리보기 · 재생

- **표(P4) 호버 미리보기** — 썸네일에 마우스를 올리면 **자동으로 재생**됩니다(플립북). 칸 아래
  스크럽 바를 **클릭/드래그하면 그 시간으로 이동**(자동재생 일시정지 + 현재 시각 표시). 분석 때
  **1초당 1프레임** 필름스트립을 ffmpeg로 따로 추출(VLM 키프레임과 별개)해 쓰므로 **영상 복사·실제
  재생 없이, 모든 코덱(ProRes 포함)** 에서 동작합니다. 간격은 `models.config`의
  `[preprocess] scrub_interval`(기본 1초)로 조절. 코드: `src/components/ThumbScrub.tsx` ·
  `preprocess.extract_filmstrip` · 서버 `GET /clips/{cid}/frame/{idx}`.
- **상세(P5) 실제 재생 + 오디오** — 어떤 코덱이든 웹 재생용 H.264+AAC로 **온디맨드 변환**(처음 열 때 1회,
  이후 캐시)해 재생합니다. 시크바로 앞뒤 이동, **타임스탬프 클릭 시 그 지점부터 재생**.
  코드: 서버 `GET /clips/{cid}/preview`(변환 상태)·`GET /video/{cid}`(Range 스트리밍), `src/pages/ClipDetail.tsx`.
  변환본은 `~/Library/Application Support/preview-ai/previews/`에 캐시되며, 원본은 건드리지 않습니다.

> 호버 스크럽은 분석 시 보관한 키프레임이 필요하므로, 이 기능 추가 전에 분석된 옛 클립은 **재분석**해야
> 프레임이 채워집니다(상세 재생은 원본 경로만 있으면 옛 클립도 동작).

## 모델 설정 (`models.config`)

프로젝트 루트의 `models.config`(TOML) 한 곳에서 모델·추천도 가중치·임계값을 바꿉니다.
수정 후 **앱(또는 사이드카)을 재시작**하면 적용됩니다.

```toml
[models]
llm   = "qwen3:8b"        # ""로 비우면 RAM 용량에 맞춰 자동 선택
vlm   = "qwen2.5vl:3b"
embed = "bge-m3"
asr   = "mlx-community/Qwen3-ASR-1.7B-4bit"   # 8bit(2.4GB)·0.6B-4bit(0.5GB)로 교체 가능

[scoring]
weight_relevance = 0.7
weight_quality   = 0.3
threshold_green  = 80
threshold_yellow = 50

[preprocess]
scene_detect     = true   # false면 균등 간격 샘플링
scene_threshold  = 0.5    # 낮을수록 컷을 더 민감하게 잡음
keyframe_min     = 1
keyframe_max     = 8
vad_threshold        = 0.5   # Silero VAD 말소리 판정 확률(높일수록 보수적)
vad_min_total_speech = 0.6   # 말소리로 인정할 최소 총량(초)
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

> 기존 환경을 쓰고 있다면 VAD 의존성만 추가로: `pip install pysilero-vad` (Silero VAD, ONNX·오프라인)

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
- **Python 사이드카**: conda `preview` 환경의 python으로 `server.py`를 자동 실행.
  이전 dev 세션이 남긴 사이드카(8765 점유 orphan)는 PID 기록으로 **자동 정리 후 새로 실행**한다.
  외부에서 수동으로 띄운 사이드카(8765)가 있으면 그건 그대로 재사용한다.

> dev를 터미널에서 `Ctrl+C`로 끄면 Rust 부모만 종료되고 사이드카가 잠깐 남을 수 있는데, 다음
> `npm run tauri:dev` 때 자동으로 정리된다. 수동 즉시 정리: `lsof -ti:8765 | xargs kill -9`

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

### 모델 다운로드가 느릴 때

기본 ASR은 `Qwen3-ASR-1.7B-4bit`(약 1.2GB)입니다. 최초 1회만 받으면 캐시되어 이후엔 즉시 로드됩니다.

- **모델 교체**: `models.config`의 `[models] asr` 값을 바꾸면 됩니다.
  - `mlx-community/Qwen3-ASR-1.7B-4bit` (기본, 약 1.2GB, 정확도≈8bit)
  - `mlx-community/Qwen3-ASR-1.7B-8bit` (약 2.4GB, 최고 정확도)
  - `mlx-community/Qwen3-ASR-0.6B-4bit` (약 0.5GB, 가장 빠름·가벼움)
  바꾼 뒤 사이드카(앱)를 재시작하면 새 모델만 받습니다.
- **다운로더**: 기본은 안정적인 표준 다운로더(진행률이 꾸준히 갱신)를 씁니다. `hf_transfer`(병렬·러스트
  기반)는 더 빠를 수 있으나 일부 네트워크에서 **0%에 멈추는 문제**가 있어 기본은 꺼져 있습니다.
  안정적인 회선에서 쓰려면 `PREVIEW_FAST_DOWNLOAD=1 npm run tauri:dev`로 명시적으로 켜세요.

### 분석(음성 인식)이 느릴 때

음성 인식(Qwen3-ASR, MLX)이 보통 가장 무거운 단계입니다.

- **MLX는 GPU 1개를 쓰므로 STT 추론은 직렬화**됩니다(`stt.py`의 `_infer_lock`). 여러 클립이 동시에
  STT를 호출해 경합하는 걸 막아 전체 처리량이 오히려 올라갑니다(VLM 등 다른 단계는 계속 병렬).
- **더 작은 ASR 모델**로 바꾸면 클립당 속도가 크게 빨라집니다(위 모델 교체 참고. `0.6B-4bit` 권장).
- 드론 B롤처럼 대사가 없는 클립은 **Silero VAD**(`vad.py`)가 말소리 없음으로 판정해 STT를 아예
  건너뜁니다(속도·환각 모두 개선). 말소리가 있는 클립도 **말소리 구간만 잘라** 인식하므로 소음
  구간에서 생기던 반복·중국어 환각이 원천 차단됩니다.
- 그래도 새는 환각은 2차 텍스트 필터가 정리합니다: 중국어(한자) 덩어리 폐기·한자 런 제거
  (`_filter_chinese`), 단어·n-gram 반복 폐기(`_is_degenerate`), 연속 중복 문장 축약
  (`_dedupe_segments`). 필터 후 내용이 없으면 '음성 없음'으로 처리 → VLM 장면 설명이 커버.
- LLM/VLM은 `keep_alive=30m`으로 유지되어 클립 배치 분석 중 모델 재로드가 없습니다.

**여러 영상 동시 처리** — 사이드카는 `[runtime] concurrency`개 클립을 동시에 분석합니다(0=RAM 자동:
16GB→1, 24~32GB→2, 48GB+→3). 모델 추론(ASR/VLM/LLM)은 GPU 하나를 공유해 직렬화되므로 N배가 되진
않지만, 한 클립이 추론하는 동안 다른 클립의 **CPU 전처리(ffmpeg·키프레임·장면검출)가 겹쳐** 빨라집니다.
특히 16GB 기본값(1)은 겹침이 없으니 `models.config`에서 `concurrency = 2`로 올리면 효과가 큽니다.
단, 너무 높이면(4↑) Ollama가 모델을 자주 바꿔(로드/언로드) 오히려 느려질 수 있어 2~3 권장.

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
> MLX는 Apple Silicon 전용입니다.

### 설치 시 "손상되었기 때문에 열 수 없습니다" 해결

Apple Silicon은 서명·공증이 없는 앱을 다운로드해 실행하면 "손상되었기 때문에 열 수 없습니다"로
차단합니다(파일이 깨진 게 아니라 Gatekeeper의 격리 차단). 두 경로가 있습니다.

**(A) 무료 — 팀 내부 테스트 배포**
받는 사람이 설치 후 한 번만 격리 속성을 제거하면 바로 실행됩니다:

```bash
xattr -cr "/Applications/Preview AI.app"
```

(선택) 우클릭→"열기"가 되게 하려면 빌드한 쪽에서 ad-hoc 서명을 직접 적용할 수도 있습니다.
단, Tauri 내장 자동 ad-hoc 서명(`signingIdentity = "-"`)은 외곽 `.app` 서명에서 실패할 수 있어
빌드가 막히므로, 필요 시 빌드 후 수동 적용을 권장합니다:

```bash
codesign --force --deep -s - "src-tauri/target/release/bundle/macos/Preview AI.app"
```

**(B) 정식 — 외부 배포**
Apple Developer 계정(연 $99)으로 Developer ID 서명 + 공증(notarization)을 적용하면 위 과정 없이
바로 실행됩니다. `tauri.conf.json`의 `bundle.macOS.signingIdentity`를 "Developer ID Application: …"으로
설정하고, 빌드 시 `APPLE_ID`·`APPLE_PASSWORD`(앱 암호)·`APPLE_TEAM_ID` 환경변수로 공증을 켭니다.

## 개발 우선순위 (MVP)

1. ✅ 영상 → Qwen3-ASR/VLM → 표 자동 완성 (수직 슬라이스)
2. ✅ 기획안 업로드 + 추천도 계산
3. ✅ 필터 · 상세페이지

추후 사이클: Twelve Labs(드라마틱 지수), NLE 직접 연동, 자연어 검색, 웹 전환.

dmg 파일 링크
https://drive.google.com/file/d/1X8qLTUSMHWGVoJY9d7FbEExsCRnBe4S7/view?usp=drive_link

