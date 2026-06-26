import { useState, useCallback, useEffect } from 'react';
import { useWorkhourTimerStore, ensureWorkhourInterval } from '../../stores/useWorkhourTimerStore';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}H ${String(m).padStart(2, '0')}m`;
}

export function WorkhourTimer() {
  const { elapsed, running, start, pause, reset, addMinutes, subtractMinutes } = useWorkhourTimerStore();
  const [showControls, setShowControls] = useState(false);

  const handleToggle = useCallback(() => {
    if (running) pause();
    else start();
  }, [running, start, pause]);

  const handleReset = useCallback(() => {
    if (confirm('근무시간을 초기화하시겠습니까?')) reset();
  }, [reset]);

  useEffect(() => {
    ensureWorkhourInterval();
  }, [running]);

  return (
    <div className="px-2.5 py-2 border-t border-border">
      <div className="flex items-center gap-1.5">
        {/* Play/Pause */}
        <button
          onClick={handleToggle}
          className="w-5 h-5 flex items-center justify-center text-ink-2 hover:text-ink transition-colors rounded"
          title={running ? 'Pause' : 'Start'}
        >
          {running ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="3" height="8" rx="0.5" />
              <rect x="6" y="1" width="3" height="8" rx="0.5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1l7 4-7 4V1z" />
            </svg>
          )}
        </button>

        {/* Time display */}
        <button
          onClick={() => setShowControls(p => !p)}
          className="flex-1 text-left text-[12px] font-mono text-ink-2 hover:text-ink transition-colors tabular-nums"
          title="Click for controls"
        >
          <span className={running ? 'text-chrome font-medium' : ''}>
            {formatTime(elapsed)}
          </span>
        </button>

        {/* Reset */}
        <button
          onClick={handleReset}
          className="w-4 h-4 flex items-center justify-center text-ink-3 hover:text-ink-2 transition-colors rounded"
          title="Reset"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Expandable controls */}
      {showControls && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          <button
            onClick={() => subtractMinutes(60)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            −1h
          </button>
          <button
            onClick={() => subtractMinutes(30)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            −30m
          </button>
          <button
            onClick={() => subtractMinutes(10)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            −10m
          </button>
          <button
            onClick={() => subtractMinutes(5)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            −5m
          </button>
          <button
            onClick={() => addMinutes(5)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            +5m
          </button>
          <button
            onClick={() => addMinutes(10)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            +10m
          </button>
          <button
            onClick={() => addMinutes(30)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            +30m
          </button>
          <button
            onClick={() => addMinutes(60)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50 transition-colors"
          >
            +1h
          </button>
        </div>
      )}
    </div>
  );
}
