import { useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useTimerStore } from '../../stores/useTimerStore';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useFileWatcher } from '../../hooks/useFileWatcher';
import { readConfig, initDataFiles, ensureDataDir } from '../../lib/fileSystem';
import { buildIndex } from '../../lib/searchIndex';
import { debugFts } from '../../lib/db';
import { autoArchiveQuickMemos } from '../../lib/autoArchive';
import { runDailyBackup } from '../../lib/backup';
import { processRecurringTodos } from '../../lib/recurringTodos';
import { useConfigStore } from '../../stores/useConfigStore';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { DockMode } from './DockMode';
import { SidebarMode } from './SidebarMode';
import { ExpandedMode } from './ExpandedMode';
import { MusicEngine } from '../productivity/MusicPlayer';
import { MorningBriefing } from '../productivity/MorningBriefing';
import { EveningReminder } from '../productivity/EveningReminder';
import { EventReminder } from '../productivity/EventReminder';
import { QuickCapture } from '../productivity/QuickCapture';
import { ClipboardCapture } from '../productivity/ClipboardCapture';
import { ReviewScheduler } from '../productivity/ReviewScheduler';
import { OnboardingTour } from './OnboardingTour';
import { UpdateChecker } from '../productivity/UpdateChecker';
import type { Theme } from '../../stores/useAppStore';

export function AppShell() {
  const { mode, dataDir, setTheme } = useAppStore();
  const clipboardEnabled = useConfigStore((s) => s.editor.clipboard_capture);

  useKeyboardShortcuts();
  useFileWatcher();

  const applyConfig = useCallback(async () => {
    if (!dataDir) return;
    const config = (await readConfig(dataDir)) as Record<string, unknown> | null;
    if (!config) return;
    if ((config as { theme?: Theme }).theme) {
      setTheme((config as { theme: Theme }).theme);
    }
    useConfigStore.getState().loadFromConfig(config);
    const pom = config.pomodoro as { work: number; break: number; longBreak: number; sessionsBeforeLong: number } | undefined;
    if (pom) {
      const timer = useTimerStore.getState();
      if (timer.status === 'idle') {
        const phase = timer.phase;
        let duration = pom.work;
        if (phase === 'break') duration = pom.break;
        if (phase === 'longBreak') duration = pom.longBreak;
        timer.reset(duration);
      }
    }
  }, [dataDir, setTheme]);

  useEffect(() => {
    if (dataDir) {
      ensureDataDir(dataDir)
        .then(() => initDataFiles(dataDir))
        .then(() => buildIndex(dataDir))
        .then(() => {
          window.dispatchEvent(new CustomEvent('search-index-ready'));
          autoArchiveQuickMemos(dataDir).catch(() => {});
          processRecurringTodos(dataDir).catch(() => {});
          (window as any).__debugFts = () => debugFts().then(r => { console.table(r); return r; });
          // Delayed so Google Drive has time to hydrate after boot — a
          // snapshot of stale/unreadable files would be useless.
          setTimeout(() => { runDailyBackup(dataDir).catch(() => {}); }, 20_000);
        })
        .catch((e) => console.error('[AppShell] init failed:', e));
    }
  }, [dataDir]);

  useEffect(() => {
    applyConfig();
  }, [applyConfig]);

  useEffect(() => {
    const handler = () => applyConfig();
    window.addEventListener('config-changed', handler);
    return () => window.removeEventListener('config-changed', handler);
  }, [applyConfig]);

  const opacityKey = `opacity_${mode}` as const;
  const opacity = useConfigStore((s) => s.window[opacityKey]);

  return (
    <div className="h-full flex flex-col bg-paper" data-mode={mode} style={{ opacity: opacity / 100 }}>
      <TitleBar />
      {mode === 'dock' && <DockMode />}
      {mode === 'sidebar' && <SidebarMode />}
      {mode === 'expanded' && <ExpandedMode />}
      {mode === 'expanded' && <StatusBar />}
      <MusicEngine />
      <MorningBriefing />
      <EveningReminder />
      <EventReminder />
      <QuickCapture />
      {clipboardEnabled && <ClipboardCapture />}
      <ReviewScheduler />
      <OnboardingTour />
      <UpdateChecker />
    </div>
  );
}
