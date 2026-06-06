import { create } from 'zustand';

const STORAGE_KEY = 'jrh-orbit-workhour-timer';

interface Saved {
  elapsed: number;
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
      const s = JSON.parse(raw) as Saved;
      if (s.date === today()) return s;
    }
  } catch {}
  return { elapsed: 0, running: false, startedAt: null, date: today() };
}

function save(s: Saved) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface WorkhourTimerState {
  elapsed: number;
  running: boolean;
  startedAt: number | null;

  start: () => void;
  pause: () => void;
  reset: () => void;
  addMinutes: (min: number) => void;
  subtractMinutes: (min: number) => void;
  tick: () => void;
}

let intervalId: ReturnType<typeof setInterval> | undefined;

function startInterval() {
  stopInterval();
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
// If it was running, compute elapsed since startedAt
let initialElapsed = initial.elapsed;
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
    startedAt: initial.running ? Date.now() : null,

    start: () => {
      const now = Date.now();
      set({ running: true, startedAt: now });
      save({ elapsed: get().elapsed, running: true, startedAt: now, date: today() });
      startInterval();
    },

    pause: () => {
      stopInterval();
      const { elapsed, startedAt } = get();
      const newElapsed = startedAt ? elapsed + Math.floor((Date.now() - startedAt) / 1000) : elapsed;
      set({ running: false, elapsed: newElapsed, startedAt: null });
      save({ elapsed: newElapsed, running: false, startedAt: null, date: today() });
    },

    reset: () => {
      stopInterval();
      set({ elapsed: 0, running: false, startedAt: null });
      save({ elapsed: 0, running: false, startedAt: null, date: today() });
    },

    addMinutes: (min: number) => {
      const added = min * 60;
      set(s => {
        const newElapsed = s.elapsed + added;
        save({ elapsed: newElapsed, running: s.running, startedAt: s.startedAt, date: today() });
        return { elapsed: newElapsed };
      });
    },

    subtractMinutes: (min: number) => {
      const sub = min * 60;
      set(s => {
        const newElapsed = Math.max(0, s.elapsed - sub);
        save({ elapsed: newElapsed, running: s.running, startedAt: s.startedAt, date: today() });
        return { elapsed: newElapsed };
      });
    },

    tick: () => {
      const { startedAt, elapsed } = get();
      if (!startedAt) return;
      const now = Date.now();
      const total = elapsed + Math.floor((now - startedAt) / 1000);
      // Don't set elapsed in tick — compute from startedAt for accuracy
      // But we need to trigger re-render
      set({ elapsed: total, startedAt: now });
    },
  };
});
