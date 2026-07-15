---
name: jrh-orbit-dev
description: jrh-orbit 개발 가이드 — Tauri 2 + React 19 + TipTap 데스크톱 앱의 구조, 빌드 명령어, Daily 노트/Task 규칙, 에디터 커서 보존 원칙, 동기화 아키텍처. 이 프로젝트의 코드를 수정하기 전에 반드시 참조.
---

# jrh-orbit 개발 가이드

Tauri 2 (Rust) + React 19 + TypeScript + TipTap 기반 개인 지식 관리 데스크톱 앱.
노트(마크다운), 태스크(Kanban), Daily 로그, 프로젝트 허브, 워크아워 타이머를 제공한다.

## 빌드/실행

```bash
npm run dev          # Vite 개발 서버 (프론트만, Tauri API는 모킹 안 됨)
npm run tauri dev    # 전체 앱 개발 모드 (권장)
npm run build        # tsc + vite build — 타입체크 포함, 커밋 전 필수
npm run tauri build  # 릴리즈 빌드
```

수정 후 최소 `npx tsc --noEmit`으로 타입 검증할 것.

## 디렉터리 구조

- `src/components/editor/` — TipTap 에디터 (`NoteEditor.tsx`, `extensions.ts`, `extensions/` 커스텀 확장)
- `src/components/notes/DailyLog.tsx` — Daily 노트 뷰 (생성/편집/Task 동기화 오케스트레이션)
- `src/components/tasks/TaskListView.tsx` — Tasks 탭
- `src/lib/dailyLogHelper.ts` — Daily↔Task 동기화 핵심 로직
- `src/lib/taskSync.ts` — Task 라인 파싱/직렬화 중앙 모듈 (신규 코드는 반드시 여기 사용)
- `src/stores/` — Zustand 스토어
- `src-tauri/src/commands/notes.rs` — 파일 I/O Rust 커맨드 (read_note, write_note, write_binary 등)
- 데이터 저장: 사용자 지정 `dataDir` 하위 — `notes/daily/*.md`, `notes/research/*.md`, `data/todos.json`, `data/projects.json`, `attachments/`

## Daily 노트 마크다운 구조

```markdown
## 작업
### 🛰️ ProjectName        ← 프로젝트 섹션 (이모지는 프로젝트별 커스텀 가능)
- [ ] [TASK-001] 메인 태스크 (D-3)
  - [ ] [TASK-001.1] 서브 태스크
- [x] [TASK-002] (이월) 이월된 태스크
### 📌 GENERAL
---
## 메모
---
## 노트                    ← 자동 집계 테이블
---
## 내일                    ← 여기의 - [ ]는 다음날 TODO로 자동 등록
```

## Task ID 규칙

- Main task: `TASK-NNN` (예: TASK-011) — Daily에서 자동 등록 시 순번 부여
- Subtask: `TASK-NNN.M` (예: TASK-011.1) — 부모ID.순번, 부모 Task의 `subtasks[]`에 저장
- Tasks 탭에서 직접 생성 시 랜덤 8자 ID (예: bqrphmq6)도 존재
- tiptap-markdown 직렬화가 대괄호를 이스케이프하므로 파싱 정규식은 `\\?\[` 패턴으로 양쪽 다 처리해야 함
- 에디터에서 `[TASK-xxx]`와 `(이월)`은 `HideTaskMeta` 확장(extensions.ts)이 시각적으로 숨김

## 동기화 아키텍처 (중요)

**단일 소스 오브 트루스: `data/todos.json`.** Daily 노트의 체크박스는 뷰(view)일 뿐이다.

- Daily 편집 → `handleChange`(DailyLog.tsx)가 diff 감지 → todos.json 갱신
- Tasks 탭 변경 → todos.json 갱신 → `syncDailyWithTodos()`로 Daily 파일 패치 → `daily-log-updated` 이벤트
- 파일 워처가 `tasks-changed`/`notes-changed` 이벤트 발행
- **새 동기화 코드는 반드시 `src/lib/taskSync.ts`의 `parseTaskLine()` 등 중앙 함수를 사용**할 것. dailyLogHelper.ts에 정규식을 새로 추가하지 말 것.

## 에디터 커서 보존 원칙 (중요)

`NoteEditor`의 content prop을 바꾸면 `editor.commands.setContent()`가 호출되어 **문서 전체가 교체되고 커서가 리셋**된다.

- 사용자가 편집 중일 수 있는 문서를 프로그램이 수정할 때는 **content prop 교체 금지**
- 대신 에디터 ref로 ProseMirror transaction을 만들어 해당 텍스트 노드만 교체할 것 (DailyLog.tsx의 Task ID 주입 참조)
- 불가피하게 setContent를 쓰면 반드시 커서 위치를 저장/복원 (`Math.min(savedPos, doc.content.size)` 클램핑)
- `isLoadingContent` ref 가드로 onUpdate 재진입 방지 패턴 유지

## TipTap 확장 개발 패턴

- 커스텀 확장은 `src/components/editor/extensions/`에 파일 분리, `extensions.ts`의 `getExtensions()`에 등록
- 자동 텍스트 치환: `SmartTransform.ts`의 `textInputRule` 패턴 참조 (코드 블록 내 치환 금지)
- 데코레이션(숨김/뱃지): `HideTaskMeta` 참조 — ProseMirror Plugin + Decoration
- Tab/Shift-Tab 들여쓰기: `DragHandle.ts` — `sinkListItem`/`liftListItem`, depth 체크 필수

