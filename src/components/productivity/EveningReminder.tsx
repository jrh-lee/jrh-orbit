import { useEffect, useRef } from 'react';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { useAppStore } from '../../stores/useAppStore';
import { todayKey } from '../../lib/dateUtils';

const REMINDER_KEY = 'jrh-orbit-evening-reminder';
const REMINDER_HOUR = 18;

export function EveningReminder() {
  const { setView } = useAppStore();
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    async function check() {
      const now = new Date();
      const today = todayKey();
      const shown = localStorage.getItem(REMINDER_KEY);
      if (shown === today) return;
      if (now.getHours() < REMINDER_HOUR) return;

      localStorage.setItem(REMINDER_KEY, today);

      try {
        let allowed = await isPermissionGranted();
        if (!allowed) {
          const perm = await requestPermission();
          allowed = perm === 'granted';
        }
        if (!allowed) return;

        const isFriday = now.getDay() === 5;
        if (isFriday) {
          sendNotification({
            title: 'JRH-Orbit',
            body: '이번 주 회고를 작성해보세요 📝',
          });
        } else {
          sendNotification({
            title: 'JRH-Orbit',
            body: '오늘 인사이트를 기록하셨나요? 💡',
          });
        }
      } catch {}
    }

    check();
    timerRef.current = setInterval(check, 60 * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [setView]);

  return null;
}
