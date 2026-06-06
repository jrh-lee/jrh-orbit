import { useState, useEffect, useCallback } from 'react';
import { useTimerStore } from '../../stores/useTimerStore';
import { useAppStore } from '../../stores/useAppStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { MusicPlayer } from '../productivity/MusicPlayer';
import { ManualWorkhour } from '../productivity/ManualWorkhour';
import { loadDailyWorkhour } from '../../lib/workhour';
import { format } from 'date-fns';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ZoomBadge() {
  const zoom = useConfigStore((s) => s.window.zoom_level);
  if (zoom === 100) return null;
  return (
    <span
      className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-paper-muted text-ink-2 cursor-pointer hover:text-ink"
      onClick={() => {
        useConfigStore.getState().setWindow({ zoom_level: 100 });
      }}
      title="Click to reset zoom (⌘0)"
    >
      {zoom}%
    </span>
  );
}

export function StatusBar() {
  const { phase, status, remaining, completedPomodoros } = useTimerStore();
  const { dataDir, activeProject } = useAppStore();
  const [todayMinutes, setTodayMinutes] = useState(0);
  const [projectMinutes, setProjectMinutes] = useState<{ project: string; mins: number }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshWorkhour = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    window.addEventListener('workhour-manual-added', refreshWorkhour);
    window.addEventListener('workhours-changed', refreshWorkhour);
    return () => {
      window.removeEventListener('workhour-manual-added', refreshWorkhour);
      window.removeEventListener('workhours-changed', refreshWorkhour);
    };
  }, [refreshWorkhour]);

  useEffect(() => {
    if (!dataDir) return;
    const dateKey = format(new Date(), 'yyyy-MM-dd');
    loadDailyWorkhour(dataDir, dateKey).then(d => {
      setTodayMinutes(d.total_minutes);
      const map = new Map<string, number>();
      for (const s of d.sessions) {
        const p = s.project || 'GENERAL';
        map.set(p, (map.get(p) ?? 0) + s.durationMinutes);
      }
      setProjectMinutes(
        [...map.entries()]
          .map(([project, mins]) => ({ project, mins: Math.max(0, mins) }))
          .filter(e => e.mins > 0)
          .sort((a, b) => b.mins - a.mins)
      );
    }).catch(() => {});
  }, [dataDir, completedPomodoros, refreshKey]);

  const formatHM = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}H ${String(m).padStart(2, '0')}m`;
  };

  return (
    <div className="h-6 shrink-0 px-3 flex items-center justify-between text-xs text-ink-3 bg-paper border-t border-border">
      <div className="flex items-center gap-3">
        {status !== 'idle' && (
          <span className="flex items-center gap-1.5">
            <span
              className={
                phase === 'work'
                  ? 'w-1.5 h-1.5 rounded-full bg-pastel-pink animate-pulse'
                  : 'w-1.5 h-1.5 rounded-full bg-pastel-mint'
              }
            />
            {formatTime(remaining)}
          </span>
        )}
        {completedPomodoros > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400/80" />
            <span className="text-ink-3">x {completedPomodoros}</span>
          </span>
        )}
        {activeProject && (
          <span className="text-ink-3 truncate max-w-[100px]">{activeProject}</span>
        )}
        {todayMinutes > 0 && (
          <span className="text-ink-3 flex items-center gap-1.5">
            <span>{formatHM(todayMinutes)}</span>
            {projectMinutes.length > 0 && (
              <span className="text-ink-3/60">
                ({projectMinutes.map(p => `${p.project} ${formatHM(p.mins)}`).join(', ')})
              </span>
            )}
          </span>
        )}
        <ManualWorkhour />
      </div>
      <div className="flex items-center gap-3">
        <ZoomBadge />
        <MusicPlayer />
        <span>{new Date().toLocaleDateString('ko-KR', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}
