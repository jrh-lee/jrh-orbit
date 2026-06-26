import { useState, useEffect, useCallback, useRef } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { NoteEditor } from '../editor/NoteEditor';
import { useAppStore } from '../../stores/useAppStore';
import { splitFrontmatter, joinFrontmatter, updateFrontmatterField, parseFrontmatterFields, buildFrontmatter } from '../../lib/frontmatter';
import { readJsonFile } from '../../lib/fileSystem';
import { FOLDERS, FILES } from '../../lib/constants';
import { NOTE_TYPE_ICONS } from '../../types/note';
import type { NoteType } from '../../types/note';
import type { TodosFile } from '../../types/task';
import type { ProjectsFile } from '../../types/project';
import {
  getCarriedOverItems,
  getActiveTodos,
  getExistingNotesForDate,
  buildDailyLogBody,
  buildCarriedOverMeta,
  incrementCarryCount,
  generateDailyLogSummary,
  detectNewlyCheckedTodos,
  detectNewlyUncheckedTodos,
  completeTodo,
  reopenTodo,
  detectNewCheckboxItems,
  detectProjectForItem,
  registerNewTodo,
  detectTodoTitleChanges,
  updateTodoTitle,
  syncDailyWithTodos,
  resolveProjectIdsInBody,
  deduplicateDailyLogBody,
  compactTaskSections,
} from '../../lib/dailyLogHelper';

function makeFrontmatter(date: Date, carriedOver: { from: string; items: string[] }[] = []): string {
  const iso = date.toISOString();
  const dateStr = format(date, 'yyyy-MM-dd');
  const title = format(date, 'yyyy-MM-dd (EEEE)', { locale: ko });
  return buildFrontmatter({
    id: `${dateStr}-daily`,
    type: 'daily-log',
    title,
    date: dateStr,
    project: [],
    subsystem: [],
    tags: [],
    related: [],
    status: 'in-progress',
    workhour: 0,
    workhour_detail: [],
    summary: '',
    carried_over: carriedOver,
    created: iso,
    updated: iso,
  });
}

interface LinkedNote {
  path: string;
  title: string;
  noteType?: string;
}


