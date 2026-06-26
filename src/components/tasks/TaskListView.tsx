import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { readJsonFile, writeJsonFile } from '../../lib/fileSystem';
import { splitFrontmatter, parseFrontmatterFields, updateFrontmatterField, formatFrontmatterValue, joinFrontmatter } from '../../lib/frontmatter';
import { FILES, FOLDERS } from '../../lib/constants';
import { insertTodoToDailyLog, updateTodoInDailyLog, removeTodoFromDailyLog, syncDailyWithTodos } from '../../lib/dailyLogHelper';
import { Dropdown, type DropdownOption } from '../ui/Dropdown';
import { todayKey } from '../../lib/dateUtils';
import type { Task, TodosFile, TaskStatus, TaskPriority, Subtask } from '../../types/task';
import type { ProjectsFile } from '../../types/project';
// TaskCalendar moved to SidebarMode

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

const priorityColors: Record<TaskPriority, string> = {
  1: 'bg-badge-high-bg text-badge-high',
  2: 'bg-badge-med-bg text-badge-med',
  3: 'bg-badge-low-bg text-badge-low',
};

const priorityLabels: Record<TaskPriority, string> = {
  1: 'High',
  2: 'Med',
  3: 'Low',
};

const statusLabels: Record<TaskStatus, string> = {
  'todo': 'Todo',
  'in-progress': 'In Progress',
  'done': 'Done',
};

const statusOrder: TaskStatus[] = ['todo', 'in-progress', 'done'];

