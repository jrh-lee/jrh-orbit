# JRH-Orbit 구현 계획서

## Context

초소형 위성(6U~16U) GNC(유도항법제어) 엔지니어가 다수의 위성 개발 프로젝트를 관리하며
연구 노트, 일일 업무 일지, Todo/Task를 기록하는 크로스 플랫폼 데스크탑 앱.

**기존 도구의 한계:**
- **Notion** — 링크·DB 연결이 많아지면 점점 무거워짐
- **todoary(workingtable)** — 디자인·기능은 좋으나 가로 리사이즈 불가, 프로젝트별 태그 관리 어려움, 기기 간 동기화 미지원
- **공통 문제** — 산발적으로 기록하면 나중에 어디에 적었는지 찾지 못함, 한 눈에 보기 어려워 금방 손을 놓게 됨

**핵심 목표:**
- Windows 데스크탑 + Mac 노트북 간 클라우드 폴더(iCloud/OneDrive/Dropbox) 기반 동기화
- 마크다운 기반 연구노트 + 데일리 업무일지 + Task 관리를 하나의 앱에서
- todoary의 Y2K 파스텔 디자인 톤 계승 + 사용성 개선
- 뽀모도로 타이머, Workhour 추적, 유튜브 음악 재생 등 부가 생산성 도구 통합

## 핵심 설계 결정

| 항목 | 결정 |
|------|------|
| 앱 이름 | **JRH-Orbit** |
| 레이아웃 | **하이브리드** (Dock ↔ Expanded 모드 전환) |
| 동기화 | **클라우드 폴더** (iCloud/OneDrive/Dropbox) |
| 디자인 | **todoary Y2K 파스텔** 톤 계승 |
| DB 전략 | **SQLite 로컬 전용** (검색 인덱스만), 실제 데이터는 .md/.json 파일로 클라우드 동기화 |
| Todo 동기화 | **todos.json 파일**로 클라우드 저장 → 양 기기에서 자동 동기화 |
| Workhour 동기화 | 1차에선 로컬만, 추후 .json으로 동기화 추가 가능 |

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Desktop Shell | Tauri 2 (Rust + WebView) |
| Frontend | React 19 + TypeScript + Vite 8 |
| 마크다운 에디터 | TipTap (ProseMirror 기반) + tiptap-markdown |
| 코드 하이라이팅 | lowlight (highlight.js) + CodeBlockLowlight |
| 로컬 검색 DB | SQLite (tauri-plugin-sql, FTS5) |
| 상태관리 | Zustand 5 |
| 스타일 | Tailwind CSS v4 + CSS custom properties |
| 유틸 | date-fns 4, clsx |

## 데이터 구조

### 클라우드 동기화 폴더 (사용자 지정)
```
~/JRH-Orbit-Data/
├── notes/
│   ├── daily/
│   │   ├── 2026-06-04.md          ← 데일리 워크로그
│   │   └── 2026-06-05.md
│   └── research/
│       ├── adcs-pid-tuning.md     ← 연구노트
│       └── orbit-determination.md
├── data/
│   ├── todos.json                 ← Todo/Task 전체 (동기화 핵심)
│   ├── projects.json              ← 프로젝트 목록
│   ├── ddays.json                 ← D-Day 이벤트
│   ├── playlist.json              ← 음악 플레이리스트
│   └── workhours/                 ← 작업시간 기록 (추후)
│       └── 2026-06-04.json
└── config.json                    ← 앱 설정 (테마, 뽀모도로 설정 등)
```

### 로컬 전용 (AppData)
```
~/.jrh-orbit/  (또는 Tauri AppData)
└── orbit.db                       ← SQLite: 검색 인덱스 (FTS5) 전용
```

### 노트 파일 포맷 (.md with frontmatter)
```markdown
---
title: ADCS PID Tuning Research
type: research
project: SNIPE-1
tags: [ADCS, PID, attitude-control]
created: 2026-06-04T09:30:00
updated: 2026-06-04T14:22:00
---

# ADCS PID Tuning Research
(본문 내용...)
```

## 디자인 토큰 (todoary 파스텔 톤)

```css
/* 텍스트 */
--ink: #28333f;  --ink-2: #5a6a7c;  --ink-3: #93a3b5;

/* 배경 */
--paper: #ffffff;  --paper-soft: #f1f7ff;  --paper-muted: #dcebfc;

/* 파스텔 */
--pink: #ffc1d6;  --mint: #c6ecd7;  --blue: #a9cdf5;
--lavender: #d8cdf5;  --cream: #fff4c0;  --peach: #ffd3b6;

/* 강조 */
--highlight: #fdff85;  --chrome: #a9cdf5;

/* 테두리/라운딩 */
border-width: 1.1px;  border-radius: 10px (sm), 14px (lg);
```

---

## Phase 1 — 기초 세팅 ✅

Tauri 2 프로젝트 스캐폴딩부터 앱 셸, 기본 파일 I/O까지.

