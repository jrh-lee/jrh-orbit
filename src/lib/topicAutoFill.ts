import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { splitFrontmatter, parseFrontmatterFields } from './frontmatter';
import { FOLDERS } from './constants';

function extractSection(body: string, heading: string): string | null {
  const regex = new RegExp(`${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

async function findPreviousNote(
  dataDir: string,
  topic: string,
  noteType: string,
  excludeId: string,
): Promise<string | null> {
  try {
    const dir = await join(dataDir, FOLDERS.research);
    const files = await invoke<string[]>('list_notes', { dir });

    let bestMatch: { raw: string; updated: string } | null = null;

    for (const f of files) {
      try {
        const raw = await invoke<string>('read_note', { path: f });
        const { frontmatter } = splitFrontmatter(raw);
        const fields = parseFrontmatterFields(frontmatter);
        if (
          (fields.topic ?? fields.experiment) === topic &&
          fields.type === noteType &&
          fields.id !== excludeId
        ) {
          const updated = fields.updated ?? fields.created ?? '';
          if (!bestMatch || updated > bestMatch.updated) {
            bestMatch = { raw, updated };
          }
        }
      } catch {}
    }

    return bestMatch?.raw ?? null;
  } catch {
    return null;
  }
}

export async function getBaseConditions(
  dataDir: string,
  topic: string,
  noteId: string,
): Promise<string | null> {
  const raw = await findPreviousNote(dataDir, topic, 'analysis-note', noteId);
  if (!raw) return null;
  const { body } = splitFrontmatter(raw);
  return extractSection(body, '### 공통 조건 \\(Base\\)');
}

export async function getPreviousTestData(
  dataDir: string,
  topic: string,
  noteId: string,
): Promise<{ measurements: string | null; noteTitle: string } | null> {
  const raw = await findPreviousNote(dataDir, topic, 'test-log', noteId);
  if (!raw) return null;
  const { frontmatter, body } = splitFrontmatter(raw);
  const fields = parseFrontmatterFields(frontmatter);
  const measurements = extractSection(body, '## 측정 데이터');
  return { measurements, noteTitle: fields.title ?? fields.id ?? '' };
}

const CODE_FILE_PATTERN = /(?:^|\s|["'`(])([^\s"'`()]+\.(?:m|py|slx|vi|c|h|cpp|f90|mat|csv|xlsx))\b/g;

export function detectCodeReferences(body: string): string[] {
  const refs = new Set<string>();
  let match;
  while ((match = CODE_FILE_PATTERN.exec(body)) !== null) {
    refs.add(match[1]);
  }
  CODE_FILE_PATTERN.lastIndex = 0;
  const codeSection = extractSection(body, '## 코드 / 파일 참조');
  if (codeSection) {
    for (const ref of [...refs]) {
      if (codeSection.includes(ref)) refs.delete(ref);
    }
  }
  return [...refs];
}
