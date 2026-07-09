/**
 * Central task-line parsing for Daily-note ↔ todos.json synchronization.
 *
 * The daily note is a *view* of todos.json (the single source of truth).
 * Every piece of code that reads or writes task lines in markdown must go
 * through these helpers — do not add new ad-hoc task regexes elsewhere.
 *
 * Task ID formats:
 *   - Main task:  TASK-011  (or legacy random 8-char ids like bqrphmq6)
 *   - Subtask:    TASK-011.1  (parentId.index, stored in the parent's subtasks[])
 *
 * Note: tiptap-markdown escapes square brackets on serialize, so IDs can
 * appear as `[TASK-011]` or `\[TASK-011\]` — parseTaskLine handles both.
 */

export interface ParsedTaskLine {
  /** Leading indentation width (tabs count as 2). 0 = top-level task. */
  indent: number;
  checked: boolean;
  /** Task or subtask ID if the line carries one. */
  id?: string;
  /** Text after the ID prefix; carry-over/D-day tags NOT stripped. */
  title: string;
}

const TASK_LINE_RE = /^([ \t]*)- \[([ xX])\] (.*)$/;
const ID_PREFIX_RE = /^\\?\[([^\]\\]+)\\?\]\s*/;
const SUBTASK_ID_RE = /^(.+)\.(\d+)$/;
const CARRY_TAG_RE = /^\\?\(이월[^)]*\\?\)\s*/;
const START_TAG_RE = /^\\?\(시작 [^)]*\\?\)\s*/;
const DUE_TAG_RE = /\s*\((?:⚠️\s*)?D[+-]?\d+\)$/;
const DDAY_TAG_RE = /\s*\(⚠️\s*D-Day\)$/;

/** Parse a markdown line as a task checkbox line. Returns null for non-task lines. */
export function parseTaskLine(line: string): ParsedTaskLine | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;
  const indent = m[1].replace(/\t/g, "  ").length;
  const checked = m[2] !== " ";
  let title = m[3];
  let id: string | undefined;
  const idm = title.match(ID_PREFIX_RE);
  if (idm) {
    id = idm[1];
    title = title.slice(idm[0].length);
  } else {
    // Autolink can swallow the whole task text into a markdown link:
    // `- [ ] [\[TASK-013\] text](url)`. Unwrap the link to find the ID —
    // otherwise the line looks ID-less and gets re-registered as a new task.
    const lm = title.match(/^\[(.+)\]\(.*\)\s*$/);
    if (lm) {
      const inner = lm[1].match(ID_PREFIX_RE);
      if (inner) {
        id = inner[1];
        title = lm[1].slice(inner[0].length);
      }
    }
  }
  return { indent, checked, id, title: title.trim() };
}

/** Split a subtask ID into parent + index; null if not a subtask ID. */
export function splitSubtaskId(id: string): { parentId: string; subIndex: number } | null {
  const m = id.match(SUBTASK_ID_RE);
  if (!m) return null;
  return { parentId: m[1], subIndex: parseInt(m[2], 10) };
}

export function isSubtaskId(id: string): boolean {
  return SUBTASK_ID_RE.test(id);
}

/** Strip carry-over, scheduled-start and due-date metadata from a task title. */
export function stripTaskMeta(title: string): string {
  return title
    .replace(CARRY_TAG_RE, "")
    .replace(START_TAG_RE, "")
    .replace(CARRY_TAG_RE, "")
    .replace(DUE_TAG_RE, "")
    .replace(DDAY_TAG_RE, "")
    .trim();
}

export function isCarryOverText(title: string): boolean {
  return /^\\?\(이월/.test(title);
}

/** Strip inline markdown syntax for plain-text display (hub, sidebar, calendar).
 *  `[label](url)` → label, `\[KGS\]` → [KGS], 굵게·코드 등 마커 제거. */
export function stripInlineMarkdown(text: string): string {
  let t = text.replace(/\\([[\]()#*_~`>+\-!.|])/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(\*|_)(.*?)\1/g, "$2");
  t = t.replace(/~~(.*?)~~/g, "$1");
  t = t.replace(/`([^`]*)`/g, "$1");
  return t;
}

/** Collect every task/subtask ID referenced by checkbox lines in a body. */
export function collectTaskIds(body: string): Set<string> {
  const ids = new Set<string>();
  for (const line of body.split("\n")) {
    const p = parseTaskLine(line);
    if (p?.id) ids.add(p.id);
  }
  return ids;
}

/**
 * Walk upward from lines[index] to find the main-task ID this indented line
 * belongs to. Returns undefined when no ID-bearing ancestor exists (e.g. the
 * parent hasn't been registered yet). Subtask ancestors resolve to their
 * main-task parent so nesting deeper than one level still maps correctly.
 */
export function findParentTaskId(lines: string[], index: number): string | undefined {
  const current = parseTaskLine(lines[index]);
  if (!current || current.indent === 0) return undefined;
  for (let i = index - 1; i >= 0; i--) {
    const p = parseTaskLine(lines[i]);
    if (!p) {
      if (lines[i].trim() === "") continue;
      return undefined; // hit a heading/paragraph — no task parent
    }
    if (p.indent < current.indent) {
      if (!p.id) return undefined;
      const sub = splitSubtaskId(p.id);
      return sub ? sub.parentId : p.id;
    }
  }
  return undefined;
}
