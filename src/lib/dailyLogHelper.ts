import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { format, subDays } from "date-fns";
import { FOLDERS, FILES } from "./constants";
import {
  splitFrontmatter,
  joinFrontmatter,
  parseFrontmatterFields,
} from "./frontmatter";
import { readJsonFile, writeJsonFile } from "./fileSystem";
import { normalizeProject, NOTE_TYPE_LABELS, NOTE_TYPE_ICONS } from "../types/note";
import type { NoteType } from "../types/note";
import type { Task, TodosFile } from "../types/task";
import {
  parseTaskLine,
  splitSubtaskId,
  isCarryOverText,
  findParentTaskId,
} from "./taskSync";

export interface ExistingNote {
  id: string;
  title: string;
  noteType: string;
  project: string[];
  topic: string;
}

export interface CarriedItem {
  text: string;
  project: string;
  todoId?: string;
  done?: boolean;
  carryCount?: number;
}

export interface ActiveTodo {
  id: string;
  title: string;
  project: string;
  dueDate?: string;
  /** yyyy-MM-dd — future-start tasks render dimmed with a (시작 M/D) badge */
  startDate?: string;
  isOverdue: boolean;
  subtasks?: { id: string; title: string; done: boolean; startDate?: string }[];
}

const PROJECT_HEADING_RE = /^###\s+🛰️\s+(.+)$/;
const GENERAL_HEADING_RE = /^###\s+📌\s+GENERAL$/;
const UNCHECKED_RE = /^- \[ \] (.+)$/;
const TODO_ID_RE = /^\\?\[([^\]\\]+)\\?\]\s*/;

/** Write todos.json and immediately nudge task views. The fs watcher has an
 *  800ms debounce and write locks, so relying on it leaves the Tasks tab
 *  stale when the user switches views right after an edit. */
async function writeTodosFile(dataDir: string, data: TodosFile): Promise<void> {
  await writeJsonFile(dataDir, FILES.todos, data);
  window.dispatchEvent(new CustomEvent("tasks-changed"));
}

function extractProjectFromContext(lines: string[], lineIndex: number): string {
  for (let i = lineIndex - 1; i >= 0; i--) {
    if (GENERAL_HEADING_RE.test(lines[i])) return "GENERAL";
    const pm = lines[i].match(PROJECT_HEADING_RE);
    if (pm) return pm[1].trim();
    // User-typed headings without the 🛰️ emoji (### KCS) count too —
    // strip any leading emoji/symbol cluster and use the rest as the name.
    const gm = lines[i].match(/^###\s+(.+)$/);
    if (gm) {
      const name = gm[1].replace(/^[^\p{L}\p{N}]+\s*/u, "").trim();
      if (name.toUpperCase() === "GENERAL") return "GENERAL";
      if (name) return name;
    }
    if (lines[i].startsWith("## ")) break;
  }
  return "GENERAL";
}

export async function getCarriedOverItems(
  dataDir: string,
  currentDate: Date,
): Promise<CarriedItem[]> {
  const items: CarriedItem[] = [];

  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos).catch(() => null);
  const doneTodos = new Set<string>();
  const todoCarryCount = new Map<string, number>();
  const titleToTodoId = new Map<string, string>();
  if (todosFile?.todos) {
    for (const t of todosFile.todos) {
      if (t.status === "done") doneTodos.add(t.id);
      if (t.carry_count) todoCarryCount.set(t.id, t.carry_count);
      if (t.status !== "done") {
        titleToTodoId.set(t.title.trim().toLowerCase(), t.id);
      }
    }
  }

  try {
    // The immediately-previous day may have no file (weekend, skipped days,
    // creating a past date retroactively) — walk back up to 7 days to the
    // most recent daily log that actually exists.
    let raw: string | null = null;
    for (let back = 1; back <= 7 && raw === null; back++) {
      const key = format(subDays(currentDate, back), "yyyy-MM-dd");
      try {
        const p = await join(dataDir, FOLDERS.daily, `${key}.md`);
        raw = await invoke<string>("read_note", { path: p });
      } catch {
        raw = null;
      }
    }
    if (raw === null) return items;
    const { body } = splitFrontmatter(raw);
    const lines = body.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(UNCHECKED_RE);
      if (!m) continue;
      let text = m[1];
      const project = extractProjectFromContext(lines, i);

      let todoId: string | undefined;
      const tidMatch = text.match(TODO_ID_RE);
      if (tidMatch) {
        todoId = tidMatch[1];
        text = text.slice(tidMatch[0].length);
      }

      // 서브태스크(TASK-NNN.M)는 부모와 함께 렌더링된다 — 여기서 주우면
      // 최상위 이월 항목으로 승격되어 중복이 생긴다 (부모 줄이 지워지며
      // 최상위로 올라온 잔재 포함).
      if (todoId && splitSubtaskId(todoId)) continue;

      if (/^\(이월/.test(text) || /^\\?\(이월/.test(text)) {
        if (todoId) {
          text = text.replace(/^\\?\(이월[^)]*\)\s*/, "").trim();
          if (!text) continue;
        } else {
          continue;
        }
      }

      // Skip empty/whitespace-only items (e.g. default template placeholder)
      if (text.replace(/[​‌‍﻿]/g, "").trim() === "") continue;

      if (!todoId) {
        const stripped = text
          .replace(/\s*\((?:⚠️\s*)?D[+-]?\d+\)$/, "")
          .replace(/\s*\(⚠️\s*D-Day\)$/, "")
          .trim().toLowerCase();
        const matchedId = titleToTodoId.get(stripped);
        if (matchedId) {
          todoId = matchedId;
        }
      }

      const done = todoId ? doneTodos.has(todoId) : false;
      const carryCount = todoId ? (todoCarryCount.get(todoId) ?? 0) : 0;
      items.push({ text, project, todoId, done, carryCount });
    }
  } catch {
    // no previous daily log
  }

  return items;
}

export async function getActiveTodos(
  dataDir: string,
  dateKey: string,
  projectMap?: Map<string, string>,
): Promise<ActiveTodo[]> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return [];

  const today = new Date(dateKey + "T00:00:00");

  // Future-start tasks are included too — they render dimmed with a
  // (시작 M/D) badge so they can be started (and completed) early.
  return todosFile.todos
    .filter((t: Task) => t.status !== "done")
    .map((t: Task) => {
      const isOverdue = t.dueDate ? new Date(t.dueDate) <= today : false;
      const project = t.projectId
        ? (projectMap?.get(t.projectId) ?? t.projectId)
        : "GENERAL";
      return {
        id: t.id,
        title: t.title,
        project,
        dueDate: t.dueDate,
        startDate: t.startDate,
        isOverdue,
        subtasks: t.subtasks?.length ? t.subtasks.map(s => ({ id: s.id, title: s.title, done: s.done, startDate: s.startDate })) : undefined,
      };
    });
}

