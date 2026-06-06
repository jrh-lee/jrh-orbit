# JRH-Orbit 실사용 가이드

> 하루 일과 흐름으로 배우는 자동화 기능 활용법
> 모든 예시는 실제 GNC 엔지니어 업무 기반

---

## AI Review 워크플로우

### Export → Claude.ai → Import 방식

앱 내에서 AI를 직접 호출하지 않습니다. 대신:

```
1. [AI Report] 버튼 클릭 → 리뷰 유형 선택 (Weekly/Monthly/Quarterly)
2. 앱이 해당 기간 데이터를 수집 + System Prompt와 합쳐서 클립보드에 복사
3. claude.ai가 자동으로 열림
4. Ctrl+V로 붙여넣기 → Claude가 분석 생성
5. Claude 응답 전체 복사
6. 앱에서 [Import Review] 클릭 → 붙여넣기 → 저장 완료
```

**장점:**
- API 과금 없음 (기존 claude.ai 구독 활용)
- Claude 최고 성능으로 분석
- stats(workhour, 완료율 등)는 앱이 자동 계산해서 추이 차트는 항상 확보

---

## 하루 일과 흐름

### 🌅 08:00 — 출근, 앱 실행

앱을 켜면 두 가지가 **자동으로** 일어납니다.

**① 오늘의 Daily Log가 자동 생성됩니다.**

```markdown
---
id: "2026-06-09-daily"
type: daily-log
title: "2026-06-09 업무일지"
date: 2026-06-09
project: [SAT-A-6U, SAT-B-16U]
workhour: 0
carried_over:
  - from: "2026-06-06-daily"
    items: 2
---

## 오늘의 작업

### 🛰️ SAT-A-6U
- [ ] [todo-003] RW 토크 마진 검토 ⚠️ (6/6 이월, D+3 초과)
- [ ] [todo-008] CDR 발표자료 RW 섹션 작성 (D-21)

### 🛰️ SAT-B-16U
- [ ] [todo-012] 궤도결정 코드 리뷰 (6/6 이월)

### 📌 GENERAL
- [ ] 주간회의 참석 (반복)

## 인사이트 & 의사결정
## 오늘 생성한 노트
## 내일 계획
```

여기서 자동화된 것들:
- **금요일에 못 끝낸 RW 토크 마진 검토**가 자동으로 이월됨 + `(6/6 이월)` 표시
- **D+3 초과** 경고가 자동으로 붙음 (due_date가 6/6이었으니까)
- **in-progress TODO**가 프로젝트별 섹션에 자동 삽입됨
- **반복 TODO** "주간회의 참석"이 매주 월요일 자동 생성됨
- 전주 Daily Log들에 있던 project 태그가 이번 주에도 이어짐

**② Morning Briefing 패널이 뜹니다.**

```
┌─────────────────────────────────────┐
│  🌅 Good morning!                    │
│                                       │
│  📋 이월된 업무: 2건                   │
│  ⚠️ 마감 초과 TODO: 1건 (RW 토크 마진) │
│  📅 D-Day: SAT-A CDR (D-21)          │
│  ⏰ 지난주 workhour: 34.5h            │
│                                       │
│  📊 주간 리뷰를 생성할 시간입니다!     │
│  [AI Report 열기]  [닫기]              │
└─────────────────────────────────────┘
```

**③ [AI Report 열기]를 클릭하면 리뷰 생성 플로우가 시작됩니다.**

```
1. "Weekly Review (6/2~6/8)" 선택
2. 앱이 지난주 데이터를 수집 + 포맷 → 클립보드에 복사됨
3. claude.ai가 자동으로 열림
4. Ctrl+V → Claude가 분석 생성 (30초~1분)
5. Claude 응답 전체 복사 (Ctrl+A → Ctrl+C)
6. 앱으로 돌아와서 [Import Review] → 붙여넣기 → 저장
```

리뷰를 열면 Claude가 분석한 결과가 보입니다:

```markdown
## 주간 요약
SAT-A: EKF Q matrix 최적화 완료 (Case C=1e-6 선정), B-dot 디텀블링 설계 시작.
SAT-B: 궤도결정 코드 리뷰 착수했으나 미완료.

## 핵심 인사이트
1. Q matrix 바이어스 항은 자이로 스펙 기반으로 설정해야 함 — 이전 설정(1e-8)이
   4자릿수나 차이나는 건 초기 설계 시 근거 없이 잡았기 때문. Design Note로 기록 권장.
2. ...

## TODO 현황
⚠️ "RW 토크 마진 검토"가 3일 연속 이월 중. 
   → 다른 업무에 밀리는 패턴. 오전 중 30분 블록으로 먼저 처리 권장.
```

**아무것도 안 했는데 이미 하루가 정리되어 있습니다.**

---

### 🔬 09:00 — RW 토크 마진 분석 시작

주간 리뷰에서 경고한 대로 RW 토크 마진 검토부터 시작합니다.

**사이드바에서 SAT-A-6U를 클릭합니다.**

자동으로 일어나는 것들:
- 뽀모도로 타이머의 활성 프로젝트 → SAT-A-6U로 전환
- TODO 패널 필터 → SAT-A-6U만 표시
- 다음에 만드는 새 노트의 project 필드 → SAT-A-6U 자동 채움

**뽀모도로 시작 버튼을 누릅니다.** (25분 집중)

타이머가 열려있는 노트의 프로젝트(SAT-A-6U)를 자동 감지해서 별도 선택 없이 시작됩니다.

**새 Analysis Note를 생성합니다.** `+ New → 📊 Analysis Note`

