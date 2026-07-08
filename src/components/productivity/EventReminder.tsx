import { useEffect } from 'react';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { useAppStore } from '../../stores/useAppStore';
import { readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { CalendarFile } from '../../types/calendar';

const CHECK_INTERVAL_MS = 60_000;
/** Still fire up to 1 min past the start (check ticks are 60s apart) */
const GRACE_MS = 60_000;

async function notify(title: string, body: string) {
  try {
    let allowed = await isPermissionGranted();
    if (!allowed) {
      const perm = await requestPermission();
      allowed = perm === 'granted';
    }
    if (!allowed) return;
    sendNotification({ title, body });
  } catch {}
}

function reminderLabel(minutes: number): string {
  if (minutes === 0) return '지금';
  if (minutes < 60) return `${minutes}분 후`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}시간 후`;
  return `${Math.round(minutes / 1440)}일 후`;
}

/** Fires OS notifications for local calendar events with a reminder set. */
export function EventReminder() {
  const { dataDir } = useAppStore();

  useEffect(() => {
    if (!dataDir) return;
    let disposed = false;

    const check = async () => {
      try {
        const cal = await readJsonFile<CalendarFile>(dataDir, FILES.calendar);
        if (!cal || disposed) return;
        const now = Date.now();
        for (const e of cal.events) {
          if (e.reminderMinutes === undefined || e.source !== 'local') continue;
          const start = new Date(`${e.date}T${e.startTime ?? '09:00'}:00`).getTime();
          if (isNaN(start)) continue;
          const remindAt = start - e.reminderMinutes * 60_000;
          if (now < remindAt || now > start + GRACE_MS) continue;
          const firedKey = `orbit-reminded-${e.id}-${e.reminderMinutes}`;
          if (localStorage.getItem(firedKey)) continue;
          localStorage.setItem(firedKey, '1');
          const when = e.startTime ? `${e.date} ${e.startTime}` : e.date;
          await notify(`⏰ ${e.title}`, `${when} (${reminderLabel(e.reminderMinutes)} 시작)`);
        }
      } catch {}
    };

    check();
    const iv = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(iv);
    };
  }, [dataDir]);

  return null;
}
