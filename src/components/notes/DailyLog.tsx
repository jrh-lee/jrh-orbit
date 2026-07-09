import { useState, useEffect, useCallback, useRef } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { NoteEditor } from '../editor/NoteEditor';
import type { Editor } from '@tiptap/react';
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
  registerNewSubtask,
  detectTodoTitleChanges,
  updateTodoTitle,
  syncDailyWithTodos,
  resolveProjectIdsInBody,
  normalizeProjectHeadings,
  deduplicateDailyLogBody,
  compactTaskSections,
  deleteTodoById,
} from '../../lib/dailyLogHelper';
import { collectTaskIds, parseTaskLine, splitSubtaskId, stripTaskMeta } from '../../lib/taskSync';

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

/** Debounce for registering newly typed checkbox items as tasks.
 *  Short enough to feel immediate; half-typed titles self-correct via the
 *  in-flight title-update loop as the user keeps typing. */
const NEW_ITEM_DEBOUNCE_MS = 1200;

interface LinkedNote {
  path: string;
  title: string;
  noteType?: string;
}


export function DailyLog() {
  const { dataDir, openNote, pendingDailyDate, clearPendingDailyDate } = useAppStore();
  const [currentDate, setCurrentDate] = useState(new Date());

  // Calendar view can request a specific date via openDaily(date)
  useEffect(() => {
    if (!pendingDailyDate) return;
    const d = new Date(pendingDailyDate + 'T00:00:00');
    if (!isNaN(d.getTime())) setCurrentDate(d);
    clearPendingDailyDate();
  }, [pendingDailyDate, clearPendingDailyDate]);
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [conflict, setConflict] = useState(false);
  // Past date whose file couldn't be read — browsing history must NEVER
  // auto-generate (= overwrite) files; the user opts in via a button.
  const [missingPast, setMissingPast] = useState(false);
  const [genNonce, setGenNonce] = useState(0);
  const forceGenerateRef = useRef<Set<string>>(new Set());
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
  const editorRef = useRef<Editor | null>(null);
  const pendingDeleteRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const detectionRunRef = useRef<(() => void) | null>(null);

  const dateKey = format(currentDate, 'yyyy-MM-dd');

  /** Inject a task ID into the editor doc via a ProseMirror transaction.
   *  Unlike setBody() this doesn't replace the content prop, so the user's
   *  cursor stays put even while they keep typing. Returns false if the
   *  matching task item can't be found (caller falls back to setBody). */
  const injectTaskIdInEditor = useCallback(function inject(itemText: string, taskId: string, attempt = 0): boolean {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return false;
    // Don't dispatch mid-IME-composition (Korean input) — the composition
    // breaks and the cursor jumps. Retry shortly instead.
    if (editor.view.composing) {
      if (attempt < 10) setTimeout(() => inject(itemText, taskId, attempt + 1), 400);
      return true; // disk write is handled separately; the doc catches up on retry
    }
    // markdown serializer escapes punctuation; doc text is unescaped
    const target = itemText.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1').trim();
    if (!target) return false;
    let insertPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (insertPos >= 0) return false;
      if (node.type.name !== 'taskItem') return true;
      const para = node.firstChild;
      if (!para || para.type.name !== 'paragraph') return true;
      const text = para.textContent.trim();
      if (text.startsWith('[')) return true; // already has an ID
      if (text === target) {
        insertPos = pos + 2; // taskItem(+1) > paragraph(+1) > text start
        return false;
      }
      return true;
    });
    if (insertPos < 0) return false;
    const tr = editor.state.tr.insertText(`[${taskId}] `, insertPos);
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
    return true;
  }, []);

  /** Prefix user-typed project headings in the 작업 section with the emoji
   *  (### KCS → ### 🛰️ KCS). Runs ONLY while the editor is unfocused (blur /
   *  load) — any doc mutation during active typing shifts the caret and
   *  breaks Korean IME composition, so we never normalize mid-edit. */
  const normalizeHeadingsInEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    if (editor.isFocused || editor.view.composing) return;
    let inTaskSection = false;
    const inserts: { pos: number; text: string }[] = [];
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name !== 'heading') return;
      if (node.attrs.level === 2) {
        inTaskSection = node.textContent.trim() === '작업';
        return;
      }
      if (node.attrs.level !== 3 || !inTaskSection) return;
      const text = node.textContent.trim();
      if (!text || !/^[\p{L}\p{N}]/u.test(text)) return; // empty or already emoji-prefixed
      inserts.push({ pos: offset + 1, text: text.toUpperCase() === 'GENERAL' ? '📌 ' : '🛰️ ' });
    });
    if (!inserts.length) return;
    let tr = editor.state.tr;
    for (let i = inserts.length - 1; i >= 0; i--) {
      tr = tr.insertText(inserts[i].text, inserts[i].pos);
    }
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  }, []);

  useEffect(() => {
    if (!dataDir) return;
    setLoaded(false);
    setMissingPast(false);

    (async () => {
      // Past dates are opened READ-ONLY at load time: on Google Drive the app
      // can read a stale cached version of the file, and any load-time write
      // (sync/cleanup) would clobber the real content on disk. Only today's
      // daily — which this app instance owns — gets load-time writes.
      const isToday = dateKey === format(new Date(), 'yyyy-MM-dd');
      try {
        const synced = isToday ? await syncDailyWithTodos(dataDir, dateKey, true) : null;
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
        const normalized = normalizeProjectHeadings(resolvedBody);
        if (normalized.changed) { resolvedBody = normalized.body; needsWrite = true; }

        const resolved = resolveProjectIdsInBody(resolvedBody, projectMap);
        if (resolved.changed) { resolvedBody = resolved.body; needsWrite = true; }

        const deduped = deduplicateDailyLogBody(resolvedBody);
        if (deduped.changed) { resolvedBody = deduped.body; needsWrite = true; }
        const compacted = compactTaskSections(resolvedBody);
        if (compacted.changed) { resolvedBody = compacted.body; needsWrite = true; }

        if (needsWrite && isToday) {
          await invoke('write_note', { path: fullPath, content: joinFrontmatter(frontmatter, resolvedBody) }).catch(() => {});
        }

        prevBodyRef.current = resolvedBody;
        detectionBaseRef.current = resolvedBody;
        inflightRef.current.clear();
        setBody(resolvedBody);
        const fields = parseFrontmatterFields(frontmatter);
        setSummary(fields.summary ?? '');
        setLoaded(true);

        // Unknown-ID healing (today only): a line whose [ID] doesn't exist in
        // todos.json (mangled/bogus id, deleted elsewhere) is invisible to the
        // Tasks tab and every sync. Re-register it and swap the id in place.
        if (isToday) {
          const todosNow = await readJsonFile<TodosFile>(dataDir, FILES.todos).catch(() => null);
          const knownIds = new Set(
            (todosNow?.todos ?? []).flatMap((t) => [t.id, ...(t.subtasks ?? []).map((s) => s.id)]),
          );
          for (const line of resolvedBody.split('\n')) {
            const p = parseTaskLine(line);
            if (!p?.id || p.indent > 0 || p.checked) continue;
            if (knownIds.has(p.id)) continue;
            const sub = splitSubtaskId(p.id);
            if (sub && knownIds.has(sub.parentId)) continue; // positional subtask ref
            const title = stripTaskMeta(p.title);
            if (!title) continue;
            const oldId = p.id;
            const project = detectProjectForItem(resolvedBody, p.title);
            registerNewTodo(dataDir, title, project).then((newId) => {
              if (import.meta.env.DEV) console.warn('[daily-sync] unknown id re-registered:', oldId, '→', newId);
              setBody((current) => {
                const escOld = '\\[' + oldId + '\\]';
                if (!current.includes(`[${oldId}]`) && !current.includes(escOld)) return current;
                const updated = current.replace(escOld, '\\[' + newId + '\\]').replace(`[${oldId}]`, `[${newId}]`);
                prevBodyRef.current = updated;
                detectionBaseRef.current = updated;
                (async () => {
                  try {
                    await invoke('write_note', { path: fullPath, content: joinFrontmatter(fmRef.current, updated) });
                  } catch {}
                })();
                return updated;
              });
            }).catch(() => {});
          }
        }

        // Orphan sweep: any ID-less checkbox line at load time means a
        // registration cycle was cut short (e.g. the user switched views
        // before the 3s detection timer fired). Register them now — both
        // top-level tasks and indented subtasks. registerNewTodo /
        // registerNewSubtask are idempotent by title, so re-sweeps are safe.
        // Today only — past dates must stay write-free at load time.
        const orphans = isToday ? detectNewCheckboxItems('', resolvedBody) : [];
        for (const item of orphans) {
          if (inflightRef.current.has(item.text)) continue;
          inflightRef.current.set(item.text, '');
          const reg = item.parentId
            ? registerNewSubtask(dataDir, item.parentId, item.text)
            : registerNewTodo(dataDir, item.text, detectProjectForItem(resolvedBody, item.text));
          reg.then((newId) => {
            if (!newId) {
              inflightRef.current.delete(item.text);
              return;
            }
            if (import.meta.env.DEV) console.warn('[daily-sync] load sweep registered:', newId, item.parentId ? `under ${item.parentId}` : '');
            inflightRef.current.set(item.text, newId);
            setBody((current) => {
              const marker = `- [ ] ${item.text}`;
              if (!current.includes(marker)) return current;
              const updated = current.replace(marker, `- [ ] [${newId}] ${item.text}`);
              prevBodyRef.current = updated;
              detectionBaseRef.current = updated;
              (async () => {
                try {
                  await invoke('write_note', { path: fullPath, content: joinFrontmatter(fmRef.current, updated) });
                } catch {}
              })();
              return updated;
            });
          }).catch(() => {
            inflightRef.current.delete(item.text);
          });
        }
      } catch {
        // A failed read is NOT proof the file doesn't exist — on Google Drive
        // the file can exist but be temporarily unreadable (stream not
        // hydrated after boot). Regenerating in that state overwrites real
        // logs with an empty template (2026-07-06 data-loss incident).
        try {
          const fullPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
          const fileExists = await invoke<boolean>('path_exists', { path: fullPath });
          if (fileExists) {
            for (let attempt = 0; attempt < 3; attempt++) {
              await new Promise((r) => setTimeout(r, 700));
              try {
                const raw = await invoke<string>('read_note', { path: fullPath });
                const { frontmatter, body: b } = splitFrontmatter(raw);
                fmRef.current = frontmatter;
                prevBodyRef.current = b;
                detectionBaseRef.current = b;
                inflightRef.current.clear();
                setBody(b);
                setSummary(parseFrontmatterFields(frontmatter).summary ?? '');
                setLoaded(true);
                return;
              } catch { /* retry */ }
            }
            // Exists but unreadable — show the conflict banner, write NOTHING.
            console.warn('[daily-sync] daily exists but is unreadable — refusing to regenerate:', dateKey);
            fmRef.current = '';
            prevBodyRef.current = '';
            detectionBaseRef.current = '';
            inflightRef.current.clear();
            setBody('');
            setConflict(true);
            setLoaded(true);
            return;
          }
        } catch { /* path_exists unavailable — fall through */ }

        // Past dates are NEVER auto-generated: on Google Drive a file can be
        // temporarily invisible (even to path_exists), and generating would
        // overwrite the real log once it syncs. The user opts in explicitly.
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        if (dateKey < todayStr && !forceGenerateRef.current.has(dateKey)) {
          if (import.meta.env.DEV) console.warn('[daily-sync] past daily unreadable/missing — showing generate button instead:', dateKey);
          fmRef.current = '';
          prevBodyRef.current = '';
          detectionBaseRef.current = '';
          inflightRef.current.clear();
          setBody('');
          setMissingPast(true);
          setLoaded(true);
          return;
        }

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
        if (import.meta.env.DEV) {
          const bodyIds = collectTaskIds(b);
          for (const t of activeTodos) {
            if (!bodyIds.has(t.id)) console.warn('[daily-sync] active task missing from generated daily:', t.id, t.title);
          }
        }
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
          // Last-moment guard: never clobber a file that appeared meanwhile
          const already = await invoke<boolean>('path_exists', { path: fullPath }).catch(() => false);
          if (!already) {
            await invoke('write_note', { path: fullPath, content: fm + b });
          }
        } catch {}
      }
    })();
  }, [dataDir, dateKey, currentDate, genNonce]);

  useEffect(() => {
    return () => {
      // Flush the pending registration cycle — the view is going away and the
      // debounce timer would otherwise die with it, losing the new tasks.
      if (newItemTimerRef.current) {
        clearTimeout(newItemTimerRef.current);
        newItemTimerRef.current = null;
        try { detectionRunRef.current?.(); } catch {}
      }
      // Flush pending deletions — verify against the final body and remove
      // vanished tasks now instead of losing the sync.
      for (const [id, timer] of pendingDeleteRef.current) {
        clearTimeout(timer);
        if (dataDir && !collectTaskIds(prevBodyRef.current).has(id)) {
          deleteTodoById(dataDir, id).catch(() => {});
        }
      }
      pendingDeleteRef.current.clear();
    };
  }, [dataDir]);

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
        if (import.meta.env.DEV) console.warn('[daily-sync] handleChange skipped (reloading flag)');
        return;
      }

      // Deletion sync: an ID that vanished from the body means the user
      // deleted that task line. Wait 5s and re-verify before removing from
      // todos.json so cut-and-paste reordering doesn't destroy tasks.
      {
        const prevIds = collectTaskIds(prev);
        const nextIds = collectTaskIds(md);
        for (const [id, timer] of pendingDeleteRef.current) {
          if (nextIds.has(id)) {
            clearTimeout(timer);
            pendingDeleteRef.current.delete(id);
          }
        }
        for (const id of prevIds) {
          if (nextIds.has(id) || pendingDeleteRef.current.has(id)) continue;
          pendingDeleteRef.current.set(id, setTimeout(() => {
            pendingDeleteRef.current.delete(id);
            if (collectTaskIds(prevBodyRef.current).has(id)) return; // reappeared
            deleteTodoById(dataDir, id).then((deleted) => {
              if (deleted && import.meta.env.DEV) console.warn('[daily-sync] deleted task removed from todos:', id);
            }).catch(() => {});
          }, 5000));
        }
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

      // Debounced new checkbox detection — wait for typing to settle.
      // The runner is also stored in a ref so unmount can flush it immediately
      // instead of losing the registration when the user switches views.
      const runDetection = () => {
        normalizeHeadingsInEditor();
        const currentBody = prevBodyRef.current;
        const base = detectionBaseRef.current;
        const newItems = detectNewCheckboxItems(base, currentBody);
        detectionBaseRef.current = currentBody;
        if (import.meta.env.DEV) console.warn('[daily-sync] detect fired:', JSON.stringify(newItems), 'inflight:', JSON.stringify([...inflightRef.current.entries()]));

        // Never register the line the cursor is still on — a mid-typing pause
        // would register transient text (e.g. a title about to be split into
        // main + subtask) as a junk task. Skipped lines are removed from the
        // detection base and retried once the cursor moves on.
        const ed = editorRef.current;
        let activeLine: string | null = null;
        if (ed && !ed.isDestroyed && ed.isFocused) {
          const { $from } = ed.state.selection;
          if ($from.parent.isTextblock) {
            activeLine = $from.parent.textContent.replace(/[​‌‍﻿]/g, '').trim();
          }
        }
        const unesc = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1').trim();
        const skippedTexts: string[] = [];
        const itemsToProcess = newItems.filter((it) => {
          if (activeLine !== null && unesc(it.text) === activeLine) {
            skippedTexts.push(it.text);
            return false;
          }
          return true;
        });
        if (skippedTexts.length > 0) {
          const skipSet = new Set(skippedTexts.map((t) => `- [ ] ${t}`));
          detectionBaseRef.current = currentBody
            .split('\n')
            .filter((l) => !skipSet.has(l.trim()))
            .join('\n');
          if (newItemTimerRef.current) clearTimeout(newItemTimerRef.current);
          newItemTimerRef.current = setTimeout(() => {
            newItemTimerRef.current = null;
            detectionRunRef.current?.();
          }, NEW_ITEM_DEBOUNCE_MS);
          if (import.meta.env.DEV) console.warn('[daily-sync] deferred (cursor on line):', JSON.stringify(skippedTexts));
        }

        // Patch the registered ID into the body string, persist to disk, and
        // keep the refs consistent. Works even after unmount (no setState).
        const applyIdToBody = (rawText: string, newId: string): string | null => {
          const marker = `- [ ] ${rawText}`;
          const cur = prevBodyRef.current;
          if (!cur.includes(marker)) return null;
          const updated = cur.replace(marker, `- [ ] [${newId}] ${rawText}`);
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
        };

        // Match new items against pending in-flight items whose text changed.
        // If an in-flight item (taskId='', registration pending) disappeared from
        // the body, it was likely edited — pair it with the new item instead of
        // creating a duplicate task.
        const vanishedPending: string[] = [];
        for (const [txt, id] of inflightRef.current.entries()) {
          if (id) continue;
          if (!currentBody.includes(`- [ ] ${txt}`)) vanishedPending.push(txt);
        }

        for (const item of itemsToProcess) {
          const text = item.text;
          if (inflightRef.current.has(text)) continue;

          // Indented under an ID-bearing task → register as its subtask
          if (item.parentId) {
            const parentId = item.parentId;
            inflightRef.current.set(text, '');
            registerNewSubtask(dataDir, parentId, text).then((subId) => {
              if (!subId) {
                inflightRef.current.delete(text);
                return;
              }
              if (import.meta.env.DEV) console.warn('[daily-sync] registered subtask:', subId, 'under', parentId);
              inflightRef.current.set(text, subId);
              const injected = injectTaskIdInEditor(text, subId);
              const updated = applyIdToBody(text, subId);
              if (!updated) {
                if (!injected) inflightRef.current.delete(text);
                return;
              }
              if (!injected) setBody(updated);
            }).catch(() => {
              inflightRef.current.delete(text);
            });
            continue;
          }

          if (vanishedPending.length > 0) {
            const oldText = vanishedPending.shift()!;
            inflightRef.current.delete(oldText);
            inflightRef.current.set(text, '');
            continue;
          }

          inflightRef.current.set(text, '');
          const project = detectProjectForItem(currentBody, text);
          if (import.meta.env.DEV) console.warn('[daily-sync] registering main task:', text, '→ project:', project);
          registerNewTodo(dataDir, text, project).then((taskId) => {
            if (import.meta.env.DEV) console.warn('[daily-sync] registered:', taskId);
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

            // Patch the editor doc via a transaction (keeps the cursor), then
            // persist the ID to disk right away in case the editor's follow-up
            // change gets swallowed (e.g. by a concurrent reload or unmount).
            const injected = injectTaskIdInEditor(finalText, taskId);
            const updated = applyIdToBody(finalText, taskId);
            if (!updated) {
              if (!injected) inflightRef.current.delete(finalText);
              return;
            }
            if (!injected) setBody(updated);
          }).catch((e) => {
            if (import.meta.env.DEV) console.warn('[daily-sync] register failed:', e);
            inflightRef.current.delete(text);
          });
        }
      };
      detectionRunRef.current = runDetection;
      if (newItemTimerRef.current) clearTimeout(newItemTimerRef.current);
      newItemTimerRef.current = setTimeout(() => {
        newItemTimerRef.current = null;
        runDetection();
      }, NEW_ITEM_DEBOUNCE_MS);

      (async () => {
        try {
          const fullPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
          await invoke('write_note', { path: fullPath, content: joinFrontmatter(fmRef.current, md) });
          // Daily를 원본으로 삼는 동기화 블록 미러 갱신용
          window.dispatchEvent(new CustomEvent('note-saved'));
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
      if (import.meta.env.DEV) console.warn('[daily-sync] reloadDaily: replacing body from disk');
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

  // 동기화 블록(미러)에서 이 Daily를 역기입한 경우 즉시 다시 읽는다
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path && path.replace(/\\/g, '/').endsWith(`/${dateKey}.md`)) reloadDaily();
    };
    window.addEventListener('note-external-edit', handler);
    return () => window.removeEventListener('note-external-edit', handler);
  }, [dateKey, reloadDaily]);

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
      {loaded && missingPast && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-6">
          <div className="text-sm text-ink-2">이 날짜의 Daily 파일을 찾을 수 없습니다.</div>
          <div className="text-xs text-ink-3">
            Google Drive 동기화 지연일 수 있습니다 — 잠시 후 날짜를 다시 선택하면 나타날 수 있어요.
            <br />파일이 정말 없다면 아래 버튼으로 새로 생성할 수 있습니다.
          </div>
          <button
            onClick={() => {
              forceGenerateRef.current.add(dateKey);
              setGenNonce((n) => n + 1);
            }}
            className="px-3 py-1.5 text-xs rounded-lg border border-border text-ink-2 hover:bg-paper-soft transition-colors"
          >
            이 날짜의 Daily 새로 생성
          </button>
        </div>
      )}
      {loaded && !missingPast && (
        <div className="daily-log-editor flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
          <NoteEditor
            key={dateKey}
            content={body}
            onChange={handleChange}
            placeholder="Write today's log..."
            editorRef={editorRef}
            onEditorBlur={normalizeHeadingsInEditor}
          />
        </div>
      )}
    </div>
  );
}
