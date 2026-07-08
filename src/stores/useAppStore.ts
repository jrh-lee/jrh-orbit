import { create } from 'zustand';

export type WindowMode = 'dock' | 'sidebar' | 'expanded';
export type AppView = 'daily' | 'notes' | 'tasks' | 'calendar' | 'search' | 'statistics' | 'graph' | 'settings' | 'hub' | 'dashboard';
export type Theme = 'light' | 'dark' | 'spreadsheet' | 'cyberpunk' | 'forest' | 'ocean' | 'paper' | 'terminal' | 'solarized' | 'buddybuddy';

const STORAGE_KEY = 'jrh-orbit-data-dir';

interface AppState {
  mode: WindowMode;
  view: AppView;
  dataDir: string;
  isSetupComplete: boolean;
  theme: Theme;
  pendingNotePath: string | null;
  /** Block-link anchor (block text prefix) to scroll to after the note opens */
  pendingNoteAnchor: string | null;
  pendingTagFilter: string | null;
  /** yyyy-MM-dd — date the Daily view should jump to on next open */
  pendingDailyDate: string | null;
  activeProject: string | null;
  hubTarget:
    | { type: 'project'; name: string }
    | { type: 'topic'; name: string }
    | { type: 'experiment'; name: string; project: string }
    | null;
  /** Expanded-mode focus mode: hides the left sidebar (Ctrl+\) */
  sidebarHidden: boolean;

  setMode: (mode: WindowMode) => void;
  setView: (view: AppView) => void;
  setDataDir: (dir: string) => void;
  setSetupComplete: (complete: boolean) => void;
  setTheme: (theme: Theme) => void;
  openNote: (path: string, anchor?: string) => void;
  clearPendingNote: () => void;
  openDaily: (date: string) => void;
  clearPendingDailyDate: () => void;
  filterByTag: (tag: string) => void;
  filterByTaskTag: (tag: string) => void;
  clearPendingTagFilter: () => void;
  setActiveProject: (project: string | null) => void;
  openProjectHub: (projectName: string) => void;
  openTopicHub: (topicName: string) => void;
  openExperimentHub: (experimentName: string, projectName: string) => void;
  goHubLanding: () => void;
  toggleSidebar: () => void;
}

const savedDir = localStorage.getItem(STORAGE_KEY) || '';

export const useAppStore = create<AppState>((set) => ({
  mode: 'expanded',
  view: 'daily',
  dataDir: savedDir,
  isSetupComplete: !!savedDir,
  theme: 'light',
  pendingNotePath: null,
  pendingNoteAnchor: null,
  pendingTagFilter: null,
  pendingDailyDate: null,
  activeProject: null,
  hubTarget: null,
  sidebarHidden: localStorage.getItem('orbit-sidebar-hidden') === '1',

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
  openNote: (path, anchor) => set({ view: 'notes', pendingNotePath: path, pendingNoteAnchor: anchor ?? null }),
  clearPendingNote: () => set({ pendingNotePath: null, pendingNoteAnchor: null }),
  openDaily: (date) => set({ view: 'daily', pendingDailyDate: date }),
  clearPendingDailyDate: () => set({ pendingDailyDate: null }),
  filterByTag: (tag) => set({ view: 'notes', pendingTagFilter: tag }),
  filterByTaskTag: (tag) => set({ view: 'tasks', pendingTagFilter: tag }),
  clearPendingTagFilter: () => set({ pendingTagFilter: null }),
  setActiveProject: (project) => set({ activeProject: project }),
  openProjectHub: (name) => set({ view: 'hub', hubTarget: { type: 'project', name } }),
  openTopicHub: (name) => set({ view: 'hub', hubTarget: { type: 'topic', name } }),
  openExperimentHub: (name, project) => set({ view: 'hub', hubTarget: { type: 'experiment', name, project } }),
  goHubLanding: () => set({ hubTarget: null }),
  toggleSidebar: () => set((s) => {
    const next = !s.sidebarHidden;
    localStorage.setItem('orbit-sidebar-hidden', next ? '1' : '0');
    return { sidebarHidden: next };
  }),
}));