- [x] Tauri 2 + React 19 + TypeScript + Vite 8 프로젝트 생성
- [x] 프론트엔드 의존성 설치 (zustand, @tiptap/*, lowlight, tailwindcss, date-fns, clsx)
- [x] Tauri 플러그인 설치 (sql, dialog, notification, fs, shell)
- [x] Tailwind v4 + 파스텔 테마 CSS 변수 설정
- [x] Rust 백엔드 구조 (notes.rs CRUD, config.rs, window.rs 모드 전환)
- [x] 커스텀 TitleBar + AppShell (decorations: false, data-tauri-drag-region)
- [x] Dock ↔ Expanded 모드 전환 (72x520 always-on-top ↔ 1200x800)
- [x] SQLite FTS5 검색 인덱스 초기화
- [x] 첫 실행 SetupWizard (클라우드 폴더 선택, 폴더 구조 생성)

## Phase 2 — 핵심 기능 ✅

에디터, 노트, Task 관리, 타이머 등 앱의 핵심 기능 구현.

- [x] TipTap 마크다운 에디터 (EditorToolbar, 자동저장 디바운스)
- [x] Daily Log — 날짜별 자동 생성, 한국어 날짜 포맷
- [x] Research Notes — CRUD, frontmatter 메타데이터 (title, project, tags)
- [x] Task 관리 — Kanban 3단 (todo/in-progress/done), 우선순위, 서브태스크, 날짜
- [x] 뽀모도로 타이머 — work/break/longBreak 자동 전환, OS 알림, 설정 가능
- [x] 프로젝트 관리 — 색상 컬러 피커, projects.json 영속화
- [x] Zustand 상태관리 (appStore, noteStore, taskStore, projectStore, timerStore, musicStore)

## Phase 3 — 생산성 도구 ✅

검색, 음악, D-Day 등 부가 생산성 기능과 테마 시스템.

- [x] 전문 검색 (SQLite FTS5) — 실시간 검색, 스니펫 하이라이팅, 노트 타입 배지
- [x] 검색 결과 → 연구노트 직접 링크 (pendingNotePath 패턴)
- [x] YouTube 음악 플레이어 — 플레이리스트 관리, 반복 모드 (off/one/all), noembed API
- [x] D-Day 카운터 — D-Day/D+N/D-N 포맷, ddays.json 영속화
- [x] 테마 시스템 — Light, Dark, Cyberpunk (VA-11 HALL-A), Forest, Ocean
- [x] Settings 뷰 — 테마 전환, 뽀모도로 설정, 데이터 폴더 변경

## Phase 4 — UX 폴리싱 ✅

사용성 개선, 커스텀 UI 컴포넌트, 세부 인터랙션 개선.

- [x] 커스텀 Dropdown 컴포넌트 (네이티브 `<select>` 대체, compact 모드)
- [x] 코드블록 언어 선택 + Syntax Highlighting (30개 언어, Consolas 폰트)
- [x] 사이드바 태그 매니저 (연구노트 frontmatter 스캔, 카운트 배지, 실시간 반영)
- [x] 사이드바 접을 수 있는 섹션 (Projects/D-Day/Tags 토글)
- [x] 섹션 헤더에 토글 + 액션 버튼 같은 행 배치 (`▶ Projects [+]`)
- [x] 드래그 리사이즈 패널 (사이드바↔콘텐츠, 노트목록↔에디터)
- [x] 리사이즈 핸들 hover 시에만 표시
- [x] Music Player 외부 클릭 시 자동 닫힘
- [x] Task 필터 드롭다운 compact 디자인 통일

## Phase 5 — 동기화 & 안정성 ✅

클라우드 폴더 기반 동기화, 파일 변경 감지, 충돌 방지.

- [x] File Watcher — tauri-plugin-fs watch로 클라우드 폴더 변경 실시간 감지 (useFileWatcher 훅)
- [x] 노트/Task 변경 감지 시 자동 리로드 (CustomEvent 기반: tasks/projects/ddays/playlist/config/notes-changed)
- [x] 파일 충돌 감지 — 편집 중 외부 변경 시 배너 알림 + Reload/Dismiss (DailyLog, NoteListView, TaskListView)
- [x] todos.json 동기화 안정화 — 저장 시 lastModified 기반 낙관적 잠금
- [x] 앱 시작 시 검색 인덱스 자동 재구축 + 파일 변경 시 증분 업데이트 (reindexNote)
- [ ] Workhour 데이터 .json 파일 동기화 (Phase 7 Workhour 구현 시 함께 진행)

## Phase 6 — 고급 에디터 & 노트 기능 ✅

에디터 확장, 노트 간 연결, 템플릿, 수식 지원 등.

- [x] 노트 템플릿 — Blank/Research/Meeting/Experiment 프리셋 (+ New 드롭다운)
- [x] LaTeX/KaTeX 수식 지원 — TipTap Mathematics 확장, `$...$` 인라인 수식
- [x] 이미지/파일 첨부 — 드래그앤드롭 이미지 삽입, attachments/ 폴더 저장 (write_binary 커맨드)
- [x] 노트 목록 필터/정렬 — 프로젝트별, 태그별 필터 + Recent/Created/A-Z 정렬
- [x] 데일리 로그 ↔ 연구노트 상호 링크 — "Edited today" 칩으로 당일 수정된 노트 표시
- [x] 테이블 에디터 — TipTap Table 확장, 리사이즈 가능 컬럼, 헤더 행
- [x] Link 확장 — 자동 링크 감지, 클릭 시 열기
- [x] 에디터 툴바 확장 — 테이블/수식/이미지/구분선 삽입 버튼 추가
- [ ] 노트 간 링크 (`[[note-title]]` 위키링크) + 백링크 표시 (Phase 8로 이관)
- [ ] Mermaid 다이어그램 렌더링 (Phase 8로 이관)

### Phase 6.5 — 에디터 고도화 & 내보내기 ✅ (2026-06-05)

에디터 사용성 개선, 파일 첨부 확장, 노트 내보내기, 테이블 자동 너비 조절.

**파일 첨부 & 링크 열기:**
- [x] 비이미지 파일 첨부 — PDF/Word/HWP/Excel 등 문서 파일 첨부 (클립 아이콘, `attachments/` 폴더 복사)
- [x] 커스텀 Rust `open_path` 커맨드 — macOS(`open`)/Windows(`cmd /c start`)/Linux(`xdg-open`) 크로스플랫폼 파일 열기
- [x] 로컬 파일 링크 클릭 → 시스템 기본 앱으로 열기 (PDF → 미리보기, HWP → 한컴오피스 등)
- [x] Link 확장에서 `target="_blank"` 제거 — Tauri WKWebView에서 네이티브 레벨 네비게이션 방지
- [x] ProseMirror `handleDOMEvents.click`으로 링크 인터셉트 — 로컬 파일은 바로 열기, 웹 URL은 Cmd/Ctrl+클릭

**노트 내보내기:**
- [x] 마크다운 저장 — `@tauri-apps/plugin-dialog` save 다이얼로그로 `.md` 파일 내보내기
- [x] 인쇄/PDF — 에디터 콘텐츠를 인라인 스타일 HTML로 변환, 시스템 브라우저에서 `window.print()` 실행

**테이블 Auto-fit:**
- [x] 열 경계선 더블클릭 → 해당 열 텍스트에 맞게 자동 너비 조절 (Notion 스타일)
- [x] ProseMirror `handleDOMEvents.dblclick` + mouseup 타이밍 백업 이중 감지
- [x] 셀 좌/우 경계 모두 감지 (16px 임계값), span 기반 DOM 텍스트 측정
- [x] `.column-resize-handle`에 `pointer-events: none` 복원 — 핸들 재생성으로 인한 이벤트 감지 실패 해결
- [x] `table-layout: fixed` + `overflow-x: auto` — 열 너비 독립 조절 (한 열 변경 시 다른 열 영향 없음)
- [x] 툴바 Auto-fit 버튼 — 전체 열 일괄 자동 너비 조절 (span 기반 측정으로 통일)

**이미지 기능 확장:**
- [x] 이미지 정렬 — 좌/중/우 정렬 툴바 (hover/select 시 표시)
- [x] 이미지 캡션 — 인라인 캡션 입력 필드
- [x] 리사이즈 핸들 — 드래그로 이미지 크기 조절

## Phase 7-A — 데이터 모델 확장 ✅ (2026-06-05)

SPEC.md 기반 frontmatter v2 스키마, 데이터 파일 확장.

- [x] NoteType 확장 — daily-log, quick-memo, analysis-note, test-log, design-note, study-note, review
- [x] NoteStatus enum — draft, in-progress, complete, archived
- [x] Frontmatter v2 — id, date, experiment, subsystem[], related[], status, verdict, workhour, workhour_detail, summary, carried_over
- [x] project 필드 string → string[] 배열 변환 + normalizeProject() 호환 함수
- [x] Task 모델 확장 — subsystem, tags, related_notes, daily_logs, carry_count, recurring
- [x] data/tags.json — 태그 인덱스 + keyword_map (GNC 용어 매핑)
- [x] data/links.json — 노트 간 forward/backward 링크 그래프
- [x] data/subsystems.json — Primary(ADCS, Orbit) + Secondary(OBC, EPS, COM, STR, Thermal, Payload)
- [x] initDataFiles() — 앱 시작 시 tags/links/subsystems JSON 기본값 생성
- [x] FTS5 스키마 v2 — id, subsystem, experiment, status 컬럼 추가 (스키마 버전 관리)
- [x] 파일 워처 확장 — links-changed, subsystems-changed 이벤트, notes/ 전체 폴더 감시
- [x] 기존 노트 마이그레이션 — Settings에서 실행, type/project/id/subsystem/related/status 자동 변환
- [x] DailyLog frontmatter v2 스키마 적용

## Phase 7-B — 템플릿 & Daily Log ✅ (2026-06-05)

노트 템플릿 교체, Daily Log 구조화, 자동화 규칙.

- [x] 6종 노트 템플릿 — quick-memo(💬), analysis-note(📊), test-log(🔧), design-note(📐), study-note(📚), blank(📝)
- [x] 노트 ID 스키마 — `{date}-{type-abbrev}-{seq}` 자동 생성 (예: 2026-06-05-analysis-001)
- [x] Daily Log 구조화 — 프로젝트별 섹션, 인사이트&의사결정, 오늘 생성한 노트 테이블, 내일 계획, 회고
- [x] 미완료 업무 이월 (§3.5) — 전날 unchecked 항목 자동 파싱, (이월) 마커 삽입, carry_count 증가
- [x] TODO ↔ Daily Log 연동 (§3.6) — in-progress 할일 자동 삽입, 마감일 경고(D-N/D+N)
- [x] Quick Memo 승격 (§3.2) — 우클릭 컨텍스트 메뉴에서 Analysis/Design/Study/Test로 승격, 원본 archived 처리
- [x] Morning Briefing (§5.2) — 앱 시작 시 당일 첫 접속 모달 (이월/overdue/D-Day/주간 workhour)
- [x] 노트 목록에 타입 아이콘 표시

## Phase 7-C — 링크 시스템 ✅ (2026-06-05)

위키링크, 자동 링크, 백링크, 태그 자동완성.

- [x] links.json 자동 갱신 — 노트 생성/삭제 시 forward/backward 링크 동기화 (linkGraph.ts)
- [x] [[ ]] 위키링크 자동완성 — 에디터에서 `[[` 입력 시 FTS5 검색 드롭다운, 방향키+Enter 선택
- [x] 백링크 사이드 패널 — 노트 에디터 우측 접이식 패널, "Referenced by" + "References" 목록
- [x] 태그 자동완성 — tags.json 기반 prefix-match 드롭다운 (빈도순), 자동 정규화 (lowercase-hyphen)
- [x] Subsystem enum UI — Primary/Secondary 구분 체크박스 드롭다운
- [x] Experiment 입력 필드 추가
- [x] Status 드롭다운 (draft/in-progress/complete/archived)

## Phase 7-D — Workhour 추적 ✅ (2026-06-05)

뽀모도로 연동 작업시간 추적, 프로젝트 컨텍스트 자동 전환.

- [x] workhours/{date}.json 저장 — 세션 기록 (project, startedAt, endedAt, durationMinutes, source)
- [x] 뽀모도로 → workhour 자동 기록 — work 세션 완료 시 activeProject로 자동 저장
- [x] 프로젝트 컨텍스트 자동 전환 (§5.5) — 노트 열면 해당 project가 activeProject로 설정
- [x] StatusBar workhour 표시 — 오늘 작업시간 + activeProject
- [x] Morning Briefing 주간 workhour 통합
- [x] 주간 workhour 집계 함수 (getWeeklyWorkhour)

## Phase 7-E — Dashboard & Statistics ✅ (2026-06-05)

- [x] Statistics 탭 UI — `statistics` AppView, Sidebar/DockMode 네비게이션 추가
- [x] Dashboard (§4.2) — 프로젝트별 시간 바 차트, 노트 유형별 파이 차트, KPI 카드 8개
- [x] 노트 건강 점검 (§3.14) — orphan/stale/missing-verdict/empty-conclusion/overdue/carry-over/tag-duplicate/empty-applicability (8가지)
- [x] Recharts 차트 — BarChart (workhour by project), PieChart (notes by type), rate bars
- [x] Growth Score (§4.6) — 4축 성장 점수 (생산성/기술성장/엔지니어링/지식관리), RadarChart 시각화
- [x] 기간 선택 — This Week / This Month 토글

### 구현 파일:
- `src/lib/statistics.ts` — 전체 노트 수집, workhour 집계, TODO/완료율/시험통과율 계산, GrowthScore 4축 계산
- `src/lib/noteHealth.ts` — 8가지 건강 점검 (orphan, stale-in-progress, missing-verdict, empty-conclusion, overdue-todo, high-carry-over, tag-duplicate, empty-applicability)
- `src/components/statistics/StatisticsView.tsx` — Dashboard UI (StatCard, RateCard, HealthBanner, Recharts BarChart/PieChart/RadarChart)
- `src/stores/useAppStore.ts` — `statistics` AppView 추가
- `src/components/layout/Sidebar.tsx` — Stats 네비게이션 아이콘
- `src/components/layout/ExpandedMode.tsx` — StatisticsView 뷰 라우팅
- `src/components/layout/DockMode.tsx` — Stats 독 버튼

## Phase 7-F — AI Review Pages ✅ (2026-06-05)

- [x] reviews/ 폴더 + Review frontmatter (weekly/monthly/quarterly)
- [x] 데이터 수집 (reviewCollector.ts) + 프롬프트 생성 (reviewGenerator.ts) + 파일 저장
- [x] 리뷰 목록 UI + 페이지 뷰 (ReviewListView, Statistics > Reviews 탭)
- [x] Review frontmatter stats (§4.3) — ReviewStats JSON을 frontmatter에 저장
- [x] Claude.ai 클립보드 방식 — Copy Prompt → claude.ai에 붙여넣기 → Paste Result → 저장 (API 키 불필요)
- [x] 이번 기간 / 지난 기간 선택 — 앱 사용 초기에도 현재 주/월 데이터로 리뷰 생성 가능
- [x] 스케줄 알림 (주/월/분기) — 설정 시간에 OS 알림으로 리뷰 생성 상기

### 구현 파일:
- `src/lib/reviewCollector.ts` — 기간별 노트/workhour/TODO 데이터 수집, ReviewStats 계산, 이번/지난 기간 선택
- `src/lib/reviewGenerator.ts` — 프롬프트 생성 (system prompt + 데이터), 리뷰 저장
- `src/lib/clipboard.ts` — Tauri WebView 호환 클립보드 유틸리티
- `src/components/statistics/ReviewListView.tsx` — 리뷰 탭 UI (Copy Prompt → Paste Result 2단계 플로우)
- `src/components/productivity/ReviewSchedulerStatus.tsx` — 스케줄 설정 UI (On/Off, 알림 시간, Copy Prompt)
- `src/components/productivity/ReviewScheduler.tsx` — 백그라운드 스케줄러 (알림 전송)

## Phase 7-G — 마이크로 자동화 ✅ (2026-06-05)

- [x] 글로벌 Quick Capture 단축키 (Cmd+Shift+N) — QuickCapture 오버레이 팝업, Enter x2로 저장
- [x] Evening Reminder (18:00 OS 알림, 금요일 회고 알림)
- [x] 반복 TODO 자동 생성 (daily/weekly/monthly, 앱 시작 시 처리)
- [x] 노트 자동 아카이브 (complete quick-memo 14일 미수정 → archived, 앱 시작 시)
- [x] 스마트 템플릿 제안 (§5.4) — Quick Memo 작성 중 키워드 감지 → 승격 제안 배너
- [x] Daily Log 자동 요약 (§3.10) — 체크된 항목 + 인사이트 추출 → 100자 summary
- [x] subsystem 자동 추출 (§3.8) — 본문 키워드 감지 → 에디터 배너로 추가 제안
- [x] 태그 자동 추출 (§3.9) — tags.json keyword_map 기반 배너 제안
- [x] TODO↔Daily Log 체크박스 동기화 (§3.6) — Daily Log에서 체크 시 todos.json status→done
- [x] 후속 과제 추적 (§3.4) — 후속 과제 체크박스 완료 시 관련 노트 생성 제안
- [x] Experiment 자동 링크 제안 (§3.3) — 같은 experiment 노트 발견 시 Link All 배너
- [x] Auto-status 감지 (§3.7) — 결론 작성/verdict 설정 시 complete 제안 배너
- [x] 반복 분석 조건 자동 채움 (§3.11) — 같은 experiment의 이전 분석 Base 조건 복사 제안
- [x] 시험 전후 비교 자동화 (§3.12) — 같은 experiment의 이전 시험 측정 데이터 구조 복사 + 비교 섹션 추가
- [x] 코드 참조 자동 감지 (§3.13) — *.m, *.py, *.slx 등 파일 경로 패턴 감지 → 배너 알림
- [x] 클립보드 Quick Capture (§5.7) — Ctrl+V URL→Study Note, 100자+ 텍스트→Quick Memo 토스트
- [x] 에디터 스마트 변환 (§5.9) — TipTap InputRule: 날짜(6/10→2026-06-10), 그리스 문자(sigma→σ), 수학 기호(deg→°)
- [x] 뽀모도로 프로젝트 자동 감지 (§5.12) — 현재 열린 노트의 project로 타이머 세션 자동 설정
- [x] Study Note 적용 추적 (§5.8) — study_to_application 비율 계산
- [x] 수동 Workhour 입력 — StatusBar "+" 버튼, 프로젝트/시간/메모 입력 UI

### 구현 파일:
- `src/components/productivity/QuickCapture.tsx` — Cmd+Shift+N 글로벌 Quick Capture 오버레이
- `src/components/productivity/EveningReminder.tsx` — 18:00 OS 알림 (인사이트/금요일 회고)
- `src/components/productivity/ClipboardCapture.tsx` — 클립보드 URL/텍스트 감지 → Study Note/Quick Memo 토스트
- `src/components/productivity/ManualWorkhour.tsx` — 수동 workhour 입력 드롭다운 UI
- `src/components/notes/AutoSuggestionBanner.tsx` — 통합 스마트 배너 (status 감지, 승격 제안, 태그/subsystem 추출, experiment 링크, 후속 과제, 코드 참조, 분석 조건 자동 채움, 시험 비교)
- `src/components/editor/extensions/SmartTransform.ts` — TipTap InputRule 확장 (날짜, 그리스 문자, 수학 기호)
- `src/lib/autoExtract.ts` — subsystem 키워드 매핑 (SUBSYSTEM_KEYWORDS) + 태그 키워드 매핑
- `src/lib/experimentAutoFill.ts` — 이전 분석 Base 조건 추출, 이전 시험 측정 데이터 추출, 코드 참조 감지
- `src/lib/dailyLogHelper.ts` — 자동 요약 (generateDailyLogSummary), TODO 체크 동기화 (detectNewlyCheckedTodos, completeTodo)
- `src/lib/recurringTodos.ts` — recurring TODO 자동 생성 (daily/weekly/monthly)
- `src/lib/autoArchive.ts` — quick-memo 14일 미수정 자동 아카이브
- `src/components/layout/AppShell.tsx` — EveningReminder, QuickCapture, ClipboardCapture 통합

## Phase 8 — 배포 & 마무리 ✅

크로스 플랫폼 빌드, 자동 업데이트, 성능 최적화, 추가 테마.

- [x] macOS + Windows 크로스 플랫폼 빌드 파이프라인 (GitHub Actions CI/CD)
- [x] Tauri Updater 플러그인 — 앱 자동 업데이트
- [x] 성능 최적화 — 대량 노트(100+) 시 검색/목록 로딩 속도 개선
- [x] 키보드 단축키 체계 — Cmd+1~7 뷰 전환, Cmd+K 검색, Cmd+N 새 노트, Cmd+D Daily, Cmd+T Tasks, Cmd+Shift+N Quick Capture
- [x] 추가 테마 — Spreadsheet, BuddyBuddy, Paper, Solarized, Terminal + 기존 5종 = 10개 테마
- [x] 데이터 내보내기/가져오기 — HTML/Markdown 일괄 export, Notion markdown import
- [x] 접근성 개선 — Dropdown 키보드 네비게이션 (방향키/Enter/Escape), ARIA 속성, role/aria-current
- [x] 앱 아이콘 + 스플래시 스크린 — 궤도 로고 SVG, Tauri icons 전체 사이즈 생성
- [x] 사용자 가이드 / 온보딩 튜토리얼 — 8단계 OnboardingTour + Settings User Guide (상세 한국어 가이드)
- [x] AI 리뷰 — Claude.ai 클립보드 방식 (Copy Prompt → claude.ai → Paste Result), 스케줄 알림 (주/월/분기)
- [x] Graph View — Force-directed 노드 그래프, 프로젝트/타입 필터, 줌/팬/드래그, 노드 클릭→노트 이동, Fit 버튼
- [x] Working Hour 타이머 — 사이드바 스톱워치 (출근→0시작), 초기화/추가/삭제 버튼, localStorage 영속
- [x] Mermaid 다이어그램 렌더링 — 코드블록 language=mermaid 선택 시 렌더링, 더블클릭으로 소스 편집
- [x] TODO 이월 경고 강화 — carry_count >= 3 시 🔴 D+N 연속 이월 마커 표시
- [x] Morning Briefing에 AI Report 바로가기 추가 — "AI Report 열기" 버튼 → Statistics > Reviews
- [x] 리뷰 데이터 보강 — weekly 리뷰 시 daily log 본문 2000자 포함, new_tags 자동 계산 (이전 기간 비교)
- [x] claude.ai 자동 열기 — Copy Prompt 시 자동으로 브라우저에서 claude.ai 열기

## Phase 9 — SPEC.md 기반 미구현 기능 (예정)

SPEC.md 업데이트 기반. experiment→topic 리네이밍, 토픽 시스템, 섹션↔TODO 동기화, 설정 확장.

### 9-A: experiment → topic 리네이밍 + topics.json ✅ (2026-06-06)

기존 `experiment` 필드를 SPEC.md 기준 `topic`으로 통일. 토픽 관리 시스템 신규 구현.

- [x] frontmatter `experiment` → `topic` 필드 리네이밍 (note.ts NoteMeta 인터페이스)
- [x] FTS5 스키마 v3 — `experiment` 컬럼 → `topic` 리네이밍 (db.ts)
- [x] experimentAutoFill.ts → topicAutoFill.ts 리네이밍 + 내부 로직 topic 기반 변경
- [x] AutoSuggestionBanner, NoteListView 등 UI에서 experiment→topic 용어 변경
- [x] 기존 노트 호환성 — `fields.topic ?? fields.experiment` 폴백으로 기존 노트 자동 인식
- [x] data/topics.json 생성 — TopicEntry (name, project, subsystem, keywords, note_count, last_used)
- [x] constants.ts FILES.topics + fileSystem.ts initDataFiles에 topics.json 자동 생성
- [x] 토픽 드롭다운 UI — 기존 experiment 텍스트 입력 → 드롭다운 선택 (프로젝트별 필터링, 빈도순 정렬)
- [x] "새 토픽 만들기" — 드롭다운 내 인라인 입력으로 신규 토픽 생성
- [x] 토픽 자동 추천 (SPEC §3.16) — 본문/tags/subsystem/project 기반 score 계산 → 배너 제안 (최소 3점)
- [x] 같은 topic 연결 제안 (SPEC §3.3) — 같은 topic 다른 노트 발견 시 "Link All" 배너
- [x] useFileWatcher topics-changed 이벤트 추가

### 9-B: 섹션 체크박스 → TODO 자동 생성 ✅ (2026-06-06)

특정 섹션의 체크박스를 todos.json에 자동 등록. source_note/source_section 필드 활용.

- [x] Task 인터페이스에 source_note, source_section 필드 추가 (task.ts)
- [x] 대상 섹션 매핑 구현 — Analysis/Study "후속 과제"/"추가 조사 필요", Test "후속 조치", Design "결론 & 후속"
- [x] 노트 저장 시 대상 섹션 체크박스 파싱 → 중복 확인 → TODO 자동 생성 (registerNoteTodo)
- [x] source_note, source_section 필드 활용 — TODO 패널에서 "📎 note-abbrev" 배지 표시 (hover로 전체 경로)
- [x] 양방향 동기화 — 체크박스 체크→TODO done, 언체크→TODO reopen, TODO done→노트 체크박스 [x]
- [x] NoteListView handleChange에 prevBodyRef 추적 + syncNoteCheckboxesWithTodos 통합
- [x] 새 체크박스 작성 시 자동으로 [TASK-xxx] ID 삽입

### 9-C: config.json 확장 + 자동화 설정 UI ✅ (2026-06-06)

각 자동화 기능의 on/off 토글을 Settings에서 제어.

- [x] AppConfig 타입 정의 (src/types/config.ts) — EditorConfig, TagRulesConfig, AutoArchiveConfig, NotificationsConfig + 기본값
- [x] useConfigStore (Zustand) — config.json ↔ 전역 상태 동기화, loadFromConfig/toConfigFields
- [x] config.json 스키마 확장 — editor (smart_transform, auto_tag_suggest, auto_subsystem_suggest, clipboard_capture), tag_rules, auto_archive 필드
- [x] Settings 뷰에 Automation 섹션 추가 — 4개 토글 스위치 (ToggleRow 컴포넌트) + Auto Archive days 숫자 입력
- [x] SmartTransform 조건부 로딩 — getExtensions에 smartTransform 파라미터, NoteEditor에서 configStore 참조
- [x] ClipboardCapture 조건부 렌더링 — AppShell에서 clipboard_capture 플래그로 on/off
- [x] Auto Tag Suggest 조건부 — AutoSuggestionBanner에서 auto_tag_suggest 플래그 참조
- [x] Auto Archive config 반영 — autoArchive.ts에서 config.json의 quick_memo_days 읽기 (기본 14일)
- [x] AppShell applyConfig에서 config-changed 이벤트 시 configStore 자동 갱신

### 9-D: 템플릿 관리 UI ✅ (2026-06-06)

앱 내에서 템플릿을 편집/추가/삭제할 수 있는 Template Editor.

- [x] TemplateEditor 컴포넌트 — 모달 UI (목록 + 마크다운 편집기)
- [x] data/templates.json 기반 영속화 — 기본 6종 템플릿 (built-in) + 사용자 커스텀 템플릿
- [x] 템플릿 편집 — 이름, 타입, 본문(마크다운) 수정 + 저장
- [x] 템플릿 추가 — "+ Add Template" 버튼으로 커스텀 템플릿 생성
- [x] 템플릿 삭제 — 사용자 커스텀 템플릿 삭제 (built-in은 삭제 불가, Reset만 가능)
- [x] Reset to Default — 개별 built-in 템플릿 초기화 + 전체 초기화
- [x] Notes 헤더에 Edit Templates 버튼 (연필 아이콘) 추가
- [x] 동적 템플릿 로딩 — + New 드롭다운이 customTemplates 기반으로 렌더링

### 9-E: 섹션 가이드 텍스트 (Placeholder 가이드) ✅ (2026-06-06)

템플릿의 HTML 주석(`<!-- ... -->`)을 기반으로 빈 섹션에 회색 가이드 문구를 표시.

- [x] SectionGuide ProseMirror 플러그인 (src/components/editor/extensions/SectionGuide.ts)
  - extractGuideMap(): 템플릿 본문에서 heading→HTML 주석 매핑 추출
  - Decoration.widget: 빈 섹션에 `.section-guide-placeholder` 가이드 표시
  - 섹션 비어있음 판단: text/table/codeBlock/image/list 등 실제 콘텐츠 없으면 empty
- [x] 빈 섹션 → 회색 placeholder 가이드 텍스트 표시
- [x] 사용자가 타이핑 시작 → 가이드 텍스트 자동 소멸 (ProseMirror decorations은 매 트랜잭션마다 재계산)
- [x] 콘텐츠 전부 삭제 → 가이드 텍스트 복원
- [x] 기존 HTML 주석 가이드를 placeholder 방식으로 활용 (주석 내용 → 가이드 텍스트로 자동 매핑)
- [x] Settings에서 on/off 토글 — editor.section_guides config 플래그
- [x] NoteListView에서 activeNote의 noteType → 매칭 템플릿 → guideMap 계산 → NoteEditor에 전달
- [x] editor.css에 .section-guide-placeholder 스타일 (회색, 이탤릭, pointer-events: none)

### Phase 8 잔여 (배포) ✅ (2026-06-06)

- [x] Workhour 파일 워처 동기화 — workhours-changed 이벤트 추가, StatusBar/Statistics 자동 갱신
- [x] 성능 최적화 — collectAllNotes() 10초 TTL 캐시 (600+ reads → ~100), 태그 로딩 중복 제거, AutoSuggestion FTS5 쿼리 전환
- [x] macOS + Windows 크로스 플랫폼 빌드 파이프라인 — GitHub Actions CI/CD (ci.yml + build.yml), v* 태그 시 자동 릴리즈
- [x] Tauri Updater 플러그인 — tauri-plugin-updater, UpdateChecker 컴포넌트, latest.json 엔드포인트

## Phase 10 — UI/UX 확장 ✅ (2026-06-06)

SPEC.md §7~9 기반. 창 투명도, 줌, 디자인 통일, 태스크 편집, Statistics 확장.

### 10-A: 투명도 조절 (Opacity Slider) ✅ (2026-06-06)

TitleBar에 투명도 슬라이더 추가. 모드별(Dock/Sidebar/Expanded) 독립 투명도 저장.

- [x] TitleBar에 투명도 슬라이더 UI 추가 (아이콘 + 슬라이더 바 + 퍼센트)
- [x] 투명 창 지원 (tauri.conf.json `transparent: true`, `shadow: true`)
- [x] CSS opacity로 실시간 투명도 변경 (30%~100% 범위)
- [x] 모드별 독립 투명도 config.json 영속화 (opacity_dock, opacity_sidebar, opacity_expanded)
- [x] 모드 전환 시 저장된 투명도 자동 적용 (AppShell에서 configStore 기반)
- [x] Dock 모드에도 투명도 슬라이더 추가 (OpacitySlider 공유 컴포넌트)
- [x] 슬라이더 디바운스 저장 (500ms)

### 10-B: 사이드바/독 디자인 통일 (Theme Design Sync) ✅ (2026-06-06)

Expanded 모드의 테마 디자인 요소를 Dock/Sidebar에도 적용하여 모드 간 시각적 일관성 확보.

- [x] AppShell에 `data-mode` 속성 추가 (dock/sidebar/expanded) — CSS 타겟팅
- [x] 10종 테마 각각 Dock/Sidebar 전용 CSS 추가 (배경 그라디언트, hover 효과)
- [x] Cyberpunk: 네온 글로우, 다크 그라디언트 배경
- [x] Terminal: 그린 텍스트 그로우, CRT 효과 (기존 #root 가상요소로 전체 적용)
- [x] BuddyBuddy: XP 스타일 그라디언트, 둥근 버튼
- [x] Paper: 따뜻한 그라디언트 배경
- [x] Spreadsheet: compact 폰트 사이즈
- [x] Dark/Ocean/Forest/Solarized: 테마별 미묘한 배경 그라디언트

### 10-C: 확장 모드 줌 (Zoom In/Out) ✅ (2026-06-06)

Cmd+/- 단축키로 Expanded 모드 전체 창 확대/축소.

- [x] 줌 레벨 상태 관리 (configStore.window.zoom_level, 50%~200%, 10% 스텝)
- [x] Cmd + = / Cmd + - / Cmd + 0 키보드 단축키 등록 (useKeyboardShortcuts)
- [x] CSS zoom 적용 (ExpandedMode 루트 div)
- [x] StatusBar에 줌 레벨 표시 배지 ("120%", 클릭 시 100% 리셋)
- [x] config.json에 zoom_level 영속화
- [x] Dock/Sidebar 모드에서는 줌 비활성화 (Expanded only)

### 10-D: 사이드바 태스크 클릭→편집 (Task Edit) ✅ (2026-06-06)

사이드바에서 태스크/서브태스크 클릭 시 편집 패널 표시.

- [x] 메인 태스크 타이틀 클릭 → SidebarTaskEditor 편집 패널 열기 (hover:text-chrome 피드백)
- [x] SidebarSubtaskRow 컴포넌트 — 서브태스크 전용 행 (toggle + title + edit/delete)
- [x] 서브태스크 hover 시 ✏️(편집)/🗑️(삭제) 아이콘 마커 표시
- [x] 서브태스크 ✏️ 클릭 → 인라인 텍스트 편집 (Enter 저장, Esc 취소, blur 자동 저장)
- [x] 서브태스크 🗑️ 클릭 → 즉시 삭제
- [x] SidebarTaskEditor 내부 서브태스크도 SidebarSubtaskRow 통일 적용
- [x] 기존 서브태스크 추가 ("+ subtask...") 유지

### 10-E: 항상 위 (Always on Top) 모드별 설정 ✅ (2026-06-06)

Dock/Sidebar/Expanded 모드 각각에 대해 항상 위 On/Off 독립 설정.

- [x] Settings 뷰에 "Window" 섹션 추가 (Dock/Sidebar/Expanded 각각 토글)
- [x] config.json에 모드별 always_on_top 필드 추가 (always_on_top_dock, always_on_top_sidebar, always_on_top_expanded)
- [x] Rust set_window_mode에 always_on_top 파라미터 추가, 모드 전환 시 자동 적용
- [x] 기본값: Dock=true, Sidebar=true, Expanded=false
- [x] TitleBar/DockMode/SidebarMode에서 모드 전환 시 configStore의 always_on_top 값 전달

### 10-F: Statistics 확장 — Workhour by Day + 추가 시각화 ✅ (2026-06-06)

Statistics Dashboard에 요일별 작업시간 차트 + 추가 시각화 요소.

- [x] Workhour by Day 바 차트 — This Week/Month: 월~일 개별 바 (Recharts BarChart)
- [x] Monthly Heatmap — This Month: 주차별(1~N주) × 요일 히트맵 (CSS Grid, GitHub contribution 스타일)
- [x] workhours/{date}.json → 요일별 집계 함수 구현 (getWorkhourByDay, getMonthlyHeatmap)
- [x] 연속 기록 스트릭 (Writing Streak) — Daily Log 연속 작성일 + 최장 스트릭 (StreakCard)
- [ ] (추후) 시간대별 생산성 히트맵, 프로젝트 시간 추이, 태그 클라우드, 집중 시간 분포

### 구현 파일 (예상):
- `src/components/layout/TitleBar.tsx` — 투명도 슬라이더 UI 추가
- `src/components/layout/DockMode.tsx` — 테마 디자인 요소, 태스크 클릭 편집
- `src/components/layout/Sidebar.tsx` — 테마 디자인 요소, 태스크 클릭 편집
- `src/components/tasks/TaskEditModal.tsx` — 태스크 편집 모달 (신규)
- `src/components/statistics/WorkhourByDay.tsx` — 요일별 워크아워 차트 (신규)
- `src/components/statistics/WritingStreak.tsx` — 연속 기록 스트릭 (신규)
- `src/components/statistics/ProductivityHeatmap.tsx` — 시간대별 히트맵 (신규)
- `src/components/statistics/StatisticsView.tsx` — 확장 차트 통합
- `src/components/settings/SettingsView.tsx` — Always on Top 섹션 추가
- `src/stores/useAppStore.ts` — zoomLevel, opacity 상태 추가
- `src/types/config.ts` — AppConfig window 필드 확장
- `src/styles/themes/*.css` — Dock/Sidebar 전용 디자인 토큰 추가

---

## 현재 진행 상태

**Phase 1~10 전체 완료** — 모든 기능 구현 및 배포 파이프라인 설정 완료

v0.2.0 기준 구현 완료 기능:
- Dock/Expanded 하이브리드 레이아웃, 커스텀 타이틀바
- TipTap 마크다운 에디터 (코드블록 syntax highlighting, 30개 언어, 스마트 변환)
- Daily Log + 6종 Research Notes (frontmatter v2 기반 메타데이터)
- Task Kanban (3단계, 우선순위, 서브태스크, 프로젝트 연결, 반복 TODO)
- 전문검색 (SQLite FTS5), 검색→노트 직접 링크
- [[ ]] 위키링크 자동완성, 백링크 사이드 패널, links.json 자동 갱신
- 뽀모도로 타이머 (프로젝트 자동 감지), YouTube 음악 플레이어, D-Day 카운터
- Workhour 추적 (뽀모도로 자동 + 수동 입력 + 사이드바 스톱워치), 프로젝트별 시간 통계
- 프로젝트·태그·subsystem 관리 (자동 추출 + 자동완성)
- Statistics Dashboard (KPI 카드, Recharts 차트, Growth Score 레이더, 노트 건강 점검)
- AI Review (Claude.ai 클립보드 방식: Copy Prompt → claude.ai → Paste Result → 저장)
- Graph View (force-directed 노트 그래프, 프로젝트/타입 필터, 줌/팬/드래그/호버)
- 스마트 자동화 배너 (status 감지, 태그/subsystem 추출, topic 링크, 후속 과제, 분석 조건 자동 채움, 시험 비교, 코드 참조)
- Quick Capture (Cmd+Shift+N), 클립보드 캡처 (URL/텍스트), Evening Reminder
- Morning Briefing, 미완료 업무 이월, TODO↔Daily Log 동기화
- 노트 자동 아카이브, Daily Log 자동 요약, Study Note 적용 추적
- 10개 테마 (Light/Dark/Cyberpunk/Forest/Ocean/Paper/Solarized/Terminal/Spreadsheet/BuddyBuddy)
- 클라우드 폴더 파일 감시 (실시간 동기화), 충돌 감지 배너
- 파일 첨부 (PDF/Word/HWP 등) + 클릭 시 시스템 앱으로 열기
- 데이터 내보내기/가져오기 (HTML/Markdown export, Notion import)
- 앱 아이콘 (궤도 로고) + 스플래시 스크린 + 8단계 온보딩 투어
- 키보드 단축키 (Cmd+1~7, Cmd+K, Cmd+N, Cmd+D, Cmd+T, Cmd+Shift+N)
- 테이블 열 Auto-fit, 이미지 정렬/캡션/리사이즈

### SPEC.md 대비 미구현 기능 요약

| Phase | 기능 | SPEC 참조 | 규모 | 상태 |
|-------|------|-----------|------|------|
| 9-A | experiment→topic 리네이밍 + topics.json + 토픽 드롭다운/추천 | §1.2, §1.7, §3.3, §3.16 | 2-3일 | ✅ |
| 9-B | 섹션 체크박스 → TODO 자동 생성 (양방향 동기화) | §3.15 | 1-2일 | ✅ |
| 9-C | config.json 확장 + 자동화 설정 UI | §6.3 | 1일 | ✅ |
| 9-D | 템플릿 관리 UI (in-app editor) | §6.2 | 0.5일 | ✅ |
| 9-E | 섹션 가이드 텍스트 (빈 섹션 placeholder) | — | 1-2일 | ✅ |
| 10-A | 투명도 조절 (Opacity Slider) | §7.1 | 0.5-1일 | ✅ |
| 10-B | 사이드바/독 디자인 통일 (Theme Design Sync) | §7.2 | 2-3일 | ✅ |
| 10-C | 확장 모드 줌 (Zoom In/Out) | §7.3 | 0.5일 | ✅ |
| 10-D | 사이드바 태스크 클릭→편집 (Task Edit) | §8.1 | 1-2일 | ✅ |
| 10-E | 항상 위 모드별 설정 (Always on Top) | §7.4 | 0.5일 | ✅ |
| 10-F | Statistics 확장 — Workhour by Day + 추가 시각화 | §9.1, §9.2 | 2-3일 | ✅ |
| 8잔여 | 빌드 파이프라인, 자동 업데이트, 성능 최적화, Workhour 동기화 | — | 3-4일 | ✅ |
