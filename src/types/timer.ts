export type TimerPhase = 'work' | 'break' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerState {
  phase: TimerPhase;
  status: TimerStatus;
  remaining: number;
  completedPomodoros: number;
}

export interface WorkhourEntry {
  date: string;
  project?: string;
  startedAt: string;
  endedAt?: string;
  durationMinutes: number;
  note?: string;
}
