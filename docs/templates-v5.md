# JRH-Orbit 템플릿 v5 (최종) — SPEC.md §2 교체용

> 공통 서식: 헤더(`#`/`##`/`###`) 바로 아래 빈 줄 없이 내용 시작 · 섹션 간 빈 줄 2개
> Research Note 공통 뼈대: 목적 / 내용 / 분석
> Daily Log: 자동 대시보드 + 메모

---

## 공통 서식 규칙

```
## 섹션 제목
- 내용 1
- 내용 2


## 다음 섹션
- 내용 3
```

- 모든 헤더 바로 아래에 빈 줄 없이 내용 시작
- 내용은 불릿(`-`)으로 시작
- 섹션과 섹션 사이 빈 줄 **2개**
- **예외**: 체크박스(`- [ ]`), 테이블(`| |`)은 불릿 대신 해당 형식 사용

---

## 1. Daily Work Log

```markdown
---
id: "{date}-daily"
type: daily-log
title: "{date} 업무일지"
date: { date }
project: []
workhour: 0
workhour_detail: []
carried_over: []
---

## 작업

### 🛰️ {project}

- [ ] [todo-001] {TODO 항목} (D-5)
- [x] [todo-003] {완료된 TODO}
- {그날 진행한 작업 내용}
- {진행 내용} → [[{노트 링크}]]

### 📌 GENERAL

- [x] 주간회의
- {회의 내용 요약}

## 메모

<!-- #토픽명을 붙이면 해당 Topic Hub에 자동 연결 -->

- #EKF-튜닝 OBC 팀에서 인터페이스 변경 통보. 상태벡터 포맷 확인 필요
- #RW-환경시험 열팀 열진공 일정 2주 지연
- CDR 일정 7/1 확정

## 노트

<!-- 자동 집계 -->

| 유형   | 제목             | 프로젝트  | 토픽    |
| ------ | ---------------- | --------- | ------- |
| {icon} | [[{id}]] {title} | {project} | {topic} |

## 내일

<!-- ⚡ - [ ] → 자동 TODO + 내일 작업에 표시 -->

- [ ] `[{project}]` {할 일}
```

### Daily Log 요약

- **작업**: 프로젝트별 H3. 체크박스(`- [ ]`) = TODO(자동 삽입), 일반 불릿(`-`) = 진행 내용(수동). 노트 링크 가능.
- **메모**: 짧은 내용은 여기에. `#토픽명` 인라인 태그 → Topic Hub 타임라인에 자동 표시. 태그 없는 항목은 일반 메모.
- **노트**: 당일 생성/수정된 Research Note 자동 집계. 유형/제목/프로젝트/토픽 4열.
- **내일**: `- [ ]` 체크박스 → 자동 TODO 등록 + 다음날 Daily Log 작업에 표시.
- 매일 직접 쓰는 양: **작업의 `-` 진행 내용 + 메모 + 내일** (2~3분)

---

## 2. Quick Memo 💬

```markdown
---
id: "{date}-memo-{seq}"
type: quick-memo
title: ""
date: { date }
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: complete
---

- {자유 형식}
```

- 구조 없음. 가장 낮은 마찰.
- Analysis / Design / Study Note로 승격 가능.

---

## 3. Analysis Note 📊

```markdown
---
id: "{date}-analysis-{seq}"
type: analysis-note
title: ""
date: { date }
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
---

## 목적

- {이 분석을 왜 하는가}
- {무엇을 확인하려 하는가}

## 내용

<!-- 자유 형식. 조건, 과정, 결과 등 -->
<!-- 필요 시 에디터 툴바 → [+ 블록 삽입] → 조건 테이블 / 결과 테이블 / 파일 참조 -->

## 분석

- {핵심 결론}
- {왜 그런 결과인가}
- {다음 할 일}

## 후속 과제

<!-- ⚡ - [ ] → 자동 TODO (이 노트와 연결) -->

- [ ] {다음 분석/시험}
```

- **내용** 섹션은 빈 캔버스. 테이블/코드/이미지는 필요할 때 삽입.
- 같은 topic의 이전 Analysis Note가 있으면 조건 테이블 자동 복사 제안.

---

## 4. Test Log 🔧

