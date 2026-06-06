import { useState, useEffect, useCallback, useMemo, useRef, Component } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useEditor, EditorContent } from '@tiptap/react';
import { useAppStore } from '../../stores/useAppStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { useMusicStore, type PlaylistItem } from '../../stores/useMusicStore';
import { readJsonFile, writeJsonFile } from '../../lib/fileSystem';
import { FILES, FOLDERS } from '../../lib/constants';
import { buildFrontmatter, updateFrontmatterField } from '../../lib/frontmatter';
import { todayKey } from '../../lib/dateUtils';
import { insertNoteToDailyLog, insertTodoToDailyLog } from '../../lib/dailyLogHelper';
import { updateNoteLinks } from '../../lib/linkGraph';
import { getExtensions } from '../editor/extensions';
import { ColorPicker } from '../editor/EditorToolbar';
import { insertBlankLinesBeforeHeadings } from '../editor/NoteEditor';
import type { TodosFile, TaskStatus, Task, Subtask } from '../../types/task';
import type { Editor } from '@tiptap/react';

const statusLabels: Record<TaskStatus, string> = { 'todo': '○', 'in-progress': '◐', 'done': '●' };
const statusOrder: TaskStatus[] = ['todo', 'in-progress', 'done'];

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\s]+)/,
    /(?:youtu\.be\/)([^?\s]+)/,
    /(?:youtube\.com\/embed\/)([^?\s]+)/,
    /(?:youtube\.com\/shorts\/)([^?\s]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await res.json();
    if (data.title) return data.title;
  } catch {}
  return `Video ${videoId}`;
}

