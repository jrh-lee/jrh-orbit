import { create } from 'zustand';

const STORAGE_KEY = 'jrh-orbit-workhour-timer';
const SAVE_EVERY_TICKS = 30;

interface Saved {
  baseElapsed: number;
  running: boolean;
  startedAt: number | null;
  date: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.date !== today()) return { baseElapsed: 0, running: false, startedAt: null, date: today() };
      if (s.baseElapsed !== undefined) return s as Saved;
      // migrate from old format
      return {
        baseElapsed: s.elapsed ?? 0,
        running: s.running ?? false,
        startedAt: s.startedAt ?? null,
        date: s.date,
      };
    }
  } catch {}
  return { baseElapsed: 0, running: false, startedAt: null, date: today() };
}

function save(s: Saved) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface WorkhourTimerState {
  elapsed: number;
  running: boolean;
  startedAt: number | null;
  baseElapsed: number;

  start: () => void;
  pause: () => void;
  reset: () => void;
  addMinutes: (min: number) => void;
  subtractMinutes: (min: number) => void;
  tick: () => void;
}

let intervalId: ReturnType<typeof setInterval> | undefined;
let tickCount = 0;

function startInterval() {
  stopInterval();
  tickCount = 0;
  intervalId = setInterval(() => {
    useWorkhourTimerStore.getState().tick();
  }, 1000);
}

function stopInterval() {
  if (intervalId !== undefined) {
    clearInterval(intervalId);
    intervalId = undefined;
  }
}

const initial = load();
let initialElapsed = initial.baseElapsed;
if (initial.running && initial.startedAt) {
  initialElapsed += Math.floor((Date.now() - initial.startedAt) / 1000);
}

export const useWorkhourTimerStore = create<WorkhourTimerState>((set, get) => {
  if (initial.running) {
    setTimeout(() => startInterval(), 0);
  }

  return {
    elapsed: initialElapsed,
    running: initial.running,
    startedAt: initial.running ? initial.startedAt : null,
    baseElapsed: initial.running ? initial.baseElapsed : initialElapsed,

    start: () => {
      const now = Date.now();
      const { baseElapsed } = get();
      set({ running: true, startedAt: now });
      save({ baseElapsed, running: true, startedAt: now, date: today() });
      startInterval();
    },

    pause: () => {
      stopInterval();
      const { baseElapsed, startedAt } = get();
      const session = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
      const newBase = baseElapsed + session;
      set({ running: false, elapsed: newBase, baseElapsed: newBase, startedAt: null });
      save({ baseElapsed: newBase, running: false, startedAt: null, date: today() });
    },

    reset: () => {
      stopInterval();
      set({ elapsed: 0, running: false, startedAt: null, baseElapsed: 0 });
      save({ baseElapsed: 0, running: false, startedAt: null, date: today() });
    },

    addMinutes: (min: number) => {
      const added = min * 60;
      set(s => {
        const newBase = s.baseElapsed + added;
        const session = s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0;
        save({ baseElapsed: newBase, running: s.running, startedAt: s.startedAt, date: today() });
        return { baseElapsed: newBase, elapsed: newBase + session };
      });
    },

    subtractMinutes: (min: number) => {
      const sub = min * 60;
      set(s => {
        const newBase = Math.max(0, s.baseElapsed - sub);
        const session = s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0;
        const newElapsed = Math.max(0, newBase + session);
        save({ baseElapsed: newBase, running: s.running, startedAt: s.startedAt, date: today() });
        return { baseElapsed: newBase, elapsed: newElapsed };
      });
    },

    tick: () => {
      const { startedAt, baseElapsed } = get();
      if (!startedAt) return;
      const sessionSeconds = Math.floor((Date.now() - startedAt) / 1000);
      set({ elapsed: baseElapsed + sessionSeconds });

      tickCount++;
      if (tickCount >= SAVE_EVERY_TICKS) {
        tickCount = 0;
        save({ baseElapsed, running: true, startedAt, date: today() });
      }
    },
  };
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const { running, startedAt, baseElapsed } = useWorkhourTimerStore.getState();
    if (!running || !startedAt) return;

    if (document.visibilityState === 'visible') {
      const sessionSeconds = Math.floor((Date.now() - startedAt) / 1000);
      useWorkhourTimerStore.setState({ elapsed: baseElapsed + sessionSeconds });
    }
    save({ baseElapsed, running: true, startedAt, date: today() });
  });
}