function daysUntilDue(dueDate: string, dateKey: string): number {
  const due = new Date(dueDate + "T00:00:00").getTime();
  const now = new Date(dateKey + "T00:00:00").getTime();
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

export async function getExistingNotesForDate(
  dataDir: string,
  dateKey: string,
): Promise<ExistingNote[]> {
  const results: ExistingNote[] = [];
  try {
    const dir = await join(dataDir, FOLDERS.research);
    const files = await invoke<string[]>("list_notes", { dir });
    for (const f of files) {
      try {
        const raw = await invoke<string>("read_note", { path: f });
        const { frontmatter } = splitFrontmatter(raw);
        const fields = parseFrontmatterFields(frontmatter);
        const noteDate = fields.date ?? (fields.created ?? "").slice(0, 10);
        if (noteDate === dateKey && fields.id && fields.type !== "daily-log") {
          results.push({
            id: fields.id,
            title: fields.title ?? fields.id,
            noteType: fields.type ?? "analysis-note",
            project: normalizeProject(fields.project),
            topic: fields.topic ?? "",
          });
        }
      } catch {}
    }
  } catch {}
  return results;
}

function formatStartTag(startDate: string): string {
  const [, m, d] = startDate.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function formatDueTag(dueDate: string, dateKey: string): string {
  const d = daysUntilDue(dueDate, dateKey);
  if (d < 0) return `⚠️ D+${Math.abs(d)}`;
  if (d === 0) return "⚠️ D-Day";
  return `D-${d}`;
}

export function buildDailyLogBody(
  carriedItems: CarriedItem[],
  activeTodos: ActiveTodo[],
  dateKey: string,
  existingNotes: ExistingNote[] = [],
  projectMap?: Map<string, string>,
): string {
  const projectSections = new Map<string, string[]>();

  const resolveName = (raw: string): string => {
    if (!projectMap || raw === "GENERAL") return raw;
    return projectMap.get(raw) ?? raw;
  };

  const addToProject = (project: string, line: string) => {
    const resolved = resolveName(project);
    if (!projectSections.has(resolved)) projectSections.set(resolved, []);
    projectSections.get(resolved)!.push(line);
  };

  const usedTodoIds = new Set<string>();
  const carriedTitles = new Set<string>();

  const todoById = new Map<string, ActiveTodo>();
  for (const t of activeTodos) todoById.set(t.id, t);

  // Subtask lines carry a `parentId.N` ref so checkbox toggles/edits in the
  // daily note can sync back to the parent's subtasks[] in todos.json.
  const subtaskRef = (parentId: string, st: { id: string }, idx: number): string => {
    const sp = splitSubtaskId(st.id);
    return sp && sp.parentId === parentId ? st.id : `${parentId}.${idx + 1}`;
  };
  const addSubtasks = (project: string, todo: ActiveTodo) => {
    if (!todo.subtasks?.length) return;
    todo.subtasks.forEach((st, idx) => {
      const check = st.done ? "[x]" : "[ ]";
      // 서브태스크도 시작일 표시 — 부모보다 먼저 시작하는 사전작업이면
      // 태그 없이 활성으로, 미래 시작이면 배지+음영
      const stStart = st.startDate && st.startDate > dateKey
        ? `(시작 ${formatStartTag(st.startDate)}) `
        : "";
      addToProject(project, `  - ${check} [${subtaskRef(todo.id, st, idx)}] ${stStart}${st.title}`);
    });
  };

  for (const item of carriedItems) {
    const matchedTodo = item.todoId ? todoById.get(item.todoId) : undefined;
    // 시작일이 아직 안 된 task는 "이월"이 아니다 — 이월 태그/카운트 없이
    // 아래 activeTodos 루프에서 (시작 M/D) 배지로 렌더링되게 넘긴다.
    if (matchedTodo?.startDate && matchedTodo.startDate > dateKey) continue;
    const prefix = item.todoId ? `[${item.todoId}] ` : "";
    const check = item.done ? "[x]" : "[ ]";
    const carryTag = (item.carryCount ?? 0) >= 3
      ? `(이월, 🔴 D+${item.carryCount} 연속 이월)`
      : "(이월)";
    let cleanText = item.text
      .replace(/\\?\(시작 [^)]*\\?\)\s*/g, "")
      .replace(/\s*\((?:⚠️\s*)?D[+-]?\d+\)$/, "")
      .replace(/\s*\(⚠️\s*D-Day\)$/, "")
      .trim();
    if (matchedTodo?.dueDate) {
      cleanText += ` (${formatDueTag(matchedTodo.dueDate, dateKey)})`;
    }
    addToProject(item.project, `- ${check} ${prefix}${carryTag} ${cleanText}`);
    if (matchedTodo) addSubtasks(item.project, matchedTodo);
    if (item.todoId) usedTodoIds.add(item.todoId);
    const stripped = item.text
      .replace(/\s*\((?:⚠️\s*)?D[+-]?\d+\)$/, "")
      .replace(/\s*\(⚠️\s*D-Day\)$/, "")
      .trim().toLowerCase();
    if (stripped) carriedTitles.add(stripped);
  }

  for (const todo of activeTodos) {
    if (usedTodoIds.has(todo.id)) continue;
    if (carriedTitles.has(todo.title.trim().toLowerCase())) continue;
    const dueTag = todo.dueDate
      ? ` (${formatDueTag(todo.dueDate, dateKey)})`
      : "";
    const startTag = todo.startDate && todo.startDate > dateKey
      ? `(시작 ${formatStartTag(todo.startDate)}) `
      : "";
    addToProject(todo.project, `- [ ] [${todo.id}] ${startTag}${todo.title}${dueTag}`);
    addSubtasks(todo.project, todo);
  }

  const lines: string[] = [];
  lines.push("## 작업");
  lines.push("");

  const generalItems = projectSections.get("GENERAL");
  projectSections.delete("GENERAL");

  for (const [project, items] of projectSections) {
    lines.push(`### 🛰️ ${project}`);
    for (const item of items) lines.push(item);
  }

  lines.push("### 📌 GENERAL");
  if (generalItems?.length) {
    for (const item of generalItems) lines.push(item);
  } else {
    lines.push("- [ ] ​");
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 메모");
  lines.push("");
  lines.push("<!-- #토픽명을 붙이면 해당 Topic Hub에 자동 연결 -->");
  lines.push("");
  lines.push("- ");
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 노트");
  lines.push("");
  lines.push("<!-- 자동 집계 -->");
  lines.push("");
  lines.push("| 유형 | 제목 | 프로젝트 | 토픽 |");
  lines.push("|---|---|---|---|");
  if (existingNotes.length > 0) {
    for (const n of existingNotes) {
      const icon = NOTE_TYPE_ICONS[n.noteType as NoteType] ?? "📝";
      const label = NOTE_TYPE_LABELS[n.noteType as NoteType] ?? "Note";
      lines.push(`| ${label} | [${icon} ${n.title}](note://${n.id}) | ${n.project.join(", ")} | ${n.topic} |`);
    }
  } else {
    lines.push("|  |  |  |  |");
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 내일");
  lines.push("");
  lines.push("<!-- ⚡ - [ ] → 자동 TODO + 내일 작업에 표시 -->");
  lines.push("");
  lines.push("- [ ] ");
  lines.push("");

  return "\n" + lines.join("\n") + "\n";
}

export async function incrementCarryCount(
  dataDir: string,
  todoId: string,
): Promise<number> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return 0;

  let newCount = 0;
  const updated = todosFile.todos.map((t: Task) => {
    if (t.id === todoId) {
      newCount = (t.carry_count ?? 0) + 1;
      return { ...t, carry_count: newCount };
    }
    return t;
  });

  await writeTodosFile(dataDir, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });

  return newCount;
}

export function generateDailyLogSummary(body: string): string {
  const lines = body.split("\n");

  // Extract checked items
  const checkedItems: string[] = [];
  for (const line of lines) {
    const m = line.match(/^- \[x\] (.+)$/);
    if (m) {
      let text = m[1].replace(/^\\?\[[^\]\\]+\\?\]\s*/, "");
      text = text.replace(/^\\?\(이월[^)]*\\?\)\s*/, "");
      checkedItems.push(text.trim());
    }
  }

  // Extract first line of insight section (## 인사이트)
  let insightLine = "";
  for (let i = 0; i < lines.length; i++) {
    if (/^## 인사이트/.test(lines[i])) {
      // Find the first non-empty content line after the heading
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (trimmed === "" || trimmed === "---") continue;
        if (trimmed.startsWith("## ")) break;
        // Strip leading "- " if present
        insightLine = trimmed.replace(/^-\s*/, "").trim();
        break;
      }
      break;
    }
  }

  // Combine into summary
  const parts: string[] = [];

  if (checkedItems.length > 0) {
    parts.push(checkedItems.join(", "));
  }

  if (insightLine) {
    parts.push(insightLine);
  }

  let summary = parts.join(" | ");

  // Truncate to 100 characters
  if (summary.length > 100) {
    summary = summary.slice(0, 97) + "...";
  }

  return summary;
}