```markdown
---
id: "2026-06-09-analysis-001"
type: analysis-note
title: ""                              ← 여기만 입력하면 됨
date: 2026-06-09                       ← 자동
project: [SAT-A-6U]                    ← 자동 (activeProject)
experiment: ""                         ← 입력 시작하면 자동완성 표시
subsystem: [ADCS]                      ← 자동 제안됨 (RW 관련 키워드 감지)
tags: []                               ← 본문 작성 중 자동 제안됨
related: ["2026-06-09-daily"]          ← 자동
status: draft                          ← 자동
---
```

**experiment 필드에 "RW" 를 타이핑합니다.**

자동완성 드롭다운이 뜨면서 기존 experiment 목록이 표시됩니다:
```
RW-QUAL-003  (SAT-A-6U, 최근: 6/5)
RW-FUNC-001  (SAT-A-6U, 최근: 5/20)
```

`RW-QUAL-003`을 선택하면:

**"이전 분석에서 조건을 가져왔습니다" 토스트가 뜹니다!**

같은 experiment의 마지막 Analysis Note에서 Base 조건 테이블이 자동으로 복사됩니다:

```markdown
## 분석 조건

### 공통 조건 (Base)

| 파라미터 | 값 | 비고 |
|---|---|---|
| 시뮬레이션 도구 | MATLAB R2024b | `rw_torque_margin.m` |
| RW 모델 | RW-01 (최대 토크 4 mNm) | S/N: RW-A-0023 |
| 궤도 | SSO 500km, LTAN 10:30 | |
| 자세 모드 | 3축 안정화 (나디르 포인팅) | |
```

**궤도, RW 스펙, 시뮬레이션 도구를 다시 적을 필요가 없습니다.** 바뀐 조건만 Sweep 테이블에 추가하면 됩니다.

**본문을 작성하다가 `rw_torque_margin.m`을 입력합니다.**

`.m` 파일 경로가 감지되어 "코드 / 파일 참조" 섹션에 자동 추가됩니다.

**본문에 "반응 휠"이라는 단어를 적습니다.**

에디터 상단에 배너:
```
subsystem: ADCS 추가? [추가] [무시]
태그 제안: reaction-wheel [추가] [무시]
```

[추가]를 누르면 frontmatter가 자동 업데이트됩니다.

---

### 🗓️ 10:00 — 주간회의 참석, Quick Memo

회의 중에 갑자기 중요한 정보가 나옵니다.
"SAT-B 궤도 설계 변경 — 고도 500km → 550km로 올림"

**앱이 Dock 모드(작은 창)여도 Ctrl+Shift+N을 누릅니다.**

Quick Capture 팝업이 즉시 뜹니다:

```
┌───────────────────────────────┐
│ 💬 Quick Memo                  │
│                                 │
│ 제목: SAT-B 궤도 변경 550km   │
│                                 │
│ SAT-B 궤도 500→550km 변경     │
│ 이유: 방사선 환경 완화          │
│ 영향: 궤도결정 정확도 재확인    │
│       ADCS 자기장 모델 업데이트 │
│                                 │
│        [저장] [취소]            │
└───────────────────────────────┘
```

[저장]하면:
- Quick Memo가 `2026-06-09-memo-001.md`로 저장됨
- project: `[SAT-B-16U]` 자동 채움 (본문에서 SAT-B 감지)
- related: `["2026-06-09-daily"]` 자동 연결
- Daily Log의 "오늘 생성한 노트" 테이블에 자동 추가됨

**회의가 끝나고 이 메모를 다시 열어봅니다.**

이 내용은 나중에 깊이 분석해야 하니까, 에디터 상단의 배너가 보입니다:
```
💡 본문에 "궤도", "변경"이 포함되어 있습니다. Study Note로 승격하시겠습니까?
```

하지만 지금은 시간이 없으니 무시합니다. 나중에 돌아와서 **승격 버튼**을 누르면 됩니다.

---

### 📚 11:00 — 논문 읽다가 메모

브라우저에서 B-dot 제어 논문을 읽고 있습니다. 핵심 내용을 캡처하고 싶습니다.

**논문의 핵심 문단을 복사(Ctrl+C)합니다.**

앱이 포그라운드면 미니 토스트가 뜹니다:
```
📋 클립보드 감지: 텍스트 (243자). Quick Memo로 저장? [저장] [무시]
```

[저장]하면 Quick Memo가 바로 생성됩니다. 여기에 더 정리를 하고 싶으면, **승격 버튼 → 📚 Study Note**를 선택합니다.

승격하면 기존 메모 내용이 "핵심 내용" 섹션으로 이동하고, 나머지 스켈레톤이 자동 추가됩니다:

```markdown
---
id: "2026-06-09-study-001"
type: study-note
title: "B-dot 게인 튜닝 방법론"
(... 기존 frontmatter 유지, type만 변경 ...)
---

## 주제

## 출처

| 유형 | 상세 |
|---|---|

## 핵심 내용                    ← 기존 메모 내용이 여기로 이동됨

(원래 Quick Memo 본문)

### 주요 개념
### 수식 / 알고리즘

## 내 프로젝트 적용 가능성       ← 이 섹션이 핵심!

- `[SAT-A]` {여기에 적용 아이디어를 적으면 나중에 추적됨}

## 추가 조사 필요

- [ ] {더 알아볼 것}
```

**"내 프로젝트 적용 가능성"에 다음과 같이 적습니다:**

```
- `[SAT-A]` 디텀블링 모드에서 B-dot 게인을 이 논문의 최적화 방법으로 튜닝 가능
  → 추후 Analysis Note에서 시뮬레이션 예정
```

나중에 이 주제로 Analysis Note를 만들고 Study Note를 `[[link]]`로 연결하면, Study Note에 "적용됨 ✅" 배지가 자동으로 표시됩니다.

