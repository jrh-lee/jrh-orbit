# jrh-orbit Improvement Plan & Code Review

> 2026-06-22 · 17 issues · Root cause analysis + fix specifications

---

## 목차

- [A. Notes Editor — Notion-like UX Roadmap](#a-notes-editor--notion-like-ux-roadmap)
- [B. Bugs — Root Cause & Fix Plan (8)](#b-bugs--root-cause--fix-plan)
- [C. UX Improvements (5)](#c-ux-improvements)
- [D. Feature Requests (4)](#d-feature-requests)
- [E. Priority & Effort Matrix](#e-priority--effort-matrix)

---

## A. Notes Editor — Notion-like UX Roadmap

현재 에디터는 **TipTap 3.25 (ProseMirror)** 기반으로 17개 이상의 extension을 사용 중입니다.
Notion 수준의 사용성을 위해 아래 영역별 현황과 개선 방향을 정리합니다.

### Notion vs jrh-orbit 기능 비교

| 기능 | 현재 상태 | 설명 |
|------|-----------|------|
| ✅ 블록 에디터 기반 | 구현됨 | TipTap/ProseMirror가 블록 기반. 각 paragraph, heading, list item이 노드 단위. 기반 구조는 이미 Notion과 동일. |
| ❌ 블록 드래그 핸들 | 미구현 | 현재 이미지에만 `data-drag-handle` 속성이 있음. 모든 블록에 좌측 드래그 핸들 UI 필요. `@tiptap-pro/extension-drag-handle` 또는 커스텀 구현 필요. |
| ✅ 리스트 들여쓰기 | 구현됨 | StarterKit의 Tab/Shift+Tab이 동작. 다만 일부 상황에서 indent가 풀리는 버그 존재 가능. |
| ❌ 블록 간 이동 (드래그) | 미구현 | 블록을 드래그해서 다른 위치로 옮기는 기능 없음. NodeView 기반 드래그 핸들 + ProseMirror DnD 로직 구현 필요. |
| ✅ 서식 도구 모음 | 구현됨 | EditorToolbar에 Bold, Italic, Heading, List, Table, Color, Align 등 대부분 구현. 696줄 규모. |
| ❌ Slash Commands | 미구현 | `/` 입력으로 블록 타입 빠르게 전환하는 기능 없음. `@tiptap/extension-slash-command` 또는 커스텀 Suggestion 플러그인 필요. |
| ✅ Task List 체크박스 | 구현됨 | TaskList + TaskItem 확장으로 구현. nested 지원, carry-over 배지 표시. ID 메타데이터 자동 숨김(HideTaskMeta). |
| ❌ Toggle / Callout 블록 | 미구현 | 접기/펼치기 토글 블록, 컬러 callout 블록 없음. Notion의 핵심 기능 중 하나. |

### 핵심 개선 항목 (Phase별)

1. **Phase 1 — 기본 사용성 수정**
   - 줄 간격 일관성 수정 (`editor.css` paragraph/list/heading margin 통일)
   - Tab 들여쓰기 안정화, 이미지 렌더링 버그 수정, 표 헤더 색상 수정
   - 이 단계는 기존 코드의 CSS/로직 버그 수정 위주

2. **Phase 2 — 블록 드래그 & 재정렬**
   - 모든 top-level 노드에 좌측 드래그 핸들 추가
   - TipTap Pro의 DragHandle 확장이 유료이므로, ProseMirror의 `NodeView` + 커스텀 `DragHandle` decoration으로 구현 권장
   - 각 블록 호버 시 좌측에 6-dot grip 아이콘 표시, 드래그하면 블록 위치 이동

3. **Phase 3 — Slash Commands**
   - `/` 키 입력 시 팝업 메뉴로 블록 타입 전환
   - TipTap의 `Suggestion` 유틸리티 기반으로 구현
   - Heading, Bullet List, Task List, Code Block, Table, Math, HR 등 빠르게 삽입

4. **Phase 4 — 고급 블록 타입**
   - Toggle(접기/펼치기), Callout(색상별 안내 박스), Column Layout 등
   - Notion 고유 블록 타입 추가. 각각 커스텀 TipTap extension으로 구현

### 에디터 줄 간격 분석

현재 `editor.css`에서 블록 타입별 margin이 불일치합니다:

```css
/* 현재 상태 - 블록 타입별 다른 간격 */
.ProseMirror          { line-height: 1.65; font-size: 0.9375rem; }
.ProseMirror p        { margin: 0.25rem 0; }
.ProseMirror li       { margin: 0.15rem 0; }     /* p와 다름! */
.ProseMirror li p     { margin: 0; }
.ProseMirror pre      { line-height: 1.6; }       /* base와 다름! */
.ProseMirror h2       { margin: 1.25rem 0 0.5rem; }

/* 개선안 - 통일된 간격 시스템 */
.ProseMirror          { line-height: 1.65; }
.ProseMirror p        { margin: 0.2rem 0; }
.ProseMirror li       { margin: 0.2rem 0; }       /* p와 동일 */
.ProseMirror li p     { margin: 0; }
.ProseMirror pre      { line-height: 1.65; }      /* base와 동일 */
```

---

## B. Bugs — Root Cause & Fix Plan

### #01 Timer 패널 닫으면 시간 누적 안 됨 `BUG` `Effort: M`

**Root Cause**

`useWorkhourTimerStore`는 실제로 localStorage에 timer 상태를 저장하고 있으며,
앱 재시작 시에도 `running=true`이면 경과 시간을 복원합니다 (line 72-80).
`document.visibilitychange` 이벤트로 탭 비활성 시에도 시간을 보정합니다.

**문제는 "패널 닫기"의 의미**에 있습니다.
WorkhourTimer 컴포넌트가 언마운트되면 `setInterval`이 정리되지만,
store의 `start()` 함수에서 interval을 관리하는 `intervalId`가 **module-scope 변수**입니다.
컴포넌트 언마운트 시 interval이 클리어되면, 다시 마운트될 때 localStorage에서 복원하지만,
**그 사이 시간은 startedAt 기반으로 계산되므로 누적은 정상**이어야 합니다.

실제 원인은 **WorkhourTimer가 특정 뷰에서만 렌더링**되는 구조일 가능성이 높습니다.
패널을 닫으면 interval이 정지되고, localStorage의 `running` 상태가 `pause()`로 변경될 수 있습니다.

**Affected Files**
- `src/stores/useWorkhourTimerStore.ts` — interval lifecycle
- `src/components/productivity/WorkhourTimer.tsx` — mount/unmount

**Fix Plan**
1. Store의 interval 관리를 **컴포넌트 lifecycle에서 분리**. Store 초기화 시 interval을 시작하고 앱 전체 수명 동안 유지.
2. 컴포넌트는 store의 `elapsed`를 구독만 하고, interval 시작/정지는 store의 `start()/pause()`만 호출.
3. `AppShell.tsx`에서 앱 시작 시 `useWorkhourTimerStore.getState().restore()`를 호출하여 이전 세션 복원.
4. 패널이 닫혀도 store의 interval은 계속 실행되므로 시간이 누적됨.

---

### #02 하단 바에 프로젝트 코드로 표시됨 `BUG` `Effort: S`

**Root Cause**

StatusBar에서 `activeProject`를 표시할 때, `useAppStore()`의 `activeProject` 값을 그대로 출력합니다.
이 값은 SidebarProjectTree에서 `projectId`로 설정되며 (SidebarProjectTree.tsx:18),
`projectId`는 내부 코드(예: `PROJ-001`)입니다.

**projects 배열에서 name을 조회하지 않고 id를 바로 표시**하는 것이 원인.

**Fix Plan**

StatusBar에서 `activeProject` ID를 받아 `projects.find(p => p.id === activeProject)?.name`으로 변환하여 표시.
또는 `setActiveProject()` 호출 시 name도 함께 저장.

---

### #03 사이드바 모드에서 노트 수정 기능 없음 `BUG` `Effort: M`

**Root Cause**

`SidebarMode.tsx`의 **MemoEditor** 컴포넌트 (line 654-798)는
오늘 생성된 quick-memo만 편집할 수 있는 경량 에디터입니다.

사이드바에서 기존 노트를 클릭하면 `openMemoForEdit()`가 호출되지만,
이 함수는 **오늘의 research 폴더에서만 파일을 로드**합니다.
이전 날짜의 노트나 다른 타입의 노트를 열 수 있는 경로가 없습니다.

Expanded 모드에서는 `NoteEditor` 전체가 렌더링되어 모든 노트를 편집할 수 있지만,
사이드바 모드에서는 MemoEditor만 있어서 기존 노트 수정이 불가능합니다.

**Affected Files**
- `src/components/layout/SidebarMode.tsx` — MemoEditor (line 654-798)

**Fix Plan**
1. `openMemoForEdit()`에 **임의 경로의 노트를 열 수 있는 파라미터** 추가.
2. 사이드바 노트 목록에서 클릭 시 해당 노트 경로로 MemoEditor를 초기화.
3. 또는, 사이드바에서 노트 클릭 시 **자동으로 Expanded 모드로 전환**하여 전체 편집 UI 제공 (더 간단한 접근).

---

### #04 Quick Memo 승격 시 기존 노트 유지 & 중복 안내 `BUG` `Effort: M`

**Root Cause**

`NoteListView.tsx`의 `handlePromote()` (line 694-754)에서
의도적으로 **"새 파일 생성 + 원본 archive"** 방식으로 구현되어 있습니다:

```typescript
// NoteListView.tsx:703-738
const noteId = generateNoteId(targetType, notes, typeAbbrevMap);
const fullPath = await join(dataDir, FOLDERS.research, filename);
// 1) 새 노트 생성 (새 ID, 새 type)
await invoke('write_note', { path: fullPath, content: fm + newBody });
// 2) 원본은 status: 'archived'로 변경
sourceFm = updateFrontmatterField(sourceFm, 'status', 'archived');
```

원본이 archived 되지만 **노트 목록에서 archived가 기본적으로 숨겨지지 않으면** 두 개가 보입니다.

**중복 안내 문제**: `AutoSuggestionBanner.tsx`의 `dismissed` 상태가
**React useState**로 관리됩니다 (line 54). 노트가 저장/리로드되면
컴포넌트가 리마운트되어 dismissed가 초기화되고, 키워드 매칭이 다시 발생합니다.
승격 후 type이 바뀌어도, **body의 키워드는 그대로**이므로 새 type에서도 트리거될 수 있습니다.

**Fix Plan**
1. **In-place 변환**으로 변경: 새 파일을 만들지 않고, 기존 파일의 frontmatter `type`과 `id` 필드만 업데이트. 필요시 파일명도 rename. 이렇게 하면 단일 파일이 유지됨.
2. `handlePromote`에서 승격 완료 후 frontmatter에 `promoted: true` 플래그 추가.
3. `AutoSuggestionBanner`에서 `promoted: true`이면 승격 제안을 건너뛰도록 수정.
4. 대안: dismissed 상태를 노트의 frontmatter에 저장하여 영구적으로 유지.

---

### #05 이미지 첨부 시 렌더링 안 됨 (Caption만 표시) `BUG` `Effort: M`

**Root Cause**

`ResizableImageView.tsx`에서 이미지는 `<img src={node.attrs.src}>`로 렌더링됩니다.
이미지 삽입 시 `EditorToolbar.tsx` (line 473-514)에서 파일을 `attachments/` 폴더에 복사하고
경로를 `src` 속성에 설정합니다.

**가능한 원인:**
1. **경로 문제**: Tauri의 WebView에서 로컬 파일 경로(`C:\...`)를 직접 src로 사용하면 보안 정책으로 차단될 수 있음. `convertFileSrc()` (Tauri API)를 사용해야 WebView에서 접근 가능.
2. **base64 변환 실패**: NoteEditor.tsx line 462-474의 드래그/드롭 핸들러에서 base64 변환을 시도하지만, 큰 이미지에서 실패할 수 있음.
3. **NodeView 렌더링 조건**: ResizableImageView에서 `node.attrs.src`가 비어있거나 invalid할 때 이미지 태그가 렌더링되지 않고 caption 영역만 보일 수 있음.

**Fix Plan**
1. ResizableImageView에서 `src` 값을 디버그 로그로 확인하여 실제 경로/값 파악.
2. 로컬 파일 경로인 경우 `convertFileSrc()`로 Tauri asset URL로 변환.
3. 이미지 로드 실패 시 fallback UI (에러 메시지 + 재시도 버튼) 표시.
4. `img` 태그에 `onError` 핸들러 추가하여 경로 문제 감지.

---

### #06 표 붙여넣기 시 첫 행 색상 깨짐 `BUG` `Effort: S`

**Root Cause**

외부에서 붙여넣은 표의 첫 행이 `<th>`가 아닌 `<td>`로 파싱되거나,
외부 HTML에 포함된 **인라인 스타일 `background-color: white`**가 테마 CSS를 덮어씁니다.

`editor.css` line 465에서 `th`에 `var(--color-paper-soft)` 배경을 지정하지만,
붙여넣기 시 원본의 인라인 스타일이 우선합니다.
TipTap의 `TableHeader` extension (extensions.ts:149-163)에서 `backgroundColor` 속성을
attribute로 파싱하므로, 외부 white 배경이 그대로 저장됩니다.

**Fix Plan**
1. 테이블 붙여넣기 시 **인라인 background-color를 제거**하는 paste transform 추가. TipTap의 `transformPastedHTML` 옵션에서 `th/td`의 background-color 인라인 스타일 제거.
2. 또는 `editor.css`에서 `th` 배경색에 `!important` 추가 (단, 사용자 커스텀 색상이 있으면 충돌 가능).
3. 가장 좋은 방법: paste transform에서 첫 행(`thead`)의 배경색만 제거하고, 나머지 셀은 유지.

---

### #07 Tasks에서 마크다운 원문 노출 `BUG` `Effort: S`

**Root Cause**

`TaskListView.tsx` line 465에서 task title을 **`<span>`에 plain text로 렌더링**합니다.
마크다운 렌더링이나 strip 처리가 없어서 `[링크](URL)`이 그대로 보입니다.

`[KGS]`가 `\[KGS\]`로 보이는 이유: task title이 Daily Log의 markdown에서 추출될 때,
대괄호가 마크다운 링크 문법으로 해석되지 않도록 **escape 처리**된 상태로 저장되기 때문입니다.

**Fix Plan**
1. Task title에서 마크다운 문법을 **plain text로 변환하는 strip 함수** 적용.
   `[text](url)` → `text`, `\[text\]` → `[text]`.
2. 정규식 예시: `title.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\\([\[\]])/g, '$1')`
3. Task 생성/수정 시점에서 title을 정규화하는 것도 고려 (저장 시 strip).

---

### #08 Daily Log에서 Task 수정 시 중복 생성 `BUG` `Effort: M`

**Root Cause**

Daily Log에서 task를 직접 수정하면 두 가지 경로가 동시에 실행됩니다:

1. `detectTodoTitleChanges()` (dailyLogHelper.ts:591)가 제목 변경을 감지하고 `updateTodoTitle()`로 todos.json을 업데이트.
2. 에디터의 onChange가 일반 텍스트 변경으로 인식하여 `- [ ] 수정된 텍스트`를 **새 task로 등록**하려고 시도.
   `registerNewTodo()` (line 808)가 ID가 없는 체크리스트 항목을 발견하면 새 TASK-XXX를 생성.

핵심: **제목 수정 시 기존 ID가 유지되어야 하는데**,
수정 과정에서 `[TASK-XXX]` 부분이 깨지면 ID 없는 항목으로 인식되어 새 task가 등록됩니다.
`deduplicateDailyLogBody()`가 있지만, 제목이 미묘하게 다르면 (오타 수정) 중복으로 인식하지 못합니다.

**Fix Plan**
1. `registerNewTodo()`에서 새 task 생성 전, 기존 task와 **유사도 비교** (Levenshtein distance 또는 포함 관계)로 중복 방지.
2. `HideTaskMeta` extension이 `[TASK-XXX]`를 숨기고 있으므로, 사용자가 제목만 수정해도 ID가 보존되는지 확인. 수정 시 ID prefix가 손상되지 않도록 **decoration 방식으로 숨기되, 실제 텍스트는 유지**.
3. `detectTodoTitleChanges()`가 실행된 후에는 `registerNewTodo()`를 건너뛰도록 순서 보장.

---

## C. UX Improvements

### #09 진행 중 시간 조정 + 버튼 추가 (-1h, -5m, +5m) `IMPROVE` `Effort: S`

**현재 상태**

코드 리뷰 결과, `addMinutes()`와 `subtractMinutes()`는 이미 **타이머 실행 중에도 동작**합니다
(useWorkhourTimerStore.ts:112-131). 현재 세션 시간을 계산한 후 baseElapsed에 반영하는 구조.

그러나 **UI에서 버튼이 비활성화**되어 있거나, 버튼이 숨겨져 있을 가능성이 있습니다.
WorkhourTimer.tsx의 조정 버튼 영역(line 69-100)이 특정 조건에서만 표시되는지 확인 필요.

**Fix Plan**
1. 타이머 실행 중에도 조정 버튼이 항상 활성화/표시되도록 UI 조건 수정.
2. 버튼 추가: `-1h`, `-5m`, `+5m`. 기존 `-30m`, `-10m`, `+10m`, `+30m`, `+1h`에 추가.
3. 레이아웃: 두 줄 그리드로 배치 (`-1h -30m -10m -5m | +5m +10m +30m +1h`).

---

### #10 Hub: Topic 대신 Tags 필터 + PROJECT-only 노트 즉시 반영 `IMPROVE` `Effort: M`

**Root Cause**

`hubLoader.ts`의 `loadProjectHubData()` (line 132-205)에서
`findNotesForProject()`로 프로젝트 노트를 조회합니다.

`db.ts` line 136-149의 `findNotesForProject()`는
**전체 FTS 인덱스를 로드한 후 JS에서 필터링**합니다:

```typescript
// db.ts:142 - 전체를 가져온 후 필터
const all = await database.select<HubNoteRow[]>(
  `SELECT * FROM notes_fts`
);
const rows = all.filter(r => r.project && r.project.includes(projectName));
```

PROJECT만 설정한 노트가 Hub에 안 보이는 이유: 노트가 **FTS 인덱스에 아직 반영되지 않았을 때**
(indexing 타이밍 이슈) 또는 frontmatter의 project 필드 형식이 다를 때 (string vs array).

**Fix Plan**
1. Hub 필터링을 **Topic에서 Tags 기반**으로 변경. TopicHubView를 TagHubView로 리팩토링.
2. `findNotesForProject()`를 SQL WHERE 절로 변경하여 성능 개선: `WHERE project LIKE '%projectName%'`.
3. 노트 저장 시 **즉시 FTS 인덱스 업데이트** 호출. 현재는 배치 인덱싱일 수 있음.
4. `normalizeProject()`로 project 필드를 항상 배열로 정규화하고, 인덱싱 시 쉼표 구분 문자열로 저장.

---

### #11 사이드바 프로젝트 버튼에 Notes도 표시 `IMPROVE` `Effort: S`

**Root Cause**

`SidebarProjectTree.tsx` line 18에서 프로젝트 클릭 시 **항상 `setView('tasks')`**를 호출합니다.
NoteListView의 `filterProject`는 별도의 상태로, TaskStore의 filterProject와 연동되지 않습니다.

```typescript
// SidebarProjectTree.tsx:16-18 - tasks로만 이동
setFilterProject(projectId);
setActiveProject(projectId);
setView('tasks');  // <-- 항상 tasks
```

**Fix Plan**
1. 프로젝트 클릭 시 **Tasks + Notes를 동시에 보여주는 프로젝트 개요 뷰** 생성. 상단에 최근 Notes, 하단에 Active Tasks 표시.
2. 또는 간단하게: 프로젝트 클릭 시 **Hub의 ProjectHubView로 이동** (`setView('hub')` + 해당 프로젝트 선택). Hub에 이미 Notes와 Tasks가 함께 표시되는 구조가 있으므로 재활용.
3. NoteListView에도 `filterProject`를 AppStore의 `activeProject`와 연동.

---

### #12 노트 줄 간격 불일치 `IMPROVE` `Effort: S`

**Root Cause**

`editor.css`에서 블록 타입별 `margin`과 `line-height`가 다릅니다:

| Element | margin | line-height |
|---------|--------|-------------|
| `p` | 0.25rem 0 | 1.65 (inherited) |
| `li` | 0.15rem 0 | 1.65 (inherited) |
| `li p` | 0 | 1.65 (inherited) |
| `pre` | 0.75rem 0 | 1.6 |
| `task-item` | special calc | calc(0.9375rem * 1.65) |
| Sidebar editor | smaller | 1.5 |

`p`의 margin(0.25rem)과 `li`의 margin(0.15rem) 차이가 줄 간격 불일치의 주 원인.
또한 `pre`의 line-height(1.6)이 base(1.65)와 다릅니다.

**Fix Plan**
1. `p`와 `li`의 margin을 동일한 값으로 통일 (0.2rem 0 권장).
2. `pre` line-height를 base와 동일하게 1.65로 수정.
3. task-item의 line-height 계산식 제거하고, base line-height 상속으로 변경.
4. Sidebar editor의 line-height도 base와 동일한 비율 유지 (1.65).

---

### #13 Tasks Active 필터 (Todo + In-progress, Done 제외) `IMPROVE` `Effort: S`

**현재 상태**

`TaskListView.tsx` line 40-46에 4개 필터가 정의되어 있습니다:
`All`, `Todo`, `In Progress`, `Done`.
필터 로직 (line 223-226): `filterStatus`가 null이면 전체 표시, 아니면 해당 status만 표시.

**"Active" 필터가 없어서** Todo와 In-progress를 동시에 보려면 All을 선택해야 하고,
All에는 완료된 task도 포함됩니다.

**Fix Plan**

```typescript
// statusFilters에 Active 추가
const statusFilters = [
  { label: 'All', value: null },
  { label: 'Active', value: 'active' },  // NEW
  { label: 'Todo', value: 'todo' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Done', value: 'done' },
];

// 필터 로직 수정
.filter((t) => {
  if (!filterStatus) return true;
  if (filterStatus === 'active') return t.status !== 'done';
  return t.status === filterStatus;
})
```

---

## D. Feature Requests

### #14 드래그/드롭 이미지 첨부 `FEATURE` `Effort: S`

**현재 상태**

`NoteEditor.tsx` line 462-474에 이미 **drop 이벤트 핸들러가 존재**합니다.
파일을 드롭하면 base64로 변환하여 삽입하는 로직이 있습니다.
**동작하지 않는다면** Tauri의 WebView drop 이벤트 전파 문제일 가능성이 높습니다.

**Fix Plan**
1. Tauri의 `tauri://file-drop` 이벤트를 활용하여 네이티브 파일 드롭을 처리.
2. WebView의 기본 drop 이벤트가 Tauri에 의해 차단되는지 확인. 필요 시 `tauri.conf.json`의 `fileDropEnabled` 설정 조정.
3. 드롭된 파일을 `attachments/`에 복사 후 `convertFileSrc()`로 URL 생성하여 삽입.

---

### #15 블록 단위 드래그/드롭 및 들여쓰기 `FEATURE` `Effort: L`

**구현 방안**

TipTap Pro의 `DragHandle` 확장은 유료($149/year)입니다.
대안으로 **커스텀 ProseMirror Plugin**으로 구현합니다.

1. **DragHandle Decoration Plugin** 생성: ProseMirror의 `DecorationSet`를 사용하여 각 top-level 노드 왼쪽에 드래그 핸들 위젯(⁞⁞ 6-dot grip) 추가.
2. **드래그 시작**: 핸들 mousedown 시 해당 블록의 NodeRange를 selection으로 설정하고 ProseMirror의 기본 드래그 동작 활성화.
3. **드롭 위치 표시**: dragover 시 대상 위치에 파란색 라인 인디케이터 표시. `view.posAtCoords()`로 드롭 위치 계산.
4. **블록 이동**: drop 시 `tr.delete(from, to).insert(dropPos, slice)`로 ProseMirror transaction 실행.
5. **들여쓰기**: Tab/Shift+Tab 키 바인딩 강화. 리스트 외에도 paragraph, heading에 indent level 속성 추가 가능.

**CSS 스케치**

```css
/* 드래그 핸들 스타일 */
.drag-handle {
  position: absolute;
  left: -24px; top: 2px;
  width: 18px; height: 18px;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s;
  color: var(--color-text-dim);
}
.ProseMirror > *:hover > .drag-handle,
.drag-handle:hover { opacity: 0.6; }
.drag-handle:active { cursor: grabbing; opacity: 1; }

/* 드롭 인디케이터 */
.drop-indicator {
  height: 2px;
  background: var(--color-accent);
  border-radius: 1px;
  pointer-events: none;
}
```

---

### #16 PDF 텍스트 선택 가능하게 내보내기 `FEATURE` `Effort: M`

**현재 상태**

현재 PDF 내보내기 기능이 **구현되어 있지 않습니다**.
"PDF 저장하면 이미지로 저장되나?"라는 피드백은 브라우저의 `Ctrl+P`(인쇄) 기능을 사용한 것으로 추정됩니다.
Tauri WebView의 인쇄 기능은 제한적이어서 이미지 기반 렌더링이 될 수 있습니다.

**구현 방안**
1. **방법 A: print CSS + window.print()** — `@media print` 스타일시트를 추가하고 Tauri의 WebView print 기능 활용. 텍스트 선택 가능한 PDF 생성. 가장 간단하지만 레이아웃 제어가 제한적.
2. **방법 B: html2pdf.js** — HTML을 Canvas로 렌더링 후 PDF 변환. 단, 이 방식은 **이미지 기반**이므로 텍스트 선택 불가. 비추천.
3. **방법 C: Rust 백엔드 PDF 생성** — `printpdf` 또는 `typst` 크레이트로 마크다운을 직접 PDF로 변환. 텍스트 선택 가능, 고품질. 구현 비용이 가장 높음.
4. **추천: 방법 A**를 먼저 구현하고, 레이아웃 문제가 심하면 방법 C로 전환.

---

### #17 프로젝트별 대시보드 노트 `FEATURE` `Effort: XL`

**현재 상태**

Hub 시스템에 `ProjectHubView`가 있지만, 이것은 자동 수집된 타임라인/할 일 목록이지
**사용자가 직접 편집하는 대시보드**가 아닙니다.

요청: 프로젝트별로 하드웨어 사양, 초기궤도, 모드별 자세 등 **공통 정보를 정리하는 편집 가능한 공간** +
하위에 관련 노트들이 연결되는 구조.

**구현 방안**
1. **프로젝트 대시보드 노트 타입** 추가: `type: 'project-dashboard'`. 프로젝트당 1개, frontmatter에 `project: 'PROJECT-NAME'`.
2. **대시보드 템플릿**: 하드웨어 개요, 궤도 파라미터, 운용 모드, 하위 시스템, 관련 문서 링크 등의 섹션이 미리 정의된 템플릿.
3. **관련 노트 자동 수집**: 대시보드 하단에 같은 project를 가진 노트들을 타임라인/카테고리별로 자동 표시 (기존 HubView 로직 재활용).
4. **Hub 통합**: ProjectHubView에서 대시보드 노트가 있으면 상단에 고정 표시, 없으면 "대시보드 만들기" 버튼 제공.

---

## E. Priority & Effort Matrix

> Effort 기준: **S** = 1-2h, **M** = 3-6h, **L** = 1-2d, **XL** = 3d+

| # | Title | Type | Effort | Priority |
|---|-------|------|--------|----------|
| #07 | Tasks 마크다운 원문 노출 | BUG | S | **P0 — 즉시** |
| #02 | 프로젝트 코드 표시 | BUG | S | **P0 — 즉시** |
| #06 | 표 첫 행 색상 | BUG | S | **P0 — 즉시** |
| #12 | 줄 간격 불일치 | IMPROVE | S | **P0 — 즉시** |
| #13 | Tasks Active 필터 | IMPROVE | S | **P0 — 즉시** |
| | | | | |
| #01 | Timer 패널 닫으면 중단 | BUG | M | P1 — 이번 주 |
| #05 | 이미지 렌더링 안 됨 | BUG | M | P1 — 이번 주 |
| #04 | Quick Memo 승격 중복 | BUG | M | P1 — 이번 주 |
| #08 | Daily Log task 중복 생성 | BUG | M | P1 — 이번 주 |
| #03 | 사이드바 노트 수정 불가 | BUG | M | P1 — 이번 주 |
| #09 | 타이머 버튼 추가 | IMPROVE | S | P1 — 이번 주 |
| | | | | |
| #11 | 사이드바 프로젝트에 Notes | IMPROVE | S | P2 — 다음 주 |
| #10 | Hub Tags 필터링 | IMPROVE | M | P2 — 다음 주 |
| #14 | 드래그/드롭 이미지 | FEATURE | S | P2 — 다음 주 |
| | | | | |
| #16 | PDF 텍스트 선택 가능 | FEATURE | M | P3 — 이후 |
| #15 | 블록 드래그/들여쓰기 | FEATURE | L | P3 — 이후 |
| #17 | 프로젝트 대시보드 노트 | FEATURE | XL | P3 — 이후 |

### 추천 작업 순서

1. **Quick wins (P0, 각 1-2시간)**: #07, #02, #06, #12, #13 — CSS 수정과 간단한 로직 변경. 하루 안에 모두 해결 가능.
2. **Core bugs (P1, 각 3-6시간)**: #01, #05, #04, #08, #03, #09 — 타이머 구조 개선, 이미지 디버깅, 승격 로직 재설계. 일주일 내 해결.
3. **UX enhancements (P2)**: #11, #10, #14 — 사이드바/Hub 개선. 다음 주.
4. **Editor overhaul (P3)**: #15, #16, #17 — 블록 에디터 고도화. Notion-like 경험의 핵심이지만 공수가 큼. 점진적 구현.
