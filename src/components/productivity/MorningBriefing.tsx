import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useAppStore } from '../../stores/useAppStore';
import { readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import { getCarriedOverItems, getActiveTodos } from '../../lib/dailyLogHelper';
import { getWeeklyWorkhour } from '../../lib/workhour';

interface DDayEvent {
  id: string;
  name: string;
  targetDate: string;
}

interface BriefingData {
  carriedCount: number;
  overdueCount: number;
  ddays: { name: string; label: string }[];
  weeklyWorkhour: number;
}

const BRIEFING_STORAGE_KEY = 'jrh-orbit-briefing-shown';

function calcDDayLabel(targetDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'D-Day';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

export function MorningBriefing() {
  const { dataDir, setView } = useAppStore();
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<BriefingData | null>(null);

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const lastShown = localStorage.getItem(BRIEFING_STORAGE_KEY);
    if (lastShown === today || !dataDir) return;

    (async () => {
      try {
        const dateKey = today;
        const currentDate = new Date();

        const [carriedItems, activeTodos, ddaysFile, weeklyMins] = await Promise.all([
          getCarriedOverItems(dataDir, currentDate),
          getActiveTodos(dataDir, dateKey),
          readJsonFile<{ events: DDayEvent[] }>(dataDir, FILES.ddays),
          getWeeklyWorkhour(dataDir, dateKey),
        ]);

        const overdueCount = activeTodos.filter(t => t.isOverdue).length;

        const events = ddaysFile?.events ?? [];
        const upcomingDdays = events
          .map(e => ({ name: e.name, label: calcDDayLabel(e.targetDate) }))
          .filter(e => !e.label.startsWith('D+') || parseInt(e.label.slice(2)) <= 7);

        setData({
          carriedCount: carriedItems.length,
          overdueCount,
          ddays: upcomingDdays.slice(0, 3),
          weeklyWorkhour: weeklyMins,
        });
        setVisible(true);
        localStorage.setItem(BRIEFING_STORAGE_KEY, today);
      } catch {
        // silently skip
      }
    })();
  }, [dataDir]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [visible]);

  const handleGoToDaily = useCallback(() => {
    setView('daily');
    setVisible(false);
  }, [setView]);

  const handleGoToReview = useCallback(() => {
    setView('statistics');
    setVisible(false);
  }, [setView]);

  if (!visible || !data) return null;

  const hasContent = data.carriedCount > 0 || data.overdueCount > 0 || data.ddays.length > 0 || data.weeklyWorkhour > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20" onClick={() => setVisible(false)}>
      <div
        className="bg-paper rounded-2xl shadow-2xl border border-border p-6 max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <div className="text-2xl mb-1">🌅</div>
          <h2 className="text-lg font-semibold text-ink">Good morning!</h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {format(new Date(), 'yyyy년 M월 d일 EEEE', { locale: ko })}
          </p>
        </div>

        {hasContent ? (
          <div className="space-y-2 mb-4">
            {data.carriedCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <span>📋</span>
                <span>이월된 업무: <span className="font-medium text-ink">{data.carriedCount}건</span></span>
              </div>
            )}
            {data.overdueCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <span>⚠️</span>
                <span>마감 초과 TODO: <span className="font-medium text-red-500">{data.overdueCount}건</span></span>
              </div>
            )}
            {data.ddays.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-ink-2">
                <span>📅</span>
                <span>{d.name} <span className="font-mono font-medium text-ink">({d.label})</span></span>
              </div>
            ))}
            {data.weeklyWorkhour > 0 && (
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <span>⏰</span>
                <span>이번 주 workhour: <span className="font-medium text-ink">{Math.floor(data.weeklyWorkhour / 60)}H {String(data.weeklyWorkhour % 60).padStart(2, '0')}m</span></span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-3 text-center mb-4">오늘 특별한 알림이 없습니다. 좋은 하루 보내세요!</p>
        )}

        <div className="flex gap-2 justify-center flex-wrap">
          <button
            onClick={handleGoToDaily}
            className="px-4 py-1.5 text-sm rounded-lg bg-chrome text-paper font-medium hover:opacity-90 transition-opacity"
          >
            오늘의 할 일 보기
          </button>
          <button
            onClick={handleGoToReview}
            className="px-4 py-1.5 text-sm rounded-lg bg-pastel-lavender text-ink font-medium hover:opacity-90 transition-opacity"
          >
            AI Report 열기
          </button>
          <button
            onClick={() => setVisible(false)}
            className="px-4 py-1.5 text-sm rounded-lg text-ink-3 hover:bg-paper-soft transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