/**
 * Detect todo IDs whose checkboxes changed from unchecked to checked between
 * the previous and current markdown body.
 */
export function detectNewlyCheckedTodos(prev: string, next: string): string[] {
  // parseTaskLine handles indentation, so subtask lines ([TASK-011.1]) are included
  const prevUnchecked = new Set<string>();
  for (const line of prev.split("\n")) {
    const p = parseTaskLine(line);
    if (p?.id && !p.checked) prevUnchecked.add(p.id);
  }

  const newlyChecked: string[] = [];
  for (const line of next.split("\n")) {
    const p = parseTaskLine(line);
    if (p?.id && p.checked && prevUnchecked.has(p.id)) {
      newlyChecked.push(p.id);
    }
  }

  return newlyChecked;
}

/**
 * Detect todo IDs whose checkboxes changed from checked to unchecked (reopened).
 */
export function detectNewlyUncheckedTodos(prev: string, next: string): string[] {
  const prevChecked = new Set<string>();
  for (const line of prev.split("\n")) {
    const p = parseTaskLine(line);
    if (p?.id && p.checked) prevChecked.add(p.id);
  }

  const newlyUnchecked: string[] = [];
  for (const line of next.split("\n")) {
    const p = parseTaskLine(line);
    if (p?.id && !p.checked && prevChecked.has(p.id)) {
      newlyUnchecked.push(p.id);
    }
  }

  return newlyUnchecked;
}

/**
 * Set a subtask's done state. `subRef` is the `parentId.N` form used in daily
 * notes: resolved first by exact subtask id, then positionally (index N-1) for
 * legacy subtasks created with random ids.
 */
async function setSubtaskDone(
  dataDir: string,
  parentId: string,
  subRef: string,
  done: boolean,
): Promise<void> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return;

  const subIndex = splitSubtaskId(subRef)?.subIndex ?? -1;
  let changed = false;
  const updated = todosFile.todos.map((t: Task) => {
    if (t.id !== parentId || !t.subtasks?.length) return t;
    let idx = t.subtasks.findIndex((s) => s.id === subRef);
    if (idx < 0 && subIndex >= 1 && subIndex <= t.subtasks.length) idx = subIndex - 1;
    if (idx < 0 || t.subtasks[idx].done === done) return t;
    changed = true;
    const subtasks = t.subtasks.map((s, i) =>
      i === idx ? { ...s, done, status: done ? ("done" as const) : ("in-progress" as const) } : s,
    );
    return { ...t, subtasks, updatedAt: new Date().toISOString() };
  });

  if (!changed) return;
  await writeTodosFile(dataDir, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });
}

/**
 * Reopen a todo in todos.json, setting status='in-progress' and clearing endDate.
 * Accepts subtask refs (`parentId.N`) and toggles the subtask instead.
 */
export async function reopenTodo(
  dataDir: string,
  todoId: string,
): Promise<void> {
  const sub = splitSubtaskId(todoId);
  if (sub) return setSubtaskDone(dataDir, sub.parentId, todoId, false);

  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return;

  const updated = todosFile.todos.map((t: Task) => {
    if (t.id === todoId && t.status === "done") {
      const { endDate: _, ...rest } = t;
      return {
        ...rest,
        status: "in-progress" as const,
        updatedAt: new Date().toISOString(),
      };
    }
    return t;
  });

  await writeTodosFile(dataDir, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });
}

/**
 * Mark a todo as done in todos.json, setting status='done' and endDate to today.
 * Accepts subtask refs (`parentId.N`) and toggles the subtask instead.
 */
export async function completeTodo(
  dataDir: string,
  todoId: string,
): Promise<void> {
  const sub = splitSubtaskId(todoId);
  if (sub) return setSubtaskDone(dataDir, sub.parentId, todoId, true);

  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return;

  const today = format(new Date(), "yyyy-MM-dd");
  const updated = todosFile.todos.map((t: Task) => {
    if (t.id === todoId) {
      return {
        ...t,
        status: "done" as const,
        endDate: today,
        updatedAt: new Date().toISOString(),
      };
    }
    return t;
  });

  await writeTodosFile(dataDir, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });
}

const TODO_CHECKBOX_RE = /^([ \t]*- \[)([ xX])(\] )/;

/** Insert a task line at the end of its project section in the 작업 area,
 *  creating the `### 🛰️ name` heading (before GENERAL) when missing. */
function insertLineUnderProject(lines: string[], project: string, newLine: string): void {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^###\s+(.+)$/);
    if (!m) continue;
    const name = m[1].replace(/^[^\p{L}\p{N}]+\s*/u, "").trim();
    if (name === project || (project === "GENERAL" && name.toUpperCase() === "GENERAL")) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    const heading = project === "GENERAL" ? "### 📌 GENERAL" : `### 🛰️ ${project}`;
    let at = lines.findIndex((l) => GENERAL_HEADING_RE.test(l.trim()));
    if (at === -1) {
      const taskIdx = lines.findIndex((l) => /^## 작업/.test(l.trim()));
      at = taskIdx >= 0 ? taskIdx + 1 : 0;
    }
    lines.splice(at, 0, heading, newLine);
    return;
  }
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (/^###\s/.test(t) || /^## /.test(t) || /^---/.test(t)) {
      end = j;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, newLine);
}