---

### 🔧 14:00 — RW 기능시험 진행

오후에 RW-01 진동시험 후 기능시험을 합니다. `+ New → 🔧 Test Log`

experiment에 `RW-QUAL-003`을 입력하면:

**이전 Test Log (6/5, 진동시험 전 기능시험)가 감지됩니다.**

자동으로 일어나는 것들:
- 이전 측정 데이터 테이블 컬럼 구조가 복사됨
- "## 전후 비교" 섹션이 자동 추가됨 (이전 데이터 포함)
- related에 이전 Test Log `[[2026-06-05-test-001]]` 자동 연결

```markdown
## 전후 비교

| 항목 | 진동 전 (06-05) | 진동 후 (06-09) | 변화 |
|---|---|---|---|
| RPM 정확도 @5000 | 0.08% | (입력) | |
| 소비전류 @5000 | 0.58A | (입력) | |
| 제로크로싱 시간 | 31.2s | (입력) | |
```

**시험이 끝나고 결과를 입력합니다.**

종합 판정에서 `🟢 PASS`를 선택하면:
- frontmatter `verdict: pass` 자동 반영
- `status: complete` 제안 팝업 → [확인] 누르면 자동 변경
- Daily Log의 TODO `[todo-003] RW 토크 마진 검토`에 체크가 가능해짐

**Daily Log에서 해당 TODO를 체크합니다.**

- todos.json에서 status → done, end_date → 2026-06-09 자동 반영
- 다음날 Daily Log에 이 항목이 더 이상 이월되지 않음

---

### 💡 17:30 — 퇴근 전 정리

**18:00에 OS 알림이 뜹니다:**

```
💡 오늘 인사이트를 기록하셨나요?
[Daily Log 열기]
```

클릭하면 Daily Log의 "인사이트 & 의사결정" 섹션으로 바로 이동합니다.

```markdown
## 인사이트 & 의사결정

- RW-01 진동시험 전후 비교: RPM 정확도 변화 없음 (0.08%→0.09%), 소비전류 미세 증가 (0.58→0.61A).
  베어링 상태 양호로 판단. 다만 전류 증가 추이를 열진공 시험 후에도 확인 필요.
- SAT-B 궤도 변경(550km)이 ADCS 자기장 모델에 미치는 영향 → 내일 확인 필요.
  IGRF 모델 고도 파라미터 수정 범위 크지 않을 것으로 예상.
```

이 인사이트들이 주간 리뷰에서 "핵심 인사이트"로 선별되고,
분기 리뷰에서 "기술 성장" 분석의 데이터가 됩니다.

**Daily Log의 "오늘 생성한 노트"를 확인합니다.**

자동으로 집계되어 있습니다:

```markdown
## 오늘 생성한 노트

| 유형 | 제목 | 프로젝트 |
|---|---|---|
| 📊 Analysis | [[2026-06-09-analysis-001]] RW 토크 마진 분석 | SAT-A-6U |
| 💬 Memo | [[2026-06-09-memo-001]] SAT-B 궤도 변경 550km | SAT-B-16U |
| 📚 Study | [[2026-06-09-study-001]] B-dot 게인 튜닝 방법론 | SAT-A-6U |
| 🔧 Test | [[2026-06-09-test-001]] RW-01 진동 후 기능시험 | SAT-A-6U |
```

**내일 계획을 적습니다:**

```markdown
## 내일 계획

1. `[SAT-B]` 궤도 변경에 따른 IGRF 자기장 모델 파라미터 확인
2. `[SAT-A]` B-dot 게인 최적화 시뮬레이션 (Study Note 기반)
3. `[SAT-A]` 열진공 시험 일정 조율 (EPS 팀 미팅)
```

**뽀모도로 세션이 자동으로 workhour에 집계되어 있습니다:**

```yaml
workhour: 7.5
workhour_detail:
  - project: SAT-A-6U
    hours: 5.0
  - project: SAT-B-16U
    hours: 1.5
  - project: GENERAL
    hours: 1.0
```

---

### 📋 17:45 — 14일 지난 Quick Memo 자동 아카이브 알림

```
📦 2주 이상 된 Quick Memo 3개가 자동 아카이브됩니다.
  - "OBC 인터페이스 문서 위치" (5/24)
  - "점심 추천: 감자탕" (5/20)
  - "MATLAB 라이선스 서버 IP" (5/18)
[확인] [복구]
```

활성 노트 목록이 깨끗하게 유지됩니다.

---

## 금요일 오후 — 회고 리마인더

금요일 18:00에 추가 알림:

```
📝 이번 주 회고를 작성해보세요!
```

Daily Log의 회고 섹션:

```markdown
## 회고

이번 주 가장 큰 성과: RW 진동시험 통과. 전후 기능시험 비교 데이터 확보.
반복된 병목: SAT-B 궤도결정 코드 리뷰를 계속 미루고 있음. 원인은 코드가 방대해서
시작이 어려운 것. → 다음 주에는 파일별로 쪼개서 하루 1파일씩 리뷰하는 전략으로.
기술적 성장: B-dot 게인 최적화 방법론 학습. EKF Q matrix 튜닝 경험 축적.
```

이 회고가 분기 리뷰의 "병목 & 개선점" 분석 데이터가 됩니다.

---

## 월간 리뷰 예시 (7/1 자동 생성)

