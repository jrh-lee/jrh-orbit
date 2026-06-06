import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export function todayKey(): string {
  return format(new Date(), 'yyyy-MM-dd');
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
