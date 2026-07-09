import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { getBacklinks, getForwardLinks } from '../../lib/linkGraph';
import { splitFrontmatter, parseFrontmatterFields } from '../../lib/frontmatter';
import { readJsonFile } from '../../lib/fileSystem';
import { FOLDERS, FILES } from '../../lib/constants';
import { NOTE_TYPE_ICONS } from '../../types/note';
import type { NoteType } from '../../types/note';
import type { TodosFile } from '../../types/task';
import { stripInlineMarkdown } from '../../lib/taskSync';

interface BacklinkEntry {
  id: string;
  title: string;
  noteType: string;
  path: string;
}

interface RelatedTask {
  id: string;
  title: string;
  status: string;
}

interface BacklinkPanelProps {
  noteId: string;
  onNavigate: (path: string) => void;
  visible: boolean;
  onToggle: () => void;
}

export function BacklinkPanel({ noteId, onNavigate, visible, onToggle }: BacklinkPanelProps) {
  const { dataDir } = useAppStore();
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const [forwardLinks, setForwardLinks] = useState<BacklinkEntry[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<RelatedTask[]>([]);

  useEffect(() => {
    if (!dataDir || !noteId) return;

    async function load() {
      const [bIds, fIds] = await Promise.all([
        getBacklinks(dataDir, noteId),
        getForwardLinks(dataDir, noteId),
      ]);

      const resolve = async (ids: string[]): Promise<BacklinkEntry[]> => {
        const entries: BacklinkEntry[] = [];
        for (const id of ids) {
          try {
            const isDailyId = id.endsWith('-daily');
            const folder = isDailyId ? FOLDERS.daily : FOLDERS.research;
            const filename = isDailyId ? id.replace(/-daily$/, '') + '.md' : id + '.md';
            const path = await join(dataDir, folder, filename);
            const raw = await invoke<string>('read_note', { path });
            const fields = parseFrontmatterFields(splitFrontmatter(raw).frontmatter);
            entries.push({
              id,
              title: fields.title ?? id,
              noteType: fields.type ?? 'analysis-note',
              path,
            });
          } catch {
            entries.push({ id, title: id, noteType: 'analysis-note', path: '' });
          }
        }
        return entries;
      };

      const [b, f] = await Promise.all([resolve(bIds), resolve(fIds)]);
      setBacklinks(b);
      setForwardLinks(f);

      // Find tasks that reference this note
      const todosFile = await readJsonFile<TodosFile>(dataDir!, FILES.todos);
      if (todosFile?.todos) {
        const matched = todosFile.todos.filter(t =>
          t.related_notes?.includes(noteId)
        ).map(t => ({ id: t.id, title: t.title, status: t.status }));
        setRelatedTasks(matched);
      } else {
        setRelatedTasks([]);
      }
    }

    load();

    const handler = () => load();
    window.addEventListener('links-changed', handler);
    window.addEventListener('tasks-changed', handler);
    return () => {
      window.removeEventListener('links-changed', handler);
      window.removeEventListener('tasks-changed', handler);
    };
  }, [dataDir, noteId]);

  const totalLinks = backlinks.length + forwardLinks.length + relatedTasks.length;

  if (!visible) return null;

  return (
    <div className="border-l border-border bg-paper-soft w-48">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[10px] text-ink-3 uppercase tracking-wider font-medium">
          Links {totalLinks > 0 && <span className="text-ink-2">({totalLinks})</span>}
        </span>
        <button
          onClick={onToggle}
          className="text-ink-3 hover:text-ink transition-colors"
          title="Close links panel"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="px-2 pb-2 space-y-3 overflow-y-auto max-h-full text-xs">
        {backlinks.length > 0 && (
          <div>
            <div className="text-[9px] text-ink-3 uppercase tracking-wider mb-1">Referenced by</div>
            {backlinks.map(b => (
              <button
                key={b.id}
                onClick={() => b.path && onNavigate(b.path)}
                className="w-full text-left px-1.5 py-1 rounded hover:bg-paper-muted/50 text-ink-2 truncate transition-colors block"
              >
                <span className="mr-0.5">{NOTE_TYPE_ICONS[b.noteType as NoteType] ?? '📝'}</span>
                {b.title}
              </button>
            ))}
          </div>
        )}
        {forwardLinks.length > 0 && (
          <div>
            <div className="text-[9px] text-ink-3 uppercase tracking-wider mb-1">References</div>
            {forwardLinks.map(f => (
              <button
                key={f.id}
                onClick={() => f.path && onNavigate(f.path)}
                className="w-full text-left px-1.5 py-1 rounded hover:bg-paper-muted/50 text-ink-2 truncate transition-colors block"
              >
                <span className="mr-0.5">{NOTE_TYPE_ICONS[f.noteType as NoteType] ?? '📝'}</span>
                {f.title}
              </button>
            ))}
          </div>
        )}
        {relatedTasks.length > 0 && (
          <div>
            <div className="text-[9px] text-ink-3 uppercase tracking-wider mb-1">Related Tasks</div>
            {relatedTasks.map(t => {
              const statusBg = t.status === 'done' ? 'bg-pastel-mint/30' : t.status === 'in-progress' ? 'bg-chrome/20' : 'bg-paper-muted';
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-paper-muted/50 transition-colors"
                >
                  <span className={`px-1 py-0 text-[8px] rounded font-medium shrink-0 ${statusBg}`}>{t.status}</span>
                  <span className="text-ink-2 truncate text-[10px]">{stripInlineMarkdown(t.title)}</span>
                </div>
              );
            })}
          </div>
        )}
        {totalLinks === 0 && (
          <div className="text-[10px] text-ink-3 text-center py-2">No links yet</div>
        )}
      </div>
    </div>
  );
}
