import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, getDay, getISOWeek } from 'date-fns';
import { listNotes, readNote, readJsonFile } from './fileSystem';
import { parseFrontmatterFields } from './frontmatter';
import { loadDailyWorkhour } from './workhour';
import { FOLDERS, FILES } from './constants';
import { normalizeLegacyType, normalizeProject } from '../types/note';
import type { TodosFile } from '../types/task';

export type DateRange = { start: Date; end: Date };

export interface DashboardStats {
  workhourByProject: { project: string; hours: number }[];
  totalWorkhour: number;
  notesByType: Record<string, number>;
  totalNotes: number;
  todoCompletionRate: number;
  todoTotal: number;
  todoDone: number;
  overdueCount: number;
  carryOverRate: number;
  testPassRate: number;
  testTotal: number;
  completionRate: number;
  /** §5.8 Study Note application ratio: applied study notes / total study notes (-1 if no study notes) */
  studyToApplication: number;
  notesMeta: ParsedNoteMeta[];
}

export interface ParsedNoteMeta {
  id: string;
  title: string;
  type: string;
  date: string;
  project: string[];
  status: string;
  verdict: string;
  tags: string[];
  related: string[];
  subsystem: string[];
  path: string;
  updated: string;
  content: string;
}

export interface GrowthScore {
  productivity: number;    // 0-100
  techGrowth: number;      // 0-100
  engineering: number;     // 0-100
  knowledgeMgmt: number;   // 0-100
  total: number;           // weighted average 0-100
}

export function calculateGrowthScore(stats: DashboardStats): GrowthScore {
  const completionRate = stats.completionRate >= 0 ? stats.completionRate : 0;
  const todoCompletion = stats.todoCompletionRate >= 0 ? stats.todoCompletionRate : 0;
  const carryOver = stats.carryOverRate;

  // productivity (20%): completion_rate * 0.5 + todo_completion * 0.3 + (1-carry_over) * 0.2
  const productivity = (completionRate * 0.5 + todoCompletion * 0.3 + (1 - carryOver) * 0.2) * 100;

  // techGrowth (30%): study ratio * 0.6 + study_to_application * 0.4  (§4.6 / §5.8)
  const studyNotes = stats.notesByType['study-note'] ?? 0;
  const totalNotes = stats.totalNotes > 0 ? stats.totalNotes : 1;
  const studyRatio = Math.min(studyNotes / totalNotes, 1);
  const s2a = stats.studyToApplication >= 0 ? stats.studyToApplication : 0;
  const techGrowth = (studyRatio * 0.6 + s2a * 0.4) * 100;

  // engineering (30%): completion_rate * 0.5 + test_pass_rate * 0.5
  const testPassRate = stats.testPassRate >= 0 ? stats.testPassRate : 0;
  const engineering = (completionRate * 0.5 + testPassRate * 0.5) * 100;

  // knowledgeMgmt (20%): (1 - orphan_rate)
  const nonDaily = stats.notesMeta.filter(n => n.type !== 'daily-log' && n.status !== 'archived');
  const orphanCount = nonDaily.filter(n => {
    const relatedCount = n.related?.length ?? 0;
    const onlyDaily = n.related?.every(r => r.includes('daily')) ?? true;
    return relatedCount <= 1 && onlyDaily;
  }).length;
  const orphanRate = nonDaily.length > 0 ? orphanCount / nonDaily.length : 0;
  const knowledgeMgmt = (1 - orphanRate) * 100;

  // weighted average: productivity 20%, techGrowth 30%, engineering 30%, knowledgeMgmt 20%
  const total = productivity * 0.2 + techGrowth * 0.3 + engineering * 0.3 + knowledgeMgmt * 0.2;

  return {
    productivity: Math.round(productivity),
    techGrowth: Math.round(techGrowth),
    engineering: Math.round(engineering),
    knowledgeMgmt: Math.round(knowledgeMgmt),
    total: Math.round(total),
  };
}

