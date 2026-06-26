import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/useAppStore';
import { useTimerStore } from '../../stores/useTimerStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { writeJsonFile, readConfig } from '../../lib/fileSystem';
import { POMODORO_DEFAULTS } from '../../lib/constants';
import { migrateNotes } from '../../lib/migration';
import { resetOnboarding } from '../layout/OnboardingTour';
import { ImportExportSection } from './ImportExportSection';
import { ReviewSchedulerStatus } from '../productivity/ReviewSchedulerStatus';
import type { Theme } from '../../stores/useAppStore';

const THEMES: { id: Theme; label: string; bg: string; accent1: string; accent2: string; accent3: string }[] = [
  { id: 'light', label: 'Light', bg: '#ffffff', accent1: '#ffc1d6', accent2: '#a9cdf5', accent3: '#c6ecd7' },
  { id: 'dark', label: 'Dark', bg: '#1a2332', accent1: '#c47090', accent2: '#6a9fd8', accent3: '#5aad80' },
  { id: 'paper', label: 'Paper', bg: '#f5f0e4', accent1: '#7a5830', accent2: '#5a7a9a', accent3: '#d0c4a8' },
  { id: 'spreadsheet', label: 'Excel', bg: '#ffffff', accent1: '#185a30', accent2: '#0078d4', accent3: '#e0e0e0' },
  { id: 'solarized', label: 'Solarized', bg: '#fdf6e3', accent1: '#268bd2', accent2: '#859900', accent3: '#d8d0b8' },
  { id: 'cyberpunk', label: 'VA-11', bg: '#14081e', accent1: '#f0d060', accent2: '#e06098', accent3: '#4890e0' },
  { id: 'terminal', label: 'Terminal', bg: '#0a0a0a', accent1: '#33ff33', accent2: '#3388ff', accent3: '#1a2a1a' },
  { id: 'buddybuddy', label: 'BuddyBuddy', bg: '#e4e8d0', accent1: '#5a8838', accent2: '#e87888', accent3: '#b8c098' },
  { id: 'forest', label: 'Forest', bg: '#f5f2eb', accent1: '#8fbc8f', accent2: '#6b8e5a', accent3: '#d4b08c' },
  { id: 'ocean', label: 'Ocean', bg: '#0a1929', accent1: '#4dacf0', accent2: '#4dd0a0', accent3: '#8080d0' },
];

