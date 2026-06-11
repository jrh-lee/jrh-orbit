import { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useConfigStore } from '../stores/useConfigStore';
import { writeJsonFile, readConfig } from '../lib/fileSystem';
import type { AppView } from '../stores/useAppStore';

const viewShortcutsByCode: Record<string, AppView> = {
  'Digit1': 'daily',
  'Digit2': 'notes',
  'Digit3': 'tasks',
  'Digit4': 'search',
  'Digit5': 'statistics',
  'Digit6': 'graph',
  'Digit7': 'settings',
};

async function persistZoom(dataDir: string, zoom: number) {
  const config = (await readConfig(dataDir)) as Record<string, unknown> | null;
  const existing = (config ?? {}) as Record<string, unknown>;
  const winSection = (existing.window ?? {}) as Record<string, unknown>;
  await writeJsonFile(dataDir, 'config.json', {
    ...existing,
    window: { ...winSection, zoom_level: zoom },
  });
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function useKeyboardShortcuts() {
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const code = e.code;

      if (viewShortcutsByCode[code]) {
        e.preventDefault();
        setView(viewShortcutsByCode[code]);
        return;
      }

      if (code === 'KeyK') {
        e.preventDefault();
        setView('search');
        return;
      }

      if (code === 'KeyN' && !e.shiftKey) {
        e.preventDefault();
        setView('notes');
        return;
      }

      if (code === 'KeyD') {
        e.preventDefault();
        setView('daily');
        return;
      }

      if (code === 'KeyT' && !e.shiftKey) {
        e.preventDefault();
        setView('tasks');
        return;
      }

      if (code === 'Comma') {
        e.preventDefault();
        setView('settings');
        return;
      }

      const mode = useAppStore.getState().mode;
      if (mode !== 'expanded') return;

      if (code === 'Equal') {
        e.preventDefault();
        const cfg = useConfigStore.getState();
        const next = Math.min(200, cfg.window.zoom_level + 10);
        cfg.setWindow({ zoom_level: next });
        const dir = useAppStore.getState().dataDir;
        if (dir) persistZoom(dir, next);
        return;
      }

      if (code === 'Minus') {
        e.preventDefault();
        const cfg = useConfigStore.getState();
        const next = Math.max(50, cfg.window.zoom_level - 10);
        cfg.setWindow({ zoom_level: next });
        const dir = useAppStore.getState().dataDir;
        if (dir) persistZoom(dir, next);
        return;
      }

      if (code === 'Digit0') {
        e.preventDefault();
        const cfg = useConfigStore.getState();
        cfg.setWindow({ zoom_level: 100 });
        const dir = useAppStore.getState().dataDir;
        if (dir) persistZoom(dir, 100);
        return;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setView]);
}
