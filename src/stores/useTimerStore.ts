import { create } from 'zustand';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { TimerPhase, TimerStatus } from '../types/timer';
import { POMODORO_DEFAULTS } from '../lib/constants';
import { addWorkhourSession } from '../lib/workhour';
import { useAppStore } from './useAppStore';
import type { WorkhourSession } from '../types/dataFiles';

async function notifyPhaseChange(fromPhase: TimerPhase, toPhase: TimerPhase) {
  try {
    let allowed = await isPermissionGranted();
    if (!allowed) {
      const perm = await requestPermission();
      allowed = perm === 'granted';
    }
    if (!allowed) return;

    if (fromPhase === 'work' && toPhase === 'longBreak') {
      sendNotification({ title: 'JRH-Orbit', body: 'Long break! You completed 4 sessions.' });
    } else if (fromPhase === 'work') {
      sendNotification({ title: 'JRH-Orbit', body: 'Break time! Take a 5-minute rest.' });
    } else {
      sendNotification({ title: 'JRH-Orbit', body: 'Back to work! Focus time.' });
    }
  } catch {}
}

function durationForPhase(phase: TimerPhase): number {
  if (phase === 'work') return POMODORO_DEFAULTS.work;
  if (phase === 'longBreak') return POMODORO_DEFAULTS.longBreak;
  return POMODORO_DEFAULTS.break;
}

function nextPhase(current: TimerPhase, completedPomodoros: number): TimerPhase {
  if (current === 'work') {
    return (completedPomodoros + 1) % POMODORO_DEFAULTS.sessionsBeforeLong === 0
      ? 'longBreak'
      : 'break';
  }
  return 'work';
}

interface TimerState {
  phase: TimerPhase;
  status: TimerStatus;
  remaining: number;
  completedPomodoros: number;
  sessionStartedAt: string | null;
  /** Project captured at work-phase start (§5.12 Pomodoro Project Auto-Detect) */
  sessionProject: string | null;

  setPhase: (phase: TimerPhase) => void;
  setStatus: (status: TimerStatus) => void;
  setRemaining: (seconds: number) => void;
  tick: () => void;
  incrementPomodoros: () => void;
  reset: (seconds: number) => void;
  skipPhase: () => void;
}

let intervalId: ReturnType<typeof setInterval> | undefined;

function startInterval() {
  stopInterval();
  intervalId = setInterval(() => {
    useTimerStore.getState().tick();
  }, 1000);
}

function stopInterval() {
  if (intervalId !== undefined) {
    clearInterval(intervalId);
    intervalId = undefined;
  }
}

function recordWorkhourSession(startedAt: string, durationMinutes: number, capturedProject: string | null) {
  const { dataDir } = useAppStore.getState();
  if (!dataDir) return;
  const session: WorkhourSession = {
    project: capturedProject ?? 'GENERAL',
    startedAt,
    endedAt: new Date().toISOString(),
    durationMinutes,
    source: 'pomodoro',
  };
  addWorkhourSession(dataDir, session).catch(() => {});
}

export const useTimerStore = create<TimerState>((set, get) => ({
  phase: 'work',
  status: 'idle',
  remaining: POMODORO_DEFAULTS.work,
  completedPomodoros: 0,
  sessionStartedAt: null,
  sessionProject: null,

  setPhase: (phase) => set({ phase }),

  setStatus: (status) => {
    const prev = get();
    if (status === 'running' && prev.status !== 'running' && prev.phase === 'work') {
      // §5.12: Capture activeProject at work-phase start so switching notes
      // mid-pomodoro won't change which project gets credited.
      const { activeProject } = useAppStore.getState();
      set({
        status,
        sessionStartedAt: prev.sessionStartedAt ?? new Date().toISOString(),
        sessionProject: prev.sessionProject ?? activeProject,
      });
    } else {
      set({ status });
    }
    if (status === 'running') {
      startInterval();
    } else {
      stopInterval();
    }
  },

  setRemaining: (seconds) => set({ remaining: seconds }),

  tick: () => {
    const { remaining, phase, completedPomodoros, sessionStartedAt, sessionProject } = get();
    if (remaining <= 1) {
      stopInterval();
      const wasWork = phase === 'work';
      const newPomodoros = wasWork ? completedPomodoros + 1 : completedPomodoros;
      const newPhase = nextPhase(phase, completedPomodoros);
      const newDuration = durationForPhase(newPhase);
      notifyPhaseChange(phase, newPhase);

      if (wasWork && sessionStartedAt) {
        const startMs = new Date(sessionStartedAt).getTime();
        const durationMinutes = Math.round((Date.now() - startMs) / 60000);
        recordWorkhourSession(sessionStartedAt, durationMinutes, sessionProject);
      }

      set({
        remaining: newDuration,
        phase: newPhase,
        completedPomodoros: newPomodoros,
        status: 'idle',
        sessionStartedAt: null,
        sessionProject: null,
      });
    } else {
      set({ remaining: remaining - 1 });
    }
  },

  incrementPomodoros: () => set((s) => ({ completedPomodoros: s.completedPomodoros + 1 })),

  reset: (seconds) => {
    stopInterval();
    set({ remaining: seconds, status: 'idle' });
  },

  skipPhase: () => {
    stopInterval();
    const { phase, completedPomodoros } = get();
    const wasWork = phase === 'work';
    const newPomodoros = wasWork ? completedPomodoros + 1 : completedPomodoros;
    const newPhase = nextPhase(phase, completedPomodoros);
    const newDuration = durationForPhase(newPhase);
    set({
      remaining: newDuration,
      phase: newPhase,
      completedPomodoros: newPomodoros,
      status: 'idle',
    });
  },
}));