```markdown
## 기술 성장 분석

이번 달 가장 활발한 태그:
  1. ekf (12개 노트) — 지난달(8개) 대비 50% 증가
  2. reaction-wheel (8개 노트)
  3. b-dot (5개 노트) — 신규 태그! 6월에 처음 등장

학습→적용 전환율: 75% (Study Note 4개 중 3개가 Analysis/Design Note로 연결됨)
  ✅ B-dot 게인 논문 → Analysis Note (시뮬레이션 검증)
  ✅ IGRF 자기장 모델 조사 → Design Note (모델 선택 의사결정)
  ✅ PID 자동 튜닝 기법 → Analysis Note (SAT-A 적용)
  ❌ 궤도전파 정밀도 비교 — 아직 미적용

## 의사결정 품질
Design Note 3개 생성. 모두 Analysis/Test로 검증 진행됨 (100%).
반복 패턴: 세 건 모두 "robustness"를 최우선 선정 근거로 사용.
→ 단일 장애점(SPOF) 회피 경향이 강함. 성능 최적화보다 안정성 우선.
```

---

## 자동화 기능 전체 목록 (한 눈에)

### 내가 아무것도 안 해도 되는 것

| 기능 | 언제 | 효과 |
|---|---|---|
| Daily Log 자동 생성 | 앱 실행 시 | 빈 노트 만들 필요 없음 |
| 미완료 업무 이월 | Daily Log 생성 시 | 어제 못한 일을 잊지 않음 |
| TODO → Daily Log 삽입 | Daily Log 생성 시 | in-progress 할 일이 자동으로 보임 |
| 반복 TODO 생성 | 설정된 주기마다 | 주간회의 등 매번 만들 필요 없음 |
| "오늘 생성한 노트" 집계 | 노트 생성할 때마다 | 일지가 목차 역할 |
| 당일 daily-log 역참조 | 노트 생성 시 | related 수동 입력 불필요 |
| workhour 누적 | 뽀모도로 완료 시 | 시간 기록 자동 |
| Daily Log 요약 | 다음날 Daily Log 생성 시 | 월간 리뷰 토큰 절약 |
| Quick Memo 자동 아카이브 | 14일 경과 시 | 노트 목록 깨끗하게 유지 |
| 주간/월간 리뷰 | 월 08:00 / 매월 1일 | 알아서 분석해줌 |
| Morning Briefing | 매일 첫 접속 | 오늘 할 일 즉시 파악 |

### 내가 한 번만 클릭/선택하면 되는 것

| 기능 | 트리거 | 효과 |
|---|---|---|
| 프로젝트 컨텍스트 전환 | 사이드바 프로젝트 클릭 | 타이머+TODO+새노트 전부 따라감 |
| Quick Capture | Ctrl+Shift+N | 2초 만에 메모 저장 |
| 클립보드 캡처 | 복사 후 토스트 [저장] | 외부 정보 즉시 수집 |
| 태그/subsystem 자동 제안 | 본문 키워드 감지 → 배너 [추가] | 수동 태그 입력 불필요 |
| 코드 참조 감지 | .m/.py 경로 입력 | 참조 섹션 자동 추가 |
| Quick Memo 승격 | 승격 버튼 1번 | 내용 보존 + 스켈레톤 추가 |
| 종합 판정 → status | 판정 선택 시 | status:complete 자동 제안 |
| TODO 체크 → done | Daily Log에서 체크 | todos.json 자동 업데이트 |

### 같은 experiment가 있으면 자동으로 되는 것

| 기능 | 트리거 | 효과 |
|---|---|---|
| Base 조건 자동 채움 | Analysis Note experiment 선택 | 매번 궤도/센서/도구 재입력 불필요 |
| 시험 전후 비교 테이블 | Test Log experiment 선택 | 이전 측정 데이터 자동 불러옴 |
| 관련 노트 연결 제안 | 같은 experiment 노트 발견 | 토스트로 연결 제안 |
| 이전 노트 링크 | Test Log/Analysis Note | related에 자동 추가 |

### 주기적으로 알려주는 것

| 기능 | 시점 | 효과 |
|---|---|---|
| Evening Reminder | 매일 18:00 | 인사이트 기록 잊지 않음 |
| 금요일 회고 리마인더 | 금 18:00 | 주간 성찰 습관 형성 |
| 3일 이월 경고 | 이월 시 | 미루는 패턴 인식 |
| Stale 노트 경고 | 건강 점검 시 | 방치된 분석 정리 |
| Overdue TODO 경고 | Morning Briefing | 마감 초과 즉시 인지 |

---

# 기능 레퍼런스

> 아래는 JRH-Orbit의 모든 UI 기능을 영역별로 정리한 상세 레퍼런스입니다.

---

## 1. 레이아웃 모드

JRH-Orbit은 세 가지 레이아웃 모드를 제공합니다. 상단 타이틀바 또는 사이드바 하단 버튼으로 전환합니다.

### Dock 모드 (최소 창)

화면 모서리에 띄워두는 미니 위젯입니다.

- **Workhour 타이머** 표시 (예: `2H 45m`)
- **현재 날짜/요일** 표시
- **음악 재생 중인 트랙명** 표시
- **Sidebar / Expand 전환 버튼**

Dock 모드에서도 `Cmd+Shift+N`으로 Quick Capture를 사용할 수 있습니다.

### Sidebar 모드

Dock보다 넓은 사이드바 형태입니다. Quick Memo 입력, 태스크 관리, 캘린더, 음악 플레이어를 한 패널에서 사용합니다.

### Expanded 모드 (전체 창)

사이드바(140~300px 리사이즈 가능) + 메인 뷰 영역으로 구성된 전체 작업 화면입니다. 대부분의 작업은 이 모드에서 합니다.

---

## 2. 사이드바

Expanded 모드 좌측 사이드바에 7개 뷰 전환 버튼이 있습니다.

