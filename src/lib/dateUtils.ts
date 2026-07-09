import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export function todayKey(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** 근무일 경계는 자정이 아니라 새벽 6시 — 자정 넘어 일한 시간은 전날로 기록/집계.
 *  workhour의 기록·조회·통계는 todayKey()가 아니라 반드시 이 키를 쓸 것. */
export const WORKDAY_START_HOUR = 6;
export function workdayKey(d: Date = new Date()): string {
  return format(new Date(d.getTime() - WORKDAY_START_HOUR * 3600 * 1000), 'yyyy-MM-dd');
}

export function formatDateKo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'yyyy년 M월 d일 (EEEE)', { locale: ko });
}

export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'M/d (EEE)', { locale: ko });
}

export function isoNow(): string {
  return new Date().toISOString();
}
