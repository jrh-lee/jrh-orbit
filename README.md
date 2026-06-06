# JRH-Orbit

GNC 위성 엔지니어를 위한 크로스 플랫폼 데스크탑 업무 노트 앱.

Tauri 2 (Rust + WebView) 기반. 연구 노트, 일일 업무 일지, Task 관리, Workhour 추적을 하나의 앱에서.

## 주요 기능

- TipTap 마크다운 에디터 (코드 하이라이팅, LaTeX 수식, Mermaid 다이어그램, 테이블)
- Daily Log + 6종 연구 노트 템플릿 (Analysis, Test, Design, Study, Quick Memo)
- Task Kanban (3단계, 우선순위, 서브태스크, 반복 TODO, 이월 추적)
- 뽀모도로 타이머 + Workhour 추적 (프로젝트별 자동 집계)
- 전문 검색 (SQLite FTS5), Wiki-link 자동완성, 백링크
- Statistics Dashboard (KPI, Recharts 차트, Growth Score, 노트 건강 점검)
- AI Review (Claude.ai 클립보드 방식)
- Graph View (Force-directed 노트 연결 그래프)
- 10개 테마 (Light, Dark, Cyberpunk, Forest, Ocean, Paper, Solarized, Terminal, Spreadsheet, BuddyBuddy)
- 클라우드 폴더 동기화 (iCloud / OneDrive / Dropbox)

## 사전 요구사항

| 항목 | macOS | Windows |
|------|-------|---------|
| Node.js | 22+ | 22+ |
| Rust | `rustup` 설치 | `rustup` 설치 |
| 시스템 도구 | Xcode Command Line Tools | Visual Studio Build Tools (C++) |

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Windows

1. [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 설치 ("C++를 사용한 데스크톱 개발" 선택)
2. [Rustup](https://rustup.rs/) 설치
3. [Node.js 22+](https://nodejs.org/) 설치

## 설치 & 실행

```bash
git clone git@github.com:jrh-lee/jrh-orbit.git
cd jrh-orbit
npm install
```

### 개발 모드 (핫 리로드)

```bash
npm run tauri dev
```

### 프로덕션 빌드

```bash
npm run tauri build
```

빌드 결과물 위치:

| OS | 경로 |
|----|------|
| macOS (.dmg) | `src-tauri/target/release/bundle/dmg/` |
| macOS (.app) | `src-tauri/target/release/bundle/macos/` |
| Windows (.exe) | `src-tauri/target/release/bundle/nsis/` |

macOS: `.dmg`를 열어 Applications로 드래그.
Windows: `.exe` 설치 파일 실행.

## 첫 실행 — 데이터 폴더 설정

앱을 처음 실행하면 Setup Wizard가 나타납니다.

1. **클라우드 폴더 선택** — iCloud Drive, OneDrive, Dropbox 등 동기화되는 폴더를 선택
2. 앱이 자동으로 폴더 구조를 생성합니다:

```
선택한 폴더/
  notes/daily/        <- 일일 업무 일지
  notes/research/     <- 연구 노트
  data/               <- todos.json, projects.json, workhours/ 등
  config.json         <- 앱 설정
```

> Mac과 Windows 양쪽에서 같은 클라우드 폴더를 선택하면 데이터가 자동 동기화됩니다.

## 앱 모드

| 모드 | 크기 | 용도 |
|------|------|------|
| **Dock** | 72x520 | 항상 위, 빠른 타이머/TODO 확인 |
| **Sidebar** | 320x600 | 중간 크기, TODO/타이머/노트 |
| **Expanded** | 1400x860 | 전체 기능 (에디터, 검색, 통계) |

TitleBar의 모드 전환 버튼 또는 `Cmd+1~3`으로 전환.

## 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `Cmd+1` ~ `Cmd+3` | Dock / Sidebar / Expanded 모드 |
| `Cmd+4` | Tasks |
| `Cmd+5` | Statistics |
| `Cmd+6` | Graph View |
| `Cmd+7` | Settings |
| `Cmd+K` | 검색 |
| `Cmd+N` | 새 노트 |
| `Cmd+D` | Daily Log |
| `Cmd+T` | Tasks |
| `Cmd+Shift+N` | Quick Capture |
| `Cmd+=` / `Cmd+-` | 줌 인/아웃 |
| `Cmd+0` | 줌 리셋 |

> Windows에서는 `Cmd` 대신 `Ctrl` 사용.

## 개발 & 배포 워크플로우

### 코드 수정 후 테스트

```bash
npm run tauri dev        # 개발 모드로 확인
npx tsc --noEmit         # 타입 체크
```

### 수정사항 커밋 & 푸시

```bash
git add -A
git commit -m "fix: 수정 내용"
git push
```

### 새 버전 릴리즈

```bash
# 1. tauri.conf.json의 version 업데이트
# 2. 태그 생성 & 푸시
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions가 자동으로:
- macOS (arm64 + x64) 빌드
- Windows (x64) 빌드
- GitHub Releases에 draft로 업로드

Releases 페이지에서 draft를 publish하면 다운로드 가능.

### Windows에서 새 버전 적용

GitHub Releases에서 `.exe` 다운로드 → 기존 앱 위에 설치 (덮어쓰기).

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Desktop Shell | Tauri 2 (Rust + WebView) |
| Frontend | React 19 + TypeScript + Vite 8 |
| Editor | TipTap (ProseMirror) |
| 검색 DB | SQLite FTS5 |
| 상태 관리 | Zustand 5 |
| 스타일 | Tailwind CSS v4 |
| 차트 | Recharts |

## 프로젝트 구조

```
jrh-orbit/
  src/                    <- React 프론트엔드
    components/           <- UI 컴포넌트
    stores/               <- Zustand 스토어
    lib/                  <- 유틸리티 (statistics, workhour, db 등)
    types/                <- TypeScript 타입 정의
    styles/               <- CSS (테마, 에디터)
  src-tauri/              <- Rust 백엔드
    src/commands/          <- Tauri IPC 커맨드
    capabilities/          <- 권한 설정
    icons/                 <- 앱 아이콘
  docs/                   <- 프로젝트 문서
  .github/workflows/      <- CI/CD
```

## 라이선스

Private — 개인 사용 목적.