export async function syncDailyWithTodos(
  dataDir: string,
  dateKey: string,
  /** Re-insert active tasks missing from the body (today's daily only) —
   *  without this, a task whose line got lost never reappears. */
  appendMissingActive = false,
  /** Also re-insert tasks created within the last 10 minutes. Only for
   *  explicit user actions in the Tasks tab — automatic load-time syncs must
   *  keep the freshness guard so mid-typing junk doesn't resurrect. */
  includeFresh = false,
): Promise<string | null> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return null;

  const todoMap = new Map<string, Task>();
  for (const t of todosFile.todos) {
    todoMap.set(t.id, t);
  }

  const dailyPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);
  let raw: string;
  try {
    raw = await invoke<string>("read_note", { path: dailyPath });
  } catch {
    return null;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  // Future-start tasks are NOT removed — they stay visible (dimmed via the
  // (시작 M/D) tag) so the user can start or complete them early.
  const lines: string[] = body.split("\n");
  let changed = false;

  // What checkbox state todos.json says a given ref should have.
  const desiredDone = (id: string): boolean | undefined => {
    const sub = splitSubtaskId(id);
    if (sub) {
      const parent = todoMap.get(sub.parentId);
      if (!parent?.subtasks?.length) return undefined;
      let st = parent.subtasks.find((s) => s.id === id);
      if (!st && sub.subIndex >= 1 && sub.subIndex <= parent.subtasks.length) {
        st = parent.subtasks[sub.subIndex - 1];
      }
      return st?.done;
    }
    const todo = todoMap.get(id);
    return todo ? todo.status === "done" : undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const p = parseTaskLine(lines[i]);
    if (!p?.id) continue;
    const isDone = desiredDone(p.id);
    if (isDone !== undefined && isDone !== p.checked) {
      lines[i] = lines[i].replace(TODO_CHECKBOX_RE, isDone ? "$1x$3" : "$1 $3");
      changed = true;
    }

    // Maintain the (시작 M/D) tag: present while the start date is in the
    // future, removed automatically once the day arrives.
    if (p.indent === 0) {
      const todo = todoMap.get(p.id);
      if (todo) {
        const wantTag = !!(todo.startDate && todo.startDate > dateKey);
        // 손상 치유 1: 시작 전 task에 (이월...) 태그가 붙어 있으면 제거 —
        // 시작일이 안 됐으면 이월(D+N)로 취급하지 않는다
        if (wantTag && /\\?\(이월[^)]*\\?\)/.test(lines[i])) {
          lines[i] = lines[i].replace(/\\?\(이월[^)]*\\?\)\s*/g, "");
          changed = true;
        }
        // 손상 치유 2: (시작 ...) 태그 중복/불필요 — 전부 제거 후 아래에서
        // 필요하면 하나만 다시 삽입 (제목 접두사만 보던 기존 검사는
        // (이월) 뒤에 붙은 태그를 못 봐서 중복 삽입했음)
        const startTags = lines[i].match(/\\?\(시작 [^)]*\\?\)/g) ?? [];
        if (startTags.length > 1 || (startTags.length === 1 && !wantTag)) {
          lines[i] = lines[i].replace(/\\?\(시작 [^)]*\\?\)\s*/g, "");
          changed = true;
        }
        const hasTag = /\\?\(시작 /.test(lines[i]);
        if (wantTag && !hasTag) {
          lines[i] = lines[i].replace(
            /^([ \t]*- \[[ xX]\] \\?\[[^\]\\]+\\?\]\s*)/,
            `$1(시작 ${formatStartTag(todo.startDate!)}) `,
          );
          changed = true;
        }
      }
    }
  }

  // 손상 치유 3: 부모 줄이 지워지며 최상위로 승격된 서브태스크 잔재 제거 —
  // 부모 task 줄이 문서에 존재하면 그 밑에서 렌더링되므로 중복이다.
  {
    const topLevelIds = new Set<string>();
    for (const line of lines) {
      const p = parseTaskLine(line);
      if (p?.id && p.indent === 0 && !splitSubtaskId(p.id)) topLevelIds.add(p.id);
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const p = parseTaskLine(lines[i]);
      if (!p?.id || p.indent !== 0) continue;
      const sub = splitSubtaskId(p.id);
      if (sub && topLevelIds.has(sub.parentId)) {
        lines.splice(i, 1);
        changed = true;
      }
    }
  }

  if (appendMissingActive) {
    const present = new Set<string>();
    for (const line of lines) {
      const p = parseTaskLine(line);
      if (p?.id) {
        present.add(p.id);
        const sub = splitSubtaskId(p.id);
        if (sub) present.add(sub.parentId);
      }
    }
    const projectsFile = await readJsonFile<{ projects?: { id: string; name: string }[] }>(
      dataDir,
      FILES.projects,
    );
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const t of todosFile.todos) {
      if (t.status === "done") continue;
      if (present.has(t.id)) continue;
      // Freshly created tasks are excluded: a mid-typing registration whose
      // line the user just edited away would otherwise resurrect here and
      // fight the pending deletion sync.
      if (!includeFresh && t.createdAt && new Date(t.createdAt).getTime() > tenMinAgo) continue;
      const projName = t.projectId
        ? (projectsFile?.projects?.find((p) => p.id === t.projectId)?.name ?? t.projectId)
        : "GENERAL";
      const startTag = t.startDate && t.startDate > dateKey
        ? `(시작 ${formatStartTag(t.startDate)}) `
        : "";
      insertLineUnderProject(lines, projName, `- [ ] [${t.id}] ${startTag}${t.title}`);
      changed = true;
    }
  }

  if (!changed) return null;

  const updatedBody = lines.join("\n");
  await invoke("write_note", {
    path: dailyPath,
    content: joinFrontmatter(frontmatter, updatedBody),
  });
  return updatedBody;
}

function stripTodoMeta(raw: string): string {
  return raw
    .replace(/^\\?\(이월[^)]*\\?\)\s*/, "")
    .replace(/^\\?\(시작 [^)]*\\?\)\s*/, "")
    .replace(/^\\?\(이월[^)]*\\?\)\s*/, "")
    .replace(/\s*\((?:⚠️\s*)?D[+-]?\d+\)$/, "")
    .replace(/\s*\(⚠️\s*D-Day\)$/, "")
    .trim();
}