const statusFilters: { label: string; value: TaskStatus | 'active' | null }[] = [
  { label: 'All', value: null },
  { label: 'Active', value: 'active' },
  { label: 'Todo', value: 'todo' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Done', value: 'done' },
];

export function TaskListView() {
  const { dataDir, pendingTagFilter, clearPendingTagFilter } = useAppStore();
  const { tasks, setTasks, addTask, updateTask, removeTask, filterStatus, setFilterStatus, filterProject, setFilterProject, filterTag, setFilterTag } = useTaskStore();
  const { projects, setProjects } = useProjectStore();
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [taskConflict, setTaskConflict] = useState(false);
  const knownLastModified = useRef<string | null>(null);
  const lastPersistTime = useRef(0);

  const loadTasks = useCallback(() => {
    if (!dataDir) return;
    readJsonFile<TodosFile>(dataDir, FILES.todos).then((data) => {
      if (data?.todos) {
        setTasks(data.todos);
        knownLastModified.current = data.lastModified ?? null;
      }
    });
  }, [dataDir, setTasks]);

  const loadProjects = useCallback(() => {
    if (!dataDir) return;
    readJsonFile<ProjectsFile>(dataDir, FILES.projects).then((data) => {
      if (data?.projects) setProjects(data.projects);
    });
  }, [dataDir, setProjects]);

  useEffect(() => {
    loadTasks();
    loadProjects();
  }, [loadTasks, loadProjects]);

  useEffect(() => {
    const onTasksChanged = () => {
      if (Date.now() - lastPersistTime.current > 2000) {
        loadTasks();
        setTaskConflict(true);
      }
    };
    const onProjectsChanged = () => loadProjects();
    window.addEventListener('tasks-changed', onTasksChanged);
    window.addEventListener('projects-changed', onProjectsChanged);
    return () => {
      window.removeEventListener('tasks-changed', onTasksChanged);
      window.removeEventListener('projects-changed', onProjectsChanged);
    };
  }, [loadTasks, loadProjects]);

  useEffect(() => {
    if (!pendingTagFilter) return;
    setFilterTag(pendingTagFilter);
    clearPendingTagFilter();
  }, [pendingTagFilter, setFilterTag, clearPendingTagFilter]);

  const persist = useCallback(
    async (updatedTasks: Task[]) => {
      if (!dataDir) return;
      try {
        const current = await readJsonFile<TodosFile>(dataDir, FILES.todos);
        if (current?.lastModified && knownLastModified.current &&
            current.lastModified !== knownLastModified.current &&
            Date.now() - lastPersistTime.current > 2000) {
          setTaskConflict(true);
          setTasks(current.todos);
          knownLastModified.current = current.lastModified;
          return;
        }
      } catch {}
      const ts = new Date().toISOString();
      knownLastModified.current = ts;
      lastPersistTime.current = Date.now();
      await writeJsonFile(dataDir, FILES.todos, {
        version: 1,
        lastModified: ts,
        todos: updatedTasks,
      });
    },
    [dataDir, setTasks],
  );

  function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    const task: Task = {
      id: generateId(),
      title,
      status: 'todo',
      priority: 2,
      subtasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(newProjectId ? { projectId: newProjectId } : {}),
      ...(newDueDate ? { dueDate: newDueDate } : {}),
      ...(newStartDate ? { startDate: newStartDate } : {}),
      ...(newEndDate ? { endDate: newEndDate } : {}),
    };
    addTask(task);
    setNewTitle('');
    setNewProjectId('');
    setNewDueDate('');
    setNewStartDate('');
    setNewEndDate('');
    setShowAddOptions(false);
    persist([...tasks, task]);
    if (dataDir) {
      const projName = task.projectId
        ? projects.find(p => p.id === task.projectId)?.name ?? 'GENERAL'
        : 'GENERAL';
      insertTodoToDailyLog(dataDir, task.id, title, projName).catch(() => {});
    }
    if (task.tags?.length) {
      window.dispatchEvent(new CustomEvent('tags-changed'));
    }
  }

  async function cycleStatus(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const idx = statusOrder.indexOf(task.status);
    const next = statusOrder[(idx + 1) % statusOrder.length];
    updateTask(id, { status: next, updatedAt: new Date().toISOString() });
    await persist(tasks.map((t) => (t.id === id ? { ...t, status: next, updatedAt: new Date().toISOString() } : t)));
    if (dataDir) {
      const dateKey = todayKey();
      await syncDailyWithTodos(dataDir, dateKey);
      window.dispatchEvent(new CustomEvent('daily-log-updated'));
    }
  }

  async function handleUpdate(id: string, changes: Partial<Task>) {
    updateTask(id, { ...changes, updatedAt: new Date().toISOString() });
    const updated = tasks.map((t) => (t.id === id ? { ...t, ...changes, updatedAt: new Date().toISOString() } : t));
    await persist(updated);
    if (dataDir && (changes.title !== undefined || changes.projectId !== undefined)) {
      const task = updated.find((t) => t.id === id);
      if (task) {
        const projName = task.projectId
          ? projects.find(p => p.id === task.projectId)?.name ?? 'GENERAL'
          : 'GENERAL';
        updateTodoInDailyLog(dataDir, id, task.title, projName).catch(() => {});
      }
    }
    if (dataDir && changes.status !== undefined) {
      const dateKey = todayKey();
      await syncDailyWithTodos(dataDir, dateKey);
      window.dispatchEvent(new CustomEvent('daily-log-updated'));
    }
    if (changes.tags !== undefined || changes.subtasks !== undefined) {
      window.dispatchEvent(new CustomEvent('tags-changed'));
    }
  }

  function handleDelete(id: string) {
    const deleted = tasks.find((t) => t.id === id);
    removeTask(id);
    persist(tasks.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
    if (dataDir) {
      removeTodoFromDailyLog(dataDir, id).catch(() => {});
    }
    if (deleted?.tags?.length || deleted?.subtasks?.some(s => s.tags?.length)) {
      window.dispatchEvent(new CustomEvent('tags-changed'));
    }
  }

  const projectOptions: DropdownOption[] = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name, color: p.color })),
    [projects],
  );

  const filtered = tasks
    .filter((t) => !filterStatus || (filterStatus === 'active' ? t.status !== 'done' : t.status === filterStatus))
    .filter((t) => !filterProject || t.projectId === filterProject)
    .filter((t) => !filterTag || t.tags?.includes(filterTag) || t.subtasks?.some(s => s.tags?.includes(filterTag)));
  const sorted = [...filtered].sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {taskConflict && (
        <div className="px-4 py-1.5 bg-pastel-cream/50 border-b border-pastel-cream flex items-center justify-between shrink-0">
          <span className="text-xs text-ink-2">Tasks were updated from another device.</span>
          <button
            onClick={() => setTaskConflict(false)}
            className="px-2 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-muted/50 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-lg font-semibold text-ink">Tasks</h1>
        </div>

        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {statusFilters.map((f) => (
            <button
              key={f.label}
              onClick={() => setFilterStatus(f.value)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filterStatus === f.value
                  ? 'bg-chrome/30 text-ink font-medium'
                  : 'text-ink-3 hover:bg-paper-soft'
              }`}
            >
              {f.label}
            </button>
          ))}
          {projects.length > 0 && (
            <>
              <span className="w-px h-4 bg-border mx-1" />
              <Dropdown
                value={filterProject ?? ''}
                options={projectOptions}
                onChange={(v) => setFilterProject(v || null)}
                placeholder="All Projects"
                compact
              />
            </>
          )}
          {filterTag && (
            <>
              <span className="w-px h-4 bg-border mx-1" />
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-pastel-lavender/30 text-tag-text">
                #{filterTag}
                <button onClick={() => setFilterTag(null)} className="hover:text-red-400 ml-0.5">&times;</button>
              </span>
            </>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); handleAdd(); }}
          className="space-y-2"
        >
          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add a task..."
              className="flex-1 px-2.5 py-1.5 text-sm rounded-[var(--radius-sm)] border border-border bg-paper-soft text-ink placeholder:text-ink-3 focus:outline-none focus:border-chrome transition-colors"
            />
            {projects.length > 0 && (
              <Dropdown
                value={newProjectId}
                options={projectOptions}
                onChange={setNewProjectId}
                placeholder="Project"
              />
            )}
            <button
              type="button"
              onClick={() => setShowAddOptions(!showAddOptions)}
              className={`px-1.5 py-1.5 text-sm rounded-[var(--radius-sm)] border border-border transition-colors ${
                showAddOptions ? 'bg-chrome/30 text-ink' : 'text-ink-3 hover:bg-paper-soft'
              }`}
              title="Dates"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
            >
              Add
            </button>
          </div>
          {showAddOptions && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-ink-3 uppercase tracking-wider">Start</span>
                <input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-ink-3 uppercase tracking-wider">End</span>
                <input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-ink-3 uppercase tracking-wider">Due</span>
                <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome" />
              </div>
            </div>
          )}
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-1.5">
        {sorted.length === 0 && (
          <p className="text-sm text-ink-3 text-center py-6">No tasks yet.</p>
        )}
        {sorted.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            projects={projects}
            isEditing={editingId === task.id}
            onToggleEdit={() => setEditingId(editingId === task.id ? null : task.id)}
            onCycleStatus={() => cycleStatus(task.id)}
            onUpdate={(changes) => handleUpdate(task.id, changes)}
            onDelete={() => handleDelete(task.id)}
            dataDir={dataDir}
          />
        ))}
      </div>
    </div>
  );
}

function renderTitle(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let clean = text.replace(/\\([[\]()#*_~`>+\-!.|])/g, '$1');
  clean = clean.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  clean = clean.replace(/(\*\*|__)(.*?)\1/g, '$2');
  clean = clean.replace(/(\*|_)(.*?)\1/g, '$2');
  clean = clean.replace(/~~(.*?)~~/g, '$1');
  clean = clean.replace(/`([^`]*)`/g, '$1');

  while ((m = linkRe.exec(clean)) !== null) {
    if (m.index > last) parts.push(clean.slice(last, m.index));
    const label = m[1];
    const url = m[2];
    parts.push(
      <a
        key={m.index}
        href={url}
        onClick={(e) => { e.stopPropagation(); invoke('open_path', { path: url }).catch(() => window.open(url, '_blank')); e.preventDefault(); }}
        className="text-chrome hover:underline cursor-pointer"
        title={url}
      >
        {label}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < clean.length) parts.push(clean.slice(last));
  if (parts.length === 0) return [clean];
  return parts;
}

const statusColors: Record<TaskStatus, string> = {
  'todo': 'bg-paper-muted text-ink-3',
  'in-progress': 'bg-chrome/20 text-chrome',
  'done': 'bg-pastel-mint/30 text-ink-3',
};

function TaskRow({ task, projects, isEditing, onToggleEdit, onCycleStatus, onUpdate, onDelete, dataDir }: {
  task: Task;
  projects: { id: string; name: string; color: string }[];
  isEditing: boolean;
  onToggleEdit: () => void;
  onCycleStatus: () => void;
  onUpdate: (changes: Partial<Task>) => void;
  onDelete: () => void;
  dataDir: string | null;
}) {
  const [subtasksOpen, setSubtasksOpen] = useState(true);
  const [newSubtask, setNewSubtask] = useState('');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const subtasks = task.subtasks ?? [];
  const hasSubtasks = subtasks.length > 0;
  const proj = task.projectId ? projects.find(p => p.id === task.projectId) : null;

  const handleAddSubtask = () => {
    const t = newSubtask.trim();
    if (!t) return;
    const st: Subtask = {
      id: Math.random().toString(36).slice(2, 8),
      title: t,
      done: false,
      status: 'todo',
      priority: task.priority,
      startDate: todayKey(),
      ...(task.projectId ? { projectId: task.projectId } : {}),
      ...(task.tags?.length ? { tags: [...task.tags] } : {}),
      ...(task.endDate ? { dueDate: task.endDate, endDate: task.endDate } : {}),
    };
    onUpdate({ subtasks: [...subtasks, st] });
    setNewSubtask('');
  };

  const handleCycleSubStatus = (id: string) => {
    const updated = subtasks.map(s => {
      if (s.id !== id) return s;
      const cur = s.status ?? (s.done ? 'done' : 'todo');
      const next = statusOrder[(statusOrder.indexOf(cur) + 1) % statusOrder.length];
      return { ...s, status: next, done: next === 'done' };
    });
    const changes: Partial<Task> = { subtasks: updated };
    if (task.status === 'todo' && updated.some(s => s.status === 'in-progress')) {
      changes.status = 'in-progress';
    }
    onUpdate(changes);
  };

  const handleUpdateSubtask = (id: string, changes: Partial<Subtask>) => {
    const updated = subtasks.map(s => s.id === id ? { ...s, ...changes } : s);
    const taskChanges: Partial<Task> = { subtasks: updated };
    if (task.status === 'todo' && updated.some(s => s.status === 'in-progress')) {
      taskChanges.status = 'in-progress';
    }
    onUpdate(taskChanges);
  };

  const handleRemoveSubtask = (id: string) => {
    onUpdate({ subtasks: subtasks.filter(s => s.id !== id) });
  };

  return (
    <div className="border-b border-border/50">
      {/* Main row */}
      <div className="flex items-center gap-2 py-2 group">
        {/* Subtask toggle / checkbox area */}
        <div className="w-5 shrink-0 flex items-center justify-center">
          {hasSubtasks ? (
            <button onClick={() => setSubtasksOpen(!subtasksOpen)} className="text-ink-3 hover:text-ink transition-colors">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: subtasksOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ) : (
            <div className="w-2.5" />
          )}
        </div>

        {/* Status button */}
        <button
          onClick={onCycleStatus}
          className={`px-1.5 py-0.5 text-[10px] rounded font-medium shrink-0 transition-colors ${statusColors[task.status]}`}
          title="Click to change status"
        >
          {statusLabels[task.status]}
        </button>

        {/* Title */}
        <span
          onClick={onToggleEdit}
          className={`flex-1 text-sm cursor-pointer min-w-0 truncate ${task.status === 'done' ? 'text-ink-3 line-through' : 'text-ink'}`}
        >
          {renderTitle(task.title)}
        </span>

        {/* Project badge */}
        {proj && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full text-tag-text shrink-0" style={{ backgroundColor: proj.color + '30' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: proj.color }} />
            {proj.name}
          </span>
        )}

        {/* Tags preview */}
        {(task.tags?.length ?? 0) > 0 && (
          <span className="hidden sm:flex items-center gap-0.5 shrink-0">
            {task.tags!.slice(0, 2).map(t => (
              <span key={t} className="px-1 py-0 text-[9px] rounded bg-pastel-lavender/20 text-ink-3">{t}</span>
            ))}
            {task.tags!.length > 2 && <span className="text-[9px] text-ink-3">+{task.tags!.length - 2}</span>}
          </span>
        )}

        {/* Subtask progress bar */}
        {hasSubtasks && (() => {
          const done = subtasks.filter(s => s.done).length;
          const pct = Math.round((done / subtasks.length) * 100);
          return (
            <span className="flex items-center gap-1 shrink-0" title={`${done}/${subtasks.length} subtasks`}>
              <span className="w-12 h-1.5 bg-paper-muted rounded-full overflow-hidden">
                <span className="block h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--color-pastel-mint)' : 'var(--color-chrome)' }} />
              </span>
              <span className="text-[9px] text-ink-3 font-mono">{done}/{subtasks.length}</span>
            </span>
          );
        })()}

        {/* Source note badge */}
        {task.source_note && (
          <span
            className="text-[9px] text-ink-3 shrink-0 truncate max-w-[120px] cursor-help"
            title={`${task.source_note} > ${task.source_section ?? ''}`}
          >
            📎 {task.source_note.split('-').slice(3).join('-') || task.source_note}
          </span>
        )}

        {/* Due date */}
        {task.dueDate && (
          <button
            className={`text-[10px] font-mono shrink-0 px-1 py-0.5 rounded transition-colors hover:bg-paper-soft ${
              new Date(task.dueDate) < new Date(new Date().toDateString()) ? 'text-badge-high' : 'text-ink-3'
            }`}
            title={`Due: ${task.dueDate}`}
          >
            {new Date(task.dueDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
          </button>
        )}

        {/* Priority */}
        <button
          onClick={() => onUpdate({ priority: ((task.priority % 3) + 1) as TaskPriority })}
          title={`Priority: ${priorityLabels[task.priority]}`}
          className={`px-1.5 py-0.5 text-[10px] rounded font-medium shrink-0 ${priorityColors[task.priority]}`}
        >
          {priorityLabels[task.priority]}
        </button>

        {/* Edit / Delete */}
        <button onClick={onToggleEdit} className="opacity-0 group-hover:opacity-100 p-1 text-ink-3 hover:text-ink transition-all" title="Edit">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 p-1 text-ink-3 hover:text-red-400 transition-all">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Subtasks inline (always visible, collapsible) */}
      {subtasksOpen && (
        <div className="pl-10 pb-1.5">
          {subtasks.map(st => {
            const stStatus = st.status ?? (st.done ? 'done' : 'todo');
            const isEditingSub = editingSubId === st.id;
            return (
              <div key={st.id}>
                <div className="flex items-center gap-1.5 py-0.5 group/st">
                  <button onClick={() => handleCycleSubStatus(st.id)} className={`px-1 py-0 text-[9px] rounded font-medium shrink-0 transition-colors ${statusColors[stStatus]}`}>{statusLabels[stStatus]}</button>
                  <span onClick={() => setEditingSubId(isEditingSub ? null : st.id)} className={`flex-1 text-[11px] min-w-0 truncate cursor-pointer ${st.done ? 'text-ink-3 line-through' : 'text-ink'}`}>{renderTitle(st.title)}</span>
                  {(() => { const sp = st.projectId ? projects.find(p => p.id === st.projectId) : null; return sp ? (
                    <span className="inline-flex items-center gap-0.5 px-1 py-0 text-[8px] rounded-full text-tag-text shrink-0" style={{ backgroundColor: sp.color + '30' }}>
                      <span className="w-1 h-1 rounded-full" style={{ backgroundColor: sp.color }} />{sp.name}
                    </span>
                  ) : null; })()}
                  {(st.tags?.length ?? 0) > 0 && (
                    <span className="hidden sm:flex items-center gap-0.5 shrink-0">
                      {st.tags!.slice(0, 2).map(t => (
                        <span key={t} className="px-1 py-0 text-[8px] rounded bg-pastel-lavender/20 text-ink-3">{t}</span>
                      ))}
                      {st.tags!.length > 2 && <span className="text-[8px] text-ink-3">+{st.tags!.length - 2}</span>}
                    </span>
                  )}
                  {st.dueDate && (
                    <span className={`text-[9px] font-mono shrink-0 ${new Date(st.dueDate) < new Date(new Date().toDateString()) ? 'text-badge-high' : 'text-ink-3'}`}>
                      {new Date(st.dueDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  <button
                    onClick={() => handleUpdateSubtask(st.id, { priority: (((st.priority ?? 2) % 3) + 1) as TaskPriority })}
                    className={`px-1 py-0 text-[9px] rounded font-medium shrink-0 ${priorityColors[st.priority ?? 2]}`}
                  >{priorityLabels[st.priority ?? 2]}</button>
                  <button onClick={() => setEditingSubId(isEditingSub ? null : st.id)} className="opacity-0 group-hover/st:opacity-100 p-0.5 text-ink-3 hover:text-ink transition-all" title="Edit">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <button onClick={() => handleRemoveSubtask(st.id)} className="opacity-0 group-hover/st:opacity-100 text-ink-3 hover:text-red-400 text-[10px] transition-opacity shrink-0">&times;</button>
                </div>
                {isEditingSub && (
                  <ItemEditor item={st} projects={projects} onUpdate={(c) => handleUpdateSubtask(st.id, c)} onClose={() => setEditingSubId(null)} dataDir={dataDir} compact />
                )}
              </div>
            );
          })}
          {/* Inline add subtask */}
          <div className="flex gap-1 mt-0.5">
            <input
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask(); } }}
              placeholder="+ Add subtask..."
              className="flex-1 px-1.5 py-0.5 text-[10px] rounded border border-transparent bg-transparent text-ink placeholder:text-ink-3/50 focus:outline-none focus:border-border focus:bg-paper-soft"
            />
          </div>
        </div>
      )}

      {/* Expanded editor panel */}
      {isEditing && (
        <ItemEditor item={task} projects={projects} onUpdate={onUpdate} onClose={onToggleEdit} dataDir={dataDir} />
      )}
    </div>
  );
}

function ItemEditor({ item, projects, onUpdate, onClose, dataDir, compact }: {
  item: Task | Subtask;
  projects: { id: string; name: string; color: string }[];
  onUpdate: (changes: Partial<Task & Subtask>) => void;
  onClose: () => void;
  dataDir: string | null;
  compact?: boolean;
}) {
  const { openNote } = useAppStore();
  const allTasks = useTaskStore(s => s.tasks);
  const [title, setTitle] = useState(item.title);
  const [newTag, setNewTag] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);
  const [tagHighlight, setTagHighlight] = useState(0);
  const [allKnownTags, setAllKnownTags] = useState<string[]>([]);
  const [noteSearch, setNoteSearch] = useState('');
  const [noteResults, setNoteResults] = useState<{ id: string; title: string }[]>([]);
  const [linkedNoteTitles, setLinkedNoteTitles] = useState<Record<string, string>>({});
  const tags = item.tags ?? [];
  const relatedNotes = item.related_notes ?? [];
  const isSub = !('createdAt' in item);
  const curStatus = isSub
    ? ((item as Subtask).status ?? ((item as Subtask).done ? 'done' : 'todo'))
    : (item as Task).status;
  const editorProjectOptions: DropdownOption[] = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name, color: p.color })),
    [projects],
  );
  const sz = compact ? 'text-[9px]' : 'text-[10px]';
  const inputSz = compact ? 'text-[11px] px-1.5 py-0.5' : 'text-sm px-2 py-1';
  const wrap = compact ? 'ml-6 mb-1 p-1.5 rounded bg-paper-soft/50 border border-border/30 space-y-1' : 'pb-2 pl-10 pr-2 space-y-1.5 border-t border-border/30 pt-1.5 bg-paper-soft/30 rounded-b-lg';
  const labelW = compact ? 'w-12' : 'w-14';

  useEffect(() => {
    if (!dataDir || relatedNotes.length === 0) return;
    (async () => {
      const titles: Record<string, string> = {};
      try {
        const dir = await join(dataDir, FOLDERS.research);
        const files = await invoke<string[]>('list_notes', { dir });
        for (const f of files) {
          try {
            const raw = await invoke<string>('read_note', { path: f });
            const { frontmatter } = splitFrontmatter(raw);
            const fields = parseFrontmatterFields(frontmatter);
            if (fields.id && relatedNotes.includes(fields.id)) titles[fields.id] = fields.title ?? fields.id;
          } catch {}
        }
      } catch {}
      setLinkedNoteTitles(titles);
    })();
  }, [dataDir, relatedNotes]);

  useEffect(() => {
    const tagSet = new Set<string>();
    for (const t of allTasks) {
      t.tags?.forEach(tag => tagSet.add(tag));
      t.subtasks?.forEach(st => st.tags?.forEach(tag => tagSet.add(tag)));
    }
    if (!dataDir) { setAllKnownTags([...tagSet].sort()); return; }
    (async () => {
      try {
        const dir = await join(dataDir, FOLDERS.research);
        const files = await invoke<string[]>('list_notes', { dir });
        await Promise.all(files.map(async (f) => {
          try {
            const raw = await invoke<string>('read_note', { path: f });
            const { frontmatter } = splitFrontmatter(raw);
            const fields = parseFrontmatterFields(frontmatter);
            if (Array.isArray(fields.tags)) fields.tags.forEach((t: string) => { if (t) tagSet.add(t); });
          } catch {}
        }));
      } catch {}
      setAllKnownTags([...tagSet].sort());
    })();
  }, [dataDir, allTasks]);

  const handleSearchNotes = useCallback(async (q: string) => {
    if (!dataDir || q.length < 2) { setNoteResults([]); return; }
    try {
      const dir = await join(dataDir, FOLDERS.research);
      const files = await invoke<string[]>('list_notes', { dir });
      const results: { id: string; title: string }[] = [];
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        try {
          const raw = await invoke<string>('read_note', { path: f });
          const { frontmatter } = splitFrontmatter(raw);
          const fields = parseFrontmatterFields(frontmatter);
          const id = fields.id ?? '';
          const nt = fields.title ?? '';
          if (id.includes(q) || nt.toLowerCase().includes(q.toLowerCase())) {
            results.push({ id, title: nt });
            if (results.length >= 8) break;
          }
        } catch {}
      }
      setNoteResults(results.filter(r => !relatedNotes.includes(r.id)));
    } catch { setNoteResults([]); }
  }, [dataDir, relatedNotes]);

  useEffect(() => {
    const timer = setTimeout(() => handleSearchNotes(noteSearch), 300);
    return () => clearTimeout(timer);
  }, [noteSearch, handleSearchNotes]);

  const syncTagsToNote = useCallback(async (noteId: string, tagsToSync: string[]) => {
    if (!dataDir || tagsToSync.length === 0) return;
    try {
      const notePath = await join(dataDir, FOLDERS.research, `${noteId}.md`);
      const raw = await invoke<string>('read_note', { path: notePath });
      const { frontmatter, body } = splitFrontmatter(raw);
      const fields = parseFrontmatterFields(frontmatter);
      const existing: string[] = Array.isArray(fields.tags) ? fields.tags : [];
      const merged = [...existing];
      let changed = false;
      for (const t of tagsToSync) {
        if (!merged.includes(t)) {
          merged.push(t);
          changed = true;
        }
      }
      if (!changed) return;
      const updatedFm = updateFrontmatterField(frontmatter, 'tags', formatFrontmatterValue(merged));
      await invoke('write_note', { path: notePath, content: joinFrontmatter(updatedFm, body) });
      window.dispatchEvent(new CustomEvent('tags-changed'));
      window.dispatchEvent(new CustomEvent('notes-changed'));
    } catch {}
  }, [dataDir]);

  const normalizeTag = (raw: string) =>
    raw.trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');

  const commitTag = (tag: string) => {
    if (!tag || tags.includes(tag)) return;
    onUpdate({ tags: [...tags, tag] });
    setNewTag('');
    setTagSuggestionsOpen(false);
    setTagHighlight(0);
    for (const noteId of relatedNotes) {
      syncTagsToNote(noteId, [tag]);
    }
  };

  const handleAddTag = () => {
    commitTag(normalizeTag(newTag));
  };

  const handleTagInputChange = (val: string) => {
    setNewTag(val);
    const q = val.trim().toLowerCase();
    if (!q) {
      setTagSuggestionsOpen(false);
      setTagSuggestions([]);
      return;
    }
    const filtered = allKnownTags.filter(t => t.includes(q) && !tags.includes(t));
    setTagSuggestions(filtered.slice(0, 8));
    setTagSuggestionsOpen(filtered.length > 0);
    setTagHighlight(0);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (tagSuggestionsOpen && tagSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTagHighlight(i => (i + 1) % tagSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTagHighlight(i => (i - 1 + tagSuggestions.length) % tagSuggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && tagSuggestions[tagHighlight])) {
        e.preventDefault();
        commitTag(tagSuggestions[tagHighlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTagSuggestionsOpen(false);
        return;
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <div className={wrap}>
      {/* Title */}
      <input value={title} onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { if (title.trim() && title !== item.title) onUpdate({ title: title.trim() }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={`w-full rounded border border-border bg-paper text-ink focus:outline-none focus:border-chrome ${inputSz}`} />

      {/* Status */}
      <div className="flex items-center gap-1">
        <span className={`${sz} text-ink-3 uppercase tracking-wider ${labelW} shrink-0`}>Status</span>
        <div className="flex gap-0.5">
          {statusOrder.map(s => (
            <button key={s} onClick={() => onUpdate(isSub ? { status: s, done: s === 'done' } : { status: s })}
              className={`px-1.5 py-0.5 ${sz} rounded font-medium transition-colors ${curStatus === s ? statusColors[s] : 'text-ink-3 hover:bg-paper-soft'}`}
            >{statusLabels[s]}</button>
          ))}
        </div>
      </div>

      {/* Priority */}
      <div className="flex items-center gap-1">
        <span className={`${sz} text-ink-3 uppercase tracking-wider ${labelW} shrink-0`}>Priority</span>
        <div className="flex gap-0.5">
          {([1, 2, 3] as TaskPriority[]).map(p => {
            const curPri = isSub ? ((item as Subtask).priority ?? 2) : (item as Task).priority;
            return (
              <button key={p} onClick={() => onUpdate({ priority: p })}
                className={`px-1.5 py-0.5 ${sz} rounded font-medium transition-colors ${curPri === p ? priorityColors[p] : 'text-ink-3 hover:bg-paper-soft'}`}
              >{priorityLabels[p]}</button>
            );
          })}
        </div>
      </div>

      {/* Project */}
      {projects.length > 0 && (
        <div className="flex items-center gap-1">
          <span className={`${sz} text-ink-3 uppercase tracking-wider ${labelW} shrink-0`}>Project</span>
          <Dropdown value={item.projectId ?? ''} options={editorProjectOptions} onChange={(v) => onUpdate({ projectId: v || undefined })} placeholder="None" compact />
        </div>
      )}

      {/* Tags */}
      <div className="flex items-start gap-1">
        <span className={`${sz} text-ink-3 uppercase tracking-wider ${labelW} shrink-0 pt-1`}>Tags</span>
        <div className="flex-1 flex items-center gap-1 flex-wrap">
          {tags.map(tag => (
            <span key={tag} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 ${sz} rounded-full bg-pastel-lavender/30 text-tag-text`}>
              {tag}<button onClick={() => onUpdate({ tags: tags.filter(t => t !== tag) })} className="hover:text-red-400 ml-0.5">&times;</button>
            </span>
          ))}
          <div className="relative">
            <input value={newTag} onChange={(e) => handleTagInputChange(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => setTimeout(() => setTagSuggestionsOpen(false), 150)}
              onFocus={() => { if (newTag.trim()) handleTagInputChange(newTag); }}
              placeholder="+ tag" className={`w-20 px-1 py-0.5 ${sz} rounded border border-transparent bg-transparent text-ink focus:outline-none focus:border-border focus:bg-paper-soft`} />
            {tagSuggestionsOpen && tagSuggestions.length > 0 && (
              <div className="absolute left-0 top-full mt-0.5 bg-paper border border-border rounded shadow-lg z-10 max-h-28 overflow-y-auto min-w-[120px]">
                {tagSuggestions.map((s, i) => (
                  <button key={s}
                    onMouseDown={(e) => { e.preventDefault(); commitTag(s); }}
                    className={`w-full text-left px-2 py-1 ${sz} truncate transition-colors ${
                      i === tagHighlight ? 'bg-chrome/15 text-ink' : 'text-ink hover:bg-paper-soft'
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="flex items-start gap-1">
        <span className={`${sz} text-ink-3 uppercase tracking-wider ${labelW} shrink-0 pt-1`}>Notes</span>
        <div className="flex-1">
          {relatedNotes.map(noteId => (
            <div key={noteId} className="flex items-center gap-1 py-0.5 group/rn">
              <button onClick={async () => { if (!dataDir) return; openNote(await join(dataDir, FOLDERS.research, `${noteId}.md`)); }}
                className={`${sz} text-chrome hover:underline truncate text-left`}>{linkedNoteTitles[noteId] || noteId}</button>
              <button onClick={() => onUpdate({ related_notes: relatedNotes.filter(n => n !== noteId) })}
                className={`opacity-0 group-hover/rn:opacity-100 text-ink-3 hover:text-red-400 ${sz}`}>&times;</button>
            </div>
          ))}
          <div className="relative">
            <input value={noteSearch} onChange={(e) => setNoteSearch(e.target.value)} placeholder="Search notes..."
              className={`w-full px-1.5 py-0.5 ${sz} rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome`} />
            {noteResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-0.5 bg-paper border border-border rounded shadow-lg z-10 max-h-28 overflow-y-auto">
                {noteResults.map(n => (
                  <button key={n.id}
                    onClick={() => { onUpdate({ related_notes: [...relatedNotes, n.id] }); setLinkedNoteTitles(p => ({ ...p, [n.id]: n.title })); setNoteSearch(''); setNoteResults([]); syncTagsToNote(n.id, tags); }}
                    className={`w-full text-left px-2 py-1 ${sz} text-ink hover:bg-paper-soft truncate`}>
                    <span className="text-chrome">{n.id}</span> {n.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dates */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className={`${sz} text-ink-3 uppercase`}>Start</span>
          <input type="date" value={item.startDate ?? ''} onChange={(e) => onUpdate({ startDate: e.target.value || undefined })}
            className={`px-1.5 py-0.5 ${sz} rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome`} />
        </div>
        <div className="flex items-center gap-1">
          <span className={`${sz} text-ink-3 uppercase`}>Due</span>
          <input type="date" value={item.dueDate ?? ''} onChange={(e) => onUpdate({ dueDate: e.target.value || undefined })}
            className={`px-1.5 py-0.5 ${sz} rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome`} />
        </div>
        <div className="flex items-center gap-1">
          <span className={`${sz} text-ink-3 uppercase`}>End</span>
          <input type="date" value={item.endDate ?? ''} onChange={(e) => onUpdate({ endDate: e.target.value || undefined })}
            className={`px-1.5 py-0.5 ${sz} rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome`} />
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={onClose} className={`px-2 py-0.5 ${sz} rounded text-ink-3 hover:bg-paper-soft transition-colors`}>Close</button>
      </div>
    </div>
  );
}
