import { format } from 'date-fns';
import { readJsonFile, writeJsonFile } from './fileSystem';
import { FOLDERS } from './constants';
import { workdayKey } from './dateUtils';
import type { DailyWorkhourFile, WorkhourSession } from '../types/dataFiles';

function workhourPath(dateKey: string): string {
  return `${FOLDERS.workhours}/${dateKey}.json`;
}

// 기본 날짜 키 = 근무일 키 (새벽 6시 경계) — 자정 넘어 기록해도 전날 파일에 쌓인다
export async function loadDailyWorkhour(dataDir: string, dateKey?: string): Promise<DailyWorkhourFile> {
  const key = dateKey ?? workdayKey();
  const data = await readJsonFile<DailyWorkhourFile>(dataDir, workhourPath(key));
  return data ?? { date: key, sessions: [], total_minutes: 0 };
}

export async function addWorkhourSession(
  dataDir: string,
  session: WorkhourSession,
  dateKey?: string,
): Promise<DailyWorkhourFile> {
  const key = dateKey ?? workdayKey();
  const daily = await loadDailyWorkhour(dataDir, key);
  daily.sessions.push(session);
  daily.total_minutes = Math.max(0, daily.sessions.reduce((sum, s) => sum + s.durationMinutes, 0));
  await writeJsonFile(dataDir, workhourPath(key), daily);
  return daily;
}

export async function getWeeklyWorkhour(dataDir: string, dateKey?: string): Promise<number> {
  const key = dateKey ?? format(new Date(), 'yyyy-MM-dd');
  const base = new Date(key + 'T00:00:00');
  const dayOfWeek = base.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + mondayOffset + i);
    const dk = format(d, 'yyyy-MM-dd');
    try {
      const daily = await loadDailyWorkhour(dataDir, dk);
      total += daily.total_minutes;
    } catch {}
  }
  return total;
}

export function summarizeByProject(sessions: WorkhourSession[]): { project: string; hours: number }[] {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const p = s.project || 'GENERAL';
    map.set(p, (map.get(p) ?? 0) + s.durationMinutes);
  }
  return [...map.entries()].map(([project, mins]) => ({ project, hours: Math.round(mins / 6) / 10 }));
}
