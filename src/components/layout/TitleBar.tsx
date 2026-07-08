import { useRef, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '../../stores/useAppStore';
import { useWorkhourTimerStore } from '../../stores/useWorkhourTimerStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { writeJsonFile, readConfig } from '../../lib/fileSystem';
import { invoke } from '@tauri-apps/api/core';
import clsx from 'clsx';

function fmtWH(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

const SLIDER_MIN = 30;
const SLIDER_MAX = 100;
const SLIDER_STEP = 5;

function snap(v: number) {
  return Math.round(Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v)) / SLIDER_STEP) * SLIDER_STEP;
}

function OpacitySlider({ compact }: { compact?: boolean }) {
  const { mode, dataDir } = useAppStore();
  const { window: winCfg, setWindow } = useConfigStore();
  const key = `opacity_${mode}` as const;
  const value = winCfg[key];
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const persist = useCallback(async (val: number) => {
    if (!dataDir) return;
    const config = (await readConfig(dataDir)) as Record<string, unknown> | null;
    const existing = (config ?? {}) as Record<string, unknown>;
    const winSection = (existing.window ?? {}) as Record<string, unknown>;
    await writeJsonFile(dataDir, 'config.json', {
      ...existing,
      window: { ...winSection, [key]: val },
    });
  }, [dataDir, key]);

  const handleChange = useCallback((val: number) => {
    const snapped = snap(val);
    setWindow({ [key]: snapped });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(snapped), 500);
  }, [key, setWindow, persist]);

  const calcValue = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return SLIDER_MIN + ratio * (SLIDER_MAX - SLIDER_MIN);
  }, [value]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleChange(calcValue(e.clientX));
  }, [calcValue, handleChange]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    handleChange(calcValue(e.clientX));
  }, [calcValue, handleChange]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const pct = ((value - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
  const w = compact ? 48 : 64;
  const thumbSize = compact ? 8 : 10;

  return (
    <div className={clsx('flex items-center gap-1.5', compact && 'gap-1')}>
      <svg width={compact ? 10 : 12} height={compact ? 10 : 12} viewBox="0 0 16 16" fill="none" className="text-ink-3 shrink-0">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" />
        <circle cx="8" cy="8" r="2.5" fill="currentColor" />
      </svg>
      <div
        ref={trackRef}
        className="relative cursor-pointer select-none"
        style={{ width: w, height: thumbSize + 4 }}
        title={`Opacity ${value}%`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-border"
          style={{ width: '100%', height: 3 }}
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-chrome/60"
          style={{ width: `${pct}%`, height: 3 }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full bg-chrome hover:brightness-110 transition-colors"
          style={{
            width: thumbSize,
            height: thumbSize,
            left: `calc(${pct}% - ${thumbSize / 2}px)`,
          }}
        />
      </div>
      <span className={clsx(
        'tabular-nums text-ink-3 shrink-0 leading-none',
        compact ? 'text-[8px]' : 'text-[9px]'
      )}>
        {value}%
      </span>
    </div>
  );
}

export { OpacitySlider };

export function TitleBar() {
  const { mode, setMode, sidebarHidden, toggleSidebar } = useAppStore();
  const wh = useWorkhourTimerStore();
  const winCfg = useConfigStore((s) => s.window);
  const appWindow = getCurrentWindow();

  async function switchMode(next: 'dock' | 'sidebar' | 'expanded') {
    setMode(next);
    const aotKey = `always_on_top_${next}` as const;
    try {
      await invoke('set_window_mode', { mode: next, alwaysOnTop: winCfg[aotKey] });
    } catch {
      setMode(mode);
    }
  }

  if (mode === 'dock') {
    return null;
  }

  if (mode === 'sidebar') {
    return (
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3 bg-transparent border-b border-border h-[var(--titlebar-height)] select-none shrink-0"
      >
        <span className="text-xs font-semibold text-ink" data-tauri-drag-region>Orbit</span>
        <div className="flex items-center gap-1.5" data-tauri-drag-region>
          <OpacitySlider compact />
          <div className="w-px h-3 bg-border shrink-0" />
          <button
            onClick={() => { if (wh.running) wh.pause(); else wh.start(); }}
            className="flex items-center gap-1 text-[9px] font-mono tabular-nums leading-none text-ink-3 hover:text-ink transition-colors"
            title={wh.running ? 'Pause' : 'Start'}
          >
            {wh.running ? (
              <svg width="6" height="6" viewBox="0 0 12 12" className="text-chrome"><rect x="2" y="1" width="3" height="10" rx="1" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="1" fill="currentColor"/></svg>
            ) : (
              <svg width="6" height="6" viewBox="0 0 12 12" className="text-ink-3"><path d="M3 1.5v9l7.5-4.5L3 1.5z" fill="currentColor"/></svg>
            )}
            <span className={wh.running ? 'text-chrome' : ''}>{fmtWH(wh.elapsed)}</span>
          </button>
          {(wh.running || wh.elapsed > 0) && (
            <button
              onClick={() => wh.finish()}
              className="p-0.5 text-ink-3 hover:text-red-500 transition-colors"
              title="근무 종료 — 오늘 누적 시간을 기록"
            >
              <svg width="6" height="6" viewBox="0 0 10 10" fill="currentColor">
                <rect x="1" y="1" width="8" height="8" rx="1" />
              </svg>
            </button>
          )}
          <div className="w-px h-3 bg-border shrink-0" />
          <span className="text-[9px] text-ink-3 tabular-nums leading-none">{new Date().getDate()}<span className="ml-0.5 text-[8px]">{new Date().toLocaleDateString('ko-KR', { weekday: 'short' })}</span></span>
          <button onClick={() => switchMode('dock')} className="p-1 rounded-md hover:bg-paper-soft text-ink-3 transition-colors" title="Dock">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="5" width="10" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
          <button onClick={() => switchMode('expanded')} className="p-1 rounded-md hover:bg-paper-soft text-ink-3 transition-colors" title="Expand">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2 6V3a1 1 0 011-1h3M10 2h3a1 1 0 011 1v3M14 10v3a1 1 0 01-1 1h-3M6 14H3a1 1 0 01-1-1v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="w-px h-3 bg-border shrink-0" />
          <button onClick={() => appWindow.minimize()} className="p-1 rounded-md hover:bg-paper-soft text-ink-3 transition-colors" title="Minimize">
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
              <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button onClick={() => appWindow.close()} className="p-1 rounded-md hover:bg-pastel-pink/50 text-ink-3 transition-colors" title="Close">
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
              <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-tauri-drag-region
      className={clsx(
        'flex items-center justify-between px-3',
        'bg-transparent border-b border-border',
        'h-[var(--titlebar-height)] select-none shrink-0'
      )}
    >
      <div className="flex items-center gap-2" data-tauri-drag-region>
        {sidebarHidden && (
          <button
            onClick={toggleSidebar}
            title="사이드바 표시 (Ctrl+\)"
            className="p-1 rounded-md hover:bg-paper-soft text-ink-3 hover:text-ink transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 3l4 4-4 4M8 3l4 4-4 4" />
            </svg>
          </button>
        )}
        <span className="text-sm font-semibold text-ink" data-tauri-drag-region>
          JRH-Orbit
        </span>
      </div>

      <div className="flex items-center gap-1">
        <OpacitySlider />
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={() => switchMode('sidebar')}
          className="p-1.5 rounded-md hover:bg-paper-soft text-ink-2 transition-colors"
          title="Sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M6 2v12" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>
        <button
          onClick={() => switchMode('dock')}
          className="p-1.5 rounded-md hover:bg-paper-soft text-ink-2 transition-colors"
          title="Dock"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="5" width="10" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>

        <button
          onClick={() => appWindow.minimize()}
          className="p-1.5 rounded-md hover:bg-paper-soft text-ink-3 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <button
          onClick={() => appWindow.toggleMaximize()}
          className="p-1.5 rounded-md hover:bg-paper-soft text-ink-3 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
          </svg>
        </button>

        <button
          onClick={() => appWindow.close()}
          className="p-1.5 rounded-md hover:bg-pastel-pink/50 text-ink-3 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
