import { format } from 'date-fns';
import { readJsonFile } from './fileSystem';
import { FILES } from './constants';
import type { ParsedNoteMeta } from './statistics';
import type { LinksFile } from '../types/dataFiles';
import type { TodosFile } from '../types/task';

export type HealthIssueType =
  | 'orphan'
  | 'stale-in-progress'
  | 'missing-verdict'
  | 'empty-conclusion'
  | 'overdue-todo'
  | 'high-carry-over'
  | 'tag-duplicate'
  | 'empty-applicability';

export interface HealthIssue {
  type: HealthIssueType;
  label: string;
  description: string;
  noteId?: string;
  notePath?: string;
  noteTitle?: string;
  todoId?: string;
  todoTitle?: string;
  /** tag-duplicate 전용 — UI에서 태그별 필터 칩을 만들 수 있도록 */
  tagA?: string;
  tagB?: string;
}

const LABELS: Record<HealthIssueType, string> = {
  'orphan': 'Orphan Note',
  'stale-in-progress': 'Stale In-Progress',
  'missing-verdict': 'Missing Verdict',
  'empty-conclusion': 'Empty Conclusion',
  'overdue-todo': 'Overdue TODO',
  'high-carry-over': 'High Carry-over',
  'tag-duplicate': 'Tag Duplicate',
  'empty-applicability': 'Empty Applicability',
};

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[la][lb];
}

export async function runHealthCheck(
  dataDir: string,
  notesMeta: ParsedNoteMeta[],
): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];
  const today = format(new Date(), 'yyyy-MM-dd');

  const [linksFile, todosFile] = await Promise.all([
    readJsonFile<LinksFile>(dataDir, FILES.links),
    readJsonFile<TodosFile>(dataDir, FILES.todos),
  ]);

  const links = linksFile ?? {};

  for (const note of notesMeta) {
    if (note.type === 'daily-log') continue;
    if (note.status === 'archived') continue;

    const id = note.id;
    const entry = id ? links[id] : null;
    const forwardCount = entry?.forward?.length ?? 0;
    const backwardCount = entry?.backward?.length ?? 0;
    const relatedCount = note.related?.length ?? 0;

    if (forwardCount + backwardCount === 0 && relatedCount <= 1) {
      const onlyDaily = note.related?.every(r => r.includes('daily')) ?? true;
      if (onlyDaily) {
        issues.push({
          type: 'orphan',
          label: LABELS['orphan'],
          description: `No links to other notes`,
          noteId: id,
          notePath: note.path,
          noteTitle: note.title,
        });
      }
    }

    if (note.status === 'in-progress' && note.updated) {
      const updatedDate = note.updated.slice(0, 10);
      const daysSince = Math.floor((new Date(today).getTime() - new Date(updatedDate).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince >= 7) {
        issues.push({
          type: 'stale-in-progress',
          label: LABELS['stale-in-progress'],
          description: `Last updated ${daysSince} days ago`,
          noteId: id,
          notePath: note.path,
          noteTitle: note.title,
        });
      }
    }

    if (note.type === 'test-log' && note.status === 'complete' && !note.verdict) {
      issues.push({
        type: 'missing-verdict',
        label: LABELS['missing-verdict'],
        description: `Test log completed but no verdict set`,
        noteId: id,
        notePath: note.path,
        noteTitle: note.title,
      });
    }

    if (note.type === 'analysis-note' && note.status === 'complete') {
      const hasConclusion = note.content.includes('## 결론') || note.content.includes('## Conclusion');
      const conclusionMatch = note.content.match(/## 결론\s*\n([\s\S]*?)(?=\n## |$)/);
      const conclusionEmpty = !conclusionMatch || conclusionMatch[1].trim().length < 10;
      if (!hasConclusion || conclusionEmpty) {
        issues.push({
          type: 'empty-conclusion',
          label: LABELS['empty-conclusion'],
          description: `Analysis note completed but conclusion is empty`,
          noteId: id,
          notePath: note.path,
          noteTitle: note.title,
        });
      }
    }

    if (note.type === 'study-note' && note.status !== 'archived') {
      const applicabilityHeading = '## 내 프로젝트 적용 가능성';
      if (note.content.includes(applicabilityHeading)) {
        const sectionMatch = note.content.match(/## 내 프로젝트 적용 가능성\s*\n([\s\S]*?)(?=\n## |$)/);
        const sectionContent = sectionMatch ? sectionMatch[1].replace(/\s/g, '') : '';
        if (sectionContent.length < 10) {
          issues.push({
            type: 'empty-applicability',
            label: LABELS['empty-applicability'],
            description: `Study note has empty applicability section`,
            noteId: id,
            notePath: note.path,
            noteTitle: note.title,
          });
        }
      }
    }
  }

  // Tag duplicate check — 오타로 갈라진 태그 후보.
  // 짧은 태그는 거리 2가 너무 관대해서 aocs↔docs, adcs↔ac 같은 정상
  // 태그들이 전부 걸린다. 5자 미만은 거리 1(한 글자 오타)만, 그 이상은 2.
  const uniqueTags = new Set<string>();
  for (const note of notesMeta) {
    for (const tag of note.tags) {
      uniqueTags.add(tag);
    }
  }
  const tagList = [...uniqueTags];
  for (let i = 0; i < tagList.length; i++) {
    for (let j = i + 1; j < tagList.length; j++) {
      const tagA = tagList[i];
      const tagB = tagList[j];
      if (tagA === tagB) continue;
      const maxDist = Math.min(tagA.length, tagB.length) >= 5 ? 2 : 1;
      if (levenshtein(tagA.toLowerCase(), tagB.toLowerCase()) <= maxDist) {
        issues.push({
          type: 'tag-duplicate',
          label: LABELS['tag-duplicate'],
          description: `"${tagA}" similar to "${tagB}"`,
          tagA,
          tagB,
        });
      }
    }
  }

  const todos = todosFile?.todos ?? [];
  for (const todo of todos) {
    if (todo.status === 'done') continue;

    if (todo.dueDate && todo.dueDate < today) {
      issues.push({
        type: 'overdue-todo',
        label: LABELS['overdue-todo'],
        description: `Due ${todo.dueDate}`,
        todoId: todo.id,
        todoTitle: todo.title,
      });
    }

    if ((todo.carry_count ?? 0) >= 3) {
      issues.push({
        type: 'high-carry-over',
        label: LABELS['high-carry-over'],
        description: `Carried over ${todo.carry_count} times`,
        todoId: todo.id,
        todoTitle: todo.title,
      });
    }
  }

  return issues;
}
