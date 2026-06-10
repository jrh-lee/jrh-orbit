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
  isOverdue: boolean;
  subtasks?: { title: string; done: boolean }[];
}

const PROJECT_HEADING_RE = /^###\s+🛰️\s+(.+)$/;
const GENERAL_HEADING_RE = /^###\s+📌\s+GENERAL$/;
const UNCHECKED_RE = /^- \[ \] (.+)$/;
const TODO_ID_RE = /^\\?\[([^\]\\]+)\\?\]\s*/;

function extractProjectFromContext(lines: string[], lineIndex: number): string {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const pm = lines[i].match(PROJECT_HEADING_RE);
    if (pm) return pm[1].trim();
    if (GENERAL_HEADING_RE.test(lines[i])) return "GENERAL";
    if (lines[i].startsWith("## ")) break;
  }
  return "GENERAL";
}

export async function getCarriedOverItems(
  dataDir: string,
  currentDate: Date,
): Promise<CarriedItem[]> {
  const prevDate = subDays(currentDate, 1);
  const prevKey = format(prevDate, "yyyy-MM-dd");
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
    const prevPath = await join(dataDir, FOLDERS.daily, `${prevKey}.md`);
    const raw = await invoke<string>("read_note", { path: prevPath });
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

  return todosFile.todos
    .filter((t: Task) => t.status !== "done")
    .filter((t: Task) => !t.startDate || t.startDate <= dateKey)
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
        isOverdue,
        subtasks: t.subtasks?.length ? t.subtasks.map(s => ({ title: s.title, done: s.done })) : undefined,
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

  for (const item of carriedItems) {
    const prefix = item.todoId ? `[${item.todoId}] ` : "";
    const check = item.done ? "[x]" : "[ ]";
    const carryTag = (item.carryCount ?? 0) >= 3
      ? `(이월, 🔴 D+${item.carryCount} 연속 이월)`
      : "(이월)";
    let cleanText = item.text
      .replace(/\s*\((?:⚠️\s*)?D[+-]?\d+\)$/, "")
      .replace(/\s*\(⚠️\s*D-Day\)$/, "")
      .trim();
    const matchedTodo = item.todoId ? todoById.get(item.todoId) : undefined;
    if (matchedTodo?.dueDate) {
      cleanText += ` (${formatDueTag(matchedTodo.dueDate, dateKey)})`;
    }
    addToProject(item.project, `- ${check} ${prefix}${carryTag} ${cleanText}`);
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
    addToProject(todo.project, `- [ ] [${todo.id}] ${todo.title}${dueTag}`);
    if (todo.subtasks?.length) {
      for (const st of todo.subtasks) {
        const check = st.done ? "[x]" : "[ ]";
        addToProject(todo.project, `  - ${check} ${st.title}`);
      }
    }
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

  await writeJsonFile(dataDir, FILES.todos, {
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
  const checkedRe = /^- \[x\] \\?\[([^\]\\]+)\\?\]/;
  const uncheckedRe = /^- \[ \] \\?\[([^\]\\]+)\\?\]/;

  // Build set of unchecked todo IDs in previous body
  const prevUnchecked = new Set<string>();
  for (const line of prev.split("\n")) {
    const m = line.match(uncheckedRe);
    if (m) prevUnchecked.add(m[1]);
  }

  // Find todo IDs that are checked in next body and were unchecked in prev body
  const newlyChecked: string[] = [];
  for (const line of next.split("\n")) {
    const m = line.match(checkedRe);
    if (m && prevUnchecked.has(m[1])) {
      newlyChecked.push(m[1]);
    }
  }

  return newlyChecked;
}

/**
 * Detect todo IDs whose checkboxes changed from checked to unchecked (reopened).
 */
export function detectNewlyUncheckedTodos(prev: string, next: string): string[] {
  const checkedRe = /^- \[x\] \\?\[([^\]\\]+)\\?\]/;
  const uncheckedRe = /^- \[ \] \\?\[([^\]\\]+)\\?\]/;

  const prevChecked = new Set<string>();
  for (const line of prev.split("\n")) {
    const m = line.match(checkedRe);
    if (m) prevChecked.add(m[1]);
  }

  const newlyUnchecked: string[] = [];
  for (const line of next.split("\n")) {
    const m = line.match(uncheckedRe);
    if (m && prevChecked.has(m[1])) {
      newlyUnchecked.push(m[1]);
    }
  }

  return newlyUnchecked;
}

/**
 * Reopen a todo in todos.json, setting status='in-progress' and clearing endDate.
 */
