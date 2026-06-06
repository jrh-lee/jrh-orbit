import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { readJsonFile, writeJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';

interface DDayEvent {
  id: string;
  name: string;
  targetDate: string;
}

interface DDaysFile {
  events: DDayEvent[];
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function calcDDay(targetDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'D-Day';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

export function DDayCounter({ adding, setAdding }: { adding: boolean; setAdding: (v: boolean) => void }) {
  const { dataDir } = useAppStore();
  const [events, setEvents] = useState<DDayEvent[]>([]);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');

  const loadEvents = useCallback(() => {
    if (!dataDir) return;
    readJsonFile<DDaysFile>(dataDir, FILES.ddays).then(async (data) => {
      if (data?.events) { setEvents(data.events); return; }
      const legacy = await readJsonFile<{ ddays?: DDayEvent[] }>(dataDir, FILES.config);
      if (legacy?.ddays?.length) {
        setEvents(legacy.ddays);
        writeJsonFile(dataDir, FILES.ddays, { events: legacy.ddays }).catch(() => {});
      }
    });
  }, [dataDir]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const handler = () => loadEvents();
    window.addEventListener('ddays-changed', handler);
    return () => window.removeEventListener('ddays-changed', handler);
  }, [loadEvents]);

  const persist = useCallback(
    (updated: DDayEvent[]) => {
      if (!dataDir) return;
      writeJsonFile(dataDir, FILES.ddays, { events: updated }).catch(() => {});
    },
    [dataDir],
  );

  function handleAdd() {
    const name = newName.trim();
    if (!name || !newDate) return;
    const event: DDayEvent = { id: generateId(), name, targetDate: newDate };
    const updated = [...events, event];
    setEvents(updated);
    persist(updated);
    setNewName('');
    setNewDate('');
    setAdding(false);
  }

  function handleRemove(id: string) {
    const updated = events.filter((e) => e.id !== id);
    setEvents(updated);
    persist(updated);
  }

  return (
    <div className="px-2">
      {adding && (
        <div className="mb-2 space-y-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Event name..."
            autoFocus
            className="w-full px-2 py-1 text-xs rounded border border-border bg-paper-soft text-ink placeholder:text-ink-3 focus:outline-none focus:border-chrome"
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome"
          />
          <div className="flex gap-1">
            <button
              onClick={handleAdd}
              className="px-2 py-0.5 text-[10px] rounded bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => { setAdding(false); setNewName(''); setNewDate(''); }}
              className="px-2 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-muted/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-0.5">
        {events.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between py-0.5 group"
          >
            <span className="text-xs text-ink-2 truncate flex-1">{e.name}</span>
            <div className="flex items-center gap-1">
              <span
                className={`text-[10px] font-mono font-semibold ${
                  calcDDay(e.targetDate).startsWith('D+')
                    ? 'text-pastel-pink'
                    : calcDDay(e.targetDate) === 'D-Day'
                      ? 'text-pastel-mint'
                      : 'text-ink-2'
                }`}
              >
                {calcDDay(e.targetDate)}
              </span>
              <button
                onClick={() => handleRemove(e.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-red-400 transition-all"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        ))}
        {events.length === 0 && !adding && (
          <span className="text-[10px] text-ink-3">No events</span>
        )}
      </div>
    </div>
  );
}
