import { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { listNotesForSwitcher, type SwitcherNoteRow } from '../../lib/db';
import { NOTE_TYPE_ICONS } from '../../types/note';
import type { NoteType } from '../../types/note';
import clsx from 'clsx';

/** Ctrl+P quick switcher — jump to any note (research + daily) by title. */
export function QuickSwitcher() {
  const { openNote, openDaily } = useAppStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SwitcherNoteRow[]>([]);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOpen = () => {
      setOpen((v) => {
        if (v) return false; // Ctrl+P again closes
        setQuery('');
        setHighlight(0);
        listNotesForSwitcher().then(setRows);
        return true;
      });
    };
    window.addEventListener('quick-switcher-open', onOpen);
    return () => window.removeEventListener('quick-switcher-open', onOpen);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows
        .filter((r) => (r.title || '').toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
        .sort((a, b) => {
          const aStarts = (a.title || '').toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = (b.title || '').toLowerCase().startsWith(q) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return (b.updated || '').localeCompare(a.updated || '');
        });
    }
    return list.slice(0, 12);
  }, [rows, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('.qs-active')?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  if (!open) return null;

  const select = (row: SwitcherNoteRow) => {
    setOpen(false);
    if (row.note_type === 'daily-log') {
      const m = row.id.match(/^(\d{4}-\d{2}-\d{2})/) ?? row.path.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) {
        openDaily(m[1]);
        return;
      }
    }
    openNote(row.path);
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/25 flex items-start justify-center pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-[480px] max-w-[90vw] bg-paper border border-border rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((i) => Math.min(i + 1, filtered.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter' && filtered[highlight]) { e.preventDefault(); select(filtered[highlight]); }
          }}
          placeholder="노트 이름으로 이동... (↑↓ 이동, Enter 열기, Esc 닫기)"
          className="w-full px-4 py-3 text-sm bg-paper text-ink placeholder:text-ink-3 border-b border-border focus:outline-none"
        />
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-4 py-3 text-xs text-ink-3">일치하는 노트가 없습니다.</p>
          )}
          {filtered.map((r, i) => (
            <button
              key={r.path}
              onClick={() => select(r)}
              onMouseEnter={() => setHighlight(i)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors',
                i === highlight ? 'qs-active bg-chrome/15' : 'hover:bg-paper-soft',
              )}
            >
              <span className="text-sm shrink-0">
                {NOTE_TYPE_ICONS[r.note_type as NoteType] ?? '📝'}
              </span>
              <span className="flex-1 min-w-0 text-xs text-ink truncate">{r.title || r.id}</span>
              <span className="text-[10px] text-ink-3 shrink-0 tabular-nums">
                {r.updated?.slice(0, 10)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