export async function reopenTodo(
  dataDir: string,
  todoId: string,
): Promise<void> {
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

  await writeJsonFile(dataDir, FILES.todos, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });
}

/**
 * Mark a todo as done in todos.json, setting status='done' and endDate to today.
 */
export async function completeTodo(
  dataDir: string,
  todoId: string,
): Promise<void> {
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

  await writeJsonFile(dataDir, FILES.todos, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });
}

const TODO_LINE_RE = /^- \[[ xX]\] \\?\[([^\]\\]+)\\?\]\s*(.*)$/;
const TODO_CHECKBOX_RE = /^(- \[)([ xX])(\] )/;

export async function syncDailyWithTodos(
  dataDir: string,
  dateKey: string,
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
  let lines = body.split("\n");
  let changed = false;

  // Remove TODO lines for tasks created after this daily log's date
  lines = lines.filter((line) => {
    const m = line.match(TODO_LINE_RE);
    if (!m) return true;
    const todo = todoMap.get(m[1]);
    if (!todo) return true;
    if (todo.startDate && todo.startDate > dateKey) {
      changed = true;
      return false;
    }
    return true;
  });

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TODO_LINE_RE);
    if (!m) continue;
    const todoId = m[1];
    const todo = todoMap.get(todoId);
    if (!todo) continue;

    const isDone = todo.status === "done";
    const checkMatch = lines[i].match(TODO_CHECKBOX_RE);
    if (!checkMatch) continue;

    const currentlyChecked = checkMatch[2] === "x" || checkMatch[2] === "X";
    if (isDone && !currentlyChecked) {
      lines[i] = lines[i].replace(TODO_CHECKBOX_RE, "$1x$3");
      changed = true;
    } else if (!isDone && currentlyChecked) {
      lines[i] = lines[i].replace(TODO_CHECKBOX_RE, "$1 $3");
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
    const m = line.trim().match(TODO_LINE_RE);
    if (m) prevTitles.set(m[1], stripTodoMeta(m[2]));
  }

  const changes: { id: string; title: string }[] = [];
  for (const line of next.split("\n")) {
    const m = line.trim().match(TODO_LINE_RE);
    if (!m) continue;
    const [, id, rawTitle] = m;
    const title = stripTodoMeta(rawTitle);
    const prevTitle = prevTitles.get(id);
    if (prevTitle !== undefined && prevTitle !== title && title) {
      changes.push({ id, title });
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

  let changed = false;
  const updated = todosFile.todos.map((t: Task) => {
    if (t.id === todoId && t.title !== newTitle) {
      changed = true;
      return { ...t, title: newTitle, updatedAt: new Date().toISOString() };
    }
    return t;
  });

  if (!changed) return;
  await writeJsonFile(dataDir, FILES.todos, {
    ...todosFile,
    lastModified: new Date().toISOString(),
    todos: updated,
  });
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

/**
 * Detect new unchecked checkbox items added between prev and next markdown body.
 * Returns the raw text (without the `- [ ] ` prefix) of newly added items.
 * Excludes items that already have a TODO ID `[TASK-xxx]` or carry-over `(이월)` prefix.
 */
export function detectNewCheckboxItems(prev: string, next: string): string[] {
  const prevLines = new Set(prev.split("\n").map((l) => l.trim()));
  const results: string[] = [];

  for (const line of next.split("\n")) {
    const trimmed = line.trim();
    const m = trimmed.match(/^- \[ \] (.+)$/);
    if (!m) continue;
    const text = m[1];
    // Skip if already present in previous body
    if (prevLines.has(trimmed)) continue;
    // Skip items that already have a TODO ID like [TASK-xxx] or \[TASK-xxx\] (escaped by markdown serializer)
    if (/^\\?\[[^\]\\]+\\?\]\s/.test(text)) continue;
    // Skip carry-over items (escaped or unescaped)
    if (/^\\?\(이월/.test(text)) continue;
    // Skip empty, whitespace-only, or zero-width-space-only items
    if (text.replace(/[​‌‍﻿]/g, "").trim() === "") continue;
    results.push(text);
  }

  return results;
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
    projectId: project === "GENERAL" ? undefined : project,
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

  await writeJsonFile(dataDir, FILES.todos, {
    version: todosFile?.version ?? 1,
    lastModified: now,
    todos: updatedTodos,
  });

  return newId;
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

  await writeJsonFile(dataDir, FILES.todos, {
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
  _project: string,
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
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const checked = /^- \[x\]/.test(lines[i].trim());
    const check = checked ? "[x]" : "[ ]";
    lines[i] = `- ${check} [${taskId}] ${title}`;
    found = true;
    break;
  }

  if (!found) return;

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