```markdown
---
id: "{date}-test-{seq}"
type: test-log
title: ""
date: { date }
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
verdict: ""
---

## 목적

- {시험 이유}
- {판정 기준}

## 내용

<!-- 장비, 절차, 측정 데이터 -->
<!-- 필요 시 에디터 툴바 → 장비 테이블 / 측정 데이터 테이블 삽입 -->

### 🟢 PASS / 🔴 FAIL / 🟡 CONDITIONAL

## 분석

- {결과 해석}
- {이상 소견: 관측 / 추정 원인 / 조치 필요 여부}
- {다음}

## 후속 조치

<!-- ⚡ - [ ] → 자동 TODO (이 노트와 연결) -->

- [ ] {다음 시험}
- [ ] {이상 소견 공유: {담당자}}
```

- **verdict**: frontmatter에 pass/fail/conditional 기록. 판정 선택 시 자동 반영.
- 같은 topic의 이전 Test Log가 있으면 전후 비교 테이블 자동 생성.

---

## 5. Design Note 📐

```markdown
---
id: "{date}-design-{seq}"
type: design-note
title: ""
date: { date }
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
---

## 목적

- {어떤 결정이 필요한가}
- {제약 조건}

## 내용

| 대안       | 장점 | 단점 | 비고 |
| ---------- | ---- | ---- | ---- |
| **{선택}** |      |      | ✅   |
| {대안 2}   |      |      |      |
| {대안 3}   |      |      |      |

## 분석

- {왜 이것을 선택했는가}
- {리스크 + 완화 방안}
- {검증 계획}
```

- **대안 비교 테이블**이 내용 섹션에 기본 포함 (Design Note의 핵심).

---

## 6. Study Note 📚

```markdown
---
id: "{date}-study-{seq}"
type: study-note
title: ""
date: { date }
project: []
topic: ""
subsystem: []
tags: []
related: ["{date}-daily"]
status: draft
---

## 목적

- {뭘 공부하는가}
- {왜 필요한가 / 어디에 쓸 건가}

## 내용

<!-- 출처, 핵심 개념, 수식 등 자유롭게 -->

## 분석

- {내 프로젝트에 어떻게 적용 가능한가}
- {한계 / 주의사항}
- {추가 조사 필요한 것}
```

---

## 7. 유형별 차이 요약

| 유형       | 뼈대           | 특수 요소           | 후속 섹션 |
| ---------- | -------------- | ------------------- | --------- |
| Quick Memo | 없음 (자유)    | —                   | —         |
| Analysis   | 목적/내용/분석 | —                   | 후속 과제 |
| Test Log   | 목적/내용/분석 | verdict + 판정 표시 | 후속 조치 |
| Design     | 목적/내용/분석 | 대안 비교 테이블    | —         |
| Study      | 목적/내용/분석 | —                   | —         |

---

## 8. 승격 매핑 규칙

Quick Memo → 다른 유형으로 승격 시 본문 이동 위치:

| 승격 대상 | 메모 본문 → 이동 | 추가되는 스켈레톤       |
| --------- | ---------------- | ----------------------- |
| Analysis  | → `## 목적` 불릿 | 내용, 분석, 후속 과제   |
| Design    | → `## 목적` 불릿 | 내용(대안 테이블), 분석 |
| Study     | → `## 내용`      | 목적, 분석              |

---

## 9. 에디터 삽입 가능 블록

"내용" 섹션에서 필요할 때 에디터 툴바 `[+ 블록 삽입]`으로 추가:

| 블록                     | 용도                          | 자동 채움                          |
| ------------------------ | ----------------------------- | ---------------------------------- |
| 조건 테이블 (Base/Sweep) | Analysis 시뮬레이션 조건 정리 | 같은 topic 이전 노트에서 복사      |
| 측정 데이터 테이블       | Test 측정 결과 정리           | 같은 topic 이전 Test에서 컬럼 복사 |
| 장비/환경 테이블         | Test 시험 장비 목록           | —                                  |
| 판정 기준 테이블         | Test 합격 기준                | —                                  |
| 파일 참조 블록           | 코드/문서 경로 정리           | 본문 파일 경로 자동 감지           |
| 비교 테이블              | Design 대안 비교 (기본 포함)  | —                                  |
| 전후 비교 테이블         | Test 전/후 데이터 비교        | 이전 Test 데이터 자동 불러옴       |
