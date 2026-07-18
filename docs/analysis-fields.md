# AI 분석 필드 기준 문서

preview_ai가 클립마다 생성하는 AI 분석 필드(영상요약, 핵심키워드, 영상내용, 영상개요 등)의
**목적·작성 기준·근거·프롬프트 설계 원칙**을 정의한다.
프롬프트(`python-sidecar/llm.py`)는 이 문서의 기준을 그대로 구현해야 하며,
기준을 바꿀 때는 문서와 프롬프트를 함께 수정한다.

---

## 1. 영상요약 (`summary`)

상세 페이지(`ClipDetail.tsx`)의 "영상 요약" 섹션에 표시되는 필드.
표 페이지의 "한줄요약"(`one_line`)과는 별개 필드로, 한줄요약이 "이 클립을 열어볼지"를
5초 안에 판단시키는 것이라면, 영상요약은 **클립을 재생하지 않고도 내용 전체를 파악**하게
하는 것이 역할이다.

### ① 목적

- 사용자는 촬영 원본 수십~수백 개를 검토·선별하는 편집자/PD다. 영상요약의 목적은
  **클립을 재생하지 않고 "이 클립에 무엇이 담겼는지"를 파악하고, 쓸지/버릴지·어디에 쓸지
  판단할 근거를 주는 것**이다. 미디어 자산 관리(MAM) 도구들이 AI 요약을 제공하는 이유와
  동일하다 — "파일을 열기 전에 안에 뭐가 있는지 이해하게 한다"([Iconik AI](https://www.iconik.io/artificial-intelligence)).
- 상세 페이지에서 영상요약 바로 아래에 "타임스탬프별 주요 장면" 목록이 이미 있으므로,
  요약이 장면을 하나하나 나열할 필요는 없다. 요약은 장면 목록이 주지 못하는
  **클립 전체의 서사(무엇이 어떻게 흘러가는 클립인가)** 를 준다.

### ② 선정/작성 기준

**3문장 고정 구조**로 작성한다. 각 문장의 역할이 정해져 있어, 사용자가 "몇 번째 문장을
보면 무엇을 알 수 있는지" 예측할 수 있고, 요약 품질을 검수할 기준도 명확해진다.

| 문장 | 역할 | 내용 |
|---|---|---|
| 1문장 | **핵심** | 누가/어디서/무엇을 담은 클립인지 — 클립의 정체를 한 번에. 역피라미드의 리드 문장 |
| 2문장 | **전개** | 시간 흐름에 따라 내용이 어떻게 진행되는지. 음성이 있으면 발화 요지 중심, 없으면(B롤) 시각적 전개 중심 |
| 3문장 | **특이점** | 편집 판단에 영향을 주는 정보 — 인상적인 발화(짧은 직접 인용 가능), 화면·소리의 특이사항, 클립의 끝맺음 등 |

- 특이점이 정말 없으면 3문장째를 억지로 채우지 않고 2문장으로 끝낸다(채우기용 문장 금지).
- 각 문장은 근거 소스(음성 자막 또는 시각 설명)에서 **추적 가능**해야 한다.
  자막·장면 설명에 없는 사실을 쓰지 않는다.
- 기획서 맥락은 표기(인물 이름, 장소 표기)를 맞추는 참고로만 쓰고,
  요약 내용의 근거로 쓰지 않는다.
- "이 영상은", "~하는 클립이다" 같은 군더더기 없이 내용으로 바로 시작한다.

### ③ 근거

- **재생 없이 내용 파악이 요약의 존재 이유**: MAM 업계에서 AI 요약의 목적은 "파일을 열기 전에
  내용을 이해하고, 파일명이 아니라 주제로 콘텐츠를 발견하게 하는 것"으로 정의된다
  ([Iconik — AI metadata for MAM](https://www.iconik.io/artificial-intelligence)).
- **역피라미드 + 간결·객관**: 사용자는 텍스트를 정독하지 않고 스캔한다. 결론(핵심)을 먼저 쓰는
  역피라미드 구조, 간결한 문장, 객관적 서술이 측정 가능하게 사용성을 높인다
  ([NN/g — Concise, Scannable, and Objective](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/),
  [NN/g — How Users Read on the Web](https://www.nngroup.com/articles/how-users-read-on-the-web/)).
  AI 생성 텍스트에도 같은 원칙(간결·스캔 가능·역피라미드·평이한 언어)이 요구된다
  ([NN/g — 4 Things GenAI Needs for Better Content Design](https://www.nngroup.com/videos/genai-content-design/)).
- **다큐 로깅 관행**: 전통적인 푸티지 로깅에서도 기록 대상은 피사체·장소·행동, 발화/인용,
  오디오·화면 특이사항이다 — 3문장 구조(핵심/전개/특이점)는 이 관행을 문장 역할로 정리한 것이다
  ([Filmsupply — How to Log Footage](https://www.filmsupply.com/articles/how-to-log-footage/),
  [New Doc Editing — Documentary Logging Tips](https://newdocediting.com/documentary-logging-tips/)).
- **생성(abstractive) 방식 + 근거 제한**: 요약은 자막·장면 설명을 재조합해 새 문장을 만드는
  abstractive 방식이되([arXiv:2410.04449 — Video Summarization Techniques: A Comprehensive Review](https://arxiv.org/abs/2410.04449)),
  환각을 막기 위해 근거를 클립에서 실제 관측된 소스(STT 자막, VLM 장면 설명)로 제한한다.
  타임스탬프는 LLM이 추측하지 않고 시스템이 키프레임 시각에서 생성한다(기존 설계 유지).

### ④ 프롬프트 설계 원칙

- 규칙은 "3~5문장"처럼 범위로 주지 않고 **문장별 역할을 명시**한다. 역할이 정해져야
  출력이 일정해지고 검수 기준이 생긴다.
- 음성 유무에 따라 2문장(전개)의 중심 소스를 프롬프트에서 분기한다
  (음성 있음 → 발화 요지, 없음 → 시각 전개). 이 분기는 기존 `summary_rule` 분기를 재사용한다.
- 근거 제한("자막·장면에 실제로 담긴 내용만")과 군더더기 금지 규칙은 시스템/규칙 블록에 유지한다.
- 출력 스키마는 기존과 동일하게 `summary: string` 하나를 유지한다 — 3문장을 배열로 쪼개지
  않는다. 소비처(`server.py`의 필드 통과, `ClipDetail.tsx`의 `<p>{clip.summary}</p>`)가
  문자열을 기대하므로 스키마 변경 없이 호환된다.

---

## 2. 핵심키워드 (`keywords`)

상세 페이지(`ClipDetail.tsx`)의 "핵심 키워드" 섹션에 태그로 표시되는 필드.
표시 외에 시스템 내부에서 한 가지 역할이 더 있다 — **추천도 계산의 입력**이다.
`analyzer.py`는 자막·장면 설명·keywords를 합쳐 임베딩한 뒤 기획서(주제+키워드) 임베딩과
비교해 연관성(relevance)을 구하고, 이것이 표의 추천도가 된다. 즉 keywords의 품질이
"이 클립이 기획 방향과 맞는가"라는 표의 핵심 신호에 직접 영향을 준다.

### ① 목적

- **스캔용 태그**: 편집자가 상세 화면에서 요약을 읽기 전에, 태그 줄만 훑고
  "이 클립이 무엇에 관한 것인지"를 1~2초 안에 파악하게 한다. 푸티지 로깅 관행에서
  키워드를 인물·장소·주제 축으로 미리 잡아두고 클립마다 붙이는 이유와 같다
  ([Lumberjack System](https://www.lumberjacksystem.com/lumberjack-for-reality-and-documentary-production/),
  [Filmsupply — How to Log Footage](https://www.filmsupply.com/articles/how-to-log-footage/)).
- **클립 구별·검색의 단서**: 수십~수백 개 클립 사이에서 "그 클립"을 다시 찾을 때
  쓰는 검색어 후보다. 따라서 키워드는 이 클립을 **다른 클립과 구별해 주는** 말이어야
  한다 — 어느 클립에나 붙는 말은 검색 변별력이 0이다.
- **기획서와의 매칭 신호**: keywords는 추천도(연관성) 임베딩에 들어가므로,
  클립에서 실제 관측된 개념을 기획서와 같은 표기로 적을수록 연관성 판단이 정확해진다.

### ② 선정/작성 기준

**5~8개**를 뽑는다. 개수 범위를 정해 두면 태그 수에 대한 기대치가 생기고
검색 가능성도 보장된다([Stacks — Controlled Vocabulary](https://stacksteam.com/blog/controlled-vocabulary)).

선정은 **4개 파셋(facet)을 고루 커버**하는 방식으로 한다. 푸티지 로깅에서 기록하는
축(피사체·장소·행동·주제)을 키워드 갈래로 옮긴 것이다.

| 파셋 | 무엇 | 예 |
|---|---|---|
| 인물·피사체 | 누가/무엇이 찍혔나 | "해녀", "어선", "손글씨 편지" |
| 장소·공간 | 어디서 | "제주 바다", "부엌", "골목시장" |
| 행위·사건 | 무엇을 하나/무슨 일이 벌어지나 | "물질", "요리", "인터뷰" |
| 소재·주제 | 무엇에 관한 내용인가 | "세대 갈등", "이주", "향수" |

- 각 파셋에서 클립에 **실제 관측되는 것만** 뽑는다. 관측이 없는 파셋(예: 장소를
  특정할 수 없는 클로즈업)은 비워 두고 다른 파셋에서 채운다.
- **범용어 금지**: "사람", "영상", "일상", "모습"처럼 거의 모든 클립에 붙을 수 있는
  말은 쓰지 않는다. AI 자동 태깅의 대표적 실패가 정확하지만 변별력 없는 generic tag다
  ([MTM — AI Auto-Tagging: What It Gets Right and Where It Fails](https://www.mtm.video/blog/ai-auto-tagging-dam-what-it-gets-right-and-where-it-fails/)).
- **형태**: 조사·수식어 없는 명사(구). 같은 대상을 가리키는 유의어를 중복해 넣지 않는다.
- **기획서 키워드는 통제어휘로 쓴다**: 클립에서 관측된 개념이 기획서 키워드와 같은
  대상을 가리키면 **기획서의 표기를 그대로 사용**한다(예: 클립에서 "바닷속 작업"이
  보이고 기획서에 "물질"이 있으면 "물질"로). 표기가 통일돼야 태그 검색이 일관되고
  추천도 매칭도 정확해진다. 단, **클립에서 관측되지 않은 기획서 키워드를 끼워 넣지
  않는다** — 그렇게 하면 모든 클립의 추천도가 인위적으로 부풀어 추천도 자체가 무의미해진다.

### ③ 근거

- **파셋 기반 선정**: 푸티지 로깅 관행은 키워드를 인물(people)·장소(places)·주제(topics)
  축으로 설계하며([Lumberjack System](https://www.lumberjacksystem.com/lumberjack-for-reality-and-documentary-production/)),
  로깅 기록 대상도 피사체·장소·행동이다([Filmsupply](https://www.filmsupply.com/articles/how-to-log-footage/)).
  파셋을 정해 두면 키워드가 특정 갈래(예: 눈에 띄는 사물만)로 쏠리는 것을 막는다.
- **통제어휘(controlled vocabulary)**: 자유 태깅은 일관성이 없어 검색 정확도를 떨어뜨리고,
  표기를 통제한 어휘가 검색 일관성을 만든다
  ([Stacks — Controlled Vocabulary](https://stacksteam.com/blog/controlled-vocabulary),
  [Veritone — Metadata Tagging Best Practices](https://www.veritone.com/blog/metadata-tagging/)).
  이 프로젝트에서 사용자가 관리하는 유일한 어휘 목록이 기획서 키워드이므로,
  이를 통제어휘로 삼아 표기를 맞춘다.
- **generic tag 회피**: AI 태깅은 "정확하지만 범용적인" 태그를 내는 경향이 있고,
  도메인 맥락(내부 분류·기획 의도)을 모른 채 태깅하면 검색 노이즈가 된다
  ([MTM](https://www.mtm.video/blog/ai-auto-tagging-dam-what-it-gets-right-and-where-it-fails/),
  [Iconik — AI metadata tagging](https://www.iconik.io/blog/ai-metadata-tagging-how-it-works-and-what-you-should-know)).
  범용어 금지 규칙과 기획서 표기 사용 규칙이 이에 대한 대응이다.
- **관측 근거 제한**: keywords는 추천도 임베딩의 입력이므로, 관측되지 않은 기획서
  키워드를 넣으면 연관성 점수가 왜곡된다. 요약(§1)과 동일하게 근거를 클립에서 실제
  관측된 소스(STT 자막, VLM 장면 설명)로 제한한다.

### ④ 프롬프트 설계 원칙

- 기존 규칙 "기획서 키워드와 겹치는 것이 있으면 반드시 포함"은 **"관측된 개념일 때만
  기획서 표기를 사용"으로 교체**한다. 기존 문구는 관측 여부와 무관하게 기획서 키워드를
  포함하라는 뜻으로 읽혀 추천도 부풀리기·환각의 원인이 된다.
- 파셋 4갈래와 "고루 뽑되 관측 없는 갈래는 생략"을 프롬프트에 명시한다.
- 범용어 금지는 금지어 나열이 아니라 **판별 기준**("어느 클립에나 붙을 수 있는 말 금지")
  + 대표 예시 2~3개로 준다. 나열식 금지어는 나열 밖 범용어를 막지 못한다.
- 출력 스키마는 기존과 동일하게 `keywords: string[]`를 유지한다. 소비처
  (`server.py`의 `_LIST_FIELDS` 통과, `ClipDetail.tsx`의 태그 렌더링,
  `analyzer.py`·`server.py`의 추천도 계산 `join`)가 모두 문자열 배열을 기대하므로
  스키마 변경 없이 호환된다.

---

## 3. 영상내용 (`scenes[].desc` — 타임스탬프별 주요 장면)

상세 페이지(`ClipDetail.tsx`)의 "타임스탬프별 주요 장면" 목록에 표시되는,
**장면(키프레임)별 내용 설명** 필드. 요약(§1)이 클립 전체를 압축한 2차 가공물이라면,
영상내용은 "이 클립에 무엇이 담겼는가"를 시간순으로 남기는 **1차 기록**이다.
타임스탬프(`time`/`t`)는 장면 검출로 얻은 실제 키프레임 시각을 시스템이 붙이고
(`analyzer.py`의 `_build_scenes`), 설명(`desc`)은 키프레임마다 VLM(Qwen2.5-VL)이
생성한다 — 즉 이 필드의 생성 프롬프트는 예외적으로 `llm.py`가 아니라 `vlm.py`에 있다.

### ① 목적

- **클립 안에서 순간 찾기**: 표·요약이 "어느 클립인지"를 찾게 한다면, 영상내용은
  "그 클립의 어느 지점인지"를 찾게 한다. 상세 페이지에서 장면을 클릭하면 그 시각으로
  시크되므로, 설명은 편집자가 원하는 순간을 목록만 훑고 바로 찾아가게 하는
  내비게이션이다. 방송·MAM 업계가 타임코드 연동 메타데이터를 만드는 이유가 이것이다 —
  "타임코드 기반 메타데이터가 있어야 자산을 장면·순간 단위로 검색하고, 영상을 눈으로
  스캔하는 대신 검색에서 바로 그 지점으로 이동한다"
  ([Digital Nirvana — Metadata for Video Files](https://digital-nirvana.com/blog/metadata-for-video-files-broadcast-checklist/)).
- **전 필드의 근거층**: 영상요약·한줄요약·키워드·인물·장소는 모두 자막과 이 장면
  설명을 근거로 융합 LLM(`llm.py`)이 생성하고, 추천도(연관성) 임베딩에도
  `scene_descriptions`가 직접 들어간다(`analyzer.py`, `server.py`의 recompute).
  특히 **음성 없는 클립(B롤)에서는 장면 설명이 유일한 내용 근거**다.
  여기서 생긴 오류·환각은 모든 하위 필드로 전파되므로, 이 필드의 제1 원칙은
  "정확한 관찰 기록"이다.

### ② 선정/작성 기준

장면 하나당 **1~2문장**, 아래 우선순위로 쓴다. 촬영 로그 관행이 샷을
"샷 크기 + 피사체 + 행동"으로 적는 것(예: "medium shot of lady handing over
bananas to customer")을 문장 구성 순서로 옮긴 것이다.

| 순서 | 요소 | 내용 |
|---|---|---|
| ① | 피사체 | 누가/무엇이 보이는가 — 인물 수·눈에 띄는 외형, 중심 사물 |
| ② | 행동·상황 | 프레임에서 확인되는 동작·일어나는 일 |
| ③ | 장소·환경 | 실내/실외, 환경, 조명·날씨 등 화면에서 드러나는 것 |
| ④ | 구도 | 클로즈업/미디엄/와이드 등 — 편집 판단에 유의미하게 두드러질 때만 |

- **보이는 것만 기록**: 프레임에 실제로 보이는 것만 쓴다. VLM은 이미지에 없는
  사물을 언급하는 객체 환각(object hallucination) 경향이 검증되어 있으므로
  ([arXiv:2305.10355 — Evaluating Object Hallucination in Large Vision-Language Models](https://arxiv.org/abs/2305.10355)),
  불확실한 것은 쓰지 않는 쪽을 택한다.
- **정지 프레임의 한계를 넘는 추측 금지**: VLM이 보는 것은 장면의 대표 프레임
  1장이다. 한 장에서 확인할 수 없는 움직임의 방향, 장면의 전후 맥락, 인물의
  감정·의도는 추측하지 않는다.
- **분위기는 단정하지 않고 관찰로 대체**: "평화로운 분위기" 같은 해석 단정 대신,
  그렇게 보이게 하는 관찰 가능한 요소(빛, 날씨, 표정)를 쓴다. 해석은 융합 단계
  (`ai_comment`)의 몫이다.
- **화면 속 문자 정보는 기록**: 간판·문서·자막 등 판독 가능한 글자는 그대로 적는다.
  장소·상황을 특정하는 검색 단서로 가치가 높다.
- **간결·본론 우선**: 이미지 서술 접근성 지침과 동일하게 — 핵심 요소만 간결하게,
  "이 장면은/화면에는" 같은 군더더기 표현 없이 내용부터 시작한다
  ([NN/g — Alt Text: What to Write](https://www.nngroup.com/articles/write-alt-text/),
  [Harvard — Describe Content in Images](https://accessibility.huit.harvard.edu/describe-content-images)).
- 각 장면 구간의 음성 자막은 시스템이 `speech`로 따로 붙이므로(`_attach_scene_speech`),
  설명이 발화 내용을 다룰 필요는 없다.

### ③ 근거

- **순간 단위 검색·이동**: 타임코드 연동 메타데이터는 자산을 장면·순간 단위로
  검색 가능하게 하고, 시각적 스캔을 검색-이동으로 대체한다
  ([Digital Nirvana](https://digital-nirvana.com/blog/metadata-for-video-files-broadcast-checklist/)).
  학술적으로도 클립 전체 요약과 별개로, 미편집 영상의 사건들을 시간 구간별로
  각각 서술하는 dense video captioning이 독립 과제로 정립되어 있다 —
  "구간 localize + 구간별 캡션"이라는 이 프로젝트의 구조(시각은 장면 검출,
  설명은 VLM)와 같은 분해다
  ([ACM Computing Surveys — Dense Video Captioning: A Survey](https://dl.acm.org/doi/full/10.1145/3712059)).
- **샷 로그 관행**: 푸티지 로깅에서 클립 노트는 샷 타입·피사체·행동을 적는다
  ([Filmsupply — How to Log Footage](https://www.filmsupply.com/articles/how-to-log-footage/),
  [Pond5 — 6 Easy Steps for Logging Footage](https://blog.pond5.com/5716-6-easy-steps-logging-footage/)).
  ②의 우선순위(피사체→행동→환경→구도)는 이 관행을 따른 것이다.
- **객체 환각 대응**: LVLM은 이미지에 없는 빈출 객체를 언급하는 환각이 체계적으로
  관측된다([arXiv:2305.10355](https://arxiv.org/abs/2305.10355)). 이 필드는 모든
  하위 필드와 추천도 임베딩의 근거이므로, 환각 1건이 요약·키워드·추천도까지
  오염시킨다. "보이는 것만·불확실하면 생략" 규칙과 감정·의도 추측 금지가 대응책이다.
- **이미지 서술 지침**: 접근성 분야의 이미지 서술 원칙(핵심 요소 중심의 간결한
  서술, 군더더기 도입부 금지, 이미지 속 텍스트 포함)은 "화면을 못 보는 독자에게
  화면을 전달"하는 검증된 작성 규범으로, 재생 전 클립을 판단하는 편집자의 상황과
  같다([NN/g](https://www.nngroup.com/articles/write-alt-text/),
  [Harvard](https://accessibility.huit.harvard.edu/describe-content-images)).

### ④ 프롬프트 설계 원칙

- 이 필드의 프롬프트는 `vlm.py`(`_PROMPT`/`_SYSTEM`)에 있다. `llm.py`는 장면
  설명을 소비만 하며, 장면 설명의 품질 기준은 생성 지점인 VLM 프롬프트에서 잡는다.
- 요소를 병렬 나열("장소, 인물 수와 행동, 구도, 분위기를 구체적으로")하지 않고
  **우선순위가 있는 순서(피사체→행동→환경→구도)** 로 지시한다. 병렬 나열은 어느
  요소가 중요한지 알려주지 못해 장소·분위기 서술이 문장을 선점하는 원인이 된다.
- "분위기" 요구는 **관찰 가능한 요소로 대체**해 지시한다(해석 단정 금지).
  기존 프롬프트는 "분위기를 구체적으로"라고 요구해 근거 없는 해석 수식을 유도했다.
- 정지 프레임 1장 기반임을 전제로 **움직임·전후 맥락·감정 추측 금지**를 명시한다.
- 화면 속 판독 가능한 글자 기록 지시를 추가한다.
- 한국어 강제·재시도, 프레임별 실패 격리(`describe_keyframes`) 등 기존 동작은
  유지한다. 출력은 기존과 동일한 **프레임당 평문 1~2문장**(JSON 아님)이다 —
  소비처(`analyzer.py` `_build_scenes`→`scenes[].desc`, `llm.py` `scene_block`,
  추천도 임베딩의 `scene_descriptions: string[]`, `ClipDetail.tsx` 장면 목록)가
  모두 문자열(배열)을 기대하므로 스키마 변경 없이 호환된다.

> 필드 이름 매핑 메모: 과제 목록의 "영상내용"은 상세 페이지의 장면별 내용 기록
> (`scenes[].desc`)을 가리킨다. 클립 전체를 한 번에 개관하는 "영상개요"(과제 4)는
> 표·상세 상단의 `one_line`(한줄요약)에 대응한다.
