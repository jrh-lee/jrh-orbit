import { useEffect, useRef } from 'react';
import { todayKey } from '../../lib/dateUtils';

const WEEKLY_KEY = 'jrh-orbit-review-reminder-weekly';
const MONTHLY_KEY = 'jrh-orbit-review-reminder-monthly';
const QUARTERLY_KEY = 'jrh-orbit-review-reminder-quarterly';
const CONFIG_KEY = 'jrh-orbit-review-config';

interface ReviewScheduleConfig {
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  quarterlyEnabled: boolean;
  scheduleHour: number;
}

function loadScheduleConfig(): ReviewScheduleConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        weeklyEnabled: parsed.weeklyEnabled ?? true,
        monthlyEnabled: parsed.monthlyEnabled ?? true,
        quarterlyEnabled: parsed.quarterlyEnabled ?? true,
        scheduleHour: parsed.scheduleHour ?? 8,
      };
    }
  } catch {}
  return { weeklyEnabled: true, monthlyEnabled: true, quarterlyEnabled: true, scheduleHour: 8 };
}

async function trySendNotification(title: string, body: string) {
  try {
    const { sendNotification, isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    let permitted = await isPermissionGranted();
    if (!permitted) {
      const result = await requestPermission();
      permitted = result === 'granted';
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  } catch {}
}

const QUARTER_MONTHS = [0, 3, 6, 9];

export function ReviewScheduler() {
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const configRef = useRef<ReviewScheduleConfig>(loadScheduleConfig());

  useEffect(() => {
    const handler = () => { configRef.current = loadScheduleConfig(); };
    window.addEventListener('review-config-changed', handler);
    return () => window.removeEventListener('review-config-changed', handler);
  }, []);

  useEffect(() => {
    function check() {
      const config = configRef.current;
      const now = new Date();
      const today = todayKey();

      if (config.weeklyEnabled && now.getDay() === 1 && now.getHours() >= config.scheduleHour) {
        if (localStorage.getItem(WEEKLY_KEY) !== today) {
          localStorage.setItem(WEEKLY_KEY, today);
          trySendNotification('JRH-Orbit', 'Weekly Review를 생성할 시간입니다. Statistics > Reviews에서 프롬프트를 복사하세요.');
        }
      }

      if (config.monthlyEnabled && now.getDate() === 1 && now.getHours() >= config.scheduleHour) {
        if (localStorage.getItem(MONTHLY_KEY) !== today) {
          localStorage.setItem(MONTHLY_KEY, today);
          trySendNotification('JRH-Orbit', 'Monthly Review를 생성할 시간입니다. Statistics > Reviews에서 프롬프트를 복사하세요.');
        }
      }

      if (config.quarterlyEnabled && QUARTER_MONTHS.includes(now.getMonth()) && now.getDate() === 1 && now.getHours() >= config.scheduleHour) {
        if (localStorage.getItem(QUARTERLY_KEY) !== today) {
          localStorage.setItem(QUARTERLY_KEY, today);
          trySendNotification('JRH-Orbit', 'Quarterly Review를 생성할 시간입니다. Statistics > Reviews에서 프롬프트를 복사하세요.');
        }
      }
    }

    check();
    timerRef.current = setInterval(check, 60 * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  return null;
}