export function detectTodoTitleChanges(
  prev: string,
  next: string,
): { id: string; title: string }[] {
  const prevTitles = new Map<string, string>();
  for (const line of prev.split("\n")) {
    const p = parseTaskLine(line);
    if (p?.id) prevTitles.set(p.id, stripTodoMeta(p.title));
  }

  const changes: { id: string; title: string }[] = [];
  for (const line of next.split("\n")) {
    const p = parseTaskLine(line);
    if (!p?.id) continue;
    const title = stripTodoMeta(p.title);
    const prevTitle = prevTitles.get(p.id);
    if (prevTitle !== undefined && prevTitle !== title && title) {
      changes.push({ id: p.id, title });
    }
  }
  return changes;
}

export async function updateTodoTitle(
  dataDir: string,
  todoId: string,
  newTitle: string,
): Promise<void> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return;

  const sub = splitSubtaskId(todoId);
  let changed = false;
  const updated = todosFile.todos.map((t: Task) => {
    if (sub) {
      if (t.id !== sub.parentId || !t.subtasks?.length) return t;
      let idx = t.subtasks.findIndex((s) => s.id === todoId);
      if (idx < 0 && sub.subIndex >= 1 && sub.subIndex <= t.subtasks.length) idx = sub.subIndex - 1;
      if (idx < 0 || t.subtasks[idx].title === newTitle) return t;
      changed = true;
      const subtasks = t.subtasks.map((s, i) => (i === idx ? { ...s, title: newTitle } : s));
      return { ...t, subtasks, updatedAt: new Date().toISOString() };
    }
    if (t.id === todoId && t.title !== newTitle) {
      changed = true;
      return { ...t, title: newTitle, updatedAt: new Date().toISOString() };
    }
    return t;
  });

  if (!changed) return;
  await writeTodosFile(dataDir, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });
}

/**
 * Normalize user-typed project headings in the 작업 section to the generated
 * format: `### KCS` → `### 🛰️ KCS`, `### general` → `### 📌 GENERAL`.
 * Headings that already start with an emoji/symbol are left alone.
 */
export function normalizeProjectHeadings(
  body: string,
): { body: string; changed: boolean } {
  const lines = body.split("\n");
  let changed = false;
  let inTaskSection = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^## /.test(trimmed)) {
      inTaskSection = /^## 작업/.test(trimmed);
      continue;
    }
    if (!inTaskSection) continue;
    const m = trimmed.match(/^###\s+(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    if (!name || !/^[\p{L}\p{N}]/u.test(name)) continue; // already emoji-prefixed
    lines[i] = name.toUpperCase() === "GENERAL" ? "### 📌 GENERAL" : `### 🛰️ ${name}`;
    changed = true;
  }
  return { body: changed ? lines.join("\n") : body, changed };
}

export function resolveProjectIdsInBody(
  body: string,
  projectMap: Map<string, string>,
): { body: string; changed: boolean } {
  if (!projectMap || projectMap.size === 0) return { body, changed: false };
  const lines = body.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PROJECT_HEADING_RE);
    if (!m) continue;
    const raw = m[1].trim();
    const resolved = projectMap.get(raw);
    if (resolved && resolved !== raw) {
      lines[i] = `### 🛰️ ${resolved}`;
      changed = true;
    }
  }
  return { body: changed ? lines.join("\n") : body, changed };
}

const STRIP_TODO_META_RE = /\s*\((?:⚠️\s*)?D[+-]?\d+\)$/;
const STRIP_DDAY_RE = /\s*\(⚠️\s*D-Day\)$/;
const CARRY_TAG_RE = /^\(이월[^)]*\)\s*/;

function extractNakedTitle(text: string): string {
  return text
    .replace(CARRY_TAG_RE, "")
    .replace(STRIP_TODO_META_RE, "")
    .replace(STRIP_DDAY_RE, "")
    .trim()
    .toLowerCase();
}

export function deduplicateDailyLogBody(
  body: string,
): { body: string; changed: boolean } {
  const lines = body.split("\n");

  const idBearingTitles = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^- \[[ xX]\] \[([^\]]+)\] (.+)$/);
    if (!m) continue;
    idBearingTitles.add(extractNakedTitle(m[2]));
  }

  if (idBearingTitles.size === 0) return { body, changed: false };

  let changed = false;
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^- \[[ xX]\] (.+)$/);
    if (m) {
      const content = m[1];
      const hasId = /^\[([^\]]+)\] /.test(content);
      if (!hasId) {
        const title = extractNakedTitle(content);
        if (title && idBearingTitles.has(title)) {
          changed = true;
          continue;
        }
      }
    }
    out.push(line);
  }

  return { body: changed ? out.join("\n") : body, changed };
}

export function compactTaskSections(
  body: string,
): { body: string; changed: boolean } {
  const lines = body.split("\n");
  let inTask = false;
  let changed = false;
  const out: string[] = [];
  let pendingBlanks = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (/^## 작업/.test(trimmed)) {
      inTask = true;
      out.push(lines[i]);
      pendingBlanks = 0;
      continue;
    }
    if (inTask && (/^---/.test(trimmed) || (/^## /.test(trimmed) && !/^## 작업/.test(trimmed)))) {
      for (let b = 0; b < pendingBlanks; b++) out.push("");
      pendingBlanks = 0;
      inTask = false;
      out.push(lines[i]);
      continue;
    }

    if (inTask && trimmed === "") {
      pendingBlanks++;
      continue;
    }

    if (inTask && /^### /.test(trimmed)) {
      if (pendingBlanks > 0) changed = true;
      pendingBlanks = 0;
    } else {
      for (let b = 0; b < pendingBlanks; b++) out.push("");
      pendingBlanks = 0;
    }

    out.push(lines[i]);
  }
  for (let b = 0; b < pendingBlanks; b++) out.push("");

  return { body: changed ? out.join("\n") : body, changed };
}

export function buildCarriedOverMeta(
  items: CarriedItem[],
  prevDateKey: string,
): { from: string; items: string[] }[] {
  if (items.length === 0) return [];
  return [{ from: prevDateKey, items: items.map((i) => i.text) }];
}

export interface NewCheckboxItem {
  /** Text of the new item, without the `- [ ] ` prefix. */
  text: string;
  /** Set when the line is indented under an ID-bearing task — register as its subtask. */
  parentId?: string;
}

/**
 * Detect new unchecked checkbox items added between prev and next markdown body.
 * Top-level items become new main tasks; indented items under an ID-bearing task
 * are reported with that task's id as `parentId` (→ registerNewSubtask).
 * Indented items whose parent has no ID yet are skipped — they're picked up on a
 * later cycle once the parent's ID has been injected.
 * Excludes items that already have a TODO ID or a carry-over `(이월)` prefix.
 */
export function detectNewCheckboxItems(prev: string, next: string): NewCheckboxItem[] {
  const prevLines = new Set(prev.split("\n").map((l) => l.trim()));
  const results: NewCheckboxItem[] = [];
  const nextLines = next.split("\n");

  for (let i = 0; i < nextLines.length; i++) {
    const p = parseTaskLine(nextLines[i]);
    if (!p || p.checked) continue;
    // Skip items that already have a TODO ID
    if (p.id) continue;
    // Skip carry-over items (escaped or unescaped)
    if (isCarryOverText(p.title)) continue;
    // Skip empty, whitespace-only, or zero-width-space-only items
    if (p.title.replace(/[​‌‍﻿]/g, "").trim() === "") continue;

    if (p.indent > 0) {
      // Indented items: ID-less lines under an ID-bearing task are always
      // candidates, even if present in the previous body — the parent may
      // have gotten its ID only after this line first appeared, so the
      // "new vs prev" diff would never see it again. The caller's in-flight
      // map guards against duplicate registration.
      const parentId = findParentTaskId(nextLines, i);
      if (!parentId) continue;
      results.push({ text: p.title, parentId });
    } else {
      // Skip if already present in previous body
      if (prevLines.has(nextLines[i].trim())) continue;
      results.push({ text: p.title });
    }
  }

  return results;
}

/**
 * Register a new subtask under `parentId` in todos.json.
 * The subtask id is `${parentId}.${n}` so daily-note lines can reference it.
 * Returns the new subtask id, or null when the parent doesn't exist.
 */
export async function registerNewSubtask(
  dataDir: string,
  parentId: string,
  title: string,
): Promise<string | null> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return null;

  const now = new Date().toISOString();
  let newId: string | null = null;
  let alreadyExists: string | null = null;
  const updated = todosFile.todos.map((t: Task) => {
    if (t.id !== parentId) return t;
    const subs = t.subtasks ?? [];
    // Idempotency: detection may re-report a line whose registration already
    // happened (e.g. after a reload cleared the in-flight map).
    const existing = subs.find((s) => s.title.trim() === title.trim());
    if (existing) {
      alreadyExists = existing.id;
      return t;
    }
    let maxN = subs.length;
    for (const s of subs) {
      const sp = splitSubtaskId(s.id);
      if (sp && sp.parentId === parentId && sp.subIndex > maxN) maxN = sp.subIndex;
    }
    newId = `${parentId}.${maxN + 1}`;
    return {
      ...t,
      subtasks: [...subs, { id: newId, title, done: false }],
      updatedAt: now,
    };
  });

  if (alreadyExists) return alreadyExists;
  if (!newId) return null;
  await writeTodosFile(dataDir, {
    ...todosFile,
    lastModified: now,
    todos: updated,
  });
  return newId;
}