export function getDateRange(period: 'week' | 'month' | 'custom', customRange?: DateRange): DateRange {
  const now = new Date();
  if (period === 'week') {
    return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  }
  if (period === 'month') {
    return { start: startOfMonth(now), end: endOfMonth(now) };
  }
  return customRange ?? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
}

let _notesCache: { dataDir: string; data: ParsedNoteMeta[]; ts: number } | null = null;
const NOTES_CACHE_TTL = 10_000;

async function collectAllNotes(dataDir: string): Promise<ParsedNoteMeta[]> {
  if (_notesCache && _notesCache.dataDir === dataDir && Date.now() - _notesCache.ts < NOTES_CACHE_TTL) {
    return _notesCache.data;
  }

  const results: ParsedNoteMeta[] = [];
  const folders = [FOLDERS.daily, FOLDERS.research];

  for (const folder of folders) {
    try {
      const files = await listNotes(dataDir, folder);
      for (const filePath of files) {
        if (!filePath.endsWith('.md')) continue;
        try {
          const raw = await readNote(dataDir, filePath);
          const fields = parseFrontmatterFields(raw);
          const normalizedType = normalizeLegacyType(fields.type ?? 'quick-memo');
          const projects = normalizeProject(fields.project);
          results.push({
            id: fields.id ?? '',
            title: fields.title ?? filePath.split(/[/\\]/).pop()?.replace('.md', '') ?? '',
            type: normalizedType,
            date: fields.date ?? fields.created?.slice(0, 10) ?? '',
            project: projects,
            status: fields.status ?? 'draft',
            verdict: fields.verdict ?? '',
            tags: Array.isArray(fields.tags) ? fields.tags : [],
            related: Array.isArray(fields.related) ? fields.related : [],
            subsystem: Array.isArray(fields.subsystem) ? fields.subsystem : [],
            path: filePath,
            updated: fields.updated ?? fields.created ?? '',
            content: raw,
          });
        } catch {}
      }
    } catch {}
  }

  _notesCache = { dataDir, data: results, ts: Date.now() };
  return results;
}

export function invalidateNotesCache() {
  _notesCache = null;
}

function filterByDateRange(notes: ParsedNoteMeta[], range: DateRange): ParsedNoteMeta[] {
  const startStr = format(range.start, 'yyyy-MM-dd');
  const endStr = format(range.end, 'yyyy-MM-dd');
  return notes.filter(n => n.date >= startStr && n.date <= endStr);
}

/**
 * §5.8 Study Note application ratio.
 * A study note is "applied" if any note whose id appears in its `related` field
 * has type analysis-note or design-note.
 * Returns applied / total, or -1 when there are no study notes.
 */
export function calcStudyToApplication(notes: ParsedNoteMeta[]): number {
  const noteById = new Map<string, ParsedNoteMeta>();
  for (const n of notes) {
    if (n.id) noteById.set(n.id, n);
  }

  const studyNotes = notes.filter(n => n.type === 'study-note');
  if (studyNotes.length === 0) return -1;

  let applied = 0;
  for (const sn of studyNotes) {
    const related = sn.related ?? [];
    const hasApplication = related.some(rid => {
      const linked = noteById.get(rid);
      return linked && (linked.type === 'analysis-note' || linked.type === 'design-note');
    });
    if (hasApplication) applied++;
  }

  return applied / studyNotes.length;
}

