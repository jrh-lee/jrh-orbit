import { create } from 'zustand';

export type WindowMode = 'dock' | 'sidebar' | 'expanded';
export type AppView = 'daily' | 'notes' | 'tasks' | 'search' | 'statistics' | 'graph' | 'settings';
export type Theme = 'light' | 'dark' | 'spreadsheet' | 'cyberpunk' | 'forest' | 'ocean' | 'paper' | 'terminal' | 'solarized' | 'buddybuddy';

const STORAGE_KEY = 'jrh-orbit-data-dir';

interface AppState {
  mode: WindowMode;
  view: AppView;
  dataDir: string;
  isSetupComplete: boolean;
  theme: Theme;
  pendingNotePath: string | null;
  pendingTagFilter: string | null;
  activeProject: string | null;

  setMode: (mode: WindowMode) => void;
  setView: (view: AppView) => void;
  setDataDir: (dir: string) => void;
  setSetupComplete: (complete: boolean) => void;
  setTheme: (theme: Theme) => void;
  openNote: (path: string) => void;
  clearPendingNote: () => void;
  filterByTag: (tag: string) => void;
  filterByTaskTag: (tag: string) => void;
  clearPendingTagFilter: () => void;
  setActiveProject: (project: string | null) => void;
}

const savedDir = localStorage.getItem(STORAGE_KEY) || '';

export const useAppStore = create<AppState>((set) => ({
  mode: 'expanded',
  view: 'daily',
  dataDir: savedDir,
  isSetupComplete: !!savedDir,
  theme: 'light',
  pendingNotePath: null,
  pendingTagFilter: null,
  activeProject: null,

  setMode: (mode) => set({ mode }),
  setView: (view) => set({ view }),
  setDataDir: (dir) => {
    if (dir) localStorage.setItem(STORAGE_KEY, dir);
    else localStorage.removeItem(STORAGE_KEY);
    set({ dataDir: dir });
  },
  setSetupComplete: (complete) => set({ isSetupComplete: complete }),
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  openNote: (path) => set({ view: 'notes', pendingNotePath: path }),
  clearPendingNote: () => set({ pendingNotePath: null }),
  filterByTag: (tag) => set({ view: 'notes', pendingTagFilter: tag }),
  filterByTaskTag: (tag) => set({ view: 'tasks', pendingTagFilter: tag }),
  clearPendingTagFilter: () => set({ pendingTagFilter: null }),
  setActiveProject: (project) => set({ activeProject: project }),
}));