/**
 * Determine the project context for a given checkbox text in markdown body
 * by looking at the nearest heading above it.
 */
export function detectProjectForItem(body: string, itemText: string): string {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().includes(itemText)) {
      return extractProjectFromContext(lines, i);
    }
  }
  return "GENERAL";
}

/**
 * Register a new TODO in todos.json from a checkbox item typed in the Daily Log.
 * Returns the new task ID (e.g., "TASK-007").
 */
export async function registerNewTodo(
  dataDir: string,
  title: string,
  project: string,
): Promise<string> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  const existing = todosFile?.todos ?? [];

  // Idempotency: the load-time orphan sweep may re-report a line whose task
  // already exists (e.g. its ID injection was lost). Reuse the existing task.
  const dup = existing.find((t) => t.status !== "done" && t.title.trim() === title.trim());
  if (dup) return dup.id;

  // Daily headings carry the project NAME — resolve to the project id so
  // filters/links in the Tasks tab match (projectId must store the id).
  // GENERAL also resolves if the user has an actual project named GENERAL.
  // Matching order: exact (case-insensitive) → unique prefix/substring
  // (### AJC matches project AJC2) → unresolved names stay unassigned rather
  // than storing a garbage projectId string.
  let projectId: string | undefined;
  const projectsFile = await readJsonFile<{ projects?: { id: string; name: string }[] }>(
    dataDir,
    FILES.projects,
  );
  const projects = projectsFile?.projects ?? [];
  const q = project.trim().toLowerCase();
  const exact = projects.find((p) => p.id === project || p.name.trim().toLowerCase() === q);
  if (exact) {
    projectId = exact.id;
  } else if (q && project !== "GENERAL") {
    const partial = projects.filter((p) => {
      const n = p.name.trim().toLowerCase();
      return n.startsWith(q) || q.startsWith(n) || n.includes(q);
    });
    if (partial.length === 1) projectId = partial[0].id;
  }

  // Determine next sequence number
  let maxSeq = 0;
  for (const t of existing) {
    const m = t.id.match(/^TASK-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  const nextSeq = maxSeq + 1;
  const newId = `TASK-${String(nextSeq).padStart(3, "0")}`;

  const now = new Date().toISOString();
  const today = format(new Date(), "yyyy-MM-dd");

  const newTask: Task = {
    id: newId,
    title,
    projectId,
    status: "in-progress",
    priority: 2,
    startDate: today,
    subtasks: [],
    createdAt: now,
    updatedAt: now,
    tags: [],
    related_notes: [],
    daily_logs: [],
    carry_count: 0,
  };

  const updatedTodos = [...existing, newTask];

  await writeTodosFile(dataDir, {
    version: todosFile?.version ?? 1,
    lastModified: now,
    todos: updatedTodos,
  });

  return newId;
}

/**
 * Delete a todo (or a subtask, for `parentId.N` refs) from todos.json.
 * Done main tasks are kept — deleting a completed line from the daily is
 * treated as view cleanup, not history deletion.
 */
export async function deleteTodoById(
  dataDir: string,
  todoId: string,
): Promise<boolean> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile?.todos) return false;

  const sub = splitSubtaskId(todoId);
  let changed = false;
  let todos: Task[];
  if (sub) {
    const subIndex = sub.subIndex;
    todos = todosFile.todos.map((t: Task) => {
      if (t.id !== sub.parentId || !t.subtasks?.length) return t;
      let idx = t.subtasks.findIndex((s) => s.id === todoId);
      if (idx < 0 && subIndex >= 1 && subIndex <= t.subtasks.length) idx = subIndex - 1;
      if (idx < 0 || t.subtasks[idx].done) return t;
      changed = true;
      return {
        ...t,
        subtasks: t.subtasks.filter((_, i) => i !== idx),
        updatedAt: new Date().toISOString(),
      };
    });
  } else {
    todos = todosFile.todos.filter((t: Task) => {
      if (t.id !== todoId) return true;
      if (t.status === "done") return true;
      changed = true;
      return false;
    });
  }

  if (!changed) return false;
  await writeTodosFile(dataDir, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos,
  });
  return true;
}

const TODO_SECTION_MAP: Record<string, string[]> = {
  'analysis-note': ['## 후속 과제'],
  'study-note': ['## 후속 과제'],
  'test-log': ['## 후속 조치'],
  'design-note': ['## 결론 & 후속'],
};