interface RecentMemo {
  id: string;
  title: string;
  path: string;
  createdAt: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export function SidebarMode() {
  const { dataDir, setMode, setView } = useAppStore();
  const { tasks, setTasks, addTask, updateTask } = useTaskStore();
  const music = useMusicStore();
  const [memo, setMemo] = useState('');
  const [recentMemos, setRecentMemos] = useState<RecentMemo[]>([]);
  const [editingMemo, setEditingMemo] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [addingTrack, setAddingTrack] = useState(false);
  const [memoOpen, setMemoOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState<string | null>(todayKey());
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingSubKey, setEditingSubKey] = useState<{ taskId: string; subId: string } | null>(null);

  useEffect(() => {
    if (!dataDir) return;
    readJsonFile<TodosFile>(dataDir, FILES.todos).then((data) => {
      if (data?.todos) setTasks(data.todos);
    });
  }, [dataDir, setTasks]);

  const loadRecentMemos = useCallback(async () => {
    if (!dataDir) return;
    try {
      const dir = await join(dataDir, FOLDERS.research);
      const files = await invoke<string[]>('list_notes', { dir });
      const today = todayKey();
      const memoFiles = files
        .filter(f => {
          const name = f.split('/').pop()?.replace('.md', '') ?? '';
          return name.startsWith(`${today}-memo-`);
        })
        .sort()
        .reverse()
        .slice(0, 5);

      const memos: RecentMemo[] = [];
      for (const f of memoFiles) {
        try {
          const raw = await invoke<string>('read_note', { path: f });
          const titleMatch = raw.match(/^title:\s*["']?(.+?)["']?\s*$/m);
          const createdMatch = raw.match(/^created:\s*["']?(.+?)["']?\s*$/m);
          memos.push({
            id: f.split('/').pop()?.replace('.md', '') ?? '',
            title: titleMatch?.[1] || 'Untitled',
            path: f,
            createdAt: createdMatch?.[1] || '',
          });
        } catch {}
      }
      setRecentMemos(memos);
    } catch {}
  }, [dataDir]);

  useEffect(() => {
    loadRecentMemos();
    const handler = () => loadRecentMemos();
    window.addEventListener('notes-changed', handler);
    return () => window.removeEventListener('notes-changed', handler);
  }, [loadRecentMemos]);

  const activeTasks = tasks.filter(t => t.status !== 'done').sort((a, b) => a.priority - b.priority);

  const cycleStatus = useCallback(async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const next = statusOrder[(statusOrder.indexOf(task.status) + 1) % statusOrder.length];
    updateTask(id, { status: next, updatedAt: new Date().toISOString() });
    const updated = tasks.map(t => t.id === id ? { ...t, status: next, updatedAt: new Date().toISOString() } : t);
    if (dataDir) {
      await writeJsonFile(dataDir, FILES.todos, { version: 1, lastModified: new Date().toISOString(), todos: updated });
    }
  }, [tasks, dataDir, updateTask]);

  const handleAddTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title || !dataDir) return;
    const task: Task = {
      id: generateId(),
      title,
      status: 'todo',
      priority: 2,
      subtasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(newTaskDue ? { dueDate: newTaskDue } : {}),
    };
    addTask(task);
    setNewTaskTitle('');
    setNewTaskDue('');
    const updated = [...tasks, task];
    await writeJsonFile(dataDir, FILES.todos, { version: 1, lastModified: new Date().toISOString(), todos: updated });
    insertTodoToDailyLog(dataDir, task.id, title, 'GENERAL').catch(() => {});
  }, [newTaskTitle, newTaskDue, tasks, dataDir, addTask]);

  const handleUpdateTask = useCallback(async (id: string, changes: Partial<Task>) => {
    updateTask(id, { ...changes, updatedAt: new Date().toISOString() });
    const updated = tasks.map(t => t.id === id ? { ...t, ...changes, updatedAt: new Date().toISOString() } : t);
    if (dataDir) {
      await writeJsonFile(dataDir, FILES.todos, { version: 1, lastModified: new Date().toISOString(), todos: updated });
    }
  }, [tasks, dataDir, updateTask]);

  const handleDeleteTask = useCallback(async (id: string) => {
    const { removeTask } = useTaskStore.getState();
    removeTask(id);
    const updated = tasks.filter(t => t.id !== id);
    if (dataDir) {
      await writeJsonFile(dataDir, FILES.todos, { version: 1, lastModified: new Date().toISOString(), todos: updated });
    }
    setEditingTaskId(null);
  }, [tasks, dataDir]);

  const handleQuickMemo = useCallback(async () => {
    const text = memo.trim();
    if (!text || !dataDir) return;
    const today = todayKey();
    const dir = await join(dataDir, FOLDERS.research);
    await invoke('ensure_dir', { path: dir });
    const files = await invoke<string[]>('list_notes', { dir });
    const prefix = `${today}-memo-`;
    let seq = 1;
    for (const f of files) {
      const name = f.split('/').pop()?.replace('.md', '') ?? '';
      if (name.startsWith(prefix)) {
        const num = parseInt(name.slice(prefix.length), 10);
        if (!isNaN(num) && num >= seq) seq = num + 1;
      }
    }
    const noteId = `${prefix}${String(seq).padStart(3, '0')}`;
    const fm = buildFrontmatter({
      id: noteId,
      type: 'quick-memo',
      title: text.slice(0, 60),
      date: today,
      project: [],
      tags: [],
      related: [`${today}-daily`],
      status: 'in-progress',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    });
    const body = `\n- ${text}\n`;
    const fullPath = await join(dir, `${noteId}.md`);
    await invoke('write_note', { path: fullPath, content: fm + body });
    updateNoteLinks(dataDir, noteId, [`${today}-daily`]).catch(() => {});
    insertNoteToDailyLog(dataDir, noteId, text.slice(0, 60), 'quick-memo', '').catch(() => {});
    window.dispatchEvent(new CustomEvent('notes-changed'));
    setMemo('');
  }, [memo, dataDir]);

  const openMemoForEdit = useCallback(async (path: string) => {
    try {
      const raw = await invoke<string>('read_note', { path });
      const fmEnd = raw.indexOf('\n---\n');
      const bodyContent = fmEnd >= 0 ? raw.slice(fmEnd + 5) : raw;
      const titleMatch = raw.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      setEditingMemo(path);
      setEditingBody(bodyContent);
      setEditingTitle(titleMatch?.[1] || '');
    } catch {}
  }, []);

  const saveMemoEdit = useCallback(async (markdown: string) => {
    if (!editingMemo) return;
    try {
      const raw = await invoke<string>('read_note', { path: editingMemo });
      const fmEnd = raw.indexOf('\n---\n');
      const fm = fmEnd >= 0 ? raw.slice(0, fmEnd + 5) : '';
      await invoke('write_note', { path: editingMemo, content: fm + markdown });
      setEditingBody(markdown);
      window.dispatchEvent(new CustomEvent('notes-changed'));
    } catch {}
  }, [editingMemo]);

  const saveMemoTitle = useCallback(async (newTitle: string) => {
    if (!editingMemo) return;
    try {
      const raw = await invoke<string>('read_note', { path: editingMemo });
      const fmEnd = raw.indexOf('\n---\n');
      if (fmEnd < 0) return;
      const fm = raw.slice(0, fmEnd + 5);
      const body = raw.slice(fmEnd + 5);
      const updatedFm = updateFrontmatterField(fm, 'title', `"${newTitle.replace(/"/g, '\\"')}"`);
      await invoke('write_note', { path: editingMemo, content: updatedFm + body });
      setEditingTitle(newTitle);
      window.dispatchEvent(new CustomEvent('notes-changed'));
    } catch {}
  }, [editingMemo]);

  const closeEditor = useCallback(() => {
    setEditingMemo(null);
    setEditingBody('');
    setEditingTitle('');
  }, []);

  function sendMusicCmd(cmd: 'toggle' | 'next' | 'prev') {
    window.dispatchEvent(new CustomEvent('music-cmd', { detail: cmd }));
  }

  function openExpanded(view: 'daily' | 'notes' | 'tasks') {
    setView(view);
    setMode('expanded');
    const aot = useConfigStore.getState().window.always_on_top_expanded;
    invoke('set_window_mode', { mode: 'expanded', alwaysOnTop: aot }).catch(() => {});
  }

  const currentTrack = music.playlist.length > 0 ? music.playlist[music.currentIndex] : null;
  const hasPlaylist = music.playlist.length > 0;

  const calendarData = useMemo(() => {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();
    const monthStart = firstDay.toISOString().slice(0, 10);
    const monthEnd = lastDay.toISOString().slice(0, 10);
    const countMap = new Map<string, number>();

    function addRange(start: string | undefined, end: string | undefined, fallback: string | undefined) {
      if (start && end) {
        const lo = start < monthStart ? monthStart : start;
        const hi = end > monthEnd ? monthEnd : end;
        const cur = new Date(lo);
        const stop = new Date(hi);
        while (cur <= stop) {
          const k = cur.toISOString().slice(0, 10);
          countMap.set(k, (countMap.get(k) ?? 0) + 1);
          cur.setDate(cur.getDate() + 1);
        }
      } else {
        const key = end ?? start ?? fallback;
        if (key) countMap.set(key, (countMap.get(key) ?? 0) + 1);
      }
    }

    for (const t of tasks) {
      addRange(t.startDate, t.endDate ?? t.dueDate, t.createdAt?.slice(0, 10));
      if (t.subtasks) {
        for (const st of t.subtasks) {
          addRange(st.startDate, st.endDate ?? st.dueDate, t.createdAt?.slice(0, 10));
        }
      }
    }
    const days: { day: number; key: string; count: number }[] = [];
    for (let d = 1; d <= totalDays; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, key, count: countMap.get(key) ?? 0 });
    }
    return { startDow, days, label: `${y}.${String(m + 1).padStart(2, '0')}` };
  }, [calMonth, tasks]);

  const selectedDateTasks = useMemo(() => {
    if (!selectedDate) return [];
    const result: { id: string; title: string; status: TaskStatus; isSubtask?: boolean }[] = [];

    function inRange(start: string | undefined, end: string | undefined, fallback: string | undefined): boolean {
      if (start && (end || start)) {
        const lo = start;
        const hi = end ?? start;
        return selectedDate! >= lo && selectedDate! <= hi;
      }
      return (end ?? start ?? fallback) === selectedDate;
    }

    for (const t of tasks) {
      if (inRange(t.startDate, t.endDate ?? t.dueDate, t.createdAt?.slice(0, 10))) {
        result.push({ id: t.id, title: t.title, status: t.status });
      }
      if (t.subtasks) {
        for (const st of t.subtasks) {
          if (inRange(st.startDate, st.endDate ?? st.dueDate, t.createdAt?.slice(0, 10))) {
            result.push({ id: st.id, title: st.title, status: st.status ?? (st.done ? 'done' : 'todo'), isSubtask: true });
          }
        }
      }
    }
    return result;
  }, [selectedDate, tasks]);

  const todayStr = todayKey();

  if (editingMemo) {
    return (
      <MemoErrorBoundary onClose={closeEditor}>
        <MemoEditor
          title={editingTitle}
          initialBody={editingBody}
          onSave={saveMemoEdit}
          onTitleChange={saveMemoTitle}
          onClose={closeEditor}
        />
      </MemoErrorBoundary>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-3 gap-2 overflow-hidden">
      {/* Music */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => sendMusicCmd('prev')} disabled={!hasPlaylist} className="p-0.5 text-ink-3 hover:text-ink transition-colors disabled:opacity-20">
            <svg width="8" height="8" viewBox="0 0 14 14" fill="none"><path d="M10 3L5 7l5 4V3z" fill="currentColor"/><path d="M4 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => sendMusicCmd('toggle')} disabled={!hasPlaylist}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors disabled:opacity-20">
            {music.playing ? (
              <svg width="7" height="7" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" rx="1" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="1" fill="currentColor"/></svg>
            ) : (
              <svg width="7" height="7" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5L3 1.5z" fill="currentColor"/></svg>
            )}
          </button>
          <button onClick={() => sendMusicCmd('next')} disabled={!hasPlaylist} className="p-0.5 text-ink-3 hover:text-ink transition-colors disabled:opacity-20">
            <svg width="8" height="8" viewBox="0 0 14 14" fill="none"><path d="M4 3l5 4-5 4V3z" fill="currentColor"/><path d="M10 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <span className="text-[9px] text-ink-3 truncate flex-1">
          {currentTrack ? currentTrack.title : (hasPlaylist ? 'Paused' : 'No playlist')}
        </span>
        <button onClick={() => setShowPlaylist(!showPlaylist)}
          className={`p-0.5 rounded transition-colors shrink-0 ${showPlaylist ? 'text-chrome' : 'text-ink-3 hover:text-ink'}`} title="Playlist">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2 3h7M2 6h7M2 9h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M11 7v4M9 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>
      </div>

      {showPlaylist && (
        <div className="shrink-0 border border-border rounded-[var(--radius-sm)] bg-paper-soft overflow-hidden">
          <div className="px-2 py-1.5">
            <form onSubmit={async (e) => {
              e.preventDefault();
              const vid = extractVideoId(playlistUrl.trim());
              if (!vid) return;
              setAddingTrack(true);
              const title = await fetchVideoTitle(vid);
              const item: PlaylistItem = { id: Math.random().toString(36).substring(2, 8), videoId: vid, title };
              const updated = [...music.playlist, item];
              if (music.playlist.length === 0) music.setPlaying(true);
              music.setPlaylist(updated);
              if (music.playlist.length === 0) music.setCurrentIndex(0);
              setPlaylistUrl('');
              setAddingTrack(false);
            }} className="flex gap-1">
              <input value={playlistUrl} onChange={e => setPlaylistUrl(e.target.value)} placeholder="YouTube URL..."
                className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-paper text-ink placeholder:text-ink-3 focus:outline-none focus:border-chrome min-w-0" />
              <button type="submit" disabled={addingTrack}
                className="px-1.5 py-1 text-[9px] rounded bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors disabled:opacity-50 shrink-0">
                {addingTrack ? '...' : '+'}
              </button>
            </form>
          </div>
          <div className="max-h-28 overflow-y-auto">
            {music.playlist.length === 0 && <p className="text-[9px] text-ink-3 text-center py-2">YouTube URL을 추가하세요</p>}
            {music.playlist.map((item, idx) => (
              <div key={item.id}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] group cursor-pointer transition-colors ${idx === music.currentIndex ? 'bg-chrome/15 text-ink' : 'text-ink-2 hover:bg-paper-muted/50'}`}
                onClick={() => { music.setPlaying(true); music.setCurrentIndex(idx); }}>
                {idx === music.currentIndex && music.playing && <span className="w-1 h-1 rounded-full bg-pastel-mint animate-pulse shrink-0" />}
                <span className="flex-1 truncate">{item.title}</span>
                <button onClick={(e) => {
                  e.stopPropagation();
                  const updated = music.playlist.filter((_, i) => i !== idx);
                  let newIdx = music.currentIndex;
                  if (idx < music.currentIndex) newIdx--;
                  if (idx === music.currentIndex) newIdx = Math.min(music.currentIndex, updated.length - 1);
                  if (newIdx < 0) newIdx = 0;
                  music.setPlaylist(updated);
                  music.setCurrentIndex(newIdx);
                }} className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-3 hover:text-red-400 transition-all shrink-0">
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="w-full h-px bg-border shrink-0" />

      {/* Quick memo — collapsible */}
      <div className="shrink-0">
        <button onClick={() => setMemoOpen(!memoOpen)}
          className="flex items-center gap-1 w-full mb-1">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
            className={`text-ink-3 transition-transform ${memoOpen ? '' : '-rotate-90'}`}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-[10px] text-ink-3 uppercase tracking-wider">Quick Memo</span>
        </button>
        {memoOpen && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); handleQuickMemo(); }} className="flex gap-1.5">
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Capture a thought..."
                className="flex-1 px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] border border-border bg-paper-soft text-ink placeholder:text-ink-3 focus:outline-none focus:border-chrome" />
              <button type="submit" disabled={!memo.trim()}
                className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors disabled:opacity-30">
                ↵
              </button>
            </form>
            {recentMemos.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {recentMemos.map(m => (
                  <button key={m.id} onClick={() => openMemoForEdit(m.path)}
                    className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-paper-muted/50 transition-colors text-left">
                    <span className="text-[9px]">💬</span>
                    <span className="text-[10px] text-ink-2 truncate flex-1">{m.title}</span>
                    {m.createdAt && (
                      <span className="text-[8px] text-ink-3 tabular-nums shrink-0">
                        {new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="w-full h-px bg-border shrink-0" />

      {/* Tasks — collapsible with add */}
      <div className="flex-1 min-h-0 flex flex-col">
        <button onClick={() => setTasksOpen(!tasksOpen)}
          className="flex items-center gap-1 w-full mb-1 shrink-0">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
            className={`text-ink-3 transition-transform ${tasksOpen ? '' : '-rotate-90'}`}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-[10px] text-ink-3 uppercase tracking-wider flex-1 text-left">Tasks</span>
          <span className="text-[10px] text-ink-3 ml-auto">{activeTasks.length}</span>
        </button>
        {tasksOpen && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); handleAddTask(); }} className="flex gap-1 mb-1 shrink-0">
              <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Add a task..."
                className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-paper-soft text-ink placeholder:text-ink-3 focus:outline-none focus:border-chrome min-w-0" />
              <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)}
                className="w-[105px] px-1.5 py-1 text-[9px] rounded border border-border bg-paper-soft text-ink-3 focus:outline-none focus:border-chrome shrink-0" />
              <button type="submit" disabled={!newTaskTitle.trim()}
                className="px-1.5 py-1 text-[9px] rounded bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors disabled:opacity-30 shrink-0">+</button>
            </form>
            <div className="flex-1 overflow-y-auto space-y-0.5">
              {activeTasks.map(t => (
                <div key={t.id}>
                  <div className="flex items-center gap-1.5 py-1 group">
                    <button onClick={() => cycleStatus(t.id)}
                      className="text-xs text-ink-3 hover:text-ink transition-colors shrink-0 w-4 text-center" title={t.status}>
                      {statusLabels[t.status]}
                    </button>
                    <span
                      onClick={() => { setEditingTaskId(editingTaskId === t.id ? null : t.id); setEditingSubKey(null); }}
                      className="flex-1 text-xs text-ink truncate cursor-pointer hover:text-chrome transition-colors"
                    >{t.title}</span>
                    {t.dueDate && (
                      <span className={`text-[9px] font-mono shrink-0 ${
                        new Date(t.dueDate) < new Date(new Date().toDateString()) ? 'text-badge-high' : 'text-ink-3'
                      }`}>
                        {new Date(t.dueDate).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                      </span>
                    )}
                    <button onClick={() => { setEditingTaskId(editingTaskId === t.id ? null : t.id); setEditingSubKey(null); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-3 hover:text-ink transition-all shrink-0" title="Edit">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <button onClick={() => handleDeleteTask(t.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-3 hover:text-red-400 transition-all shrink-0" title="Delete">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  {t.subtasks?.length > 0 && editingTaskId !== t.id && (
                    <div className="ml-5 space-y-0.5 mb-0.5">
                      {t.subtasks.filter(st => !st.done).map(st => (
                        <div key={st.id}>
                          <SidebarSubtaskRow
                            subtask={st}
                            onToggle={() => {
                              const updated = t.subtasks.map(s => s.id === st.id ? { ...s, done: true, status: 'done' as TaskStatus } : s);
                              handleUpdateTask(t.id, { subtasks: updated });
                            }}
                            onTitleClick={() => setEditingSubKey(
                              editingSubKey?.taskId === t.id && editingSubKey?.subId === st.id ? null : { taskId: t.id, subId: st.id }
                            )}
                            onDelete={() => {
                              const updated = t.subtasks.filter(s => s.id !== st.id);
                              handleUpdateTask(t.id, { subtasks: updated });
                            }}
                          />
                          {editingSubKey?.taskId === t.id && editingSubKey?.subId === st.id && (
                            <SidebarSubtaskEditor
                              subtask={st}
                              onUpdate={(changes) => {
                                const updated = t.subtasks.map(s => s.id === st.id ? { ...s, ...changes } : s);
                                handleUpdateTask(t.id, { subtasks: updated });
                              }}
                              onDelete={() => {
                                const updated = t.subtasks.filter(s => s.id !== st.id);
                                handleUpdateTask(t.id, { subtasks: updated });
                                setEditingSubKey(null);
                              }}
                              onClose={() => setEditingSubKey(null)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {editingTaskId === t.id && (
                    <SidebarTaskEditor task={t} onUpdate={(changes) => handleUpdateTask(t.id, changes)} onDelete={() => handleDeleteTask(t.id)} onClose={() => setEditingTaskId(null)} />
                  )}
                </div>
              ))}
              {activeTasks.length === 0 && <p className="text-[10px] text-ink-3 text-center py-4">All clear!</p>}
            </div>
          </>
        )}
      </div>

      <div className="w-full h-px bg-border shrink-0" />

      {/* Calendar */}
      <div className="shrink-0">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => { setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1)); setSelectedDate(null); }}
            className="p-0.5 text-ink-3 hover:text-ink transition-colors">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="text-[10px] text-ink-2 font-medium tabular-nums">{calendarData.label}</span>
          <button onClick={() => { setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1)); setSelectedDate(null); }}
            className="p-0.5 text-ink-3 hover:text-ink transition-colors">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div className="grid grid-cols-7 gap-px text-center">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} className="text-[8px] text-ink-3 py-0.5">{d}</div>
          ))}
          {Array.from({ length: calendarData.startDow }).map((_, i) => (
            <div key={`e-${i}`} />
          ))}
          {calendarData.days.map(d => {
            const isToday = d.key === todayStr;
            const isSelected = d.key === selectedDate;
            return (
              <button key={d.day}
                onClick={() => setSelectedDate(isSelected ? null : d.key)}
                className={`relative text-[9px] py-0.5 rounded transition-colors ${
                  isSelected ? 'bg-chrome/40 text-ink font-bold ring-1 ring-chrome'
                  : isToday ? 'bg-chrome/20 text-ink font-bold'
                  : d.count > 0 ? 'text-ink hover:bg-paper-soft cursor-pointer' : 'text-ink-3 hover:bg-paper-soft cursor-pointer'
                }`}>
                {d.day}
                {d.count > 0 && (
                  <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                    d.count >= 4 ? 'bg-pastel-lavender' : d.count >= 2 ? 'bg-chrome' : 'bg-pastel-mint'
                  }`} />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 border-t border-border pt-1">
          <div className="text-[9px] text-ink-3 mb-0.5">
            {selectedDate ? `${selectedDate} — ${selectedDateTasks.length} task(s)` : 'Select a date'}
          </div>
          <div className="h-[72px] overflow-y-auto space-y-0.5">
            {selectedDate && selectedDateTasks.length > 0 ? selectedDateTasks.map(t => (
              <div key={t.id} className={`flex items-center gap-1.5 py-0.5 ${t.isSubtask ? 'ml-3' : ''}`}>
                <span className="text-[9px] text-ink-3 shrink-0">{statusLabels[t.status]}</span>
                <span className={`text-[10px] truncate ${t.isSubtask ? 'text-ink-2' : 'text-ink'}`}>{t.title}</span>
              </div>
            )) : selectedDate ? (
              <p className="text-[9px] text-ink-3 text-center py-2">No tasks</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Quick nav */}
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => openExpanded('daily')} className="flex-1 py-1.5 text-[10px] text-ink-3 hover:text-ink hover:bg-paper-muted/50 rounded transition-colors">Daily</button>
        <button onClick={() => openExpanded('notes')} className="flex-1 py-1.5 text-[10px] text-ink-3 hover:text-ink hover:bg-paper-muted/50 rounded transition-colors">Notes</button>
        <button onClick={() => openExpanded('tasks')} className="flex-1 py-1.5 text-[10px] text-ink-3 hover:text-ink hover:bg-paper-muted/50 rounded transition-colors">Tasks</button>
      </div>
    </div>
  );
}

function MemoEditor({ title, initialBody, onSave, onTitleChange, onClose }: {
  title: string;
  initialBody: string;
  onSave: (markdown: string) => void;
  onTitleChange: (title: string) => void;
  onClose: () => void;
}) {
  const extensions = useMemo(() => getExtensions({ placeholder: 'Write...' }), []);
  const [localTitle, setLocalTitle] = useState(title);
  const titleDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isLoadingContent = useRef(true);

  const handleTitleChange = useCallback((val: string) => {
    setLocalTitle(val);
    clearTimeout(titleDebounce.current);
    titleDebounce.current = setTimeout(() => onTitleChange(val), 500);
  }, [onTitleChange]);

  useEffect(() => () => clearTimeout(titleDebounce.current), []);

  const editor = useEditor({
    extensions,
    content: initialBody || '',
    onCreate: ({ editor: e }) => {
      try { insertBlankLinesBeforeHeadings(e); } catch (err) { console.warn('insertBlankLines failed:', err); }
      isLoadingContent.current = false;
    },
    onUpdate: ({ editor: e }) => {
      if (isLoadingContent.current) return;
      const storage = e.storage as Record<string, any>;
      const md: string = storage.markdown?.getMarkdown?.() ?? '';
      onSave(md);
    },
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-paper">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <button
          onClick={onClose}
          className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-soft transition-colors shrink-0"
          title="Back"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <input
          value={localTitle}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          className="flex-1 text-xs font-medium text-ink bg-transparent border-none outline-none placeholder:text-ink-3 min-w-0"
        />
      </div>

      {/* TipTap editor */}
      <div className="flex-1 overflow-y-auto px-3 pr-4 py-2">
        <EditorContent editor={editor} className="h-full sidebar-memo-editor text-xs" />
      </div>

      {/* Bottom toolbar — 2 rows */}
      {editor && (
        <div className="border-t border-border shrink-0">
          {/* Row 1: text formatting, headings, block elements */}
          <div className="flex items-center gap-0.5 px-1.5 pt-1 pb-0.5 overflow-x-auto sidebar-toolbar">
            <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="B" className="font-bold" />
            <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" className="italic" />
            <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" className="line-through" />
            <ToolBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} label="<>" className="font-mono text-[8px]" />
            <ToolBtn active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} label="H" className="text-[8px]" />
            <Sep />
            <ToolBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" />
            <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" />
            <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" />
            <Sep />
            <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" />
            <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="1." />
            <ToolBtn active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} label="☐" />
            <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" />
            <ToolBtn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="{}" className="font-mono text-[8px]" />
          </div>
          {/* Row 2: color, alignment, insert, table ops */}
          <div className="flex items-center gap-0.5 px-1.5 pt-0.5 pb-1 overflow-x-auto sidebar-toolbar">
            <SidebarTextColorBtn editor={editor} />
            <SidebarTextHighlightBtn editor={editor} />
            <Sep />
            <SidebarAlignBtn editor={editor} value="left" icon="≡L" label="Align left" />
            <SidebarAlignBtn editor={editor} value="center" icon="≡C" label="Align center" />
            <SidebarAlignBtn editor={editor} value="right" icon="≡R" label="Align right" />
            <SidebarAlignBtn editor={editor} value="justify" icon="≡J" label="Justify" />
            <Sep />
            <ToolBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} label="—" />
            <ToolBtn active={false} onClick={() => {
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
              setTimeout(() => {
                const { state, view } = editor;
                const { doc, selection, tr } = state;
                const $pos = doc.resolve(selection.from);
                let tableNode = null;
                let tableStart = 0;
                for (let d = $pos.depth; d >= 0; d--) {
                  if ($pos.node(d).type.name === 'table') {
                    tableNode = $pos.node(d);
                    tableStart = $pos.start(d);
                    break;
                  }
                }
                if (!tableNode) return;
                const tableDom = view.nodeDOM(tableStart - 1) as HTMLElement | null;
                const wrapper = tableDom?.closest('.tableWrapper') ?? tableDom;
                const containerW = (wrapper?.clientWidth ?? 300) - 2;
                let numCols = 0;
                tableNode.firstChild?.forEach((cell) => { numCols += cell.attrs.colspan || 1; });
                if (numCols === 0) return;
                const colW = Math.floor(containerW / numCols);
                let offset = 0;
                tableNode.forEach((row) => {
                  let cellOffset = 0;
                  row.forEach((cell) => {
                    const colspan = cell.attrs.colspan || 1;
                    const cellPos = tableStart + offset + cellOffset + 1;
                    tr.setNodeMarkup(cellPos, undefined, {
                      ...cell.attrs,
                      colwidth: Array(colspan).fill(colW),
                    });
                    cellOffset += cell.nodeSize;
                  });
                  offset += row.nodeSize;
                });
                view.dispatch(tr);
              }, 0);
            }} label="⊞" />
            {editor.isActive('table') && (
              <>
                <Sep />
                <SidebarTableToolbar editor={editor} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarTextColorBtn({ editor }: { editor: Editor }) {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const color = editor.getAttributes('textStyle')?.color ?? '';
  return (
    <>
      <button
        ref={btnRef}
        onMouseDown={e => { e.preventDefault(); setShow(!show); }}
        title="Text color"
        className="px-1 py-0.5 text-[9px] rounded transition-colors shrink-0 text-ink-3 hover:text-ink hover:bg-paper-soft"
      >
        <span style={{ borderBottom: `2px solid ${color || 'currentColor'}` }}>A</span>
      </button>
      {show && (
        <ColorPicker
          label="Text color"
          value={color}
          anchor={btnRef.current}
          onChange={(c) => {
            if (c) editor.chain().focus().setColor(c).run();
            else editor.chain().focus().unsetColor().run();
          }}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

function SidebarTextHighlightBtn({ editor }: { editor: Editor }) {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hlAttrs = editor.getAttributes('highlight');
  const color = hlAttrs?.color ?? '';
  return (
    <>
      <button
        ref={btnRef}
        onMouseDown={e => { e.preventDefault(); setShow(!show); }}
        title="Text background color"
        className="px-1 py-0.5 text-[9px] rounded transition-colors shrink-0 text-ink-3 hover:text-ink hover:bg-paper-soft"
      >
        <span className="px-0.5" style={{ background: color || 'var(--color-highlight)' }}>A</span>
      </button>
      {show && (
        <ColorPicker
          label="Text background"
          value={color}
          anchor={btnRef.current}
          onChange={(c) => {
            if (c) editor.chain().focus().toggleHighlight({ color: c }).run();
            else editor.chain().focus().unsetHighlight().run();
          }}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

function SidebarAlignBtn({ editor, value, icon, label }: { editor: Editor; value: string; icon: string; label: string }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign(value).run(); }}
      title={label}
      className={`px-1 py-0.5 text-[8px] rounded transition-colors shrink-0 ${
        editor.isActive({ textAlign: value })
          ? 'bg-chrome/30 text-ink font-semibold'
          : 'text-ink-3 hover:text-ink hover:bg-paper-soft'
      }`}
    >
      {icon}
    </button>
  );
}

function SidebarTableToolbar({ editor }: { editor: Editor }) {
  const [showCellColor, setShowCellColor] = useState(false);
  const cellBtnRef = useRef<HTMLButtonElement>(null);

  const autoFitAll = () => {
    const { state, view } = editor;
    const { doc, selection } = state;
    const $pos = doc.resolve(selection.from);
    let tableNode = null;
    let tableStart = 0;
    for (let d = $pos.depth; d >= 0; d--) {
      if ($pos.node(d).type.name === 'table') {
        tableNode = $pos.node(d);
        tableStart = $pos.start(d);
        break;
      }
    }
    if (!tableNode) return;
    const tableDom = view.nodeDOM(tableStart - 1) as HTMLElement | null;
    const tableEl = tableDom?.querySelector('table') as HTMLTableElement | null ?? (tableDom instanceof HTMLTableElement ? tableDom : null);
    if (!tableEl) return;
    const numCols = tableEl.rows[0]?.cells.length ?? 0;
    if (numCols === 0) return;
    const span = document.createElement('span');
    span.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;white-space:nowrap;';
    document.body.appendChild(span);
    const widths: number[] = [];
    for (let c = 0; c < numCols; c++) {
      let maxW = 60;
      for (const row of Array.from(tableEl.rows)) {
        const cell = row.cells[c];
        if (!cell) continue;
        const cs = getComputedStyle(cell);
        span.style.font = cs.font;
        span.style.fontSize = cs.fontSize;
        span.style.fontFamily = cs.fontFamily;
        span.style.fontWeight = cs.fontWeight;
        span.style.letterSpacing = cs.letterSpacing;
        const paras = cell.querySelectorAll('p');
        const elems = paras.length > 0 ? Array.from(paras) : [cell];
        let cellMax = 0;
        for (const el of elems) {
          span.textContent = el.textContent || '';
          cellMax = Math.max(cellMax, span.offsetWidth);
        }
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
                   + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
        maxW = Math.max(maxW, cellMax + pad + 4);
      }
      widths.push(maxW);
    }
    document.body.removeChild(span);
    const tr = state.tr;
    let offset = 0;
    tableNode.forEach((row) => {
      let cellCol = 0;
      let cellOffset = 0;
      row.forEach((cellNode) => {
        const colspan = cellNode.attrs.colspan || 1;
        const cellPos = tableStart + offset + cellOffset + 1;
        const cw: number[] = [];
        for (let i = 0; i < colspan; i++) cw.push(widths[cellCol + i] ?? 60);
        tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, colwidth: cw });
        cellCol += colspan;
        cellOffset += cellNode.nodeSize;
      });
      offset += row.nodeSize;
    });
    view.dispatch(tr);
  };

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}
        className="px-1 py-0.5 text-[8px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors whitespace-nowrap shrink-0">+Row</button>
      <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}
        className="px-1 py-0.5 text-[8px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors whitespace-nowrap shrink-0">+Col</button>
      <Sep />
      <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteRow().run(); }}
        className="px-1 py-0.5 text-[8px] rounded text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap shrink-0">-Row</button>
      <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteColumn().run(); }}
        className="px-1 py-0.5 text-[8px] rounded text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap shrink-0">-Col</button>
      <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteTable().run(); }}
        className="px-1 py-0.5 text-[8px] rounded text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap shrink-0">-Tbl</button>
      <Sep />
      <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().mergeCells().run(); }}
        className="px-1 py-0.5 text-[8px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors whitespace-nowrap shrink-0">Merge</button>
      <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().splitCell().run(); }}
        className="px-1 py-0.5 text-[8px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors whitespace-nowrap shrink-0">Split</button>
      <Sep />
      <button onMouseDown={e => { e.preventDefault(); autoFitAll(); }}
        className="px-1 py-0.5 text-[8px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors whitespace-nowrap shrink-0">Fit</button>
      <button
        ref={cellBtnRef}
        onMouseDown={e => { e.preventDefault(); setShowCellColor(!showCellColor); }}
        title="Cell background color"
        className="px-1 py-0.5 text-[8px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors whitespace-nowrap shrink-0"
      >CellBG</button>
      {showCellColor && (
        <ColorPicker
          label="Cell background"
          value=""
          anchor={cellBtnRef.current}
          onChange={(c) => {
            if (c) editor.chain().focus().setCellAttribute('backgroundColor', c).run();
            else editor.chain().focus().setCellAttribute('backgroundColor', '').run();
          }}
          onClose={() => setShowCellColor(false)}
        />
      )}
    </div>
  );
}

