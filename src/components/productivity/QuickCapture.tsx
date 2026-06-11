import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { useAppStore } from '../../stores/useAppStore';
import { writeNote, listNotes } from '../../lib/fileSystem';
import { buildFrontmatter } from '../../lib/frontmatter';
import { updateNoteLinks } from '../../lib/linkGraph';
import { insertNoteToDailyLog } from '../../lib/dailyLogHelper';
import { FOLDERS } from '../../lib/constants';

export function QuickCapture() {
  const { dataDir } = useAppStore();
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const lastEnterRef = useRef(0);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    function handler(e: KeyboardEvent) {
      const mod = mac ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setVisible(v => !v);
      }
      if (e.key === 'Escape' && visible) {
        setVisible(false);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setBody('');
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [visible]);

  const handleSave = useCallback(async () => {
    if (!dataDir || !title.trim() || saving) return;
    setSaving(true);

    try {
      const now = new Date();
      const dateStr = format(now, 'yyyy-MM-dd');
      const iso = now.toISOString();

      const files = await listNotes(dataDir, FOLDERS.research);
      const todayMemos = files.filter(f => f.includes(`${dateStr}-memo-`));
      const seq = String(todayMemos.length + 1).padStart(3, '0');
      const noteId = `${dateStr}-memo-${seq}`;

      const dailyId = `${dateStr}-daily`;
      const fm = buildFrontmatter({
        id: noteId,
        type: 'quick-memo',
        title: title.trim(),
        date: dateStr,
        project: [],
        subsystem: [],
        tags: [],
        related: [dailyId],
        status: 'draft',
        created: iso,
        updated: iso,
      });

      const content = fm + `\n${body.trim()}\n`;
      const filePath = `${FOLDERS.research}/${noteId}.md`;
      await writeNote(dataDir, filePath, content);
      updateNoteLinks(dataDir, noteId, [dailyId]).catch(() => {});
      insertNoteToDailyLog(dataDir, noteId, title.trim(), 'quick-memo', '').catch(() => {});

      setVisible(false);
    } catch {}
    setSaving(false);
  }, [dataDir, title, body, saving]);

  const handleBodyKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const now = Date.now();
      if (now - lastEnterRef.current < 500) {
        e.preventDefault();
        handleSave();
        return;
      }
      lastEnterRef.current = now;
    }
  }, [handleSave]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-24 bg-black/20" onClick={() => setVisible(false)}>
      <div
        className="bg-paper rounded-xl shadow-2xl border border-border w-full max-w-md mx-4 animate-in fade-in slide-in-from-top-4 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 border-b border-border">
          <div className="text-[10px] uppercase tracking-wider text-ink-3 mb-1">Quick Capture</div>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title..."
            className="w-full text-sm text-ink bg-transparent outline-none placeholder:text-ink-3"
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.nextElementSibling?.querySelector('textarea')?.focus(); }}
          />
        </div>
        <div className="p-4">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={handleBodyKeyDown}
            placeholder="Write your memo... (Enter x2 to save)"
            rows={4}
            className="w-full text-sm text-ink bg-transparent outline-none resize-none placeholder:text-ink-3"
          />
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-border">
          <span className="text-[10px] text-ink-3">Cmd+Shift+N to toggle</span>
          <div className="flex gap-2">
            <button
              onClick={() => setVisible(false)}
              className="px-3 py-1 text-xs text-ink-3 rounded-md hover:bg-paper-soft transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!title.trim() || saving}
              className="px-3 py-1 text-xs rounded-md bg-chrome text-paper font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
