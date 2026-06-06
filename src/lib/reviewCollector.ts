import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths, eachDayOfInterval } from 'date-fns';
import { listNotes, readNote, readJsonFile } from './fileSystem';
import { parseFrontmatterFields, splitFrontmatter } from './frontmatter';
import { loadDailyWorkhour } from './workhour';
import { FOLDERS, FILES } from './constants';
import { normalizeLegacyType } from '../types/note';
import type { TodosFile } from '../types/task';
import type { LinksFile } from '../types/dataFiles';

export type ReviewType = 'weekly' | 'monthly' | 'quarterly';

export interface ReviewStats {
  total_workhour: number;
  workhour_by_project: Record<string, number>;
  notes_created: number;
  notes_by_type: Record<string, number>;
  completion_rate: number;
  test_pass_rate: number;
  carry_over_rate: number;
  todo_completion_rate: number;
  overdue_count: number;
  active_tags_top10: string[];
  new_tags: string[];
  study_notes_count: number;
  /** §5.8 applied study notes / total study notes (-1 if none) */
  study_to_application: number;
  orphan_rate: number;
  avg_links_per_note: number;
}

export interface ReviewContext {
  periodStart: string;
  periodEnd: string;
  stats: ReviewStats;
  dailyLogSummaries: string[];
  noteSummaries: string[];
  todoSummary: string;
}

function getPeriodRange(type: ReviewType, referenceDate?: Date, currentPeriod?: boolean): { start: Date; end: Date } {
  const ref = referenceDate ?? new Date();

  if (currentPeriod) {
    if (type === 'weekly') {
      return { start: startOfWeek(ref, { weekStartsOn: 1 }), end: ref };
    }
    if (type === 'monthly') {
      return { start: startOfMonth(ref), end: ref };
    }
    const qMonths = [0, 3, 6, 9];
    const m = ref.getMonth();
    const qStart = qMonths.filter(q => q <= m).pop() ?? 0;
    return { start: new Date(ref.getFullYear(), qStart, 1), end: ref };
  }

  if (type === 'weekly') {
    const prevWeekStart = startOfWeek(subWeeks(ref, 1), { weekStartsOn: 1 });
    const prevWeekEnd = endOfWeek(subWeeks(ref, 1), { weekStartsOn: 1 });
    return { start: prevWeekStart, end: prevWeekEnd };
  }
  if (type === 'monthly') {
    const prevMonthStart = startOfMonth(subMonths(ref, 1));
    const prevMonthEnd = endOfMonth(subMonths(ref, 1));
    return { start: prevMonthStart, end: prevMonthEnd };
  }
  const qStart = subMonths(ref, 3);
  return { start: startOfMonth(qStart), end: endOfMonth(subMonths(ref, 1)) };
}