async function collectWorkhour(dataDir: string, range: DateRange): Promise<{ project: string; hours: number }[]> {
  const days = eachDayOfInterval({ start: range.start, end: range.end });
  const projectMap = new Map<string, number>();

  for (const day of days) {
    const dk = format(day, 'yyyy-MM-dd');
    try {
      const daily = await loadDailyWorkhour(dataDir, dk);
      for (const s of daily.sessions) {
        const p = s.project || 'GENERAL';
        projectMap.set(p, (projectMap.get(p) ?? 0) + s.durationMinutes);
      }
    } catch {}
  }

  return [...projectMap.entries()]
    .map(([project, mins]) => ({ project, hours: Math.round(mins / 6) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}

export async function getDashboardStats(
  dataDir: string,
  period: 'week' | 'month' | 'custom',
  customRange?: DateRange,
): Promise<DashboardStats> {
  const range = getDateRange(period, customRange);
  const [allNotes, workhourByProject, todosFile] = await Promise.all([
    collectAllNotes(dataDir),
    collectWorkhour(dataDir, range),
    readJsonFile<TodosFile>(dataDir, FILES.todos),
  ]);

  const rangeNotes = filterByDateRange(allNotes, range);
  const totalWorkhour = workhourByProject.reduce((s, w) => s + w.hours, 0);

  const notesByType: Record<string, number> = {};
  for (const n of rangeNotes) {
    if (n.type === 'daily-log') continue;
    notesByType[n.type] = (notesByType[n.type] ?? 0) + 1;
  }

  const todos = todosFile?.todos ?? [];
  const todoDone = todos.filter(t => t.status === 'done').length;
  const overdueCount = todos.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < format(new Date(), 'yyyy-MM-dd')).length;
  const highCarry = todos.filter(t => (t.carry_count ?? 0) >= 3).length;
  const carryOverRate = todos.length > 0 ? highCarry / todos.length : 0;

  const testLogs = rangeNotes.filter(n => n.type === 'test-log' && n.status === 'complete');
  const testPass = testLogs.filter(n => n.verdict === 'pass').length;
  const testPassRate = testLogs.length > 0 ? testPass / testLogs.length : -1;

  const completable = rangeNotes.filter(n => n.type !== 'daily-log' && n.type !== 'quick-memo');
  const completed = completable.filter(n => n.status === 'complete' || n.status === 'archived');
  const completionRate = completable.length > 0 ? completed.length / completable.length : -1;

  // §5.8 Study Note application tracking
  const studyToApplication = calcStudyToApplication(allNotes);

  return {
    workhourByProject,
    totalWorkhour,
    notesByType,
    totalNotes: rangeNotes.filter(n => n.type !== 'daily-log').length,
    todoCompletionRate: todos.length > 0 ? todoDone / todos.length : -1,
    todoTotal: todos.length,
    todoDone,
    overdueCount,
    carryOverRate,
    testPassRate,
    testTotal: testLogs.length,
    completionRate,
    studyToApplication,
    notesMeta: allNotes,
  };
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export interface WorkhourByDay {
  day: string;
  dayIndex: number;
  hours: number;
  notes: number;
  date?: string;
}

export async function getWorkhourByDay(
  dataDir: string,
  period: 'week' | 'month',
): Promise<WorkhourByDay[]> {
  const now = new Date();
  const allNotes = await collectAllNotes(dataDir);

  if (period === 'week') {
    const range = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    const days = eachDayOfInterval({ start: range.start, end: range.end });
    return Promise.all(days.map(async (day) => {
      const dk = format(day, 'yyyy-MM-dd');
      let mins = 0;
      try { mins = (await loadDailyWorkhour(dataDir, dk)).total_minutes; } catch {}
      const dow = getDay(day);
      const dayNotes = allNotes.filter(n => n.date === dk && n.type !== 'daily-log').length;
      return {
        day: `${DAY_LABELS[dow]} ${format(day, 'M/d')}`,
        dayIndex: dow,
        hours: Math.round(mins / 6) / 10,
        notes: dayNotes,
        date: dk,
      };
    }));
  }

  // month: aggregate by week
  const range = { start: startOfMonth(now), end: endOfMonth(now) };
  const days = eachDayOfInterval({ start: range.start, end: range.end });
  const firstWeek = getISOWeek(range.start);
  const weekMap = new Map<number, number>();
  const weekNoteMap = new Map<number, number>();

  for (const day of days) {
    const dk = format(day, 'yyyy-MM-dd');
    const week = getISOWeek(day) - firstWeek + 1;
    try {
      const daily = await loadDailyWorkhour(dataDir, dk);
      weekMap.set(week, (weekMap.get(week) ?? 0) + daily.total_minutes);
    } catch {}
    const dayNotes = allNotes.filter(n => n.date === dk && n.type !== 'daily-log').length;
    weekNoteMap.set(week, (weekNoteMap.get(week) ?? 0) + dayNotes);
  }

  const maxWeek = Math.max(...weekMap.keys(), Math.ceil(days.length / 7));
  return Array.from({ length: maxWeek }, (_, i) => ({
    day: `${i + 1}주차`,
    dayIndex: i + 1,
    hours: Math.round((weekMap.get(i + 1) ?? 0) / 6) / 10,
    notes: weekNoteMap.get(i + 1) ?? 0,
  }));
}

export interface DailyActivity {
  date: string;
  label: string;
  hours: number;
  notes: number;
}

export async function getDailyActivity(
  dataDir: string,
  period: 'week' | 'month',
): Promise<DailyActivity[]> {
  const now = new Date();
  const range = period === 'week'
    ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    : { start: startOfMonth(now), end: endOfMonth(now) };

  const days = eachDayOfInterval({ start: range.start, end: range.end });
  const allNotes = await collectAllNotes(dataDir);

  return Promise.all(days.map(async (day) => {
    const dk = format(day, 'yyyy-MM-dd');
    let mins = 0;
    try { mins = (await loadDailyWorkhour(dataDir, dk)).total_minutes; } catch {}
    const dayNotes = allNotes.filter(n => n.date === dk && n.type !== 'daily-log').length;
    return {
      date: dk,
      label: period === 'week' ? DAY_LABELS[getDay(day)] : format(day, 'd'),
      hours: Math.round(mins / 6) / 10,
      notes: dayNotes,
    };
  }));
}

export interface WeeklyHeatmapCell {
  week: number;
  weekLabel: string;
  day: string;
  dayIndex: number;
  hours: number;
  date: string;
}

export async function getMonthlyHeatmap(dataDir: string): Promise<WeeklyHeatmapCell[]> {
  const now = new Date();
  const range = { start: startOfMonth(now), end: endOfMonth(now) };
  const days = eachDayOfInterval({ start: range.start, end: range.end });

  const firstWeek = getISOWeek(range.start);
  const cells: WeeklyHeatmapCell[] = [];

  for (const day of days) {
    const dk = format(day, 'yyyy-MM-dd');
    let mins = 0;
    try {
      const daily = await loadDailyWorkhour(dataDir, dk);
      mins = daily.total_minutes;
    } catch {}
    const week = getISOWeek(day) - firstWeek + 1;
    const dow = getDay(day);
    cells.push({
      week,
      weekLabel: `${week}주`,
      day: DAY_LABELS[dow],
      dayIndex: dow,
      hours: Math.round(mins / 6) / 10,
      date: dk,
    });
  }
  return cells;
}

// ──── Focus Time Distribution ────

export interface FocusTimeData {
  day: string;
  [key: string]: string | number;
}

export async function getFocusTimeDistribution(
  dataDir: string,
  period: 'week' | 'month',
): Promise<{ data: FocusTimeData[]; projects: string[] }> {
  const now = new Date();
  const range = period === 'week'
    ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    : { start: startOfMonth(now), end: endOfMonth(now) };

  const days = eachDayOfInterval({ start: range.start, end: range.end });
  const projectSet = new Set<string>();

  if (period === 'week') {
    const data: FocusTimeData[] = await Promise.all(days.map(async (day) => {
      const dk = format(day, 'yyyy-MM-dd');
      const entry: FocusTimeData = { day: `${DAY_LABELS[getDay(day)]}` };
      try {
        const daily = await loadDailyWorkhour(dataDir, dk);
        for (const s of daily.sessions) {
          const proj = s.project || 'GENERAL';
          projectSet.add(proj);
          entry[proj] = ((entry[proj] as number) || 0) + Math.round(s.durationMinutes / 6) / 10;
        }
      } catch {}
      return entry;
    }));
    return { data, projects: Array.from(projectSet) };
  }

  const firstWeek = getISOWeek(range.start);
  const weekMap = new Map<number, FocusTimeData>();

  for (const day of days) {
    const dk = format(day, 'yyyy-MM-dd');
    const week = getISOWeek(day) - firstWeek + 1;
    if (!weekMap.has(week)) weekMap.set(week, { day: `${week}주차` });
    try {
      const daily = await loadDailyWorkhour(dataDir, dk);
      const entry = weekMap.get(week)!;
      for (const s of daily.sessions) {
        const proj = s.project || 'GENERAL';
        projectSet.add(proj);
        entry[proj] = ((entry[proj] as number) || 0) + Math.round(s.durationMinutes / 6) / 10;
      }
    } catch {}
  }

  const maxWeek = Math.max(...weekMap.keys(), Math.ceil(days.length / 7));
  const data = Array.from({ length: maxWeek }, (_, i) => weekMap.get(i + 1) ?? { day: `${i + 1}주차` });
  return { data, projects: Array.from(projectSet) };
}

// ──── Work Pattern ────

export interface WorkPatternCell {
  slot: string;
  slotIndex: number;
  dayIndex: number;
  count: number;
}

const TIME_SLOTS = [
  { name: '오전', start: 6, end: 12 },
  { name: '오후', start: 12, end: 18 },
  { name: '야간', start: 18, end: 24 },
];

export async function getWorkPattern(
  dataDir: string,
  period: 'week' | 'month',
): Promise<WorkPatternCell[]> {
  const now = new Date();
  const range = period === 'week'
    ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    : { start: startOfMonth(now), end: endOfMonth(now) };

  const grid = new Map<string, number>();

  function addToGrid(d: Date) {
    const hour = d.getHours();
    const dow = getDay(d);
    const si = TIME_SLOTS.findIndex(s => hour >= s.start && hour < s.end);
    if (si === -1) return;
    const key = `${si}-${dow}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }

  const allNotes = await collectAllNotes(dataDir);
  for (const note of filterByDateRange(allNotes, range).filter(n => n.type !== 'daily-log')) {
    const ts = note.updated || '';
    if (!ts || ts.length < 11) continue;
    const d = new Date(ts);
    if (!isNaN(d.getTime())) addToGrid(d);
  }

  const days = eachDayOfInterval(range);
  for (const day of days) {
    try {
      const daily = await loadDailyWorkhour(dataDir, format(day, 'yyyy-MM-dd'));
      for (const s of daily.sessions) {
        if (!s.startedAt) continue;
        const d = new Date(s.startedAt);
        if (!isNaN(d.getTime())) addToGrid(d);
      }
    } catch {}
  }

  const cells: WorkPatternCell[] = [];
  for (let si = 0; si < TIME_SLOTS.length; si++) {
    for (let di = 0; di < 7; di++) {
      cells.push({ slot: TIME_SLOTS[si].name, slotIndex: si, dayIndex: di, count: grid.get(`${si}-${di}`) ?? 0 });
    }
  }
  return cells;
}

// ──── Productivity Trend ────

export interface ProductivityPoint {
  day: string;
  score: number;
  avg: number;
}

export async function getProductivityTrend(
  dataDir: string,
  period: 'week' | 'month',
): Promise<ProductivityPoint[]> {
  const now = new Date();
  const range = period === 'week'
    ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    : { start: startOfMonth(now), end: endOfMonth(now) };

  const days = eachDayOfInterval({ start: range.start, end: range.end });
  const allNotes = await collectAllNotes(dataDir);

  let todosFile: TodosFile | null = null;
  try { todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos); } catch {}

  const scores: number[] = [];
  const labels: string[] = [];

  for (const day of days) {
    const dk = format(day, 'yyyy-MM-dd');
    labels.push(period === 'week' ? DAY_LABELS[getDay(day)] : format(day, 'd'));

    let mins = 0;
    try { mins = (await loadDailyWorkhour(dataDir, dk)).total_minutes; } catch {}
    const hourScore = Math.min(mins / 480, 1) * 40;

    const dayNotes = allNotes.filter(n => n.date === dk && n.type !== 'daily-log').length;
    const noteScore = Math.min(dayNotes / 5, 1) * 30;

    let taskScore = 0;
    if (todosFile?.todos) {
      const doneToday = todosFile.todos.filter(t => t.status === 'done' && t.updatedAt?.startsWith(dk)).length;
      taskScore = Math.min(doneToday / 3, 1) * 30;
    }

    scores.push(Math.round(hourScore + noteScore + taskScore));
  }

  return scores.map((score, i) => {
    const ws = Math.max(0, i - 1);
    const we = Math.min(scores.length - 1, i + 1);
    const avg = Math.round(scores.slice(ws, we + 1).reduce((a, b) => a + b, 0) / (we - ws + 1));
    return { day: labels[i], score, avg };
  });
}

// ──── Weekly Comparison ────

export interface WeeklyComparison {
  metric: string;
  thisWeek: number;
  lastWeek: number;
}

export async function getWeeklyComparison(dataDir: string): Promise<WeeklyComparison[]> {
  const now = new Date();
  const tw = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  const lwStart = new Date(tw.start); lwStart.setDate(lwStart.getDate() - 7);
  const lwEnd = new Date(tw.end); lwEnd.setDate(lwEnd.getDate() - 7);
  const lw = { start: lwStart, end: lwEnd };

  const allNotes = await collectAllNotes(dataDir);

  async function weekHours(range: DateRange) {
    const days = eachDayOfInterval(range);
    let total = 0;
    for (const day of days) {
      try { total += (await loadDailyWorkhour(dataDir, format(day, 'yyyy-MM-dd'))).total_minutes; } catch {}
    }
    return Math.round(total / 6) / 10;
  }

  function weekNotes(range: DateRange) {
    const s = format(range.start, 'yyyy-MM-dd');
    const e = format(range.end, 'yyyy-MM-dd');
    return allNotes.filter(n => n.date >= s && n.date <= e && n.type !== 'daily-log').length;
  }

  let todosFile: TodosFile | null = null;
  try { todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos); } catch {}

  function weekTasks(range: DateRange) {
    if (!todosFile?.todos) return 0;
    const s = format(range.start, 'yyyy-MM-dd');
    const e = format(range.end, 'yyyy-MM-dd');
    return todosFile.todos.filter(t =>
      t.status === 'done' && t.updatedAt && t.updatedAt.slice(0, 10) >= s && t.updatedAt.slice(0, 10) <= e
    ).length;
  }

  const [twH, lwH] = await Promise.all([weekHours(tw), weekHours(lw)]);

  return [
    { metric: 'Workhour', thisWeek: twH, lastWeek: lwH },
    { metric: 'Notes', thisWeek: weekNotes(tw), lastWeek: weekNotes(lw) },
    { metric: 'Tasks Done', thisWeek: weekTasks(tw), lastWeek: weekTasks(lw) },
  ];
}

export interface WritingStreak {
  current: number;
  longest: number;
}

export async function getWritingStreak(dataDir: string): Promise<WritingStreak> {
  const dailyDir = `${FOLDERS.daily}`;
  let files: string[];
  try {
    files = await listNotes(dataDir, dailyDir);
  } catch {
    return { current: 0, longest: 0 };
  }

  const dates = files
    .map(f => f.split(/[/\\]/).pop()?.replace('.md', '') ?? '')
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  if (dates.length === 0) return { current: 0, longest: 0 };

  let current = 0;
  let longest = 0;
  let streak = 1;
  const today = format(new Date(), 'yyyy-MM-dd');

  if (dates[0] === today || dates[0] === format(new Date(Date.now() - 86400000), 'yyyy-MM-dd')) {
    current = 1;
  }

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (prev.getTime() - curr.getTime()) / 86400000;

    if (Math.round(diff) === 1) {
      streak++;
      if (i === current) current = streak;
    } else {
      longest = Math.max(longest, streak);
      streak = 1;
    }
  }
  longest = Math.max(longest, streak);
  if (current === 0 && dates[0] === today) current = 1;

  return { current, longest };
}