| 아이콘 | 뷰 | 단축키 | 설명 |
|---|---|---|---|
| 📅 | Daily Log | `Cmd+1` / `Cmd+D` | 오늘의 업무일지 |
| 📝 | Notes | `Cmd+2` / `Cmd+N` | 리서치 노트 목록 |
| ✅ | Tasks | `Cmd+3` / `Cmd+T` | TODO 관리 |
| 🔍 | Search | `Cmd+4` / `Cmd+K` | 전체 노트 검색 |
| 📊 | Statistics | `Cmd+5` | 대시보드 & AI 리뷰 |
| 🔗 | Graph | `Cmd+6` | 노트 관계 시각화 |
| ⚙️ | Settings | `Cmd+7` / `Cmd+,` | 설정 |

### Sidebar 모드 전용 패널

Sidebar 모드에서는 축약된 형태로 다음 패널을 직접 사용할 수 있습니다.

**Quick Memo 입력**
- 텍스트 입력 후 Enter → 즉시 Quick Memo 생성
- 최근 5개 메모 히스토리 표시 (타임스탬프 포함)

**태스크 관리**
- 제목 + 마감일로 빠르게 태스크 추가
- 상태 순환: ○ (Todo) → ◐ (In Progress) → ● (Done) — 아이콘 클릭
- 미완료 하위 태스크가 부모 아래 들여쓰기로 표시
- 하위 태스크의 ○ 클릭으로 바로 완료 처리
- 편집 모드에서 하위 태스크 추가/삭제/토글

**캘린더**
- 월별 뷰 / 좌우 화살표로 월 이동
- 날짜에 태스크 개수 점(dot) 표시: 1개=mint, 2~3개=chrome, 4개+=lavender
- 날짜 클릭 → 해당 날짜의 태스크 목록 표시

**음악 플레이어**
- YouTube URL 입력 → 자동으로 제목 fetch → 플레이리스트에 추가
- ◀ ▶ ⏯ 컨트롤 / 트랙 삭제

---

## 3. Daily Log (업무일지)

### 기본 구조

매일 앱 실행 시 자동 생성됩니다. 구조:

```
## 오늘의 작업        — 프로젝트별 TODO 자동 삽입
## 인사이트 & 의사결정  — 수동 기록
## 오늘 생성한 노트    — 노트 생성 시 자동 추가
## 내일 계획          — 수동 기록
## 회고 (선택)        — 수동 기록
```

### 자동화 기능

- **TODO 이월**: 전날 미완료 TODO가 자동으로 오늘 일지에 삽입. `(이월)` 표시 + 🔄 배지
- **D-Day 표시**: 마감일이 있는 TODO에 `(D-3)`, `(D+2)` 등 자동 표시
- **체크박스 ↔ TODO 동기화**: 일지에서 `- [ ]` 체크하면 todos.json 자동 업데이트, 역방향도 동일
- **새 체크박스 자동 등록**: `- [ ] 새로운 할 일` 입력 시 TODO로 자동 등록 + ID 부여
- **노트 목록 자동 집계**: 새 노트 생성 시 "오늘 생성한 노트" 테이블에 자동 행 추가
- **자동 요약**: 일지 내용에서 핵심 문구를 추출하여 frontmatter `summary` 자동 갱신
- **충돌 감지**: 외부에서 파일이 수정되면 "Reload / Dismiss" 배너 표시

### 날짜 이동

- ◀ ▶ 버튼: 이전/다음 날
- 날짜 텍스트 클릭: 오늘로 이동

---

## 4. Notes (리서치 노트)

### 노트 생성

`+ New` 버튼으로 템플릿 선택 후 생성합니다.

| 타입 | 아이콘 | 용도 |
|---|---|---|
| Quick Memo | 💬 | 빠른 메모, 회의 중 캡처 |
| Analysis Note | 📊 | 시뮬레이션/분석 결과 정리 |
| Test Log | 🔧 | 시험 절차, 측정 데이터, 판정 |
| Design Note | 📐 | 의사결정 기록, 대안 비교 |
| Study Note | 📚 | 논문/기술 학습, 적용 가능성 |
| Blank | 📝 | 빈 템플릿 |
| (커스텀) | 사용자 정의 | Template Editor로 추가 |

### 노트 필터링

노트 목록 상단 필터:
- **타입별**: Quick Memo, Analysis Note 등
- **상태별**: Draft, In Progress, Complete, Archived
- **프로젝트별**: 프로젝트 태그로 필터
- **태그별**: 개별 태그로 필터

### 노트 승격 (Promote)

Quick Memo를 더 구조화된 노트 타입으로 변환합니다.

1. 노트 상단 배너에서 승격 제안이 뜨거나
2. 수동으로 타입 변경 가능
3. 기존 내용이 보존되며 새 타입의 스켈레톤 섹션이 추가됨

### Backlink 패널

노트 편집 화면 우측에 토글 가능한 패널:

- **Referenced by**: 이 노트를 참조하는 다른 노트들
- **References**: 이 노트가 참조하는 다른 노트들
- **Related Tasks**: 이 노트와 연결된 태스크들
- 각 항목 클릭 시 해당 노트/태스크로 이동

### Frontmatter 편집

노트 상단 메타데이터 영역에서 직접 편집:
- **제목**: 텍스트 입력
- **상태**: Draft → In Progress → Complete → Archived
- **프로젝트**: 드롭다운 선택 (복수 가능)
- **토픽**: 텍스트 입력 (자동완성)
- **서브시스템**: 드롭다운 선택 (복수 가능)
- **태그**: 텍스트 입력 후 Enter (복수 가능)
- **관련 노트**: 노트 ID 입력

---

## 5. Template Editor (템플릿 편집기)

Notes 뷰에서 접근 가능합니다.

### 열기