function extractSectionItems(body: string, sectionHeading: string): { text: string; checked: boolean; lineIndex: number }[] {
  const lines = body.split('\n');
  const items: { text: string; checked: boolean; lineIndex: number }[] = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === sectionHeading || trimmed.startsWith(sectionHeading + ' ')) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s/.test(trimmed)) break;
    if (inSection && /^---$/.test(trimmed)) break;
    if (!inSection) continue;

    const unchecked = trimmed.match(/^- \[ \] (.+)$/);
    if (unchecked) {
      const text = unchecked[1];
      if (text.replace(/[​‌‍﻿]/g, '').trim() === '') continue;
      items.push({ text, checked: false, lineIndex: i });
      continue;
    }
    const checked = trimmed.match(/^- \[x\] (.+)$/i);
    if (checked) {
      items.push({ text: checked[1], checked: true, lineIndex: i });
    }
  }
  return items;
}

export async function registerNoteTodo(
  dataDir: string,
  title: string,
  project: string,
  sourceNote: string,
  sourceSection: string,
  subsystem?: string,
): Promise<string> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  const existing = todosFile?.todos ?? [];

  const dup = existing.find(t =>
    t.source_note === sourceNote &&
    t.title === title &&
    t.status !== 'done',
  );
  if (dup) return dup.id;

  let maxSeq = 0;
  for (const t of existing) {
    const m = t.id.match(/^TASK-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  const newId = `TASK-${String(maxSeq + 1).padStart(3, '0')}`;
  const now = new Date().toISOString();
  const today = format(new Date(), 'yyyy-MM-dd');

  const newTask: Task = {
    id: newId,
    title,
    projectId: project === 'GENERAL' ? undefined : project,
    status: 'todo',
    priority: 2,
    startDate: today,
    subtasks: [],
    createdAt: now,
    updatedAt: now,
    tags: [],
    related_notes: [sourceNote],
    daily_logs: [],
    carry_count: 0,
    subsystem,
    source_note: sourceNote,
    source_section: sourceSection,
  };

  await writeTodosFile(dataDir, {
    version: todosFile?.version ?? 1,
    lastModified: now,
    todos: [...existing, newTask],
  });
  return newId;
}

export function detectNoteTodoSections(noteType: string): string[] {
  return TODO_SECTION_MAP[noteType] ?? [];
}

export async function syncNoteCheckboxesWithTodos(
  dataDir: string,
  noteId: string,
  noteType: string,
  prevBody: string,
  nextBody: string,
  project: string,
  subsystem?: string,
): Promise<string | null> {
  const sections = detectNoteTodoSections(noteType);
  if (sections.length === 0) return null;

  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  const existingTodos = todosFile?.todos ?? [];
  let bodyChanged = false;
  let updatedBody = nextBody;

  for (const section of sections) {
    const items = extractSectionItems(nextBody, section);
    const prevItems = extractSectionItems(prevBody, section);

    for (const item of items) {
      const rawText = item.text.replace(/^\\?\[[^\]\\]+\\?\]\s*/, '').trim();
      if (!rawText) continue;

      const hasTodoId = /^\\?\[TASK-\d+\\?\]\s/.test(item.text);

      if (hasTodoId) {
        const idMatch = item.text.match(/^\\?\[(TASK-\d+)\\?\]/);
        if (!idMatch) continue;
        const todoId = idMatch[1];

        if (item.checked) {
          const prevItem = prevItems.find(p => p.text.includes(todoId));
          if (prevItem && !prevItem.checked) {
            await completeTodo(dataDir, todoId);
          }
        } else {
          const prevItem = prevItems.find(p => p.text.includes(todoId));
          if (prevItem && prevItem.checked) {
            await reopenTodo(dataDir, todoId);
          }
        }
      } else if (!item.checked) {
        const wasInPrev = prevItems.some(p => {
          const prevRaw = p.text.replace(/^\\?\[[^\]\\]+\\?\]\s*/, '').trim();
          return prevRaw === rawText;
        });
        if (wasInPrev) continue;

        const taskId = await registerNoteTodo(
          dataDir, rawText, project, noteId, section, subsystem,
        );

        const lines = updatedBody.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === `- [ ] ${item.text}`) {
            lines[i] = lines[i].replace(`- [ ] ${item.text}`, `- [ ] [${taskId}] ${rawText}`);
            bodyChanged = true;
            break;
          }
        }
        updatedBody = lines.join('\n');
      }
    }
  }

  if (bodyChanged) return updatedBody;

  const noteTodos = existingTodos.filter(t => t.source_note === noteId);
  for (const todo of noteTodos) {
    if (todo.status !== 'done') continue;
    const lines = updatedBody.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const escaped = todo.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^- \\[ \\] .*\\[${escaped}\\]`);
      if (re.test(lines[i].trim())) {
        lines[i] = lines[i].replace('- [ ]', '- [x]');
        changed = true;
      }
    }
    if (changed) {
      updatedBody = lines.join('\n');
      bodyChanged = true;
    }
  }

  return bodyChanged ? updatedBody : null;
}

/**
 * Insert a newly created research note into today's daily log "노트" table.
 */
export async function insertNoteToDailyLog(
  dataDir: string,
  noteId: string,
  title: string,
  noteType: NoteType | string,
  project: string,
  topic: string = "",
): Promise<void> {
  const dateKey = format(new Date(), "yyyy-MM-dd");
  const dailyPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);

  let raw: string;
  try {
    raw = await invoke<string>("read_note", { path: dailyPath });
  } catch {
    return;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const icon = NOTE_TYPE_ICONS[noteType as NoteType] ?? "📝";
  const label = NOTE_TYPE_LABELS[noteType as NoteType] ?? "Note";
  const newRow = `| ${label} | [${icon} ${title}](note://${noteId}) | ${project} | ${topic} |`;

  const lines = body.split("\n");
  let insertIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+노트\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\|[\s-]+\|/.test(lines[j]) && lines[j].includes('---')) {
          insertIndex = j + 1;
          break;
        }
      }
      break;
    }
  }

  // Fallback: try legacy section name
  if (insertIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+오늘 생성한 노트/.test(lines[i])) {
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\|[\s-]+\|/.test(lines[j]) && lines[j].includes('---')) {
            insertIndex = j + 1;
            break;
          }
        }
        break;
      }
    }
  }

  if (insertIndex === -1) return;

  if (
    insertIndex < lines.length &&
    /^\|\s*\|\s*\|\s*\|/.test(lines[insertIndex].trim())
  ) {
    lines[insertIndex] = newRow;
  } else {
    lines.splice(insertIndex, 0, newRow);
  }

  const updatedBody = lines.join("\n");
  await invoke("write_note", {
    path: dailyPath,
    content: joinFrontmatter(frontmatter, updatedBody),
  });
  window.dispatchEvent(new CustomEvent("daily-log-updated"));
}

