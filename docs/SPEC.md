# JRH-Orbit — Phase 7+ 개발 사양서 (SPEC.md)

> Phase 1~6.5는 PLAN.md 참조. 이 문서는 Phase 7 이후 구현할 기능의 상세 사양.
> Claude Code 실행 시: "SPEC.md를 읽고 Phase 7-A부터 구현해줘" 로 시작.

---

## 목차

1. [데이터 모델](#1-데이터-모델) — frontmatter 스키마, TODO 확장, 태그, 링크 그래프
2. [템플릿](#2-템플릿) — 6종 Research Note + Daily Log + 3종 Review
3. [자동화 규칙](#3-자동화-규칙) — 자동 링크, 이월, 승격, 건강 점검, 스마트 제안
4. [Statistics & Review 탭](#4-statistics--review-탭) — Dashboard, AI 리뷰, 성장 메트릭
5. [UX 마이크로 자동화](#5-ux-마이크로-자동화) — 마찰 제거 + 습관 형성 기능
6. [구현 가이드](#6-구현-가이드) — Phase 7 세부 순서, 파일 구조, 마이그레이션
7. [Window & Layout 확장](#7-window--layout-확장) — 투명도, 줌, 항상 위, 디자인 통일
8. [Task 편집 UX 개선](#8-task-편집-ux-개선) — 사이드바/독 태스크 클릭 편집, 서브태스크 마커
9. [Statistics 확장](#9-statistics-확장) — 요일별 Workhour, 히트맵, 추가 시각화

---

## 1. 데이터 모델

### 1.1 프로젝트 계층

```
L1  Project     위성 단위         SAT-A-6U, SAT-B-16U, GENERAL
L2  Topic       작업 주제 그룹     EKF 튜닝, RW 환경시험, 궤도결정 알고리즘
L3  Subsystem   enum (고정)       Primary: ADCS, Orbit
                                  Secondary: OBC, EPS, COM, STR, Thermal, Payload
```

### 1.2 공통 Frontmatter (모든 노트 유형 공유)

```yaml
---
id: "2026-06-05-analysis-001"     # 자동: {date}-{type abbrev}-{seq}
type: analysis-note                # enum: daily-log|quick-memo|analysis-note|test-log|design-note|study-note|review
title: ""                          # 사용자 입력
date: 2026-06-05                   # 자동
updated: 2026-06-05T14:30:00      # 자동 (저장 시)
project: [SAT-A-6U]               # 배열. 드롭다운 선택
topic: "EKF 튜닝"                  # 문자열. 드롭다운 선택 전용 (직접 입력 불가)
subsystem: [ADCS]                 # 배열. enum 체크박스
tags: [ekf, gyro-bias]            # 자유 태그. 영문소문자+하이픈만
related: ["2026-06-05-daily"]     # 다른 노트 id 배열
status: in-progress                # enum: draft|in-progress|complete|archived
verdict: ""                        # test-log 전용: pass|fail|conditional
workhour: 0                        # daily-log 전용
workhour_detail: []                # daily-log 전용: [{project, hours}]
summary: ""                        # daily-log 전용: 자동 생성 요약 (100자)
carried_over: []                   # daily-log 전용: [{from, items}]
---
```

#### 필드 자동화 표

| 필드 | 자동 생성 | 사용자 입력 | 유효성 검사 |
|---|---|---|---|
| id | ✅ `{date}-{type}-{seq}` | — | 중복 불가 |
| type | ✅ 템플릿 선택 시 | — | enum |
| date | ✅ | — | ISO 8601 |
| updated | ✅ 저장 시마다 | — | ISO 8601 |
| project | 부분자동 (§5.5) | ✅ 드롭다운 | projects.json 존재 |
| topic | 부분자동 (§3.16) | ✅ 드롭다운 선택 | topics.json 존재 |
| subsystem | 부분자동 (§3.8) | ✅ 체크박스 | enum |
| tags | 부분자동 (§3.9) | ✅ 자동완성 | 소문자+하이픈 |
| related | 부분자동 (§3.1~3.4) | ✅ [[]] 자동완성 | 존재하는 id |
| status | ✅ 초기 draft | 부분자동 (§3.7) | enum |
| verdict | — | ✅ test-log만 | enum |
| workhour | 부분자동 (뽀모도로) | ✅ 수동 보정 | ≥0 |
| summary | ✅ (§3.10) | — | 100자 이내 |

### 1.3 TODO 데이터 모델 (todos.json 확장)

기존 todos.json 구조를 유지하면서 필드 추가.

```json
{
  "id": "todo-001",
  "title": "EKF Q matrix 파라메트릭 스터디",
  "project": "SAT-A-6U",
  "status": "in-progress",
  "priority": "high",
  "subtasks": [],

  "subsystem": "ADCS",
  "tags": ["ekf"],
  "start_date": "2026-06-03",
  "due_date": "2026-06-10",
  "end_date": null,
  "related_notes": ["2026-06-05-analysis-001"],
  "daily_logs": ["2026-06-03-daily", "2026-06-05-daily"],
  "carry_count": 0,
  "recurring": null,
  "source_note": null,
  "source_section": null
}
```

새 필드(subsystem~source_section)는 default null/[]로 추가. 기존 데이터 비파괴.

- `source_note`: 이 TODO가 노트의 체크박스에서 자동 생성된 경우 원본 노트 id (§3.15)
- `source_section`: 원본 노트의 섹션명 (예: "후속 과제", "내일 계획")
- 수동 생성 TODO는 둘 다 null

`recurring` 필드 (§5.10 참조):
```json
"recurring": { "interval": "weekly", "day": "monday" }
```

### 1.4 태그 인덱스 (data/tags.json — 신규)

```json
{
  "tags": [
    { "name": "ekf", "count": 23, "last_used": "2026-06-05" },
    { "name": "gyro-bias", "count": 8, "last_used": "2026-06-05" }
  ],
  "keyword_map": {
    "EKF": "ekf",
    "Extended Kalman": "ekf",
    "reaction wheel": "reaction-wheel",
    "RW": "reaction-wheel",
    "자이로": "gyro-bias",
    "B-dot": "b-dot",
    "궤도결정": "orbit-determination"
  }
}
```

`keyword_map`: 본문에서 키워드 감지 시 자동 태그 제안 (§3.9).

### 1.5 링크 그래프 인덱스 (data/links.json — 신규)

```json
{
  "2026-06-05-analysis-001": {
    "forward": ["2026-06-05-daily", "2026-06-03-analysis-002"],
    "backward": ["2026-06-08-analysis-001"]
  }
}
```

노트 저장/삭제 시 자동 갱신. 용도: 백링크 표시, orphan 감지, 그래프 밀도 계산.

### 1.6 Subsystem enum (data/subsystems.json — 신규)

```json
{
  "primary": ["ADCS", "Orbit"],
  "secondary": ["OBC", "EPS", "COM", "STR", "Thermal", "Payload"]
}
```

UI에서 primary 상단 강조, secondary 접힌 섹션.

### 1.7 토픽 목록 (data/topics.json — 신규)

```json
{
  "topics": [
    {
      "name": "EKF 튜닝",
      "project": "SAT-A-6U",
      "subsystem": "ADCS",
      "created": "2026-06-03",
      "note_count": 5,
      "last_used": "2026-06-09",
      "keywords": ["ekf", "kalman", "Q matrix", "자이로 바이어스"]
    },
    {
      "name": "RW 환경시험",
      "project": "SAT-A-6U",
      "subsystem": "ADCS",
      "created": "2026-05-20",
      "note_count": 8,
      "last_used": "2026-06-09",
      "keywords": ["reaction-wheel", "진동시험", "기능시험"]
    },
    {
      "name": "궤도결정 알고리즘",
      "project": "SAT-B-16U",
      "subsystem": "Orbit",
      "created": "2026-04-10",
      "note_count": 3,
      "last_used": "2026-06-06",
      "keywords": ["orbit-determination", "TLE", "SGP4"]
    }
  ]
}
```

- `name`: 자연어 토픽명. 드롭다운에 표시되는 값.
- `project`: 이 토픽이 속한 프로젝트. 프로젝트 컨텍스트 필터링에 사용.
- `keywords`: 본문 내용 기반 토픽 자동 추천에 사용 (§3.16).
- `note_count`, `last_used`: 노트 저장 시 자동 갱신. 드롭다운 정렬 기준.

**토픽 생성 규칙:**
- 기존 토픽은 **드롭다운 선택만 가능** (직접 타이핑 불가)
- "새 토픽 만들기" 클릭 시에만 이름 입력 가능
- 신규 입력 시 유사 토픽 경고 (기존 토픽과 Levenshtein distance ≤ 3 또는 키워드 50%+ 겹침)
- 토픽 삭제 시: 연결된 노트의 topic → 빈 문자열 (데이터 손실 방지)

### 1.8 기존 노트 마이그레이션

```
Phase 7-A 첫 작업. Settings에 "데이터 마이그레이션" 버튼.

변환 규칙:
  type: research → analysis-note (기본) or 사용자 선택
  project: "SNIPE-1" → ["SNIPE-1"]
  id: created 날짜 기반 자동 생성
  subsystem: tags에서 ADCS/Orbit/OBC 등 추출 → subsystem으로 이동, tags에서 제거
  related: 같은 날짜 daily-log id 자동 연결
  status: updated 30일+ → archived, 아니면 complete

  원본 백업 후 진행.
```

---

## 2. 템플릿

### 2.1 Daily Work Log (매일 자동 생성)

```markdown
---
id: "{date}-daily"
type: daily-log
title: "{date} 업무일지"
date: {date}
project: []
subsystem: []
tags: []
related: []
status: in-progress
workhour: 0
workhour_detail: []
summary: ""
carried_over: []
---

## 오늘의 작업

### 🛰️ {project}
- [ ] {이월된 TODO + 새 TODO 자동 삽입}

### 📌 GENERAL
- [ ] {task}

---

## 인사이트 & 의사결정

- {왜 그렇게 판단했는지}

---

## 오늘 생성한 노트

<!-- 자동 집계 -->
| 유형 | 제목 | 프로젝트 |
|---|---|---|
| {icon} | [[{id}]] {title} | {project} |

---

## 내일 계획

1. `[{project}]` {plan}

---

## 회고 (선택)

<!-- 주 1회 권장 -->
```

### 2.2 Quick Memo 💬

```markdown
---
id: "{date}-memo-{seq}"
type: quick-memo
title: ""
date: {date}
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: complete
---

## 메모

{자유 형식}
```

### 2.3 Analysis Note 📊

```markdown
---
id: "{date}-analysis-{seq}"
type: analysis-note
title: ""
date: {date}
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
---

## 목적

{2-3문장}

## 분석 조건

### 공통 조건 (Base)

| 파라미터 | 값 | 비고 |
|---|---|---|

### 가변 조건 (Sweep)

| Case | {변수명} | 비고 |
|---|---|---|

## 결과

### Case A
{상세}

### 요약 테이블

| Case | {metric} | 판정 |
|---|---|---|

## 결론

1. {핵심}
2. {원인}
3. {후속}

## 코드 / 파일 참조

- 메인 스크립트:
- 결과 데이터:

## 후속 과제

- [ ] {다음}
```

### 2.4 Test Log 🔧

```markdown
---
id: "{date}-test-{seq}"
type: test-log
title: ""
date: {date}
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
verdict: ""
---

## 시험 목적

## 시험 장비 / 환경

| 항목 | 상세 |
|---|---|

## 시험 절차

1. {step}

## 측정 데이터

| {항목} | {값} | 판정 |
|---|---|---|

## 판정 기준 및 종합 판정

| 항목 | 기준 | 결과 | 판정 |
|---|---|---|---|

### {🟢 PASS / 🔴 FAIL / 🟡 CONDITIONAL}

## 이상 소견 / 특이사항

## 첨부 파일

## 후속 조치

- [ ] {다음}
```

### 2.5 Design Note 📐

```markdown
---
id: "{date}-design-{seq}"
type: design-note
title: ""
date: {date}
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
---

## 의사결정 요약

{한 문장}

## 배경 / 문제

## 검토한 대안

| 대안 | 장점 | 단점 | 비고 |
|---|---|---|---|

## 선정 근거

1. {근거}

## 제약 조건 / 리스크

## 결론
```

### 2.6 Study Note 📚

```markdown
---
id: "{date}-study-{seq}"
type: study-note
title: ""
date: {date}
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
---

## 주제

{한 줄 요약}

## 출처

| 유형 | 상세 |
|---|---|
| 논문 | {저자, 제목, 저널, 년도} |

## 핵심 내용

### 주요 개념

- {concept}: {설명}

### 수식 / 알고리즘 (해당 시)

## 내 프로젝트 적용 가능성

- `[{project}]` {아이디어}

## 추가 조사 필요

- [ ] {더 알아볼 것}
```

### 2.7 Review Page (Export → Claude.ai → Import)

```yaml
---
id: "review-weekly-2026-W23"
type: review
review_type: weekly
period_start: 2026-06-02
period_end: 2026-06-08
generated: 2026-06-09T08:15:00       # Import 시각
stats:
  total_workhour: 32.5
  notes_created: 12
  completion_rate: 0.67
  # (전체 stats 필드는 §4.3 — Export 시 앱이 자동 계산)
---
(Claude.ai에서 생성한 분석 본문 — Import 시 붙여넣기)
```

---

## 3. 자동화 규칙

모든 자동화의 목적: **사용자가 손으로 해야 할 일을 줄여서 포기 확률을 낮춤**.

### 3.1 자동 링크 — 노트 생성 시

```
Research Note 생성 시:
  → 해당 노트 related에 당일 daily-log id 추가
  → daily-log의 "오늘 생성한 노트" 테이블에 자동 삽입
  → links.json 갱신
```

### 3.2 자동 링크 — 승격 시

```
Quick Memo → Analysis/Design/Study 승격 시:
  → 새 노트 related에 원본 memo id 추가
  → 원본 memo related에 새 노트 id 역참조
  → 원본 memo status → archived
  → links.json 갱신
```

### 3.3 자동 링크 — 같은 topic 연결 제안

```
노트 저장 시 topic 필드가 비어있지 않으면:
  → 같은 topic의 다른 노트 검색
  → 있으면 "관련 노트 연결" 토스트 표시
  → 수락 시 양방향 related 추가
```

### 3.4 자동 링크 — 후속 과제 추적

```
"## 후속 과제"의 체크박스 완료 시:
  → 해당 항목에 [[link]]가 있으면 → 연결된 노트 status 확인
  → [[link]]가 없으면 → "새 노트 생성?" 프롬프트
```

### 3.5 미완료 업무 이월

```
새 Daily Log 생성 시 (앱 실행 or 자정):
  1. 전날 daily-log에서 미체크 항목 파싱: /^- \[ \] (.+)$/gm
  2. 프로젝트 섹션(### 🛰️) 하위 → 같은 프로젝트 섹션에 배치
  3. [todo-id] 포함 → todos.json carry_count++
  4. carry_count >= 3 → 경고: "3일 연속 이월. 마감일 조정?"
  5. 새 Daily Log에 "(이월)" + 원본 날짜 표시로 삽입
  6. Daily Log frontmatter carried_over 배열 갱신
```

### 3.6 TODO ↔ Daily Log 연동

```
Daily Log 생성 시:
  1. todos.json에서 status == in-progress 항목 필터
  2. due_date <= 오늘이면 ⚠️ 표시
  3. "오늘의 작업" 프로젝트별 섹션에 자동 삽입:
     - [ ] [todo-001] EKF 스터디 (D-5) → [[note-id]]

Daily Log 체크박스 체크 시:
  → todos.json status → done, end_date → 오늘

Daily Log에서 새 항목 직접 작성 시:
  → "TODO로 등록?" 프롬프트 (Yes: due_date 입력 UI, No: 일회성)
```

### 3.7 자동 status 감지

```
Analysis Note: "## 결론" 섹션에 내용이 채워지면 → status: complete 제안
Test Log: verdict 필드 선택 시 → status: complete 제안
Quick Memo: 생성 즉시 status: complete (기본값)
모든 노트: 30일+ 미수정 + status in-progress → "archived로 변경?" 제안
```

### 3.8 subsystem 자동 추출

```
에디터 본문에서 기술 키워드 감지:
  "반응 휠", "RW", "자세제어", "attitude" → subsystem: ADCS 자동 제안
  "궤도", "orbit", "TLE", "SGP4" → subsystem: Orbit 자동 제안
  "전력", "배터리", "solar panel" → subsystem: EPS 자동 제안

제안 방식: 에디터 상단 배너 "subsystem: ADCS 추가?" [추가] [무시]
한 번 무시하면 같은 노트에서 재제안 안 함.
```

### 3.9 태그 자동 추출 + 자동완성

```
tags.json의 keyword_map 기반:
  본문에 "EKF" 등장 → tags에 "ekf" 자동 제안 (배너)
  본문에 "B-dot" 등장 → tags에 "b-dot" 자동 제안

태그 입력 시:
  1. prefix match로 기존 태그 후보 표시 (빈도순 정렬)
  2. 후보에 없으면 → "새 태그 추가?" + 유사 태그 표시 (Levenshtein ≤ 2)
  3. 포맷 검증: 대문자/한글/언더스코어 → 자동 변환 제안

태그 자동 정규화:
  "EKF" → "ekf", "gyro_bias" → "gyro-bias", "자이로" → keyword_map 조회 → "gyro-bias"
```

### 3.10 Daily Log 자동 요약

```
Daily Log status → complete 시 (또는 다음날 새 Daily Log 생성 시):
  1. "오늘의 작업" 체크된 항목 추출
  2. "인사이트" 섹션 첫 줄 추출
  3. 결합하여 100자 이내 summary 생성:
     "SAT-A EKF Q matrix 최적화, B-dot 디텀블링 검토 시작"
  4. frontmatter summary 필드에 저장

효과: 월간 리뷰에서 daily-log 전문 대신 summary만 전송 → 토큰 50%+ 절약
```

### 3.11 반복 분석 조건 자동 채움

```
Analysis Note 생성 시 topic 선택:
  → 같은 topic의 최근 Analysis Note 검색
  → "공통 조건 (Base)" 테이블 추출
  → 새 노트 Base 테이블에 자동 복사
  → "이전 분석에서 조건을 가져왔습니다" 토스트 + [확인][초기화]

효과: 궤도, 센서 모델, MATLAB 버전 등 매번 재입력 제거
```

### 3.12 시험 전후 비교 자동화

```
Test Log 생성 시 topic 선택:
  → 같은 topic의 이전 Test Log 검색
  → 이전 측정 데이터 테이블 컬럼 구조 복사
  → "## 전후 비교" 섹션 자동 추가 (이전 데이터 + 빈 현재 데이터)
  → related에 이전 Test Log 자동 연결
```

### 3.13 파일 참조 자동 감지

```
TipTap ProseMirror Plugin으로 구현.
에디터 텍스트 변경 시 본문을 스캔.

대상 노트 type: analysis-note, test-log, design-note, study-note
비대상: quick-memo, daily-log (무시)

감지 패턴 (정규식):

  파일명:
    /[^\s"'(]+\.(m|py|slx|vi|c|h|mat|csv|json|xlsx|xls|pdf|pptx|ppt|docx|doc|hwp|hwpx|txt|fig|png|jpg|svg|zip)\b/gi

  경로 포함:
    /[A-Za-z]:\\[\w\-\\\/]+\.\w+/g                   → Windows 절대경로
    /\/[\w\-\/]+\.\w+/g                                → Unix 절대경로
    /[\w\-]+\/[\w\-\/]+\.\w+/g                         → 상대경로

확장자별 라벨 매핑:

  코드/스크립트:
    .m        → "MATLAB 스크립트"
    .py       → "Python 스크립트"
    .slx      → "Simulink 모델"
    .vi       → "LabVIEW VI"
    .c, .h    → "C 소스코드"

  데이터:
    .mat      → "MATLAB 데이터"
    .csv      → "CSV 데이터"
    .json     → "JSON 데이터"
    .xlsx/.xls → "Excel 스프레드시트"

  문서:
    .pdf      → "PDF 문서"
    .pptx/.ppt → "프레젠테이션"
    .docx/.doc → "Word 문서"
    .hwp/.hwpx → "한글 문서"
    .txt      → "텍스트 파일"

  이미지/기타:
    .fig      → "MATLAB Figure"
    .png/.jpg/.svg → "이미지"
    .zip      → "압축 파일"

동작 플로우:

  1. 새 파일 경로 패턴 감지
  2. "## 코드 / 파일 참조" 섹션 존재 확인 → 없으면 무시
  3. 해당 경로가 이미 섹션에 있으면 → 무시 (중복 방지)
  4. 이전에 [무시] 처리한 경로면 → 무시 (같은 노트 내)
  5. 에디터 상단 배너 표시:
     "📎 ekf_sim.m 감지됨 → 파일 참조에 추가? [추가] [무시]"
  6. [추가] 클릭 시:
     → 섹션에 "- **{라벨}**: {파일명 or 전체경로}" 삽입
     → 같은 확장자 그룹끼리 인접 배치 (코드 → 데이터 → 문서 순)
```

### 3.14 노트 건강 점검

```
트리거: Dashboard 갱신 시 + 주간 리뷰 생성 시

점검 항목:
  [1] Orphan Notes — related가 daily-log만이고 다른 연결 없음
  [2] Stale In-Progress — status: in-progress, updated 7일+
  [3] Missing Verdict — test-log complete인데 verdict 비어있음
  [4] Empty Conclusion — analysis-note complete인데 결론 비어있음
  [5] Tag Duplicates — 유사 태그 쌍 (Levenshtein ≤ 2)
  [6] Overdue TODOs — due_date 초과
  [7] High Carry-over — carry_count >= 3
  [8] Empty "적용 가능성" — study-note인데 "내 프로젝트 적용 가능성" 비어있음

결과: Dashboard 하단 경고 배너 + 각 항목 클릭 시 해당 노트로 이동
```

### 3.15 섹션 체크박스 → TODO 자동 생성

```
특정 섹션의 - [ ] 항목을 todos.json에 자동 등록.
"적으면 곧 할 일이 된다" — 별도로 TODO 패널에서 만들 필요 없음.

대상 섹션 매핑:

  Daily Log:
    "## 내일 계획"     → TODO 생성 (start_date = 내일)
    "## 아이디어 & TODO" → TODO 생성 (status = todo)

  Analysis Note / Study Note:
    "## 후속 과제"     → TODO 생성 (related_notes = 현재 노트 id)

  Test Log:
    "## 후속 조치"     → TODO 생성 (related_notes = 현재 노트 id)

  Design Note:
    "## 결론 & 후속"   → "검증 계획" 불릿에 [ ]가 있으면 TODO 생성

비대상: 그 외 모든 섹션의 체크박스는 TODO 생성 안 함 (일반 체크리스트).

생성 규칙:

  노트 저장 시 대상 섹션의 - [ ] 항목 파싱:
    1. 체크박스 텍스트에서 `[{project}]` 패턴 추출 → project 필드
       없으면 → 노트 frontmatter의 project[0] 사용
    2. todos.json에 동일 title + source_note 조합 존재 확인 → 중복 방지
    3. 새 TODO 생성:

       {
         "id": "todo-{auto}",
         "title": "{체크박스 텍스트 (태그 제거)}",
         "project": "{추출된 project}",
         "subsystem": "{노트 frontmatter의 subsystem[0]}",
         "status": "todo",
         "priority": "medium",
         "due_date": null,
         "source_note": "{현재 노트 id}",
         "source_section": "{섹션 제목}"
       }

       "내일 계획" 섹션인 경우 추가:
         "start_date": "{내일 날짜}"

동기화 규칙:

  체크박스 텍스트 수정 시:
    → 연결된 TODO의 title 동기화

  체크박스 완료 (- [x]) 시:
    → 연결된 TODO의 status → done, end_date → 오늘

  체크박스 삭제 시:
    → 연결된 TODO의 status → cancelled

  TODO 패널에서 완료 시:
    → 원본 노트의 체크박스도 - [x]로 변경 (양방향)

표시:
  자동 생성된 TODO는 TODO 패널에서 출처 표시:
    "📎 2026-06-09-analysis-001 > 후속 과제"
  클릭하면 해당 노트의 해당 섹션으로 이동.
```

### 3.16 토픽 자동 추천

```
노트 작성 중 topic 필드가 비어있을 때:
  1. 본문 텍스트 + tags + subsystem을 기반으로 기존 토픽 매칭

  매칭 로직:
    topics.json의 각 토픽에 대해:
      score = 0
      - 노트의 project가 토픽의 project와 일치 → +3
      - 노트의 subsystem이 토픽의 subsystem과 일치 → +2
      - 노트의 tags 중 토픽의 keywords에 포함된 것 → 각 +1
      - 본문에서 토픽의 keywords가 등장 → 각 +1

    score가 가장 높은 토픽 (최소 3점 이상) → 추천

  2. 추천이 있으면 에디터 상단 배너:
     "💡 이 노트는 'EKF 튜닝' 토픽과 관련된 것 같습니다 [연결] [다른 토픽] [무시]"

     [연결] → topic 필드에 해당 토픽 설정
     [다른 토픽] → 토픽 드롭다운 열기
     [무시] → 이 노트에서 다시 제안 안 함

  3. 추천 토픽이 없으면 배너 표시 안 함 (강제하지 않음)

  트리거 타이밍:
    - 노트 최초 저장 시
    - 본문이 100자 이상 작성된 시점 (짧은 메모에는 불필요)
    - topic이 이미 설정되어 있으면 추천 안 함

  새 토픽 생성 유도:
    추천 score가 모두 3점 미만이고, 같은 project에서 topic 없는 노트가 3개+ 쌓이면:
    → "새 토픽을 만들어서 관련 노트를 묶어보세요" 제안 (주 1회)
```

---

## 4. Statistics & Review 탭

### 4.1 탭 구조

```
[Statistics Tab]
├── Dashboard (실시간, AI 불필요)
├── Weekly Reviews (목록 + 생성)
├── Monthly Reviews (목록 + 생성)
└── Quarterly Reviews (목록 + 생성)
```

### 4.2 Dashboard

frontmatter 인덱스와 todos.json/workhours/*.json 기반. AI 불필요.

```
표시 항목:
  프로젝트별 시간 바 차트
  노트 유형별 생산량
  완료율, 시험 통과율
  TODO 완료율, overdue 수
  이월률
  주의 항목 (§3.14 건강 점검 결과)

기간 선택: [이번 주] [이번 달] [커스텀]
```

### 4.3 Review frontmatter stats

모든 리뷰 페이지의 frontmatter에 저장. 추이 차트 데이터 소스.

```yaml
stats:
  # Tier 1 기본 생산성
  total_workhour: 32.5
  workhour_by_project: { SAT-A-6U: 21.0, SAT-B-16U: 8.5, GENERAL: 3.0 }
  notes_created: 12
  notes_by_type: { quick-memo: 3, analysis-note: 4, test-log: 1, design-note: 1, study-note: 3 }
  completion_rate: 0.67
  test_pass_rate: 1.0
  carry_over_rate: 0.23
  todo_completion_rate: 0.75
  overdue_count: 2

  # Tier 2 기술 성장
  active_tags_top10: [ekf, gyro-bias, reaction-wheel, ...]
  new_tags: [b-dot, magnetic-control]
  study_notes_count: 3
  study_to_application: 0.67

  # Tier 3 의사결정 & 엔지니어링
  design_decisions: 1
  insight_count: 8
  decision_verification_rate: 1.0

  # Tier 4 지식 관리
  orphan_rate: 0.08
  avg_links_per_note: 2.3
```

### 4.4 AI 리뷰 생성 (Export → Claude.ai → Import)

앱 내에서 직접 AI를 호출하지 않음. 대신 데이터를 수집·포맷해서 claude.ai에서 분석한 뒤, 결과를 앱으로 가져오는 방식.

**워크플로우:**

```
[AI Report] 버튼 클릭
  │
  ├─ 리뷰 유형 선택: Weekly / Monthly / Quarterly
  │
  ├─ Step 1: Export (앱이 자동 처리)
  │   ├─ 해당 기간 데이터 수집 (daily-log, notes, frontmatter, todos)
  │   ├─ System Prompt(§4.5) + 수집 데이터를 하나의 텍스트로 포맷
  │   ├─ stats 수치 자동 계산 (§4.3의 Tier 1~4)
  │   ├─ 클립보드에 복사 + "claude.ai에 붙여넣으세요" 안내
  │   └─ (선택) claude.ai 자동 열기 (Tauri shell open)
  │
  ├─ Step 2: Claude.ai에서 분석 (사용자가 수행)
  │   ├─ claude.ai에 붙여넣기 → Claude가 분석 생성
  │   └─ Claude 응답 전체를 복사
  │
  └─ Step 3: Import (앱에서 처리)
      ├─ [Import Review] 버튼 클릭
      ├─ 클립보드에서 Claude 응답 자동 감지 or 텍스트 붙여넣기
      ├─ 앱이 frontmatter 자동 생성 (id, type, period, stats)
      ├─ reviews/{type}/{period-id}.md 로 저장
      └─ 리뷰 페이지 자동 열기
```

**장점:**
- API 키 / 과금 / 로컬 모델 불필요. 기존 claude.ai 구독 활용.
- Claude 최고 성능으로 분석 (로컬 모델 품질 제한 없음)
- 앱 구현이 단순 (데이터 수집 + 포맷 + 저장만)

**stats 자동 계산:**
Export 시 앱이 frontmatter/todos.json/workhours 기반으로 stats(§4.3)를 계산.
이 수치는 Claude에게도 전달되고, Import 시 Review frontmatter에도 저장됨.
→ Claude 분석 없이도 추이 차트 데이터는 항상 확보.

**데이터 수집 범위:**
- Weekly: Daily Log + Research Note **전문** (~3000-5000 tokens)
- Monthly: **주간 리뷰 + frontmatter 요약 + 인사이트 추출** (~4000-8000 tokens)
- Quarterly: **월간 리뷰 + Design Note + 회고** (~6000-12000 tokens)

### 4.5 Review System Prompts

#### Weekly

```
너는 GNC 엔지니어의 업무 리뷰를 분석하는 어시스턴트야.
사용자는 초소형 위성(6U~16U) ADCS/Orbit 담당.

아래 주간 데이터를 분석해서 리뷰 작성:

## 주간 요약 (프로젝트별 3-5줄)
## 핵심 인사이트 (기술적 발견/판단 3개)
## 기술 성장 스냅샷
  - 활발한 태그 Top 5
  - 새 태그 + 맥락
  - Study Note 요약
  - 학습→적용 연결 하이라이트
## TODO 현황
  - 완료/신규/overdue 목록
  - 3일+ 이월 항목 → 원인 분석
## 열린 후속 과제 (우선순위 제안)
## 기록 품질 (orphan, 빈 결론, 태그 부족)
## 다음 주 제안 (우선 업무 3개 + 학습 적용 기회 + 마감 경고)
```

#### Monthly

```
(동일 컨텍스트)

## 월간 요약
## 생산성 통계 (workhour, 노트, 완료율, 시험통과율, 주차별 추이)
## 기술 성장 분석
  - 태그 심화도 변화 (이번 달 vs 이전 달)
  - 학습→적용 전환율
  - 전문 영역 Top 3 (누적 노트 수)
## 의사결정 품질
  - Design Note 요약
  - 결정→검증 비율
## 업무 효율
  - 이월률 추이
  - TODO 마감 준수율
## 커리어 성장 제안 (성장 영역 + 다음 달 학습 추천 + 기록 습관 피드백)
```

#### Quarterly

```
(동일 컨텍스트)

## 분기 요약 + 주요 성과
## 종합 성장 점수 (생산성/기술성장/엔지니어링/지식관리 4축)
## 기술 포트폴리오
  - 기술 영역 맵
  - 깊이 vs 표면 영역
  - ADCS vs Orbit 비중
  - 학습→프로젝트 적용 하이라이트
## 프로젝트 기여도 (프로젝트별 노트/시험/의사결정 수)
## 의사결정 품질 (일관성, 검증 비율, 패턴)
## 업무 패턴 (시간 분배 추이, 분석vs시험 비율, 최생산적 주)
## 병목 & 개선점 (반복 이슈, stale 노트, 기록 습관)
## 장기 역량 로드맵 (강점, 보완 영역, 다음 분기 목표 3-5개, 1년 후 예측)
```

### 4.6 성장 점수 (Growth Score)

분기 리뷰에서 산출. 0~100. 자기 자신과의 비교 전용.

```
생산성    (20%): completion_rate × 0.5 + todo_completion × 0.3 + (1-carry_over) × 0.2
기술 성장  (30%): new_tags_norm × 0.3 + study_to_application × 0.4 + tag_depth_growth × 0.3
엔지니어링 (30%): decision_verification × 0.4 + conclusion_quality × 0.3 + anomaly_followup × 0.3
지식 관리  (20%): (1-orphan_rate) × 0.4 + links_growth × 0.3 + cross_project × 0.3

→ 레이더 차트로 4축 시각화 (Recharts)
```

---

## 5. UX 마이크로 자동화

습관 형성과 마찰 제거를 위한 세부 자동화.
**목적: 앱을 오래 쓸 수 있게 만드는 것. 한 번이라도 "귀찮다"는 느낌이 들면 포기로 이어짐.**

### 5.1 글로벌 Quick Capture 단축키

```
앱이 Dock 모드/최소화 상태에서도 글로벌 단축키 (Ctrl+Shift+N 등):
  → Quick Memo 오버레이 팝업 (작고 가벼움)
  → 제목 + 본문만 입력
  → project/tags는 나중에 채워도 됨 (status: draft)
  → Enter 두 번 → 저장 + 닫힘

효과: 회의 중, 브라우저 보다가, 슬랙 읽다가 즉시 캡처.
"노트앱 열기 → 새 노트 → 템플릿 선택" 과정 생략.
```

### 5.2 Morning Briefing (앱 실행 시)

```
앱 실행 + 당일 첫 접속 시:
  → 모달 또는 사이드 패널로 Morning Briefing 표시:

  ┌─────────────────────────────────────┐
  │  🌅 Good morning!                    │
  │                                       │
  │  📋 이월된 업무: 3건                   │
  │  ⚠️ 마감 초과 TODO: 1건               │
  │  📅 오늘 D-Day: SAT-A CDR (D-12)     │
  │  ⏰ 이번 주 workhour: 14.5h (목표 40) │
  │                                       │
  │  [오늘의 할 일 보기]  [닫기]            │
  └─────────────────────────────────────┘

3초 후 자동 닫힘 (설정 가능) 또는 클릭으로 닫기.
```

### 5.3 Evening Reminder (인사이트 기록)

```
설정 시간 (기본 18:00)에 OS 알림:
  "오늘 인사이트를 기록하셨나요? 💡"
  → 클릭 시 Daily Log의 "인사이트 & 의사결정" 섹션으로 이동

금요일에는 추가 알림:
  "이번 주 회고를 작성해보세요 📝"
  → 클릭 시 Daily Log의 "회고" 섹션으로 이동
```

### 5.4 스마트 템플릿 제안

```
상황별 자동 제안 (에디터 상단 배너):

Quick Memo 작성 중:
  - 본문에 "시뮬레이션", "결과", "분석" 키워드 → "Analysis Note로 승격?"
  - 본문에 "논문", "paper", "DOI", URL 패턴 → "Study Note로 승격?"
  - 본문에 "결정", "선택", "대안" → "Design Note로 승격?"

새 노트 생성 시:
  - 같은 날 Test Log가 이미 있으면 → "후 기능시험 Test Log?"
  - 최근 Study Note가 있으면 → "공부한 내용 적용하기 — Analysis Note?"
```

### 5.5 프로젝트 컨텍스트 자동 전환

```
사이드바에서 프로젝트 클릭 or 필터 선택 시:
  1. Zustand appStore.activeProject 설정
  2. 뽀모도로 타이머 활성 프로젝트 자동 전환
  3. 새 노트 생성 시 project 필드 자동 채움
  4. TODO 필터 자동 전환
  5. Daily Log의 해당 프로젝트 섹션으로 스크롤

효과: "SAT-A 작업 시작" 한 번이면 모든 뷰가 따라감
```

### 5.6 [[ ]] 위키링크 자동완성

```
에디터에서 [[ 입력 시:
  드롭다운 표시 (정렬 우선순위):
    1. 같은 topic 노트 (최신)
    2. 같은 project 노트 (최신)
    3. 최근 노트 (전체)

  검색 지원: id 또는 title 부분 매칭 (FTS5 재활용)

  선택 시:
    → [[{id}]] 삽입 + 대상 노트 related에 역참조 자동 추가

  존재하지 않는 id 입력 시:
    → 빨간 밑줄 + "노트를 찾을 수 없습니다"
```

### 5.7 클립보드 Quick Capture

```
앱이 포그라운드일 때 Ctrl+V:
  → 클립보드 내용이 URL이면 → "Study Note로 저장?" 미니 토스트
  → 클립보드 내용이 긴 텍스트(100자+)면 → "Quick Memo로 저장?" 미니 토스트
  → 일반 붙여넣기는 그대로 동작

미니 토스트: 3초 후 자동 소멸. 클릭 시 해당 템플릿으로 생성.
```

### 5.8 Study Note → 적용 추적

```
Study Note의 "내 프로젝트 적용 가능성" 섹션에 [[link]] 추가 시:
  → 연결된 Analysis/Design Note가 나중에 생성되면
  → Study Note에 "적용됨 ✅" 배지 표시
  → Statistics에서 study_to_application 비율 자동 계산

효과: 공부만 하고 안 쓰는 패턴 가시화
```

### 5.9 에디터 스마트 변환

```
TipTap 확장:
  "6/10" + space → "2026-06-10" 자동 변환 (현재 연도)
  "@SAT-A" + space → 프로젝트 링크 자동완성
  "sigma" + space → "σ" 변환 제안
  "omega" + space → "ω"
  "deg" + space → "°"
  "sqrt" + space → "√"
  "+/-" → "±"

활성화 여부는 Settings에서 토글.
```

### 5.10 반복 TODO 자동 생성

```
TODO에 recurring 필드가 설정되어 있으면:
  해당 주기마다 새 TODO 자동 생성 (이전 것은 done/cancelled 처리)

예시:
  "주간회의 참석" — recurring: {interval: "weekly", day: "monday"}
  → 매주 월요일 새 TODO 자동 생성

  "월간 보고서 작성" — recurring: {interval: "monthly", day: 25}
  → 매월 25일 새 TODO 자동 생성
```

### 5.11 노트 자동 아카이브

```
Quick Memo:
  status: complete + 14일 미수정 → status: archived (자동)
  → 아카이브된 노트는 목록에서 기본 숨김 (필터로 표시 가능)

효과: 활성 노트 목록이 깨끗하게 유지됨. 오래된 메모가 쌓여서 "어지럽다" 느낌 방지.
```

### 5.12 뽀모도로 프로젝트 자동 감지

```
뽀모도로 시작 시:
  1. 현재 열려있는 노트의 project 태그 감지
  2. 해당 프로젝트로 세션 자동 설정
  3. 노트를 안 열고 시작하면 → 마지막 사용 프로젝트 또는 드롭다운

효과: 별도로 프로젝트를 선택하는 단계 제거
```

### 5.13 백링크 사이드 패널

```
노트 열 때 오른쪽 사이드 패널 (접이식):
  "이 노트를 참조하는 노트" 목록 (links.json backward 기반)
  + "관련될 수 있는 노트" 제안 (같은 tags이지만 linked 안 된 노트)

효과: 수동으로 related를 관리하지 않아도 연결 네트워크가 보임
```

---

## 6. 구현 가이드

### 6.1 Phase 7 세부 순서

```
7-A: 데이터 모델 확장 (1-2일)
  ├─ frontmatter 스키마 v2
  ├─ 기존 노트 마이그레이션 스크립트
  ├─ todos.json 필드 확장
  ├─ tags.json 인덱스 생성
  ├─ topics.json 토픽 목록 생성
  ├─ links.json 그래프 인덱스 생성
  └─ subsystems.json 생성

7-B: 템플릿 & Daily Log (2-3일)
  ├─ 6종 노트 템플릿 교체 (+ Blank 유지)
  ├─ Daily Log 구조화 (프로젝트 섹션, 인사이트, 자동 집계, 내일 계획)
  ├─ 미완료 업무 이월 (§3.5)
  ├─ TODO ↔ Daily Log 연동 (§3.6)
  ├─ Quick Memo 승격 (§3.2)
  └─ Morning Briefing (§5.2)

7-C: 링크 시스템 (2-3일)
  ├─ [[ ]] 위키링크 자동완성 (§5.6, FTS5 재활용)
  ├─ 자동 링크 규칙 1~4 (§3.1~3.4)
  ├─ 백링크 사이드 패널 (§5.13)
  ├─ links.json 자동 갱신
  └─ 태그 자동완성 + subsystem enum UI (§3.9)

7-D: Workhour 추적 (1-2일)
  ├─ workhours/{date}.json 저장
  ├─ 뽀모도로 → 프로젝트별 시간 (§5.12)
  ├─ 수동 시간 입력 UI
  ├─ Daily Log workhour/workhour_detail 자동 갱신
  └─ 프로젝트 컨텍스트 자동 전환 (§5.5)

7-E: Dashboard & Statistics (2-3일)
  ├─ Statistics 탭 UI
  ├─ Dashboard (§4.2)
  ├─ 노트 건강 점검 (§3.14)
  └─ 추이 미니 차트 (Recharts)

7-F: AI Review — Export/Import (2-3일)
  ├─ [AI Report] 버튼 → 데이터 수집 + System Prompt 포맷 + 클립보드 복사
  ├─ stats 자동 계산 (frontmatter/todos/workhours 기반)
  ├─ claude.ai 자동 열기 (Tauri shell)
  ├─ [Import Review] 버튼 → 클립보드/텍스트 입력 → frontmatter 생성 → 저장
  ├─ reviews/ 폴더 구조 + Review 목록 UI + 페이지 뷰
  └─ 리뷰 리마인더 알림 (월요일 08:00 / 매월 1일)

7-G: 마이크로 자동화 (2-3일)
  ├─ 글로벌 Quick Capture 단축키 (§5.1)
  ├─ Evening Reminder (§5.3)
  ├─ 스마트 템플릿 제안 (§5.4)
  ├─ 반복 분석 조건 자동 채움 (§3.11)
  ├─ 시험 전후 비교 자동화 (§3.12)
  ├─ 코드 참조 자동 감지 (§3.13)
  ├─ Daily Log 자동 요약 (§3.10)
  ├─ subsystem/태그 자동 추출 (§3.8, §3.9)
  ├─ Study Note 적용 추적 (§5.8)
  ├─ 반복 TODO (§5.10)
  ├─ 노트 자동 아카이브 (§5.11)
  ├─ 클립보드 Quick Capture (§5.7)
  └─ 에디터 스마트 변환 (§5.9)
```

### 6.2 파일 구조 (최종)

```
~/JRH-Orbit-Data/                    (클라우드 동기화 폴더)
├── notes/
│   ├── daily/                        ← 기존 유지
│   │   ├── 2026-06-04.md
│   │   └── 2026-06-05.md
│   └── research/                     ← 파일명 규칙: {date}-{type}-{seq}.md
│       ├── 2026-06-05-analysis-001.md
│       ├── 2026-06-05-memo-001.md
│       ├── 2026-06-05-test-001.md
│       ├── 2026-06-05-design-001.md
│       └── 2026-06-05-study-001.md
├── reviews/                          ← 신규
│   ├── weekly/2026-W23.md
│   ├── monthly/2026-06.md
│   └── quarterly/2026-Q2.md
├── data/
│   ├── todos.json                    ← 기존 (필드 확장)
│   ├── projects.json                 ← 기존
│   ├── tags.json                     ← 신규
│   ├── topics.json                   ← 신규
│   ├── links.json                    ← 신규
│   ├── subsystems.json               ← 신규
│   ├── ddays.json                    ← 기존
│   ├── playlist.json                 ← 기존
│   └── workhours/                    ← 신규
│       └── 2026-06-05.json
├── templates/                        ← 신규 (커스터마이즈 가능)
│   ├── daily-log.md
│   ├── quick-memo.md
│   ├── analysis-note.md
│   ├── test-log.md
│   ├── design-note.md
│   └── study-note.md
├── attachments/                      ← 기존
└── config.json                       ← 기존 (review 설정 추가)
```

### 6.3 config.json 추가 필드

```json
{
  "review": {
    "reminder_weekly": true,
    "reminder_weekly_day": "monday",
    "reminder_weekly_time": "08:00",
    "reminder_monthly": true,
    "reminder_monthly_day": 1,
    "open_claude_ai_on_export": true
  },
  "active_project": null,
  "notifications": {
    "morning_briefing": true,
    "evening_reminder": true,
    "evening_reminder_time": "18:00",
    "friday_retro_reminder": true
  },
  "editor": {
    "smart_transform": true,
    "auto_tag_suggest": true,
    "auto_subsystem_suggest": true,
    "clipboard_capture": true
  },
  "tag_rules": {
    "format": "lowercase-hyphen",
    "require_confirmation_for_new": true
  },
  "auto_archive": {
    "quick_memo_days": 14
  }
}
```

`reminder_weekly/monthly`: 자동 생성이 아닌 "리뷰 생성하세요" OS 알림.
`open_claude_ai_on_export`: Export 시 claude.ai를 자동으로 브라우저에서 열기.

---

## 7. Window & Layout 확장

### 7.1 투명도 조절 (Opacity Slider)

```
모든 모드(Dock / Sidebar / Expanded)에서 창 투명도를 조절할 수 있는 슬라이더.

위치: 상단 TitleBar 영역 (우측, 창 컨트롤 버튼 옆)

UI:
  ┌─── TitleBar ──────────────────────────────────────┐
  │  [☰] JRH-Orbit        🔆━━━●━━━━ 80%   [─][□][×] │
  └───────────────────────────────────────────────────┘
  
  - 아이콘(🔆 또는 투명도 아이콘) + 슬라이더 바 + 퍼센트 표시
  - 범위: 30% ~ 100% (30% 미만은 조작 불가능하므로 제한)
  - 기본값: 100%
  - 슬라이더 드래그 실시간 반영

구현:
  - CSS: `opacity` 또는 Tauri window API의 `set_opacity()` 활용
  - Tauri 2 WebviewWindow.setAlpha() 또는 window effects 활용
  - 모드별 독립 투명도 저장 (config.json에 영속화)
    {
      "window": {
        "opacity_dock": 100,
        "opacity_sidebar": 100,
        "opacity_expanded": 100
      }
    }
  - 모드 전환 시 해당 모드의 저장된 투명도 자동 적용

단축키 (선택):
  - Cmd+Shift+[ : 투명도 10% 감소
  - Cmd+Shift+] : 투명도 10% 증가
```

### 7.2 사이드바/독 디자인 통일 (Theme Design Sync)

```
현재 상태:
  - Expanded 모드: 테마별 디자인 요소가 풍부하게 적용됨 (배경 패턴, 보더 스타일, 그림자, 아이콘 스타일 등)
  - Dock/Sidebar 모드: 색상 테마만 적용, 디자인 요소(패턴, 보더, 그림자 등)는 미적용

개선 목표:
  Expanded 모드의 테마 디자인 요소를 Dock/Sidebar에도 적용하여 모드 간 시각적 일관성 확보.

적용 대상 디자인 요소:
  1. 배경 패턴/텍스처 — 테마별 배경 이미지 또는 CSS 패턴
  2. 보더 스타일 — 테두리 색상, 두께, radius 통일
  3. 그림자/글로우 — box-shadow, text-shadow 등 테마별 효과
  4. 아이콘/버튼 스타일 — hover/active 상태, 버튼 형태
  5. 폰트 스타일 — 테마별 폰트 패밀리, weight 차이
  6. 스크롤바 스타일 — 커스텀 스크롤바 테마 적용
  7. 구분선/세퍼레이터 — 섹션 구분선 스타일

모드별 적용 범위:
  Dock 모드 (72x520 세로):
    - 배경 패턴 (축소/타일링)
    - 아이콘 hover 효과
    - 보더 스타일
    - 타이머/시계 영역 테마 장식

  Sidebar 모드:
    - 사이드바 패널 배경 패턴
    - 섹션 헤더 스타일 (Projects/D-Day/Tags/Tasks)
    - 리스트 아이템 hover/active 효과
    - 접기/펼치기 토글 스타일
    - 스크롤바 커스텀 스타일

구현 방식:
  - 테마 CSS 변수를 확장하여 디자인 토큰 추가:
    --theme-border-style, --theme-shadow, --theme-bg-pattern,
    --theme-hover-effect, --theme-separator, --theme-scrollbar-*
  - DockMode.tsx, Sidebar.tsx에 테마 클래스 적용
  - 각 테마 CSS 파일에 Dock/Sidebar 전용 섹션 추가
```

### 7.3 확장 모드 줌 (Zoom In/Out)

```
Expanded 모드에서 전체 창 내용을 확대/축소.

단축키:
  - Cmd + = (또는 Cmd + +) : 확대 (zoom in)
  - Cmd + -               : 축소 (zoom out)
  - Cmd + 0               : 기본 크기 (100%) 복원

줌 범위: 50% ~ 200% (10% 단위 스텝)
기본값: 100%

구현:
  - WebView의 CSS `zoom` 또는 `transform: scale()` 활용
  - 또는 Tauri WebView API의 zoom level 제어
  - 현재 줌 레벨 표시: StatusBar 또는 TitleBar에 "120%" 배지
  - config.json에 영속화:
    {
      "window": {
        "zoom_level": 100
      }
    }

주의사항:
  - Dock/Sidebar 모드에서는 줌 비활성화 (공간이 제한적)
  - 줌 시 레이아웃 깨짐 방지: rem/em 단위 기반 반응형 설계 확인
  - 에디터 영역만 별도 줌도 고려 (에디터 폰트 크기 조절과 병행)
```

### 7.4 항상 위 (Always on Top) 모드별 설정

```
Dock/Sidebar/Expanded 모드 각각에 대해 "항상 위" 설정을 독립적으로 제어.

현재 상태:
  - Dock 모드: 항상 위 고정 (하드코딩)
  - Sidebar 모드: 설정 없음
  - Expanded 모드: 항상 위 아님 (기본)

개선:
  Settings 뷰에 Always on Top 섹션 추가:

  ┌─── Always on Top ───────────────────────────┐
  │                                              │
  │  Dock Mode         [■ On ] / [ Off]          │
  │  Sidebar Mode      [ On ] / [■ Off]          │
  │  Expanded Mode     [ On ] / [■ Off]          │
  │                                              │
  └──────────────────────────────────────────────┘

  - 모드 전환 시 해당 모드의 always_on_top 설정 자동 적용
  - Tauri WebviewWindow.setAlwaysOnTop(bool) 호출
  - config.json 영속화:
    {
      "window": {
        "always_on_top_dock": true,
        "always_on_top_sidebar": false,
        "always_on_top_expanded": false
      }
    }
  
  기본값:
    - Dock: true (기존 동작 유지)
    - Sidebar: false
    - Expanded: false
```

---

## 8. Task 편집 UX 개선

### 8.1 사이드바 태스크 클릭 → 편집 창

```
현재 상태:
  - 사이드바에서 태스크 목록은 보이지만, 클릭 시 편집 불가
  - 서브태스크에 편집/삭제 마커 없음
  - 태스크 수정을 위해 Expanded 모드의 Task 뷰로 이동해야 함

개선:
  1. 메인 태스크 클릭 → 인라인 편집 패널 또는 모달
  2. 서브태스크 클릭 → 서브태스크 편집 모달
  3. 서브태스크에 편집(✏️)/삭제(🗑️) 아이콘 마커 추가

태스크 편집 모달 UI:
  ┌─── Edit Task ────────────────────────────┐
  │                                           │
  │  Title:    [EKF Q matrix 스터디_________] │
  │  Project:  [SAT-A-6U ▼]                  │
  │  Priority: [● High ▼]                    │
  │  Status:   [In Progress ▼]               │
  │  Due Date: [2026-06-10 📅]               │
  │                                           │
  │  Subtasks:                                │
  │  ☐ 문헌 조사         [✏️][🗑️]            │
  │  ☑ 시뮬레이션 셋업    [✏️][🗑️]            │
  │  [+ Add Subtask]                          │
  │                                           │
  │  Tags: [ekf] [gyro-bias] [+]             │
  │                                           │
  │  [Cancel]              [Save]             │
  └───────────────────────────────────────────┘

서브태스크 편집/삭제 마커:
  - 각 서브태스크 우측에 호버 시 ✏️(편집) 🗑️(삭제) 아이콘 표시
  - ✏️ 클릭 → 인라인 텍스트 입력으로 전환 (Enter로 저장, Esc로 취소)
  - 🗑️ 클릭 → 확인 없이 즉시 삭제 (undo 토스트 3초)

적용 범위:
  - Sidebar 모드: 사이드바의 Tasks 섹션에서 태스크/서브태스크 클릭 편집
  - Dock 모드: 독의 Tasks 뷰에서 태스크 클릭 편집
  - Expanded 모드: 기존 TaskListView에서도 동일한 편집 모달 사용 (통일)
```

---

## 9. Statistics 확장

### 9.1 Workhour by Day (요일별 작업시간)

```
Statistics Dashboard에 "Workhour by Day" 차트 추가.

요일별 (월~일) 작업시간을 바 차트로 시각화.

기간별 표시:
  This Week:
    - 월/화/수/목/금/토/일 개별 바 (해당 주의 실제 작업시간)
    - X축: 요일명, Y축: 시간(h)
    
  This Month:
    - 1주차 ~ N주차 그룹핑
    - 각 주차별 요일 작업시간 스택 바 또는 히트맵
    - 주차 경계: 월요일 시작 (ISO 8601 주)
    
    히트맵 레이아웃 (GitHub contribution 스타일):
    ┌──────────────────────────────────────┐
    │       1주  2주  3주  4주  5주        │
    │  월   ██   ██   ██   ░░   --        │
    │  화   ██   ██   ░░   ██   --        │
    │  수   ██   ░░   ██   ██   --        │
    │  목   ░░   ██   ██   ██   --        │
    │  금   ██   ██   ██   ░░   --        │
    │  토   ░░   ░░   --   --   --        │
    │  일   --   --   --   --   --        │
    └──────────────────────────────────────┘
    (██ = 근무, ░░ = 소량, -- = 없음)

데이터 소스:
  workhours/{date}.json의 세션 기록을 요일별로 집계.
  date → dayOfWeek (date-fns의 getDay 활용)

차트 라이브러리: Recharts BarChart + 커스텀 히트맵 (CSS Grid)
```

### 9.2 추가 시각화 추천

```
기존 Dashboard 대비 추가로 관리하면 좋은 파라미터 및 시각화 요소:

1. 시간대별 생산성 히트맵 (Productivity by Hour)
   - X축: 시간 (0~23시), Y축: 요일
   - 노트 생성/수정 시간 + 뽀모도로 세션 시간 기반
   - 효과: 본인의 골든타임(집중 시간대) 파악
   - 차트: 히트맵 (CSS Grid + 색상 강도)

2. 프로젝트 시간 추이 (Project Time Trend)
   - X축: 날짜, Y축: 시간
   - 프로젝트별 라인 차트 (Recharts LineChart)
   - 효과: 프로젝트 간 시간 배분 변화 추적
   - 기간: This Month (일별), Custom (주별 집계)

3. 연속 기록 스트릭 (Writing Streak)
   - 연속으로 Daily Log를 작성한 일수 (GitHub streak과 유사)
   - 현재 스트릭 + 최장 스트릭 표시
   - 효과: 기록 습관 형성 동기부여
   - UI: 불꽃 아이콘 + "🔥 12일 연속 기록 중"

4. 태그 클라우드 / 기술 영역 트렌드 (Tag Cloud)
   - 이번 기간 활발한 태그를 워드 클라우드로 표시
   - 또는 태그 빈도 변화 추이 (이번 달 vs 지난 달)
   - 효과: 어떤 기술 영역에 집중하고 있는지 한눈에 파악

5. 노트 유형 비율 추이 (Note Type Trend)
   - 주차/월별로 노트 유형(analysis/test/study/design) 비율 변화
   - Recharts AreaChart (스택)
   - 효과: 분석 중심인지 시험 중심인지 작업 패턴 파악

6. 집중 시간 분포 (Focus Session Distribution)
   - 뽀모도로/스톱워치 세션 길이 분포 (히스토그램)
   - 평균 집중 시간, 최장 집중 시간
   - 효과: 집중력 패턴 분석

구현 우선순위:
  Phase 10-F 필수: ①요일별 작업시간, ③연속 기록 스트릭
  Phase 10-F 권장: ②프로젝트 시간 추이, ①시간대별 히트맵
  추후: ④태그 클라우드, ⑤유형 추이, ⑥집중 분포
```

---

### 6.4 PLAN.md 변경 사항

```
Phase 7 → 7-A ~ 7-G로 세분화 (위 §6.1)
Phase 8에서 제거:
  - [[ ]] 위키링크 → Phase 7-C로 이관
Phase 8에 추가:
  - Growth Score 레이더 차트
  - 옵시디언 그래프 뷰 (links.json 시각화)
  - 에디터 스마트 변환 (§5.9)
  - Mermaid 다이어그램 (기존 유지)
```

### 6.5 Claude Code 사용 가이드

이 파일을 프로젝트 루트에 `SPEC.md`로 저장.

**Phase별 프롬프트 예시:**

```
Phase 7-A:
  "SPEC.md §1 데이터 모델을 읽고, frontmatter 스키마를 확장해줘.
   기존 noteStore에서 frontmatter 파싱 로직을 수정하고,
   tags.json, topics.json, links.json, subsystems.json 초기화 로직을 추가해.
   기존 노트 마이그레이션 스크립트도 만들어줘."

Phase 7-B:
  "SPEC.md §2 템플릿과 §3.5-3.6을 읽고, 노트 템플릿 6종을 구현해줘.
   기존 + New 드롭다운의 선택지를 교체하고,
   Daily Log 구조를 §2.1대로 변경해. TODO 연동과 이월 로직도 함께."

Phase 7-C:
  "SPEC.md §5.6과 §3.1-3.4를 읽고, [[]] 위키링크를 구현해줘.
   기존 FTS5 검색 인프라를 재활용하고,
   links.json 인덱스와 백링크 사이드 패널도 만들어."

Phase 7-G:
  "SPEC.md §5 전체를 읽고, 마이크로 자동화를 하나씩 구현해줘.
   §5.1 글로벌 단축키부터 시작하고, 각 기능 완료 후 다음으로 넘어가."
```