function SidebarSubtaskRow({ subtask, onToggle, onTitleClick, onDelete }: {
  subtask: Subtask;
  onToggle: () => void;
  onTitleClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 py-0.5 group/st">
      <button onClick={onToggle} className="text-[9px] text-ink-3 hover:text-ink shrink-0 w-3 text-center">○</button>
      <span onClick={onTitleClick}
        className="flex-1 text-[10px] text-ink-2 truncate cursor-pointer hover:text-chrome transition-colors">{subtask.title}</span>
      <button onClick={onTitleClick}
        className="opacity-0 group-hover/st:opacity-100 p-0.5 text-ink-3 hover:text-ink transition-all shrink-0" title="Edit subtask">
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <button onClick={onDelete}
        className="opacity-0 group-hover/st:opacity-100 p-0.5 text-ink-3 hover:text-red-400 transition-all shrink-0" title="Delete subtask">
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

function SidebarSubtaskEditor({ subtask, onUpdate, onDelete, onClose }: {
  subtask: Subtask;
  onUpdate: (changes: Partial<Subtask>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(subtask.title);

  return (
    <div className="ml-3 mb-1 p-1.5 rounded bg-paper-soft/50 border border-border/30 space-y-1">
      <input value={title} onChange={e => setTitle(e.target.value)}
        onBlur={() => { if (title.trim() && title !== subtask.title) onUpdate({ title: title.trim() }); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (title.trim() && title !== subtask.title) onUpdate({ title: title.trim() }); onClose(); } if (e.key === 'Escape') onClose(); }}
        autoFocus
        className="w-full px-1.5 py-0.5 text-[10px] rounded border border-border bg-paper text-ink focus:outline-none focus:border-chrome" />

      <div className="flex items-center gap-0.5">
        <span className="text-[8px] text-ink-3 w-10 shrink-0">Status</span>
        {(['todo', 'in-progress', 'done'] as TaskStatus[]).map(s => (
          <button key={s} onClick={() => onUpdate({ status: s, done: s === 'done' })}
            className={`px-1 py-0.5 text-[8px] rounded transition-colors ${(subtask.status ?? (subtask.done ? 'done' : 'todo')) === s ? 'bg-chrome/30 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'}`}>
            {s === 'todo' ? 'Todo' : s === 'in-progress' ? 'Doing' : 'Done'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5">
        <span className="text-[8px] text-ink-3 w-10 shrink-0">Priority</span>
        {[1, 2, 3].map(p => (
          <button key={p} onClick={() => onUpdate({ priority: p as 1|2|3 })}
            className={`px-1 py-0.5 text-[8px] rounded transition-colors ${subtask.priority === p ? 'bg-chrome/30 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'}`}>
            {p === 1 ? 'High' : p === 2 ? 'Med' : 'Low'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[8px] text-ink-3 w-10 shrink-0">Due</span>
        <input type="date" value={subtask.dueDate ?? ''} onChange={e => onUpdate({ dueDate: e.target.value || undefined })}
          className="flex-1 px-1 py-0.5 text-[9px] rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome" />
      </div>

      <button onClick={onDelete}
        className="w-full py-0.5 text-[9px] text-red-400 hover:bg-red-500/10 rounded transition-colors mt-0.5">Delete</button>
    </div>
  );
}

function SidebarTaskEditor({ task, onUpdate, onDelete, onClose }: {
  task: Task;
  onUpdate: (changes: Partial<Task>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [newSubtask, setNewSubtask] = useState('');

  const addSubtask = () => {
    const t = newSubtask.trim();
    if (!t) return;
    const sub: Subtask = { id: Math.random().toString(36).substring(2, 10), title: t, done: false, priority: 2 as const };
    onUpdate({ subtasks: [...(task.subtasks || []), sub] });
    setNewSubtask('');
  };

  return (
    <div className="ml-5 mb-1.5 p-1.5 rounded bg-paper-soft/50 border border-border/30 space-y-1">
      <input value={title} onChange={e => setTitle(e.target.value)}
        onBlur={() => { if (title.trim() && title !== task.title) onUpdate({ title: title.trim() }); }}
        className="w-full px-1.5 py-0.5 text-[10px] rounded border border-border bg-paper text-ink focus:outline-none focus:border-chrome" />

      <div className="flex items-center gap-0.5">
        <span className="text-[8px] text-ink-3 w-10 shrink-0">Status</span>
        {(['todo', 'in-progress', 'done'] as TaskStatus[]).map(s => (
          <button key={s} onClick={() => onUpdate({ status: s })}
            className={`px-1 py-0.5 text-[8px] rounded transition-colors ${task.status === s ? 'bg-chrome/30 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'}`}>
            {s === 'todo' ? 'Todo' : s === 'in-progress' ? 'Doing' : 'Done'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5">
        <span className="text-[8px] text-ink-3 w-10 shrink-0">Priority</span>
        {[1, 2, 3].map(p => (
          <button key={p} onClick={() => onUpdate({ priority: p as 1|2|3 })}
            className={`px-1 py-0.5 text-[8px] rounded transition-colors ${task.priority === p ? 'bg-chrome/30 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'}`}>
            {p === 1 ? 'High' : p === 2 ? 'Med' : 'Low'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[8px] text-ink-3 w-10 shrink-0">Due</span>
        <input type="date" value={task.dueDate ?? ''} onChange={e => onUpdate({ dueDate: e.target.value || undefined })}
          className="flex-1 px-1 py-0.5 text-[9px] rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome" />
      </div>

      {/* Subtasks */}
      {(task.subtasks?.length ?? 0) > 0 && (
        <div className="space-y-0.5">
          <span className="text-[8px] text-ink-3">Subtasks</span>
          {task.subtasks!.map(st => (
            <SidebarSubtaskRow
              key={st.id}
              subtask={st}
              onToggle={() => {
                const updated = task.subtasks!.map(s => s.id === st.id ? { ...s, done: !s.done, status: (!s.done ? 'done' : 'todo') as TaskStatus } : s);
                onUpdate({ subtasks: updated });
              }}
              onEdit={(newTitle) => {
                const updated = task.subtasks!.map(s => s.id === st.id ? { ...s, title: newTitle } : s);
                onUpdate({ subtasks: updated });
              }}
              onDelete={() => onUpdate({ subtasks: task.subtasks!.filter(s => s.id !== st.id) })}
            />
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
          placeholder="+ subtask..."
          className="flex-1 px-1 py-0.5 text-[9px] rounded border border-transparent bg-transparent text-ink placeholder:text-ink-3/50 focus:outline-none focus:border-border focus:bg-paper-soft" />
      </div>

      <button onClick={onDelete}
        className="w-full py-0.5 text-[9px] text-red-400 hover:bg-red-500/10 rounded transition-colors mt-0.5">Delete Task</button>
    </div>
  );
}

class MemoErrorBoundary extends Component<
  { children: React.ReactNode; onClose: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('MemoEditor crash:', error, info.componentStack); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
          <p className="text-xs text-ink-3">{'메모 에디터를 불러올 수 없습니다.'}</p>
          <button onClick={this.props.onClose}
            className="px-3 py-1 text-xs rounded bg-chrome/30 text-ink hover:bg-chrome/50">
            Back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ToolBtn({ active, onClick, label, className = '' }: {
  active: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={`px-1 py-0.5 text-[9px] rounded transition-colors shrink-0 ${className} ${
        active ? 'bg-chrome/30 text-ink' : 'text-ink-3 hover:text-ink hover:bg-paper-soft'
      }`}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-3 bg-border mx-0.5 shrink-0" />;
}