## CSS 규칙

- 에디터 스타일: `src/styles/editor.css`, 테마: `src/styles/globals.css`
- line-height는 `--editor-line-height` CSS 변수로 관리 (하드코딩 금지) — 체크박스 라벨 높이 등이 이 변수를 참조
- 블록 요소(p, li, taskList)의 vertical margin은 통일된 값 유지 — 노드 타입별로 다르면 줄 간격이 불규칙해 보임
- 체크 완료 스타일은 `> div > p`로 스코프 제한 — 하위 중첩 task에 취소선이 번지면 안 됨

## Google Drive 데이터 안전 규칙 (2026-07-06 데이터 손실 사고에서 확립 — 절대 위반 금지)

사용자 dataDir은 Google Drive 스트리밍 가상 드라이브(`G:\내 드라이브\jrh-orbit`)에 있다:

1. **읽기 실패 ≠ 파일 부재.** 부팅 직후 파일이 미수화(unhydrated) 상태면 read가 실패한다. 읽기 실패를 근거로 파일을 생성/덮어쓰는 코드 금지. `path_exists` 커맨드로 확인해도 프로세스 캐시 때문에 못 믿는다.
   - 2026-07-15 사고: todos.json 읽기 실패 상태에서 Daily 로드 스윕이 모든 태스크를 재등록 → 병렬 등록 레이스로 전원 TASK-001 배정 + todos.json이 1개로 덮어써짐. **json 파일이 안 읽히면 그 파일에 쓰는 스윕/등록류는 전부 건너뛸 것.** 그리고 `registerNewTodo`류 순번 ID 발급은 반드시 순차(await)로 — 병렬이면 같은 ID가 중복 발급된다.
2. **과거 날짜 Daily는 로드 시 완전 무쓰기.** 동기화/정리/고아등록/자동생성 전부 오늘 날짜(`dateKey === today`)에서만. 과거 날짜 파일이 안 읽히면 "생성 버튼" UI를 보여준다 (DailyLog.tsx).
3. **앱 실행 중 외부 프로세스로 데이터 파일을 수정하지 말 것.** 앱이 옛 캐시를 읽고 되써서 외부 변경을 파괴한다. 복구/마이그레이션 작업은 반드시 앱 종료 후 수행.
4. **orbit.db FTS 인덱스(notes_fts.content)가 사실상의 백업.** 파일이 덮어써져도 인덱스에 이전 본문이 남아 있을 수 있다 (단, 워처가 재인덱싱하기 전까지만 — 발견 즉시 덤프할 것).
5. **일일 스냅샷 백업**: 앱 시작 20초 후 `snapshot_data` 커맨드가 `<dataDir>/backups/<stamp>/`에 notes+data를 복사 (하루 1회, 30개 보관, `src/lib/backup.ts`). 복구 = 앱 종료 후 스냅샷의 notes/·data/를 원위치로 복사.

## 이미지/파일 첨부 (크로스플랫폼 상대 경로 — 2026-07-15 전환)

- **마크다운 파일에는 `attachments/<노트stem 또는 날짜>/파일명` 상대 경로만 저장**한다.
  절대 asset/file URL을 파일에 쓰면 다른 OS/기기에서 깨진다 (Windows↔Mac 사고 사례).
- 변환은 `src/lib/attachmentUrls.ts`가 담당: 로드 시 `attachmentsToDisplay()`(상대→asset/file URL),
  저장 시 `attachmentsToStorage()`(URL→상대). NoteEditor의 setContent/onChange 경계에서만 호출.
- 레거시 절대 URL(`http://asset.localhost/G%3A...`)은 표시 시 현재 dataDir로 재해석되고,
  사용자가 그 노트를 편집하면 저장 시 상대 경로로 자연 이행된다 — 일괄 마이그레이션 금지 (Drive 안전 규칙).
- 새 첨부는 노트별 폴더에 저장: NoteEditor/EditorToolbar의 `attachmentSubdir` prop
  (연구노트 = activeNoteId, Daily = dateKey).
- `tauri.conf.json`의 `assetProtocol.scope`가 dataDir을 커버해야 이미지가 로드됨
- IPC로 바이너리 전송 시 JSON 숫자 배열 금지 — base64 문자열로 전송

## 음악 플레이어 (YouTube 브리지)

- macOS 프로덕션 빌드의 origin은 `tauri://localhost`라 YouTube IFrame API가 동작하지 않는다
  (Windows는 `http://tauri.localhost`라 동작). 그래서 `docs/player/index.html`(GitHub Pages 호스팅)을
  숨김 iframe으로 띄우고 postMessage로 제어한다 — `MusicPlayer.tsx`의 `MusicEngine` 참조.
- 브리지 페이지 수정 시 `docs/player/index.html`을 고치고 push하면 Pages가 자동 배포.
- 디버깅: localStorage `orbit-player-url`로 브리지 URL 오버라이드 가능.

## UI 디자인

UI 작업 시 `.claude/skills/frontend-design/SKILL.md`(디자인 원칙)과 `.claude/skills/minimalist-design/SKILL.md`(Notion/Linear 스타일 미니멀리즘)를 참조. 단, minimalist-design의 "이모지 금지" 규칙은 이 앱의 기존 UX(프로젝트 이모지, 노트 타입 아이콘)와 충돌하므로 무시한다.
