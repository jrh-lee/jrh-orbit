import { create } from 'zustand';
import { addWorkhourSession, loadDailyWorkhour } from '../lib/workhour';
import { workdayKey } from '../lib/dateUtils';
import { useAppStore } from './useAppStore';

const STORAGE_KEY = 'jrh-orbit-workhour-timer';
const SAVE_EVERY_TICKS = 30;

interface Saved {
  baseElapsed: number;
  running: boolean;
  startedAt: number | null;
  date: string;
}

/** 근무일 키 (새벽 6시 경계) — dateUtils.workdayKey로 통일 */
function today(): string {
  return workdayKey();
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
  date: string;

  start: () => void;
  pause: () => void;
  /** 종료: stop the timer and record today's accumulated time to the
   *  workhours file. Only the gap between the timer total and what's already
   *  in the file gets written, so repeat play→종료 cycles accumulate and
   *  pomodoro/manual sessions are never double-counted.
   *  Returns recorded minutes, or null when recording wasn't possible. */
  finish: () => Promise<number | null>;
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

let finishing = false;

export const useWorkhourTimerStore = create<WorkhourTimerState>((set, get) => {
  // 인터벌은 항상 돌린다 — 멈춘 타이머도 tick의 rollover 검사로 새벽 6시에
  // 표시가 리셋되어야 함 (기존엔 버튼을 눌러야만 리셋을 인지했음)
  setTimeout(() => startInterval(), 0);

  // The date-change reset in load() only runs at app start. When the app
  // stays open past midnight, this resets the counter for the new day
  // (yesterday's unrecorded time is dropped — 종료 preserves it to the file).
  function rolloverIfNeeded() {
    const s = get();
    const t = today();
    if (s.date === t) return;
    const startedAt = s.running ? Date.now() : null;
    set({ date: t, baseElapsed: 0, elapsed: 0, startedAt });
    save({ baseElapsed: 0, running: s.running, startedAt, date: t });
  }

  return {
    elapsed: initialElapsed,
    running: initial.running,
    startedAt: initial.running ? initial.startedAt : null,
    baseElapsed: initial.running ? initial.baseElapsed : initialElapsed,
    date: initial.date,

    start: () => {
      rolloverIfNeeded();
      const now = Date.now();
      const { baseElapsed } = get();
      set({ running: true, startedAt: now });
      save({ baseElapsed, running: true, startedAt: now, date: today() });
      startInterval();
    },

    pause: () => {
      rolloverIfNeeded();
      const { baseElapsed, startedAt } = get();
      const session = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
      const newBase = baseElapsed + session;
      set({ running: false, elapsed: newBase, baseElapsed: newBase, startedAt: null });
      save({ baseElapsed: newBase, running: false, startedAt: null, date: today() });
    },

    finish: async () => {
      rolloverIfNeeded();
      get().pause();
      if (finishing) return null;
      finishing = true;
      try {
        const { dataDir } = useAppStore.getState();
        if (!dataDir) return null;
        const totalMinutes = Math.round(get().baseElapsed / 60);
        const workDay = today();
        const daily = await loadDailyWorkhour(dataDir, workDay);
        const delta = totalMinutes - daily.total_minutes;
        if (delta <= 0) return 0;
        await addWorkhourSession(dataDir, {
          project: 'GENERAL',
          startedAt: new Date().toISOString(),
          durationMinutes: delta,
          source: 'timer',
          note: '근무 타이머 종료 기록',
        }, workDay);
        window.dispatchEvent(new CustomEvent('workhour-manual-added'));
        return delta;
      } catch {
        return null;
      } finally {
        finishing = false;
      }
    },

    reset: () => {
      set({ elapsed: 0, running: false, startedAt: null, baseElapsed: 0, date: today() });
      save({ baseElapsed: 0, running: false, startedAt: null, date: today() });
    },

    addMinutes: (min: number) => {
      rolloverIfNeeded();
      const added = min * 60;
      set(s => {
        const newBase = s.baseElapsed + added;
        const session = s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0;
        save({ baseElapsed: newBase, running: s.running, startedAt: s.startedAt, date: today() });
        return { baseElapsed: newBase, elapsed: newBase + session };
      });
    },

    subtractMinutes: (min: number) => {
      rolloverIfNeeded();
      const sub = min * 60;
      set(s => {
        // 실행 중인 세션 시간을 먼저 base로 흡수한 뒤 "총량"에서 뺀다 —
        // base에서만 빼면 세션에 쌓인 시간은 못 깎아서, -1h를 눌러도
        // base 바닥까지만 줄고 멈추던 버그 (2h39m에서 3번만 눌리던 증상)
        const now = Date.now();
        const session = s.running && s.startedAt ? Math.floor((now - s.startedAt) / 1000) : 0;
        const newBase = Math.max(0, s.baseElapsed + session - sub);
        const startedAt = s.running ? now : null;
        save({ baseElapsed: newBase, running: s.running, startedAt, date: today() });
        return { baseElapsed: newBase, elapsed: newBase, startedAt };
      });
    },

    tick: () => {
      rolloverIfNeeded();
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

export function ensureWorkhourInterval() {
  const { running } = useWorkhourTimerStore.getState();
  if (running && intervalId === undefined) {
    startInterval();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const { running, startedAt, baseElapsed } = useWorkhourTimerStore.getState();
    if (!running || !startedAt) return;

    if (document.visibilityState === 'visible') {
      const sessionSeconds = Math.floor((Date.now() - startedAt) / 1000);
      useWorkhourTimerStore.setState({ elapsed: baseElapsed + sessionSeconds });
      ensureWorkhourInterval();
    }
    save({ baseElapsed, running: true, startedAt, date: today() });
  });
}