Notes 뷰 상단 영역에서 Template Editor 버튼을 클릭합니다.

### 템플릿 편집

- 좌측: 템플릿 목록 (built-in 표시)
- 우측 상단: **Icon** (이모지 1~2자), **Name** (표시명), **Type** (noteType, 기존 타입 자동완성)
- 우측 본문: 마크다운 textarea — 직접 편집
- **Save** 버튼: 변경사항 저장 → `data/templates.json`에 기록

### 새 템플릿 추가

1. `+ Add Template` 클릭
2. 고유한 Type이 자동 생성됨 (`custom-<timestamp>`)
3. Name, Icon, Type 편집
4. Body에 마크다운 구조 작성
5. **Save** 클릭

### Section Guide 설정

템플릿 body에서 heading 바로 다음 줄에 HTML 주석을 추가하면 Section Guide로 표시됩니다.

```markdown
## 섹션 제목
<!-- 이 섹션에 무엇을 써야 하는지 안내 텍스트 -->

## 다른 섹션
<!-- 빈 줄이 있어도 됩니다 — 첫 번째 비어있지 않은 줄이 주석이면 인식 -->
```

**규칙:**
- `## heading` 다음의 첫 번째 비어있지 않은 줄이 `<!-- ... -->` 형식이면 가이드로 인식
- heading 텍스트가 실제 노트의 heading과 **정확히 일치**해야 매칭
- 한 heading당 하나의 가이드만 (첫 번째 `<!-- -->`)
- 여러 줄 주석 (`<!-- line1\nline2 -->`)은 지원하지 않음

**표시 방식:**
- **빈 섹션**: 가이드 텍스트가 회색 이탤릭으로 placeholder처럼 표시 → 클릭하면 바로 그 자리에 타이핑 가능
- **내용 있는 섹션**: heading 바로 아래에 작고 연한 hint 텍스트로 표시

### 기본값 복원

- **Reset to Default**: 선택한 built-in 템플릿을 기본값으로 복원
- **Reset All to Default**: 모든 템플릿을 기본값으로 초기화 (커스텀 템플릿 삭제됨)

---

## 6. 에디터 기능

### 에디터 툴바

