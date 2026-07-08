import { readJsonFile, readNote, listNotes } from './fileSystem';
import { FILES, FOLDERS } from './constants';
import { findNotesForProject, findNotesForTopic, findNotesForExperiment, type HubNoteRow } from './db';
import type { TopicsFile, LinksFile } from '../types/dataFiles';
import type { TodosFile } from '../types/task';
import type { NoteType } from '../types/note';
import type { ExperimentsFile } from '../types/experiment';
import type {
  TimelineEntry,
  ConclusionEntry,
  TopicLink,
  DDayItem,
  ExperimentSummary,
} from '../stores/useHubStore';

function extractSummary(content: string): string {
  const lines = content.split('\n');
  let inAnalysis = false;
  for (const line of lines) {
    if (/^##\s+분석/.test(line)) { inAnalysis = true; continue; }
    if (inAnalysis && /^##\s/.test(line)) break;
    if (inAnalysis) {
      const m = line.match(/^[-*]\s+(.+)/);
      if (m) return m[1].slice(0, 100);
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.startsWith('|')) {
      return trimmed.slice(0, 100);
    }
  }
  return '';
}

function extractConclusions(content: string, noteId: string, notePath: string, date: string): ConclusionEntry[] {
  const lines = content.split('\n');
  const results: ConclusionEntry[] = [];
  let inAnalysis = false;
  for (const line of lines) {
    if (/^##\s+분석/.test(line)) { inAnalysis = true; continue; }
    if (inAnalysis && /^##\s/.test(line)) break;
    if (inAnalysis) {
      const bullet = line.match(/^[-*]\s+(.+)/);
      const numbered = line.match(/^\d+\.\s+(.+)/);
      const text = bullet?.[1] || numbered?.[1];
      if (text) results.push({ text: text.slice(0, 200), noteId, notePath, date });
    }
  }
  return results;
}

function rowToTimelineEntry(row: HubNoteRow): TimelineEntry {
  return {
    date: row.created?.slice(0, 10) || '',
    type: (row.note_type || 'quick-memo') as NoteType,
    title: row.title || '(제목 없음)',
    summary: extractSummary(row.content),
    noteId: row.id,
    notePath: row.path,
    topicName: row.topic || undefined,
    tags: row.tags ? row.tags.split(', ').filter(Boolean) : [],
  };
}

function deduplicateRows(rows: HubNoteRow[]): HubNoteRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = r.id || r.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface DailyInlineEntry {
  date: string;
  topicName: string;
  memoText: string;
  dailyPath: string;
}

async function parseDailyInlineTopics(
  dataDir: string,
  topicNames: Set<string>,
  limitDays: number = 90,
): Promise<DailyInlineEntry[]> {
  const results: DailyInlineEntry[] = [];
  try {
    const files = await listNotes(dataDir, FOLDERS.daily);
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - limitDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const recentFiles = files
      .filter((f) => {
        const name = f.split(/[/\\]/).pop()?.replace('.md', '') || '';
        return name >= cutoffStr;
      })
      .sort()
      .reverse()
      .slice(0, 60);

    for (const filePath of recentFiles) {
      try {
        const content = await readNote(dataDir, filePath);
        const lines = content.split('\n');
        let inMemo = false;
        const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch?.[1] || '';

        for (const line of lines) {
          if (/^##\s+메모/.test(line)) { inMemo = true; continue; }
          if (inMemo && /^##\s/.test(line)) break;
          if (inMemo) {
            const hashTags = line.match(/#([^\s#]+)/g);
            if (hashTags) {
              for (const tag of hashTags) {
                const topicName = tag.slice(1);
                if (topicNames.has(topicName)) {
                  const memoText = line.replace(/#[^\s#]+/g, '').replace(/^[-*]\s*/, '').trim();
                  results.push({ date, topicName, memoText, dailyPath: filePath });
                }
              }
            }
          }
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* no daily folder */ }
  return results;
}

export async function loadProjectHubData(dataDir: string, projectName: string) {
  const [topicsFile, todosFile, linksFile, ddaysFile, experimentsFile, projectsFile] = await Promise.all([
    readJsonFile<TopicsFile>(dataDir, FILES.topics),
    readJsonFile<TodosFile>(dataDir, FILES.todos),
    readJsonFile<LinksFile>(dataDir, FILES.links),
    readJsonFile<{ events: { id: string; name: string; targetDate: string }[] }>(dataDir, FILES.ddays),
    readJsonFile<ExperimentsFile>(dataDir, FILES.experiments),
    readJsonFile<{ projects: { id: string; name: string }[] }>(dataDir, FILES.projects),
  ]);

  const allTopics = topicsFile?.topics || [];
  const projectTopics = allTopics.filter((t) => t.project === projectName);
  const topicNames = new Set(projectTopics.map((t) => t.name));

  const noteRows = deduplicateRows(await findNotesForProject(projectName));
  console.log(`[Hub] loadProjectHubData "${projectName}": ${noteRows.length} notes found`, noteRows.map(r => ({ id: r.id, title: r.title, project: r.project, topic: r.topic })));

  const timeline: TimelineEntry[] = noteRows.map(rowToTimelineEntry);
  timeline.sort((a, b) => b.date.localeCompare(a.date));

  const dailyInlines = await parseDailyInlineTopics(dataDir, topicNames, 90);
  for (const di of dailyInlines) {
    timeline.push({
      date: di.date,
      type: 'daily-inline',
      title: `Daily — "${di.memoText.slice(0, 60)}"`,
      summary: di.memoText,
      noteId: '',
      notePath: di.dailyPath,
      topicName: di.topicName,
    });
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date));

  const decisions = timeline.filter((e) => e.type === 'design-note');

  const dashboardRow = noteRows.find(r => r.note_type === 'project-dashboard');
  const dashboardNote = dashboardRow ? {
    path: dashboardRow.path,
    id: dashboardRow.id,
    title: dashboardRow.title,
    summary: extractSummary(dashboardRow.content),
  } : null;

  // todos.json stores the project *id* (auto-registered tasks) but legacy
  // entries may hold the name — match both.
  const projectId = projectsFile?.projects.find((p) => p.name === projectName)?.id;
  const allTodos = todosFile?.todos || [];
  const projectTodos = allTodos.filter(
    (t) => (t.projectId === projectName || (projectId && t.projectId === projectId)) && t.status !== 'done',
  );
  const openTodoCount = projectTodos.reduce(
    (sum, t) => sum + 1 + (t.subtasks?.filter((st) => !st.done && st.status !== 'done').length ?? 0),
    0,
  );

  const links = linksFile || {};
  const topicLinkMap = new Map<string, number>();
  for (const row of noteRows) {
    if (!row.topic || !row.id) continue;
    const entry = links[row.id];
    if (!entry) continue;
    for (const fwd of entry.forward || []) {
      const targetRow = noteRows.find((r) => r.id === fwd);
      if (targetRow && targetRow.topic && targetRow.topic !== row.topic) {
        const key = [row.topic, targetRow.topic].sort().join('|||');
        topicLinkMap.set(key, (topicLinkMap.get(key) || 0) + 1);
      }
    }
  }
  const topicLinks: TopicLink[] = [];
  for (const [key, count] of topicLinkMap) {
    const [from, to] = key.split('|||');
    topicLinks.push({ from, to, noteCount: count });
  }

  const ddayEvents = ddaysFile?.events || [];
  const milestones: DDayItem[] = ddayEvents.filter((e) =>
    e.name.toLowerCase().includes(projectName.toLowerCase()),
  );

  const statusOrder: Record<string, number> = { active: 0, done: 1, archived: 2 };
  const experiments: ExperimentSummary[] = (experimentsFile?.experiments || [])
    .filter((e) => e.projectId === projectId)
    .map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      noteCount: noteRows.filter((r) => r.experiment === e.name).length,
    }))
    .sort((a, b) => (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0) || a.name.localeCompare(b.name));

  return {
    projectName,
    topics: projectTopics,
    experiments,
    timeline,
    decisions,
    todos: projectTodos,
    openTodoCount,
    milestones,
    topicLinks,
    dashboardNote,
  };
}

export async function loadExperimentHubData(dataDir: string, experimentName: string, projectName: string) {
  const [todosFile, experimentsFile, projectsFile] = await Promise.all([
    readJsonFile<TodosFile>(dataDir, FILES.todos),
    readJsonFile<ExperimentsFile>(dataDir, FILES.experiments),
    readJsonFile<{ projects: { id: string; name: string }[] }>(dataDir, FILES.projects),
  ]);

  const projectId = projectsFile?.projects.find((p) => p.name === projectName)?.id;
  const meta = (experimentsFile?.experiments || []).find(
    (e) => e.name === experimentName && (!projectId || e.projectId === projectId),
  ) ?? {
    // Orphan experiment names in frontmatter still get a usable hub
    id: '',
    name: experimentName,
    projectId: projectId ?? '',
    status: 'active' as const,
    createdAt: '',
  };

  const noteRows = deduplicateRows(await findNotesForExperiment(experimentName, projectName));

  const timeline: TimelineEntry[] = noteRows.map(rowToTimelineEntry);
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  const conclusions: ConclusionEntry[] = [];
  for (const row of noteRows) {
    conclusions.push(...extractConclusions(row.content, row.id, row.path, row.created?.slice(0, 10) || ''));
  }
  conclusions.sort((a, b) => b.date.localeCompare(a.date));

  const allTodos = todosFile?.todos || [];
  const noteIds = new Set(noteRows.map((r) => r.id).filter(Boolean));
  const todos = allTodos.filter(
    (t) => t.status !== 'done' && t.related_notes?.some((n) => noteIds.has(n)),
  );

  return {
    meta,
    projectName,
    timeline,
    conclusions: conclusions.slice(0, 20),
    todos,
  };
}

export async function loadTopicHubData(dataDir: string, topicName: string) {
  const [topicsFile, todosFile, linksFile] = await Promise.all([
    readJsonFile<TopicsFile>(dataDir, FILES.topics),
    readJsonFile<TodosFile>(dataDir, FILES.todos),
    readJsonFile<LinksFile>(dataDir, FILES.links),
  ]);

  const allTopics = topicsFile?.topics || [];
  const meta = allTopics.find((t) => t.name === topicName);
  if (!meta) return null;

  const topicNames = new Set(allTopics.map((t) => t.name));

  const noteRows = deduplicateRows(await findNotesForTopic(topicName));
  console.log(`[Hub] loadTopicHubData "${topicName}": ${noteRows.length} notes found`, noteRows.map(r => ({ id: r.id, title: r.title, project: r.project, topic: r.topic })));

  const timeline: TimelineEntry[] = noteRows.map(rowToTimelineEntry);

  const dailyInlines = await parseDailyInlineTopics(dataDir, new Set([topicName]), 90);
  for (const di of dailyInlines) {
    timeline.push({
      date: di.date,
      type: 'daily-inline',
      title: `Daily — "${di.memoText.slice(0, 60)}"`,
      summary: di.memoText,
      noteId: '',
      notePath: di.dailyPath,
      topicName: di.topicName,
    });
  }
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  const conclusions: ConclusionEntry[] = [];
  for (const row of noteRows) {
    const entries = extractConclusions(row.content, row.id, row.path, row.created?.slice(0, 10) || '');
    conclusions.push(...entries);
  }
  conclusions.sort((a, b) => b.date.localeCompare(a.date));

  const allTodos = todosFile?.todos || [];
  const noteIds = new Set(noteRows.map((r) => r.id).filter(Boolean));
  const topicTodos = allTodos.filter(
    (t) => t.status !== 'done' && t.related_notes?.some((n) => noteIds.has(n)),
  );

  const links = linksFile || {};
  const relatedTopicNames = new Set<string>();
  for (const row of noteRows) {
    if (!row.id) continue;
    const entry = links[row.id];
    if (!entry) continue;
    for (const linked of [...(entry.forward || []), ...(entry.backward || [])]) {
      const targetRow = noteRows.find((r) => r.id === linked);
      if (!targetRow) {
        const allRows = await findNotesForProject('');
        const target = allRows.find((r) => r.id === linked);
        if (target && target.topic && target.topic !== topicName && topicNames.has(target.topic)) {
          relatedTopicNames.add(target.topic);
        }
      }
    }
  }
  const relatedTopics = allTopics.filter((t) => relatedTopicNames.has(t.name));

  return {
    meta,
    timeline,
    conclusions: conclusions.slice(0, 20),
    todos: topicTodos,
    relatedTopics,
  };
}