export async function updateDailyLogNoteRow(
  dataDir: string,
  noteId: string,
  title: string,
  noteType: NoteType | string,
  project: string,
  topic: string = "",
): Promise<void> {
  const dateKey = format(new Date(), "yyyy-MM-dd");
  const dailyPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);

  let raw: string;
  try {
    raw = await invoke<string>("read_note", { path: dailyPath });
  } catch {
    return;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const lines = body.split("\n");
  const icon = NOTE_TYPE_ICONS[noteType as NoteType] ?? "📝";
  const label = NOTE_TYPE_LABELS[noteType as NoteType] ?? "Note";
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`note://${noteId}`) || lines[i].includes(`[[${noteId}]]`)) {
      lines[i] = `| ${label} | [${icon} ${title}](note://${noteId}) | ${project} | ${topic} |`;
      found = true;
      break;
    }
  }

  if (!found) return;
  await invoke("write_note", {
    path: dailyPath,
    content: joinFrontmatter(frontmatter, lines.join("\n")),
  });
  window.dispatchEvent(new CustomEvent("daily-log-updated"));
}

export async function removeNoteFromDailyLog(
  dataDir: string,
  noteId: string,
): Promise<void> {
  const dateKey = format(new Date(), "yyyy-MM-dd");
  const dailyPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);

  let raw: string;
  try {
    raw = await invoke<string>("read_note", { path: dailyPath });
  } catch {
    return;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const lines = body.split("\n");
  let removed = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(`note://${noteId}`) || lines[i].includes(`[[${noteId}]]`)) {
      lines.splice(i, 1);
      removed = true;
    }
  }

  if (!removed) return;

  // 마지막 데이터 행을 지웠으면 표가 헤더만 남는다 — 빈 자리표시 행을 넣어
  // 표 구조를 유지한다 (insertNoteToDailyLog가 이 빈 행을 재사용)
  for (let i = 0; i < lines.length - 1; i++) {
    const isSeparator = /^\|[\s-]+\|/.test(lines[i]) && lines[i].includes("---");
    if (!isSeparator) continue;
    const next = lines[i + 1] ?? "";
    if (!next.trim().startsWith("|")) {
      const cols = Math.max(1, lines[i].split("|").length - 2);
      lines.splice(i + 1, 0, `|${"  |".repeat(cols)}`);
    }
  }

  await invoke("write_note", {
    path: dailyPath,
    content: joinFrontmatter(frontmatter, lines.join("\n")),
  });
  window.dispatchEvent(new CustomEvent("daily-log-updated"));
}

export async function insertTodoToDailyLog(
  dataDir: string,
  taskId: string,
  title: string,
  project: string,
): Promise<void> {
  const dateKey = format(new Date(), "yyyy-MM-dd");
  const dailyPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);

  let raw: string;
  try {
    raw = await invoke<string>("read_note", { path: dailyPath });
  } catch {
    return;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const lines = body.split("\n");
  const newLine = `- [ ] [${taskId}] ${title}`;

  if (body.includes(`[${taskId}]`)) return;

  const sectionHeading = project && project !== "GENERAL"
    ? `### 🛰️ ${project}`
    : "### 📌 GENERAL";

  let insertIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeading) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("### ") || lines[j].startsWith("## ") || lines[j].startsWith("---")) {
          insertIndex = j;
          break;
        }
      }
      break;
    }
  }

  if (insertIndex === -1 && project && project !== "GENERAL") {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "### 📌 GENERAL") {
        lines.splice(i, 0, sectionHeading);
        insertIndex = i + 1;
        break;
      }
    }
  }

  if (insertIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "### 📌 GENERAL") {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].startsWith("### ") || lines[j].startsWith("## ") || lines[j].startsWith("---")) {
            insertIndex = j;
            break;
          }
        }
        break;
      }
    }
  }

  if (insertIndex === -1) return;

  while (insertIndex > 0 && lines[insertIndex - 1].trim() === "") {
    insertIndex--;
  }

  lines.splice(insertIndex, 0, newLine);

  await invoke("write_note", {
    path: dailyPath,
    content: joinFrontmatter(frontmatter, lines.join("\n")),
  });
  window.dispatchEvent(new CustomEvent("daily-log-updated"));
}

export async function updateTodoInDailyLog(
  dataDir: string,
  taskId: string,
  title: string,
  project: string,
): Promise<void> {
  const dateKey = format(new Date(), "yyyy-MM-dd");
  const dailyPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);

  let raw: string;
  try {
    raw = await invoke<string>("read_note", { path: dailyPath });
  } catch {
    return;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const lines = body.split("\n");
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[${escaped}\\]|\\\\\\[${escaped}\\\\\\]`);
  let foundIndex = -1;
  let checked = false;

  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    checked = /^- \[x\]/.test(lines[i].trim());
    foundIndex = i;
    break;
  }

  if (foundIndex === -1) return;

  const currentSection = extractProjectFromContext(lines, foundIndex);
  const targetSection = project || "GENERAL";
  const check = checked ? "[x]" : "[ ]";
  const newLine = `- ${check} [${taskId}] ${title}`;

  if (currentSection === targetSection) {
    lines[foundIndex] = newLine;
  } else {
    lines.splice(foundIndex, 1);

    const targetHeading = targetSection !== "GENERAL"
      ? `### 🛰️ ${targetSection}`
      : "### 📌 GENERAL";

    let insertIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === targetHeading) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].startsWith("### ") || lines[j].startsWith("## ") || lines[j].startsWith("---")) {
            insertIdx = j;
            break;
          }
        }
        break;
      }
    }

    if (insertIdx === -1 && targetSection !== "GENERAL") {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "### 📌 GENERAL") {
          lines.splice(i, 0, targetHeading);
          insertIdx = i + 1;
          break;
        }
      }
    }

    if (insertIdx === -1) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "### 📌 GENERAL") {
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].startsWith("### ") || lines[j].startsWith("## ") || lines[j].startsWith("---")) {
              insertIdx = j;
              break;
            }
          }
          break;
        }
      }
    }

    if (insertIdx === -1) return;

    while (insertIdx > 0 && lines[insertIdx - 1].trim() === "") {
      insertIdx--;
    }

    lines.splice(insertIdx, 0, newLine);
  }

  await invoke("write_note", {
    path: dailyPath,
    content: joinFrontmatter(frontmatter, lines.join("\n")),
  });
  window.dispatchEvent(new CustomEvent("daily-log-updated"));
}

export async function removeTodoFromDailyLog(
  dataDir: string,
  taskId: string,
): Promise<void> {
  const dateKey = format(new Date(), "yyyy-MM-dd");
  const dailyPath = await join(dataDir, FOLDERS.daily, `${dateKey}.md`);

  let raw: string;
  try {
    raw = await invoke<string>("read_note", { path: dailyPath });
  } catch {
    return;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const lines = body.split("\n");
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[${escaped}\\]|\\\\\\[${escaped}\\\\\\]`);
  const filtered = lines.filter((line) => !re.test(line));

  if (filtered.length === lines.length) return;

  await invoke("write_note", {
    path: dailyPath,
    content: joinFrontmatter(frontmatter, filtered.join("\n")),
  });
  window.dispatchEvent(new CustomEvent("daily-log-updated"));
}