| 버튼 | 기능 | 단축키 |
|---|---|---|
| **B** | 굵게 | `Cmd+B` |
| *I* | 이탤릭 | `Cmd+I` |
| ~~S~~ | 취소선 | `Cmd+Shift+X` |
| `<>` | 인라인 코드 | `Cmd+E` |
| 🖍 | 텍스트 하이라이트 | — |
| H1/H2/H3 | 제목 레벨 | `Cmd+Alt+1/2/3` |
| • | 글머리 기호 목록 | `Cmd+Shift+8` |
| 1. | 번호 목록 | `Cmd+Shift+7` |
| ☑ | 체크리스트 | `Cmd+Shift+9` |
| > | 인용 블록 | `Cmd+Shift+B` |
| `{;}` | 코드 블록 | ` ``` ` |
| 🎨 | 텍스트 색상 | 6x7 컬러 팔레트 |
| 📐 | 텍스트 정렬 | 좌/중/우/양쪽 |
| 📊 | 테이블 삽입 | 3x3 기본 |
| ∑ | 인라인 수식 | `$...$` |
| ∑∑ | 블록 수식 | `$$...$$` |
| ─ | 수평선 | `---` |
| 🖼 | 이미지 삽입 | 파일 선택 or URL |
| 📎 | 파일 첨부 | 파일 선택 → attachments 폴더에 복사 |

### 테이블 편집

테이블 안에 커서가 있으면 **테이블 전용 툴바**가 나타납니다:

- **+Row / +Col**: 행/열 추가
- **-Row / -Col**: 행/열 삭제
- **-Table**: 테이블 삭제
- **Merge / Split**: 셀 병합/분할
- **Auto-fit**: 열 너비 자동 조정
- **Cell BG**: 셀 배경색 선택
- **열 경계 더블클릭**: 해당 열 너비 자동 맞춤

### 수식 편집

- 수식 블록/인라인 클릭 → LaTeX 편집 모달
- KaTeX로 실시간 미리보기
- Save/Cancel 버튼

### Wiki Link (노트 간 연결)

`[[` 입력 시 자동완성 팝업:

1. `[[`를 입력하면 검색 팝업이 나타남
2. 노트 제목이나 ID를 타이핑하면 실시간 필터링
3. ↑↓ 화살표로 선택, Enter로 삽입
4. 완성된 링크: `[[2026-06-06-analysis-001]]`
5. `Cmd+클릭` 또는 `Ctrl+클릭`으로 해당 노트 열기

### Smart Transform (자동 변환)

Settings에서 켜고 끌 수 있습니다 (기본: ON).

| 입력 | 변환 결과 |
|---|---|
| `alpha` + 스페이스 | α |
| `beta` + 스페이스 | β |
| `delta` + 스페이스 | δ |
| `theta` + 스페이스 | θ |
| `mu` + 스페이스 | μ |
| `pi` + 스페이스 | π |
| `sigma` + 스페이스 | σ |
| `omega` + 스페이스 | ω |
| `deg` + 스페이스 | ° |
| `sqrt` + 스페이스 | √ |
| `+/-` + 스페이스 | ± |
| `6/10` + 스페이스 | 2026-06-10 (올해 날짜) |

### 코드 블록

- 언어 선택 드롭다운 (구문 강조 지원)
- **Copy** 버튼으로 코드 복사

### 이미지

- 드래그 앤 드롭으로 삽입 (attachments 폴더에 자동 복사)
- 리사이즈 핸들로 크기 조정
- 캡션 입력 가능

---

## 7. Tasks (태스크 관리)

### 태스크 생성

Tasks 뷰 또는 사이드바에서:
1. 제목 입력
2. (선택) 프로젝트, 마감일, 시작/종료일 설정
3. Enter 또는 추가 버튼

### 상태 관리

세 가지 상태 순환 (아이콘 클릭):
- **○ Todo**: 아직 시작 안 함
- **◐ In Progress**: 진행 중
- **● Done**: 완료

### 하위 태스크 (Subtask)

태스크 편집 모드에서:
1. 하위 태스크 입력 필드에 제목 입력 → Enter
2. 토글로 완료/미완료 전환
3. 삭제 버튼으로 제거

사이드바에서는 미완료 하위 태스크가 부모 아래 들여쓰기로 표시되며, ○ 클릭으로 즉시 완료 처리 가능합니다.

### 필터링

Tasks 뷰에서:
- **상태별**: Todo / In Progress / Done
- **프로젝트별**: 프로젝트 선택
- **태그별**: 태그 선택

### Daily Log 연동

- Daily Log에서 `- [ ]` 체크 → 연결된 TODO 자동 완료
- Daily Log에서 체크 해제 → TODO 자동 재오픈
- 새 `- [ ]` 항목 → 자동으로 TODO 등록 + ID 부여

---

## 8. Search (검색)

`Cmd+K` 또는 `Cmd+4`로 접근합니다.

- 전체 노트 (Daily + Research) 대상 전문 검색
- 300ms 디바운스 적용
- 결과에 하이라이트된 스니펫 표시
- 노트 타입 배지 (Daily/Research) + 마지막 수정일
- 결과 클릭 → 해당 노트 열기

---

## 9. Statistics (통계 & 리뷰)

### Dashboard 탭

- **노트 생성/수정 수**: 주간/월간 기간별
- **노트 건강 점검**: 태그 누락, 미연결 노트, 방치된 노트, 마감 초과 TODO
- **성장 점수**: 종합 활동 지표
- **차트**: 노트 타입별 바 차트, 분포 파이 차트, 메트릭 레이더 차트

### Reviews 탭

AI 리뷰 생성 및 열람:

1. **[AI Report]** 버튼 → Weekly / Monthly / Quarterly 선택
2. 앱이 해당 기간 데이터를 수집하여 클립보드에 복사
3. claude.ai가 자동으로 열림 → 붙여넣기 → Claude 분석
4. Claude 응답 복사 → 앱에서 **[Import Review]** → 붙여넣기 → 저장

---

## 10. Graph (관계 시각화)

노트 간 연결을 Force-directed 그래프로 시각화합니다.

- **노드**: 각 노트를 나타냄 (타입별 색상 구분)
- **엣지**: Wiki Link (`[[...]]`) 또는 `related` 필드 연결
- **필터**: 프로젝트별, 노트 타입별
- **노드 클릭**: 해당 노트 열기
- **드래그/줌**: 그래프 탐색
- **범례**: 타입별 색상 범례 표시

색상 매핑:
- Daily Log = chrome색
- Analysis Note = blue
- Test Log = mint
- Design Note = purple
- Study Note = green
- Quick Memo = gray

---

## 11. 생산성 도구

### Workhour 타이머

상태바 또는 Dock에 표시됩니다.

- ▶/⏸ 재생/일시정지
- ⏹ 리셋 (확인 필요)
- ±10m, ±30m, +1h 수동 조정 버튼
- 프로젝트별 workhour 자동 집계
- Daily Log frontmatter `workhour` / `workhour_detail`에 기록

### Pomodoro 타이머

Settings에서 설정:
- **Work**: 집중 시간 (기본 25분)
- **Break**: 짧은 휴식 (기본 5분)
- **Long Break**: 긴 휴식 (기본 15분)
- **Sessions before Long Break**: 긴 휴식 전 세션 수 (기본 4)

상태바에 현재 Phase(Work/Break/Long Break) + 남은 시간 표시.

### Morning Briefing

매일 앱 첫 접속 시 자동으로 팝업됩니다 (5초 후 자동 닫힘).

- 이월된 업무 수
- 마감 초과 TODO 수
- 다가오는 D-Day (최대 3개, 7일 이내)
- 이번 주 workhour 합계
- [오늘의 할 일 보기] / [Weekly Review 보기] 버튼

### Evening Reminder

매일 18:00에 데스크탑 알림: *"오늘 인사이트를 기록하셨나요?"*
금요일 18:00: *"이번 주 회고를 작성해보세요!"*

### D-Day 카운터

- 이벤트 이름 + 목표 날짜 입력
- D-Day, D-N, D+N 자동 계산
- Morning Briefing에 표시

### Quick Capture

`Cmd+Shift+N`으로 어디서든 즉시 호출:

1. 제목 + 본문 입력
2. Enter 두 번으로 저장 (또는 [저장] 클릭)
3. Quick Memo로 생성 + Daily Log에 자동 연결
4. `Esc`로 취소

### Clipboard Capture

Settings에서 켜고 끌 수 있습니다.

- 긴 텍스트를 클립보드에 복사하면 미니 토스트 표시
- [저장] 클릭 → Quick Memo로 자동 생성
- 노트 제목은 첫 줄 미리보기

---

## 12. 자동 제안 배너

노트 편집 시 에디터 상단에 상황에 맞는 제안이 표시됩니다.

### 상태 완료 제안
- Analysis Note에 "결론" 섹션이 채워지면 → `status: complete` 제안
- Test Log에 판정이 설정되면 → `status: complete` 제안

### Quick Memo 승격 제안
- 본문에 분석 관련 키워드 → Analysis Note 승격 제안
- 학습 관련 키워드 → Study Note 승격 제안
- 설계/결정 관련 키워드 → Design Note 승격 제안

### 태그 자동 제안
- 본문 키워드 기반 태그 제안 (Settings에서 on/off)
- [추가] 클릭 → frontmatter 자동 업데이트

### 서브시스템 자동 제안
- 본문 키워드에서 서브시스템 감지 (Settings에서 on/off)
- 예: "반응 휠" → `subsystem: ADCS` 제안

---

## 13. Settings (설정)

### 데이터 폴더

- **Change Folder**: 데이터 저장 위치 변경
- iCloud / OneDrive / Dropbox 폴더 사용 시 멀티 디바이스 동기화

### Pomodoro 설정

Work / Break / Long Break / Sessions 각각 분 단위 설정

### Automation 토글

| 설정 | 기본값 | 설명 |
|---|---|---|
| Smart Transform | ON | 그리스 문자, 날짜 단축키 자동 변환 |
| Auto Tag Suggest | ON | 본문 키워드 기반 태그 제안 |
| Auto Subsystem Suggest | ON | 서브시스템 자동 감지 제안 |
| Clipboard Capture | ON | 클립보드 텍스트 → Quick Memo 제안 |
| Section Guides | ON | 템플릿 HTML 주석 → 가이드 텍스트 표시 |
| Auto Archive Days | 14 | N일 지난 Quick Memo 자동 아카이브 |

### 테마

10가지 내장 테마 중 선택:

| 테마 | 스타일 |
|---|---|
| Light | 밝은 배경, 핑크/블루/그린 |
| Dark | 어두운 그레이, 차분한 색상 |
| Paper | 크림색 배경, 브라운/블루 |
| Spreadsheet | 엑셀 스타일, 그린/블루 |
| Solarized | 크림 배경, 블루/옐로/그린 |
| VA-11 Hall-A | 사이버펑크 다크 퍼플, 골드/핑크 |
| Terminal | 블랙 배경, 라임 그린 |
| BuddyBuddy | 파스텔, 그린/핑크 |
| Forest | 우드 톤, 포레스트 컬러 |
| Ocean | 다크 블루, 시안/틸 |

### Import / Export

- **Import from Notion**: Notion 내보내기 폴더 선택 → 마크다운 파일 일괄 임포트
- **Export as HTML**: 모든 노트를 단일 HTML 파일로 내보내기 (인쇄 가능)
- **Export as Markdown**: 폴더 구조 유지하며 마크다운 파일 다운로드

---

## 14. 전체 키보드 단축키

### 뷰 전환

| 단축키 | 동작 |
|---|---|
| `Cmd+1` | Daily Log |
| `Cmd+2` 또는 `Cmd+N` | Notes |
| `Cmd+3` 또는 `Cmd+T` | Tasks |
| `Cmd+4` 또는 `Cmd+K` | Search |
| `Cmd+5` | Statistics |
| `Cmd+6` | Graph |
| `Cmd+7` 또는 `Cmd+,` | Settings |
| `Cmd+D` | Daily Log (대체) |

### 빠른 동작

| 단축키 | 동작 |
|---|---|
| `Cmd+Shift+N` | Quick Capture (어디서든 즉시 메모) |

### 에디터 서식

| 단축키 | 동작 |
|---|---|
| `Cmd+B` | 굵게 |
| `Cmd+I` | 이탤릭 |
| `Cmd+E` | 인라인 코드 |
| `Cmd+Shift+X` | 취소선 |
| `Cmd+Alt+1/2/3` | 제목 H1/H2/H3 |
| `Cmd+Shift+7` | 번호 목록 |
| `Cmd+Shift+8` | 글머리 기호 목록 |
| `Cmd+Shift+9` | 체크리스트 |
| `Cmd+Shift+B` | 인용 블록 |
| `Cmd+Z` | 실행 취소 |
| `Cmd+Shift+Z` | 다시 실행 |

---

## 15. Onboarding (첫 실행)

### Setup Wizard

1. 환영 화면
2. 데이터 폴더 선택 (iCloud/OneDrive/Dropbox 권장)
3. 초기 파일 생성 (todos.json, projects, config.json)

### Onboarding Tour

8단계 인터랙티브 투어:
1. Daily Log 소개
2. Notes 뷰 소개
3. Tasks 뷰 소개
4. Wiki Link 사용법
5. 생산성 도구 소개
6. 키보드 단축키 안내
7. 테마 선택
8. 시작하기

진행 바 표시 / Skip 버튼으로 건너뛰기 가능.

---

## FAQ

**Q: 노트를 실수로 삭제했어요. 복구할 수 있나요?**
A: 현재 삭제된 노트는 즉시 파일이 제거되므로 복구할 수 없습니다. 중요한 노트는 Export 기능으로 백업을 권장합니다.

**Q: 다른 PC에서도 같은 노트를 쓸 수 있나요?**
A: 데이터 폴더를 iCloud, OneDrive, Dropbox 등 클라우드 동기화 폴더로 설정하면 여러 기기에서 동일한 노트에 접근할 수 있습니다.

**Q: Section Guide가 안 보여요.**
A: Settings → Automation → Section Guides가 ON인지 확인하세요. Guide는 템플릿 body에 `## Heading` 다음 줄에 `<!-- 가이드 텍스트 -->`가 있어야 작동합니다. Template Editor에서 확인하세요.

**Q: Smart Transform을 끄고 싶어요.**
A: Settings → Automation → Smart Transform을 OFF로 전환하세요.

**Q: 태그 형식을 바꾸고 싶어요.**
A: config.json에서 `tag_rules.format`을 `lowercase-hyphen`, `lowercase`, `as-is` 중 선택할 수 있습니다.