export function SettingsView() {
  const { dataDir, setDataDir, theme, setTheme } = useAppStore();
  const timerStore = useTimerStore();
  const configStore = useConfigStore();

  const [workMin, setWorkMin] = useState<number>(POMODORO_DEFAULTS.work / 60);
  const [breakMin, setBreakMin] = useState<number>(POMODORO_DEFAULTS.break / 60);
  const [longBreakMin, setLongBreakMin] = useState<number>(POMODORO_DEFAULTS.longBreak / 60);
  const [sessions, setSessions] = useState<number>(POMODORO_DEFAULTS.sessionsBeforeLong);
  const [localTheme, setLocalTheme] = useState<Theme>(theme);
  const [saved, setSaved] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);
  const [archiveDays, setArchiveDays] = useState(configStore.auto_archive.quick_memo_days);

  useEffect(() => {
    async function loadConfig() {
      const config = (await readConfig(dataDir)) as Record<string, unknown> | null;
      if (!config) return;
      const pom = config.pomodoro as { work: number; break: number; longBreak: number; sessionsBeforeLong: number } | undefined;
      if (pom) {
        setWorkMin(pom.work / 60);
        setBreakMin(pom.break / 60);
        setLongBreakMin(pom.longBreak / 60);
        setSessions(pom.sessionsBeforeLong);
      }
      if (config.theme) {
        setLocalTheme(config.theme as Theme);
      }
      configStore.loadFromConfig(config);
      const archCfg = config.auto_archive as { quick_memo_days?: number } | undefined;
      if (archCfg?.quick_memo_days) setArchiveDays(archCfg.quick_memo_days);
    }
    loadConfig();
  }, [dataDir]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleChangeFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setDataDir(selected);
    }
  }

  async function handleSave() {
    const configFields = configStore.toConfigFields();
    configFields.auto_archive.quick_memo_days = archiveDays;
    configStore.setAutoArchive({ quick_memo_days: archiveDays });

    const fullConfig = {
      theme: localTheme,
      pomodoro: {
        work: workMin * 60,
        break: breakMin * 60,
        longBreak: longBreakMin * 60,
        sessionsBeforeLong: sessions,
      },
      ...configFields,
    };

    await writeJsonFile(dataDir, 'config.json', fullConfig);

    setTheme(localTheme);

    if (timerStore.status === 'idle') {
      const phase = timerStore.phase;
      let newDuration = fullConfig.pomodoro.work;
      if (phase === 'break') newDuration = fullConfig.pomodoro.break;
      if (phase === 'longBreak') newDuration = fullConfig.pomodoro.longBreak;
      timerStore.reset(newDuration);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const inputClass =
    'w-24 px-3 py-1.5 rounded-sm border border-border bg-paper text-ink text-sm focus:outline-none focus:border-chrome';
  const labelClass = 'text-sm text-ink-2';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-ink mb-6">Settings</h1>

      <section className="mb-6">
        <h2 className="text-base font-medium text-ink mb-3">General</h2>
        <div className="flex items-center gap-4">
          <span className={labelClass}>Data Folder</span>
          <span className="text-sm text-ink font-mono bg-paper-soft px-3 py-1.5 rounded-sm border border-border flex-1 truncate">
            {dataDir}
          </span>
          <button
            onClick={handleChangeFolder}
            className="px-4 py-1.5 text-sm rounded-sm border border-border hover:bg-paper-soft transition-colors"
          >
            Change Folder
          </button>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-medium text-ink mb-3">Pomodoro</h2>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <label className={labelClass}>Work (min)</label>
          <input
            type="number"
            min={1}
            max={120}
            value={workMin}
            onChange={(e) => setWorkMin(Number(e.target.value))}
            className={inputClass}
          />
          <label className={labelClass}>Break (min)</label>
          <input
            type="number"
            min={1}
            max={60}
            value={breakMin}
            onChange={(e) => setBreakMin(Number(e.target.value))}
            className={inputClass}
          />
          <label className={labelClass}>Long Break (min)</label>
          <input
            type="number"
            min={1}
            max={60}
            value={longBreakMin}
            onChange={(e) => setLongBreakMin(Number(e.target.value))}
            className={inputClass}
          />
          <label className={labelClass}>Sessions before Long Break</label>
          <input
            type="number"
            min={1}
            max={12}
            value={sessions}
            onChange={(e) => setSessions(Number(e.target.value))}
            className={inputClass}
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-medium text-ink mb-3">Window</h2>
        <p className="text-xs text-ink-3 mb-3">모드별 항상 위(Always on Top) 설정</p>
        <div className="space-y-2.5 max-w-md">
          <ToggleRow
            label="Dock — Always on Top"
            description="Dock 모드에서 항상 다른 창 위에 표시"
            checked={configStore.window.always_on_top_dock}
            onChange={(v) => configStore.setWindow({ always_on_top_dock: v })}
          />
          <ToggleRow
            label="Sidebar — Always on Top"
            description="Sidebar 모드에서 항상 다른 창 위에 표시"
            checked={configStore.window.always_on_top_sidebar}
            onChange={(v) => configStore.setWindow({ always_on_top_sidebar: v })}
          />
          <ToggleRow
            label="Expanded — Always on Top"
            description="Expanded 모드에서 항상 다른 창 위에 표시"
            checked={configStore.window.always_on_top_expanded}
            onChange={(v) => configStore.setWindow({ always_on_top_expanded: v })}
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-medium text-ink mb-3">Automation</h2>
        <p className="text-xs text-ink-3 mb-3">각 자동화 기능의 on/off를 설정합니다.</p>
        <div className="space-y-2.5 max-w-md">
          <ToggleRow
            label="Smart Transform"
            description="그리스 문자(alpha->α), 날짜(6/10->2026-06-10) 자동 변환"
            checked={configStore.editor.smart_transform}
            onChange={(v) => configStore.setEditor({ smart_transform: v })}
          />
          <ToggleRow
            label="Auto Tag Suggest"
            description="본문 키워드 기반 태그 자동 추천"
            checked={configStore.editor.auto_tag_suggest}
            onChange={(v) => configStore.setEditor({ auto_tag_suggest: v })}
          />
          <ToggleRow
            label="Auto Subsystem Suggest"
            description="본문 키워드 기반 서브시스템 자동 추천"
            checked={configStore.editor.auto_subsystem_suggest}
            onChange={(v) => configStore.setEditor({ auto_subsystem_suggest: v })}
          />
          <ToggleRow
            label="Clipboard Capture"
            description="URL/긴 텍스트 붙여넣기 시 노트 자동 생성 제안"
            checked={configStore.editor.clipboard_capture}
            onChange={(v) => configStore.setEditor({ clipboard_capture: v })}
          />
          <ToggleRow
            label="Section Guides"
            description="빈 섹션에 회색 가이드 문구 표시 (템플릿 HTML 주석 기반)"
            checked={configStore.editor.section_guides}
            onChange={(v) => configStore.setEditor({ section_guides: v })}
          />
          <div className="flex items-center gap-3 pt-1">
            <span className="text-sm text-ink-2 w-48">Auto Archive (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={archiveDays}
              onChange={(e) => setArchiveDays(Number(e.target.value))}
              className={inputClass}
            />
            <span className="text-xs text-ink-3">완료된 quick-memo를 N일 후 자동 archived 처리</span>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-medium text-ink mb-3">Appearance</h2>
        <div className="flex flex-wrap gap-2.5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setLocalTheme(t.id)}
              className={`w-28 rounded-lg border-2 overflow-hidden transition-all ${
                localTheme === t.id ? 'border-chrome shadow-md scale-105' : 'border-border hover:border-chrome/50'
              }`}
            >
              <div className="h-10 flex gap-0.5 p-1" style={{ background: t.bg }}>
                <div className="flex-1 rounded" style={{ background: t.accent1 }} />
                <div className="flex-1 rounded" style={{ background: t.accent2 }} />
                <div className="flex-1 rounded" style={{ background: t.accent3 }} />
              </div>
              <div className="px-2 py-1.5 text-[10px] font-medium text-center text-ink bg-paper">
                {t.label}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <button
          onClick={handleSave}
          className="px-5 py-1.5 text-sm font-medium rounded-sm bg-chrome text-paper hover:opacity-90 transition-opacity"
        >
          {saved ? 'Saved' : 'Save Settings'}
        </button>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-medium text-ink mb-3">Keyboard Shortcuts</h2>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 max-w-md text-sm">
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+1</kbd>
          <span className="text-ink-2">Daily</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+2</kbd>
          <span className="text-ink-2">Notes</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+3</kbd>
          <span className="text-ink-2">Tasks</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+4</kbd>
          <span className="text-ink-2">Search</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+5</kbd>
          <span className="text-ink-2">Statistics</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+6</kbd>
          <span className="text-ink-2">Settings</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+K</kbd>
          <span className="text-ink-2">Quick Search</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+N</kbd>
          <span className="text-ink-2">Notes View</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+D</kbd>
          <span className="text-ink-2">Daily View</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+T</kbd>
          <span className="text-ink-2">Tasks View</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+,</kbd>
          <span className="text-ink-2">Settings</span>
          <kbd className="text-[11px] font-mono bg-paper-soft px-1.5 py-0.5 rounded border border-border text-ink text-center">Cmd/Ctrl+Shift+N</kbd>
          <span className="text-ink-2">Quick Capture</span>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-medium text-ink mb-3">Data Migration</h2>
        <p className="text-sm text-ink-2 mb-3">
          Migrate existing notes to the v2 schema (type, id, subsystem, related fields).
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setMigrating(true);
              setMigrationResult(null);
              try {
                const r = await migrateNotes(dataDir);
                const msg = `Migrated ${r.migrated}/${r.total} notes (${r.skipped} already up-to-date)${r.errors.length ? `, ${r.errors.length} errors` : ''}`;
                setMigrationResult(msg);
              } catch (e) {
                setMigrationResult(`Migration failed: ${String(e)}`);
              } finally {
                setMigrating(false);
              }
            }}
            disabled={migrating}
            className="px-4 py-1.5 text-sm rounded-sm border border-border hover:bg-paper-soft transition-colors disabled:opacity-40"
          >
            {migrating ? 'Migrating...' : 'Run Migration'}
          </button>
          {migrationResult && (
            <span className="text-sm text-ink-2">{migrationResult}</span>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium text-ink mb-2">Import / Export</h2>
        <ImportExportSection />
      </section>

      <section>
        <h2 className="text-base font-medium text-ink mb-2">AI Review Scheduler</h2>
        <ReviewSchedulerStatus />
      </section>

      <section>
        <h2 className="text-base font-medium text-ink mb-2">User Guide</h2>
        <div className="space-y-3">
          <button
            onClick={() => { resetOnboarding(); window.location.reload(); }}
            className="px-4 py-1.5 text-sm rounded-sm border border-border hover:bg-paper-soft transition-colors"
          >
            Restart Onboarding Tour
          </button>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Layout Modes</summary>
            <div className="text-xs text-ink-3 space-y-1.5 mt-2 pl-3 border-l-2 border-border">
              <p><strong className="text-ink-2">Dock Mode</strong> — 화면 모서리에 띄우는 미니 위젯. Workhour 타이머, 날짜, 음악 트랙명 표시. Dock 모드에서도 ⌘⇧N으로 Quick Capture 사용 가능.</p>
              <p><strong className="text-ink-2">Sidebar Mode</strong> — 사이드바 형태. Quick Memo 입력, 태스크 관리(상태 순환 ○→◐→●, 하위 태스크 표시), 캘린더(날짜별 태스크 dot), 음악 플레이어를 한 패널에서 사용.</p>
              <p><strong className="text-ink-2">Expanded Mode</strong> — 전체 작업 화면. 좌측 사이드바(140~300px 리사이즈) + 우측 메인 뷰. 대부분의 작업은 이 모드에서 합니다.</p>
            </div>
          </details>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Core Features</summary>
            <div className="text-xs text-ink-3 space-y-1.5 mt-2 pl-3 border-l-2 border-border">
              <p><strong className="text-ink-2">Daily Log (⌘1)</strong> — 매일의 작업, 메모, 노트, 내일 할 일을 기록합니다. 체크박스를 추가하면 자동으로 TODO 등록되며, Tasks 탭과 양방향으로 동기화됩니다. 미완료 TODO는 다음 날로 자동 이월됩니다. 외부에서 파일 수정 시 충돌 감지 배너가 뜹니다.</p>
              <p><strong className="text-ink-2">Notes (⌘2)</strong> — Quick Memo(💬), Analysis Note(📊), Test Log(🔧), Design Note(📐), Study Note(📚), Blank(📝) + 커스텀 템플릿. 타입/상태/프로젝트/태그별 필터링 가능. Quick Memo는 다른 타입으로 승격(Promote) 가능.</p>
              <p><strong className="text-ink-2">Tasks (⌘3)</strong> — TODO 관리: 우선순위(High/Med/Low), 프로젝트 분류, 시작/종료/기한. 상태 순환: ○ Todo → ◐ In Progress → ● Done. Daily Log와 실시간 동기화. 하위 태스크 지원.</p>
              <p><strong className="text-ink-2">Search (⌘4/⌘K)</strong> — 전체 노트 풀텍스트 검색. 하이라이트된 스니펫 + 노트 타입 배지 + 수정일 표시. 결과 클릭 시 해당 노트로 이동.</p>
              <p><strong className="text-ink-2">Statistics (⌘5)</strong> — Dashboard: 노트 생성/수정 통계, 건강 점검(태그 누락, 미연결 노트, 마감 초과 TODO), 성장 점수, 차트. Reviews: AI 리뷰 생성/열람.</p>
              <p><strong className="text-ink-2">Graph (⌘6)</strong> — 노트 간 링크 관계를 force-directed 그래프로 시각화. 프로젝트/노트 타입별 필터. 노드 클릭으로 이동. 타입별 색상 구분.</p>
              <p><strong className="text-ink-2">Backlink Panel</strong> — 노트 편집 화면 우측 토글 패널. 이 노트를 참조하는 노트(Referenced by), 이 노트가 참조하는 노트(References), 관련 태스크(Related Tasks) 표시.</p>
            </div>
          </details>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Editor Features</summary>
            <div className="text-xs text-ink-3 space-y-1.5 mt-2 pl-3 border-l-2 border-border">
              <p><strong className="text-ink-2">Toolbar</strong> — Bold, Italic, Strikethrough, Code, Highlight, H1/H2/H3, Lists(bullet/numbered/task), Blockquote, Code block, 텍스트 색상/배경/정렬, 테이블, 수식(inline $..$ / block $$..$$), 수평선, 이미지, 파일 첨부.</p>
              <p><strong className="text-ink-2">Wiki-Links</strong> — [[ 입력 시 자동완성 팝업. ↑↓ 선택, Enter 삽입. ⌘+클릭으로 해당 노트 열기. Graph 뷰와 백링크 패널에서 확인 가능.</p>
              <p><strong className="text-ink-2">Table</strong> — 테이블 안 커서 시 전용 툴바: +Row, +Col, -Row, -Col, Merge, Split, Auto-fit, 셀 배경색. 열 경계 더블클릭으로 열 너비 자동 맞춤.</p>
              <p><strong className="text-ink-2">Math</strong> — 수식 클릭 시 LaTeX 편집 모달 (KaTeX 실시간 미리보기). 인라인: $E=mc^2$, 블록: $$...$$</p>
              <p><strong className="text-ink-2">Code Block</strong> — 언어 선택 드롭다운(구문 강조), Copy 버튼.</p>
              <p><strong className="text-ink-2">Image</strong> — 드래그 앤 드롭 삽입(attachments 폴더 자동 복사), 리사이즈 핸들, 캡션 입력.</p>
              <p><strong className="text-ink-2">Smart Transform</strong> — alpha→α, beta→β, delta→δ, theta→θ, mu→μ, pi→π, sigma→σ, omega→ω, deg→°, sqrt→√, +/-→±. 날짜: 6/10+스페이스→2026-06-10. (Settings에서 on/off)</p>
            </div>
          </details>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Template Editor & Section Guides</summary>
            <div className="text-xs text-ink-3 space-y-1.5 mt-2 pl-3 border-l-2 border-border">
              <p><strong className="text-ink-2">Template Editor</strong> — Notes 뷰에서 접근. 좌측 템플릿 목록, 우측 편집(Icon, Name, Type, Body). + Add Template으로 커스텀 추가, Save로 저장. Reset to Default / Reset All로 복원 가능.</p>
              <p><strong className="text-ink-2">Section Guide 설정법</strong> — 템플릿 body에서 ## heading 바로 다음 줄에 {'<!-- 가이드 텍스트 -->'} 형식으로 HTML 주석을 추가하면, 해당 heading 아래에 가이드 문구가 표시됩니다.</p>
              <p><strong className="text-ink-2">Guide 표시 방식</strong> — 빈 섹션: 회색 이탤릭 placeholder로 표시, 클릭 시 바로 타이핑 가능. 내용 있는 섹션: heading 아래에 작고 연한 hint로 표시.</p>
              <p><strong className="text-ink-2">Guide 규칙</strong> — heading 텍스트와 정확히 일치해야 매칭. heading당 하나의 가이드만 인식(첫 번째 {'<!-- -->'}).</p>
            </div>
          </details>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Automation & AI</summary>
            <div className="text-xs text-ink-3 space-y-1.5 mt-2 pl-3 border-l-2 border-border">
              <p><strong className="text-ink-2">AI Review (Claude.ai)</strong> — "Copy Prompt" 버튼으로 업무 데이터 분석 프롬프트를 클립보드에 복사 → claude.ai에 붙여넣기 → AI 응답을 Statistics {'>'} Reviews에서 붙여넣기 후 저장. API 키 불필요.</p>
              <p><strong className="text-ink-2">Morning Briefing</strong> — 앱 시작 시 자동 팝업: 이월 업무 수, 마감 초과 TODO, D-Day(7일 이내), 주간 workhour. [오늘의 할 일 보기] / [Weekly Review 보기] 버튼.</p>
              <p><strong className="text-ink-2">Evening Reminder</strong> — 매일 18:00 데스크탑 알림. 금요일에는 주간 회고 리마인더 추가.</p>
              <p><strong className="text-ink-2">TODO 자동 이월</strong> — 전날 미완료 체크박스는 다음 날 daily log에 (이월) 표시 + 🔄 배지로 자동 생성.</p>
              <p><strong className="text-ink-2">Auto Tag/Subsystem Suggest</strong> — 본문 키워드 감지 시 에디터 상단 배너로 태그/서브시스템 추가 제안. [추가] 클릭 시 frontmatter 자동 업데이트.</p>
              <p><strong className="text-ink-2">Clipboard Capture</strong> — 긴 텍스트 복사 시 미니 토스트 → [저장] 클릭으로 Quick Memo 자동 생성.</p>
              <p><strong className="text-ink-2">Auto Archive</strong> — 설정된 일수(기본 14일) 지난 Quick Memo를 자동으로 archived 처리.</p>
              <p><strong className="text-ink-2">Quick Capture (⌘⇧N)</strong> — 어디서든 즉시 메모. Enter 2번으로 저장. Daily Log에 자동 연결.</p>
            </div>
          </details>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Productivity Tools</summary>
            <div className="text-xs text-ink-3 space-y-1.5 mt-2 pl-3 border-l-2 border-border">
              <p><strong className="text-ink-2">Workhour Timer</strong> — 상태바/Dock에 표시. ▶/⏸ 재생/일시정지, ±10m/±30m/+1h 수동 조정. 프로젝트별 workhour 자동 집계. Daily Log frontmatter에 기록.</p>
              <p><strong className="text-ink-2">Pomodoro</strong> — Settings에서 Work/Break/Long Break/Sessions 설정. 상태바에 현재 Phase + 남은 시간 표시.</p>
              <p><strong className="text-ink-2">D-Day Counter</strong> — 이벤트명 + 목표일 입력. D-Day/D-N/D+N 자동 계산. Morning Briefing에 표시.</p>
              <p><strong className="text-ink-2">Music Player</strong> — YouTube URL 입력 → 제목 자동 fetch → 플레이리스트. ◀ ▶ ⏯ 컨트롤.</p>
            </div>
          </details>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Import / Export</summary>
            <div className="text-xs text-ink-3 space-y-1.5 mt-2 pl-3 border-l-2 border-border">
              <p><strong className="text-ink-2">Notion Import</strong> — Notion에서 마크다운으로 내보낸 폴더를 선택하면, 해시 제거 + 프론트매터 자동 생성 + 위키링크 변환을 수행합니다.</p>
              <p><strong className="text-ink-2">HTML Export</strong> — 모든 노트를 하나의 스타일된 HTML 파일로 내보냅니다. 브라우저에서 열거나 PDF로 인쇄 가능.</p>
              <p><strong className="text-ink-2">Markdown Export</strong> — 폴더 구조를 유지한 채 모든 노트를 마크다운으로 내보냅니다.</p>
              <p><strong className="text-ink-2">Single Note Export</strong> — Notes 탭에서 개별 노트의 ⋯ 메뉴 → Export/Print로 단일 노트 내보내기 가능.</p>
            </div>
          </details>

          <details className="group">
            <summary className="text-sm font-medium text-ink-2 cursor-pointer hover:text-ink">Keyboard Shortcuts</summary>
            <div className="text-xs text-ink-3 space-y-1 mt-2 pl-3 border-l-2 border-border">
              <p className="text-ink-2 font-medium mb-0.5">View Switching</p>
              <p><kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘1</kbd> Daily  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘2</kbd> Notes  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘3</kbd> Tasks  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘4</kbd> Search</p>
              <p><kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘5</kbd> Stats  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘6</kbd> Graph  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘7</kbd> Settings</p>
              <p className="text-ink-2 font-medium mt-1.5 mb-0.5">Quick Actions</p>
              <p><kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘K</kbd> Search  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘⇧N</kbd> Quick Capture  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘,</kbd> Settings</p>
              <p className="text-ink-2 font-medium mt-1.5 mb-0.5">Editor Formatting</p>
              <p><kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘B</kbd> Bold  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘I</kbd> Italic  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘E</kbd> Code  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘⇧X</kbd> Strikethrough</p>
              <p><kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘⌥1/2/3</kbd> H1/H2/H3  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘⇧7</kbd> Numbered  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘⇧8</kbd> Bullet  <kbd className="px-1 py-0.5 rounded bg-paper-muted text-ink-2 text-[10px]">⌘⇧9</kbd> Task</p>
            </div>
          </details>
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium text-ink mb-2">About</h2>
        <p className="text-sm text-ink-2">JRH-Orbit v0.2.0</p>
      </section>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-9 h-5 rounded-full bg-border peer-checked:bg-chrome transition-colors" />
        <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-paper shadow-sm transition-transform peer-checked:translate-x-4" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-ink">{label}</span>
        <p className="text-xs text-ink-3 truncate">{description}</p>
      </div>
    </label>
  );
}