export async function collectReviewData(
  dataDir: string,
  type: ReviewType,
  referenceDate?: Date,
  currentPeriod?: boolean,
): Promise<ReviewContext> {
  const { start, end } = getPeriodRange(type, referenceDate, currentPeriod);
  const startStr = format(start, 'yyyy-MM-dd');
  const endStr = format(end, 'yyyy-MM-dd');

  const folders = [FOLDERS.daily, FOLDERS.research];
  const allNotes: { id: string; type: string; date: string; title: string; status: string; verdict: string; tags: string[]; related: string[]; content: string; body: string }[] = [];

  for (const folder of folders) {
    try {
      const files = await listNotes(dataDir, folder);
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        try {
          const raw = await readNote(dataDir, f);
          const fields = parseFrontmatterFields(raw);
          const { body } = splitFrontmatter(raw);
          const noteDate = fields.date ?? fields.created?.slice(0, 10) ?? '';
          if (noteDate < startStr || noteDate > endStr) continue;

          allNotes.push({
            id: fields.id ?? '',
            type: normalizeLegacyType(fields.type ?? 'quick-memo') as string,
            date: noteDate,
            title: fields.title ?? '',
            status: fields.status ?? 'draft',
            verdict: fields.verdict ?? '',
            tags: Array.isArray(fields.tags) ? fields.tags : [],
            related: Array.isArray(fields.related) ? fields.related : [],
            content: raw,
            body: body.slice(0, 2000),
          });
        } catch {}
      }
    } catch {}
  }

  const days = eachDayOfInterval({ start, end });
  const workhourByProject: Record<string, number> = {};
  let totalMinutes = 0;
  for (const day of days) {
    try {
      const daily = await loadDailyWorkhour(dataDir, format(day, 'yyyy-MM-dd'));
      totalMinutes += daily.total_minutes;
      for (const s of daily.sessions) {
        const p = s.project || 'GENERAL';
        workhourByProject[p] = (workhourByProject[p] ?? 0) + s.durationMinutes;
      }
    } catch {}
  }
  for (const p of Object.keys(workhourByProject)) {
    workhourByProject[p] = Math.round(workhourByProject[p] / 6) / 10;
  }

  const nonDaily = allNotes.filter(n => n.type !== 'daily-log');
  const notesByType: Record<string, number> = {};
  for (const n of nonDaily) {
    notesByType[n.type] = (notesByType[n.type] ?? 0) + 1;
  }

  const completable = nonDaily.filter(n => n.type !== 'quick-memo');
  const completed = completable.filter(n => n.status === 'complete' || n.status === 'archived');
  const testLogs = nonDaily.filter(n => n.type === 'test-log' && n.status === 'complete');
  const testPass = testLogs.filter(n => n.verdict === 'pass').length;

  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  const todos = todosFile?.todos ?? [];
  const todoDone = todos.filter(t => t.status === 'done').length;
  const overdueCount = todos.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < format(new Date(), 'yyyy-MM-dd')).length;
  const highCarry = todos.filter(t => (t.carry_count ?? 0) >= 3).length;

  const allTags = nonDaily.flatMap(n => n.tags);
  const tagCounts = new Map<string, number>();
  for (const t of allTags) {
    tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);

  const linksFile = await readJsonFile<LinksFile>(dataDir, FILES.links);
  const links = linksFile ?? {};
  let totalLinks = 0;
  let orphanCount = 0;
  for (const n of nonDaily) {
    const entry = links[n.title];
    const linkCount = (entry?.forward?.length ?? 0) + (entry?.backward?.length ?? 0);
    totalLinks += linkCount;
    if (linkCount === 0) orphanCount++;
  }

  // §5.8 Study-to-application ratio
  const noteById = new Map<string, typeof allNotes[number]>();
  for (const n of allNotes) {
    if (n.id) noteById.set(n.id, n);
  }
  const studyNotes = allNotes.filter(n => n.type === 'study-note');
  let studyApplied = 0;
  for (const sn of studyNotes) {
    if (sn.related.some(rid => {
      const linked = noteById.get(rid);
      return linked && (linked.type === 'analysis-note' || linked.type === 'design-note');
    })) {
      studyApplied++;
    }
  }

  const stats: ReviewStats = {
    total_workhour: Math.round(totalMinutes / 6) / 10,
    workhour_by_project: workhourByProject,
    notes_created: nonDaily.length,
    notes_by_type: notesByType,
    completion_rate: completable.length > 0 ? Math.round((completed.length / completable.length) * 100) / 100 : 0,
    test_pass_rate: testLogs.length > 0 ? Math.round((testPass / testLogs.length) * 100) / 100 : -1,
    carry_over_rate: todos.length > 0 ? Math.round((highCarry / todos.length) * 100) / 100 : 0,
    todo_completion_rate: todos.length > 0 ? Math.round((todoDone / todos.length) * 100) / 100 : 0,
    overdue_count: overdueCount,
    active_tags_top10: topTags,
    new_tags: [],
    study_notes_count: studyNotes.length,
    study_to_application: studyNotes.length > 0
      ? Math.round((studyApplied / studyNotes.length) * 100) / 100
      : -1,
    orphan_rate: nonDaily.length > 0 ? Math.round((orphanCount / nonDaily.length) * 100) / 100 : 0,
    avg_links_per_note: nonDaily.length > 0 ? Math.round((totalLinks / nonDaily.length) * 10) / 10 : 0,
  };

  // Calculate new_tags: tags in this period that weren't in the previous period
  const prevRange = getPeriodRange(type, start, false);
  const prevStartStr = format(prevRange.start, 'yyyy-MM-dd');
  const prevEndStr = format(prevRange.end, 'yyyy-MM-dd');
  const prevTags = new Set<string>();
  for (const folder of folders) {
    try {
      const files = await listNotes(dataDir, folder);
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        try {
          const raw = await readNote(dataDir, f);
          const fields = parseFrontmatterFields(raw);
          const noteDate = fields.date ?? fields.created?.slice(0, 10) ?? '';
          if (noteDate < prevStartStr || noteDate > prevEndStr) continue;
          if (fields.type === 'daily-log') continue;
          const tags = Array.isArray(fields.tags) ? fields.tags : [];
          for (const t of tags) prevTags.add(t);
        } catch {}
      }
    } catch {}
  }
  stats.new_tags = topTags.filter(t => !prevTags.has(t));

  const dailyLogs = allNotes.filter(n => n.type === 'daily-log').sort((a, b) => a.date.localeCompare(b.date));
  const bodyLimit = type === 'weekly' ? 2000 : 500;
  const dailyLogSummaries = dailyLogs.map(d => `### ${d.date}\n${d.body.slice(0, bodyLimit)}`);

  const noteSummaries = nonDaily.map(n => `- [${n.type}] ${n.title} (${n.date}, status: ${n.status}${n.verdict ? `, verdict: ${n.verdict}` : ''}, tags: ${n.tags.join(', ')})`);

  const todoLines = todos.filter(t => t.status !== 'done').map(t =>
    `- [${t.status}] ${t.title}${t.dueDate ? ` (due: ${t.dueDate})` : ''}${(t.carry_count ?? 0) > 0 ? ` (carried: ${t.carry_count}x)` : ''}`
  );

  return {
    periodStart: startStr,
    periodEnd: endStr,
    stats,
    dailyLogSummaries,
    noteSummaries,
    todoSummary: todoLines.join('\n'),
  };
}

export function buildReviewId(type: ReviewType, periodStart: string): string {
  if (type === 'weekly') {
    const d = new Date(periodStart + 'T00:00:00');
    const weekNum = getISOWeek(d);
    const year = d.getFullYear();
    return `review-weekly-${year}-W${String(weekNum).padStart(2, '0')}`;
  }
  if (type === 'monthly') {
    return `review-monthly-${periodStart.slice(0, 7)}`;
  }
  return `review-quarterly-${periodStart.slice(0, 7)}`;
}

function getISOWeek(date: Date): number {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
