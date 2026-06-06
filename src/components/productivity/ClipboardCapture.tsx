import { useState, useEffect, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { useAppStore } from '../../stores/useAppStore';
import { writeNote, listNotes } from '../../lib/fileSystem';
import { buildFrontmatter } from '../../lib/frontmatter';
import { updateNoteLinks } from '../../lib/linkGraph';
import { FOLDERS } from '../../lib/constants';

const URL_RE = /^https?:\/\/\S+$/i;
const LONG_TEXT_THRESHOLD = 100;
const TOAST_DURATION = 3000;

type CaptureType = 'url' | 'long-text';

interface ToastState {
  type: CaptureType;
  text: string;
}

export function ClipboardCapture() {
  const { dataDir } = useAppStore();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToast = useCallback(() => {
    setToast(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showToast = useCallback(
    (state: ToastState) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast(state);
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, TOAST_DURATION);
    },
    [],
  );

  useEffect(() => {
    function handler(e: ClipboardEvent) {
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;

      // Don't intercept if the user is pasting into an input/textarea/contenteditable
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }

      if (URL_RE.test(text)) {
        showToast({ type: 'url', text });
      } else if (text.length >= LONG_TEXT_THRESHOLD) {
        showToast({ type: 'long-text', text });
      }
    }

    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [showToast]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (!dataDir || !toast || saving) return;
    setSaving(true);

    try {
      const now = new Date();
      const dateStr = format(now, 'yyyy-MM-dd');
      const iso = now.toISOString();
      const files = await listNotes(dataDir, FOLDERS.research);

      if (toast.type === 'url') {
        const todayStudy = files.filter((f) => f.includes(`${dateStr}-study-`));
        const seq = String(todayStudy.length + 1).padStart(3, '0');
        const noteId = `${dateStr}-study-${seq}`;

        let domain = '';
        try {
          domain = new URL(toast.text).hostname;
        } catch {
          domain = toast.text;
        }

        const dailyId = `${dateStr}-daily`;
        const fm = buildFrontmatter({
          id: noteId,
          type: 'study-note',
          title: `Study: ${domain}`,
          date: dateStr,
          project: [],
          subsystem: [],
          tags: [],
          related: [dailyId],
          status: 'draft',
          created: iso,
          updated: iso,
        });

        const content =
          fm +
          `## 출처\n\n${toast.text}\n\n` +
          `## 핵심 내용\n\n\n\n` +
          `## 내 프로젝트 적용 가능성\n\n\n`;

        const filePath = `${FOLDERS.research}/${noteId}.md`;
        await writeNote(dataDir, filePath, content);
        updateNoteLinks(dataDir, noteId, [dailyId]).catch(() => {});
      } else {
        const todayMemos = files.filter((f) => f.includes(`${dateStr}-memo-`));
        const seq = String(todayMemos.length + 1).padStart(3, '0');
        const noteId = `${dateStr}-memo-${seq}`;

        const preview = toast.text.slice(0, 50).replace(/\n/g, ' ');
        const dailyId2 = `${dateStr}-daily`;
        const fm = buildFrontmatter({
          id: noteId,
          type: 'quick-memo',
          title: preview,
          date: dateStr,
          project: [],
          subsystem: [],
          tags: [],
          related: [dailyId2],
          status: 'draft',
          created: iso,
          updated: iso,
        });

        const content = fm + `\n${toast.text}\n`;
        const filePath = `${FOLDERS.research}/${noteId}.md`;
        await writeNote(dataDir, filePath, content);
        updateNoteLinks(dataDir, noteId, [dailyId2]).catch(() => {});
      }

      clearToast();
    } catch {
      // silently fail
    }
    setSaving(false);
  }, [dataDir, toast, saving, clearToast]);

  if (!toast) return null;

  const label =
    toast.type === 'url' ? 'Study Note로 저장?' : 'Quick Memo로 저장?';

  return (
    <div
      className="fixed bottom-6 right-6 z-[120] cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-200"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border border-border bg-paper text-ink text-sm select-none hover:bg-paper-soft transition-colors">
        <span className="text-ink-2 text-xs">📋</span>
        <span>{label}</span>
        {saving && (
          <span className="text-ink-3 text-xs ml-1">저장 중...</span>
        )}
      </div>
    </div>
  );
}
