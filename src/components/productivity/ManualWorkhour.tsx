import { useState, useRef, useEffect, useCallback } from 'react';
import { addWorkhourSession, loadDailyWorkhour } from '../../lib/workhour';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useWorkhourTimerStore } from '../../stores/useWorkhourTimerStore';
import { Dropdown } from '../ui/Dropdown';
import type { WorkhourSession } from '../../types/dataFiles';

export function ManualWorkhour() {
  const { dataDir } = useAppStore();
  const { projects } = useProjectStore();
  const workhourTimer = useWorkhourTimerStore();
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState('');
  const [mode, setMode] = useState<'add' | 'timer'>('timer');

  // Manual add state
  const [durationStr, setDurationStr] = useState('25');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Project timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && projects.length > 0 && !project) {
      setProject(projects[0].name);
    }
  }, [open, projects, project]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Project timer tick
  useEffect(() => {
    if (timerRunning && timerStart) {
      timerRef.current = setInterval(() => {
        setTimerElapsed(Math.floor((Date.now() - timerStart) / 1000));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning, timerStart]);

  const handleStartTimer = useCallback(() => {
    const now = Date.now();
    setTimerStart(now);
    setTimerElapsed(0);
    setTimerRunning(true);
    // Also start the sidebar workhour timer if not running
    if (!workhourTimer.running) {
      workhourTimer.start();
    }
  }, [workhourTimer]);

  const handleStopTimer = useCallback(async () => {
    if (!dataDir || !timerStart) return;
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);

    const durationMinutes = Math.max(1, Math.round((Date.now() - timerStart) / 60000));
    const session: WorkhourSession = {
      project: project || 'GENERAL',
      startedAt: new Date(timerStart).toISOString(),
      endedAt: new Date().toISOString(),
      durationMinutes,
      source: 'manual-timer',
    };
    await addWorkhourSession(dataDir, session).catch(() => {});
    window.dispatchEvent(new CustomEvent('workhour-manual-added'));

    setTimerStart(null);
    setTimerElapsed(0);
    setOpen(false);
  }, [dataDir, project, timerStart]);

  const saveWorkhour = async (mins: number) => {
    if (!dataDir || saving) return;
    setSaving(true);
    try {
      let actualMins = mins;
      if (mins < 0) {
        const daily = await loadDailyWorkhour(dataDir);
        const proj = project || 'GENERAL';
        const projectTotal = daily.sessions
          .filter(s => (s.project || 'GENERAL') === proj)
          .reduce((sum, s) => sum + s.durationMinutes, 0);
        const maxSubtract = Math.max(0, projectTotal);
        actualMins = -Math.min(Math.abs(mins), maxSubtract);
        if (actualMins === 0) { setSaving(false); return; }
      }
      const now = new Date();
      const session: WorkhourSession = {
        project: project || 'GENERAL',
        startedAt: now.toISOString(),
        durationMinutes: actualMins,
        source: 'manual',
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      await addWorkhourSession(dataDir, session);
      if (actualMins > 0) workhourTimer.addMinutes(actualMins);
      else workhourTimer.subtractMinutes(Math.abs(actualMins));
      window.dispatchEvent(new CustomEvent('workhour-manual-added'));
      setOpen(false);
      setDurationStr('25');
      setNote('');
    } catch (err) {
      console.error('Failed to save workhour:', err);
    } finally {
      setSaving(false);
    }
  };

  const duration = parseInt(durationStr) || 0;
  const handleManualSave = () => { if (duration > 0) saveWorkhour(duration); };
  const handleManualSubtract = () => { if (duration > 0) saveWorkhour(-duration); };

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const projectOptions = [
    ...projects.map((p) => ({ value: p.name, label: p.name, color: p.color })),
    { value: 'GENERAL', label: 'GENERAL' },
  ];

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-4 h-4 flex items-center justify-center rounded text-[10px] leading-none transition-colors ${
          timerRunning ? 'text-chrome animate-pulse' : 'text-ink-3 hover:text-ink hover:bg-paper-soft'
        }`}
        title={timerRunning ? `${project}: ${formatElapsed(timerElapsed)}` : 'Add work time'}
      >
        {timerRunning ? '●' : '+'}
      </button>

      {open && (
        <div className="absolute bottom-6 left-0 w-60 bg-paper border border-border rounded-lg shadow-lg p-2.5 z-50">
          {/* Mode toggle */}
          <div className="flex gap-1 mb-2">
            <button
              onClick={() => setMode('timer')}
              className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                mode === 'timer' ? 'bg-chrome/20 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'
              }`}
            >
              Start Timer
            </button>
            <button
              onClick={() => setMode('add')}
              className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                mode === 'add' ? 'bg-chrome/20 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'
              }`}
            >
              Add Time
            </button>
          </div>

          {/* Project selector (shared) */}
          <label className="block mb-1.5">
            <span className="text-[10px] text-ink-3">Project</span>
            <div className="mt-0.5">
              <Dropdown
                value={project}
                onChange={setProject}
                options={projectOptions}
                placeholder="Project"
                compact
                className="w-full"
              />
            </div>
          </label>

          {mode === 'timer' ? (
            /* Timer mode */
            <div>
              {timerRunning ? (
                <div className="text-center mb-2">
                  <div className="text-lg font-mono text-chrome font-bold tabular-nums">
                    {formatElapsed(timerElapsed)}
                  </div>
                  <div className="text-[10px] text-ink-3">{project || 'GENERAL'}</div>
                </div>
              ) : (
                <div className="text-center mb-2">
                  <div className="text-sm text-ink-3">프로젝트를 선택하고 시작하세요</div>
                </div>
              )}
              <button
                onClick={timerRunning ? handleStopTimer : handleStartTimer}
                className={`w-full text-xs py-1.5 rounded font-medium transition-colors ${
                  timerRunning
                    ? 'bg-red-500/20 text-red-600 hover:bg-red-500/30'
                    : 'bg-chrome/20 text-ink hover:bg-chrome/40'
                }`}
              >
                {timerRunning ? 'Stop & Save' : 'Start'}
              </button>
            </div>
          ) : (
            /* Manual add mode */
            <div>
              <label className="block mb-1.5">
                <span className="text-[10px] text-ink-3">Duration (min)</span>
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={durationStr}
                  onChange={(e) => setDurationStr(e.target.value.replace(/[^0-9]/g, ''))}
                  className="mt-0.5 w-full text-xs bg-paper-soft border border-border rounded px-1.5 py-1 text-ink focus:outline-none focus:border-chrome"
                />
              </label>

              <label className="block mb-2">
                <span className="text-[10px] text-ink-3">Note (optional)</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What did you work on?"
                  className="mt-0.5 w-full text-xs bg-paper-soft border border-border rounded px-1.5 py-1 text-ink placeholder:text-ink-3/50 focus:outline-none focus:border-chrome"
                />
              </label>

              <div className="flex gap-1.5">
                <button
                  onClick={handleManualSave}
                  disabled={saving || duration <= 0}
                  className="flex-1 text-xs py-1 rounded bg-chrome/20 text-ink font-medium hover:bg-chrome/40 disabled:opacity-40 transition-colors"
                >
                  {saving ? '...' : `+${duration}m`}
                </button>
                <button
                  onClick={handleManualSubtract}
                  disabled={saving || duration <= 0}
                  className="flex-1 text-xs py-1 rounded bg-red-500/10 text-red-600 font-medium hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                >
                  {saving ? '...' : `−${duration}m`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