export function DailyLog() {
  const { dataDir, openNote } = useAppStore();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [linkedNotes, setLinkedNotes] = useState<LinkedNote[]>([]);
  const [taskNotes, setTaskNotes] = useState<{ taskTitle: string; noteTitle: string; notePath: string }[]>([]);
  const [summary, setSummary] = useState('');
  const fmRef = useRef('');
  const prevBodyRef = useRef('');
  const lastWriteTime = useRef(0);
  const reloadingRef = useRef(false);
  const newItemTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectionBaseRef = useRef('');
  const inflightRef = useRef<Map<string, string>>(new Map());

  const dateKey = format(currentDate, 'yyyy-MM-dd');

  useEffect(() => {
    if (!dataDir) return;
    setLoaded(false);

    (async () => {
      try {
        const synced = await syncDailyWithTodos(dataDir, dateKey);
        const fullPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
        const raw = await invoke<string>('read_note', { path: fullPath });
        const { frontmatter, body: b } = splitFrontmatter(raw);
        fmRef.current = frontmatter;

        let resolvedBody = synced ?? b;
        let needsWrite = false;

        const projectsFile = await readJsonFile<ProjectsFile>(dataDir, FILES.projects).catch(() => null);
        const projectMap = new Map<string, string>();
        if (projectsFile?.projects) {
          for (const p of projectsFile.projects) projectMap.set(p.id, p.name);
        }
        const resolved = resolveProjectIdsInBody(resolvedBody, projectMap);
        if (resolved.changed) { resolvedBody = resolved.body; needsWrite = true; }

        const deduped = deduplicateDailyLogBody(resolvedBody);
        if (deduped.changed) { resolvedBody = deduped.body; needsWrite = true; }
        const compacted = compactTaskSections(resolvedBody);
        if (compacted.changed) { resolvedBody = compacted.body; needsWrite = true; }

        if (needsWrite) {
          await invoke('write_note', { path: fullPath, content: joinFrontmatter(frontmatter, resolvedBody) }).catch(() => {});
        }

        prevBodyRef.current = resolvedBody;
        detectionBaseRef.current = resolvedBody;
        inflightRef.current.clear();
        setBody(resolvedBody);
        const fields = parseFrontmatterFields(frontmatter);
        setSummary(fields.summary ?? '');
        setLoaded(true);
      } catch {
        const projectsFile = await readJsonFile<ProjectsFile>(dataDir, FILES.projects).catch(() => null);
        const projectMap = new Map<string, string>();
        if (projectsFile?.projects) {
          for (const p of projectsFile.projects) projectMap.set(p.id, p.name);
        }

        const [carriedItems, activeTodos, existingNotes] = await Promise.all([
          getCarriedOverItems(dataDir, currentDate),
          getActiveTodos(dataDir, dateKey, projectMap),
          getExistingNotesForDate(dataDir, dateKey),
        ]);

        for (const item of carriedItems) {
          if (item.todoId) {
            try {
              item.carryCount = await incrementCarryCount(dataDir, item.todoId);
            } catch {}
          }
        }

        // Update previous day's summary if empty
        const prevKey = format(subDays(currentDate, 1), 'yyyy-MM-dd');
        try {
          const prevPath = await join(dataDir, FOLDERS.daily, `${prevKey}.md`);
          const prevRaw = await invoke<string>('read_note', { path: prevPath });
          const { frontmatter: prevFm, body: prevBody } = splitFrontmatter(prevRaw);
          const prevFields = parseFrontmatterFields(prevFm);
          if (!prevFields.summary) {
            const prevSummary = generateDailyLogSummary(prevBody);
            if (prevSummary) {
              const updatedFm = updateFrontmatterField(prevFm, 'summary', `"${prevSummary.replace(/"/g, '\\"')}"`);
              await invoke('write_note', { path: prevPath, content: joinFrontmatter(updatedFm, prevBody) });
            }
          }
        } catch {}

        const carriedOverMeta = buildCarriedOverMeta(carriedItems, prevKey);
        const fm = makeFrontmatter(currentDate, carriedOverMeta);
        const b = buildDailyLogBody(carriedItems, activeTodos, dateKey, existingNotes, projectMap);
        fmRef.current = fm;
        prevBodyRef.current = b;
        detectionBaseRef.current = b;
        inflightRef.current.clear();
        setBody(b);
        setSummary('');
        setLoaded(true);
        try {
          await invoke('ensure_dir', { path: await join(dataDir, FOLDERS.daily) });
          const fullPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
          await invoke('write_note', { path: fullPath, content: fm + b });
        } catch {}
      }
    })();
  }, [dataDir, dateKey, currentDate]);

  useEffect(() => {
    return () => {
      if (newItemTimerRef.current) clearTimeout(newItemTimerRef.current);
    };
  }, []);

  const [linkedRefresh, setLinkedRefresh] = useState(0);

  useEffect(() => {
    const handler = () => setLinkedRefresh(k => k + 1);
    window.addEventListener('notes-changed', handler);
    return () => window.removeEventListener('notes-changed', handler);
  }, []);

  useEffect(() => {
    if (!dataDir) return;
    (async () => {
      try {
        const dir = await join(dataDir, FOLDERS.research);
        const files = await invoke<string[]>('list_notes', { dir });
        const matched: LinkedNote[] = [];
        for (const f of files) {
          try {
            const raw = await invoke<string>('read_note', { path: f });
            const { frontmatter } = splitFrontmatter(raw);
            const fields = parseFrontmatterFields(frontmatter);
            const noteDate = fields.date ?? (fields.created ?? '').slice(0, 10);
            const updatedDate = (fields.updated ?? '').slice(0, 10);
            if (noteDate === dateKey || updatedDate === dateKey) {
              matched.push({
                path: f,
                title: fields.title ?? f.split(/[/\\]/).pop()?.replace('.md', '') ?? '',
                noteType: fields.type ?? 'analysis-note',
              });
            }
          } catch {}
        }
        setLinkedNotes(matched);
      } catch {
        setLinkedNotes([]);
      }
    })();
  }, [dataDir, dateKey, linkedRefresh]);

  // Load task-linked notes
  useEffect(() => {
    if (!dataDir) return;
    (async () => {
      try {
        const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
        if (!todosFile?.todos) { setTaskNotes([]); return; }
        const activeTasks = todosFile.todos.filter(t => t.status !== 'done' && t.related_notes?.length);
        const results: { taskTitle: string; noteTitle: string; notePath: string }[] = [];
        for (const task of activeTasks) {
          for (const noteId of task.related_notes!) {
            try {
              const notePath = await join(dataDir, FOLDERS.research, `${noteId}.md`);
              const raw = await invoke<string>('read_note', { path: notePath });
              const { frontmatter } = splitFrontmatter(raw);
              const fields = parseFrontmatterFields(frontmatter);
              results.push({ taskTitle: task.title, noteTitle: fields.title ?? noteId, notePath });
            } catch {}
          }
        }
        setTaskNotes(results);
      } catch { setTaskNotes([]); }
    })();
  }, [dataDir, dateKey, linkedRefresh]);

  const handleChange = useCallback(
    (md: string) => {
      const prev = prevBodyRef.current;
      const prevLen = prev.replace(/\s/g, '').length;
      const newLen = md.replace(/\s/g, '').length;
      if (newLen === 0 && prevLen > 30) {
        return;
      }
      setBody(md);
      prevBodyRef.current = md;
      if (!dataDir) return;
      lastWriteTime.current = Date.now();
      fmRef.current = updateFrontmatterField(fmRef.current, 'updated', new Date().toISOString());

      // Auto-summary: update on any daily log edit (including clearing when all unchecked)
      const newSummary = generateDailyLogSummary(md);
      if (newSummary) {
        fmRef.current = updateFrontmatterField(fmRef.current, 'summary', `"${newSummary.replace(/"/g, '\\"')}"`);
      } else {
        fmRef.current = updateFrontmatterField(fmRef.current, 'summary', '""');
      }
      setSummary(newSummary);

      // Sync todo changes to todos.json — serialize to avoid race conditions
      (async () => {
        const newlyChecked = detectNewlyCheckedTodos(prev, md);
        for (const todoId of newlyChecked) {
          await completeTodo(dataDir, todoId).catch(() => {});
        }
        const newlyUnchecked = detectNewlyUncheckedTodos(prev, md);
        for (const todoId of newlyUnchecked) {
          await reopenTodo(dataDir, todoId).catch(() => {});
        }
        const titleChanges = detectTodoTitleChanges(prev, md);
        for (const { id, title } of titleChanges) {
          await updateTodoTitle(dataDir, id, title).catch(() => {});
        }
      })();

      if (reloadingRef.current) {
        reloadingRef.current = false;
        return;
      }

      // Check if any in-flight registered item's text was changed by the user.
      // If so, update the existing task title instead of creating a new one.
      for (const [origText, taskId] of inflightRef.current.entries()) {
        if (!taskId) continue;
        if (md.includes(`- [ ] [${taskId}] ${origText}`)) continue;
        const idPattern = `- [ ] [${taskId}] `;
        for (const line of md.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith(idPattern)) {
            const newTitle = trimmed.slice(idPattern.length).replace(/\s*\((?:⚠️\s*)?D[+-]?\d+\)$/, '').trim();
            if (newTitle && newTitle !== origText) {
              inflightRef.current.set(newTitle, taskId);
              inflightRef.current.delete(origText);
              updateTodoTitle(dataDir, taskId, newTitle).catch(() => {});
            }
            break;
          }
        }
      }

      // Debounced new checkbox detection — wait for typing to settle
      if (newItemTimerRef.current) clearTimeout(newItemTimerRef.current);
      newItemTimerRef.current = setTimeout(() => {
        newItemTimerRef.current = null;
        const currentBody = prevBodyRef.current;
        const base = detectionBaseRef.current;
        const newItems = detectNewCheckboxItems(base, currentBody);
        detectionBaseRef.current = currentBody;

        // Match new items against pending in-flight items whose text changed.
        // If an in-flight item (taskId='', registration pending) disappeared from
        // the body, it was likely edited — pair it with the new item instead of
        // creating a duplicate task.
        const vanishedPending: string[] = [];
        for (const [txt, id] of inflightRef.current.entries()) {
          if (id) continue;
          if (!currentBody.includes(`- [ ] ${txt}`)) vanishedPending.push(txt);
        }

        for (const text of newItems) {
          if (inflightRef.current.has(text)) continue;

          if (vanishedPending.length > 0) {
            const oldText = vanishedPending.shift()!;
            inflightRef.current.delete(oldText);
            inflightRef.current.set(text, '');
            continue;
          }

          inflightRef.current.set(text, '');
          const project = detectProjectForItem(currentBody, text);
          registerNewTodo(dataDir, text, project).then((taskId) => {
            // By now the user may have edited the text further.
            // Find the latest text associated with this registration cycle.
            let finalText = text;
            for (const [t, id] of inflightRef.current.entries()) {
              if (id === '' && t !== text && !currentBody.includes(`- [ ] ${text}`)) {
                finalText = t;
                break;
              }
            }

            inflightRef.current.set(finalText, taskId);
            if (finalText !== text) {
              inflightRef.current.delete(text);
              updateTodoTitle(dataDir, taskId, finalText).catch(() => {});
            }

            setBody((current) => {
              const marker = `- [ ] ${finalText}`;
              if (!current.includes(marker)) {
                inflightRef.current.delete(finalText);
                return current;
              }
              const updated = current.replace(marker, `- [ ] [${taskId}] ${finalText}`);
              prevBodyRef.current = updated;
              detectionBaseRef.current = updated;
              fmRef.current = updateFrontmatterField(fmRef.current, 'updated', new Date().toISOString());
              (async () => {
                try {
                  const fullPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
                  await invoke('write_note', { path: fullPath, content: joinFrontmatter(fmRef.current, updated) });
                } catch {}
              })();
              return updated;
            });
          }).catch(() => {
            inflightRef.current.delete(text);
          });
        }
      }, 3000);

      (async () => {
        try {
          const fullPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
          await invoke('write_note', { path: fullPath, content: joinFrontmatter(fmRef.current, md) });
        } catch {}
      })();
    },
    [dataDir, dateKey],
  );

  const reloadDaily = useCallback(async () => {
    if (!dataDir) return;
    try {
      const fullPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
      const raw = await invoke<string>('read_note', { path: fullPath });
      const { frontmatter, body: b } = splitFrontmatter(raw);
      fmRef.current = frontmatter;
      prevBodyRef.current = b;
      detectionBaseRef.current = b;
      inflightRef.current.clear();
      reloadingRef.current = true;
      setBody(b);
      setConflict(false);
    } catch {}
  }, [dataDir, dateKey]);

  useEffect(() => {
    const handler = () => {
      if (Date.now() - lastWriteTime.current > 2000) {
        setConflict(true);
      }
    };
    window.addEventListener('notes-changed', handler);
    return () => window.removeEventListener('notes-changed', handler);
  }, []);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const handler = () => {
      clearTimeout(retryTimer);
      if (Date.now() - lastWriteTime.current > 1000) {
        reloadDaily();
      } else {
        retryTimer = setTimeout(() => reloadDaily(), 1200);
      }
    };
    window.addEventListener('daily-log-updated', handler);
    return () => {
      window.removeEventListener('daily-log-updated', handler);
      clearTimeout(retryTimer);
    };
  }, [reloadDaily]);

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-paper shrink-0">
        <button
          onClick={() => setCurrentDate((d) => subDays(d, 1))}
          className="p-1.5 rounded-lg hover:bg-paper-soft text-ink-2 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div className="text-center">
          <button
            onClick={() => setCurrentDate(new Date())}
            className="text-base font-semibold text-ink hover:text-chrome transition-colors"
          >
            {format(currentDate, 'yyyy년 M월 d일', { locale: ko })}
          </button>
          <div className="text-xs text-ink-3">
            {format(currentDate, 'EEEE', { locale: ko })}
          </div>
        </div>

        <button
          onClick={() => setCurrentDate((d) => addDays(d, 1))}
          className="p-1.5 rounded-lg hover:bg-paper-soft text-ink-2 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {summary && (
        <div className="px-4 py-1.5 border-b border-border/50 bg-pastel-mint/20 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-ink-3 uppercase tracking-wider shrink-0">Summary</span>
            <span className="text-xs text-ink-2 truncate">{summary}</span>
          </div>
        </div>
      )}
      {linkedNotes.length > 0 && (
        <div className="px-4 py-1.5 border-b border-border/50 bg-paper-soft shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-ink-3 uppercase tracking-wider shrink-0">Edited today</span>
            {linkedNotes.map(n => (
              <button
                key={n.path}
                onClick={() => openNote(n.path)}
                className="px-2 py-0.5 text-[10px] rounded-full bg-pastel-blue/30 text-tag-text hover:opacity-70 transition-opacity truncate max-w-[160px]"
              >
                {NOTE_TYPE_ICONS[n.noteType as NoteType] ?? '📝'} {n.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {taskNotes.length > 0 && (
        <div className="px-4 py-1.5 border-b border-border/50 bg-pastel-lavender/10 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-ink-3 uppercase tracking-wider shrink-0">Task Notes</span>
            {taskNotes.map((tn, i) => (
              <button
                key={i}
                onClick={() => openNote(tn.notePath)}
                className="px-2 py-0.5 text-[10px] rounded-full bg-pastel-lavender/30 text-tag-text hover:opacity-70 transition-opacity truncate max-w-[200px]"
                title={`${tn.taskTitle} → ${tn.noteTitle}`}
              >
                {tn.noteTitle}
              </button>
            ))}
          </div>
        </div>
      )}
      {conflict && (
        <div className="px-4 py-1.5 bg-pastel-cream/50 border-b border-pastel-cream flex items-center justify-between shrink-0">
          <span className="text-xs text-ink-2">This daily log was modified externally.</span>
          <div className="flex gap-1.5">
            <button
              onClick={reloadDaily}
              className="px-2 py-0.5 text-[10px] rounded bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
            >
              Reload
            </button>
            <button
              onClick={() => setConflict(false)}
              className="px-2 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-muted/50 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {loaded && (
        <div className="daily-log-editor flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
          <NoteEditor
            key={dateKey}
            content={body}
            onChange={handleChange}
            placeholder="Write today's log..."
          />
        </div>
      )}
    </div>
  );
}
