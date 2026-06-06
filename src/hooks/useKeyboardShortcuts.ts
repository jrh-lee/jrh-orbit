import { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useConfigStore } from '../stores/useConfigStore';
import { writeJsonFile, readConfig } from '../lib/fileSystem';
import type { AppView } from '../stores/useAppStore';

const viewShortcuts: Record<string, AppView> = {
  '1': 'daily',
  '2': 'notes',
  '3': 'tasks',
  '4': 'search',
  '5': 'statistics',
  '6': 'graph',
  '7': 'settings',
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

export function useKeyboardShortcuts() {
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      if (viewShortcuts[key]) {
        e.preventDefault();
        setView(viewShortcuts[key]);
        return;
      }

      if (key === 'k') {
        e.preventDefault();
        setView('search');
        return;
      }

      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        setView('notes');
        return;
      }

      if (key === 'd') {
        e.preventDefault();
        setView('daily');
        return;
      }

      if (key === 't' && !e.shiftKey) {
        e.preventDefault();
        setView('tasks');
        return;
      }

      if (key === ',') {
        e.preventDefault();
        setView('settings');
        return;
      }

      const mode = useAppStore.getState().mode;
      if (mode !== 'expanded') return;

      if (key === '=' || key === '+') {
        e.preventDefault();
        const cfg = useConfigStore.getState();
        const next = Math.min(200, cfg.window.zoom_level + 10);
        cfg.setWindow({ zoom_level: next });
        const dir = useAppStore.getState().dataDir;
        if (dir) persistZoom(dir, next);
        return;
      }

      if (key === '-') {
        e.preventDefault();
        const cfg = useConfigStore.getState();
        const next = Math.max(50, cfg.window.zoom_level - 10);
        cfg.setWindow({ zoom_level: next });
        const dir = useAppStore.getState().dataDir;
        if (dir) persistZoom(dir, next);
        return;
      }

      if (key === '0') {
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
