import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { FOLDERS } from './constants';
import { buildFrontmatter } from './frontmatter';
import type { NoteType } from '../types/note';

/**
 * Strip Notion hash suffix from filename.
 * e.g. "My Cool Note abc123def456.md" -> "My Cool Note"
 */
function stripNotionHash(filename: string): string {
  const base = filename.replace(/\.md$/, '');
  // Notion appends a space + 32-char hex hash
  const match = base.match(/^(.+?)\s+[a-f0-9]{32}$/);
  if (match) return match[1].trim();
  // Also try shorter hashes (some Notion exports use 20 char)
  const shortMatch = base.match(/^(.+?)\s+[a-f0-9]{16,}$/);
  if (shortMatch) return shortMatch[1].trim();
  return base;
}

/**
 * Detect note type from content patterns.
 */
function detectNoteType(content: string): NoteType {
  const lower = content.toLowerCase();

  if (/test\s*(log|result|report)|시험\s*(결과|보고|로그)|pass\s*\/\s*fail|verdict/i.test(lower)) {
    return 'test-log';
  }
  if (/analysis|분석|simulation|시뮬레이션|결과\s*요약/i.test(lower)) {
    return 'analysis-note';
  }
  if (/design\s*(note|decision)|설계|의사결정|trade[\s-]*off/i.test(lower)) {
    return 'design-note';
  }
  if (/study|논문|paper|reference|학습|출처/i.test(lower)) {
    return 'study-note';
  }

  // Default to quick-memo for short content, analysis-note for longer
  if (content.length < 300) return 'quick-memo';
  return 'analysis-note';
}

/**
 * Convert Notion-style internal links to [[note-id]] wiki-links.
 * Notion exports links like: [Link Text](Some%20Page%20abc123def456)
 * or [Link Text](Some%20Page%20abc123def456.md)
 */
function convertNotionLinks(content: string): string {
  // Match markdown links that look like Notion internal links
  return content.replace(
    /\[([^\]]+)\]\(([^)]+?(?:\s+[a-f0-9]{16,})?(?:\.md)?)\)/g,
    (_match, text, href) => {
      // Skip external URLs
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        return _match;
      }
      // Decode URL encoding
      const decoded = decodeURIComponent(href).replace(/\.md$/, '');
      // Strip Notion hash
      const cleanName = stripNotionHash(decoded + '.md');
      // Convert to wiki-link using the display text
      return `[[${cleanName || text}]]`;
    },
  );
}

/**
 * Generate a note ID from a title and date.
 */
function generateImportId(title: string, index: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `${today}-import-${slug || String(index).padStart(3, '0')}`;
}

/**
 * Extract tags from Notion content.
 * Looks for Notion "Tags:" or "태그:" property lines, and hashtags.
 */
function extractTags(content: string): string[] {
  const tags = new Set<string>();

  // Look for "Tags: ..." or "태그: ..." lines
  const tagLineMatch = content.match(/^(?:Tags|태그)\s*:\s*(.+)$/im);
  if (tagLineMatch) {
    tagLineMatch[1].split(',').forEach(t => {
      const cleaned = t.trim().toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9가-힣-]/g, '');
      if (cleaned) tags.add(cleaned);
    });
  }

  // Extract hashtags like #tag-name
  const hashTags = content.match(/#([a-zA-Z가-힣][a-zA-Z0-9가-힣_-]*)/g);
  if (hashTags) {
    hashTags.forEach(ht => {
      const cleaned = ht.slice(1).toLowerCase().replace(/[_\s]+/g, '-');
      if (cleaned.length > 1) tags.add(cleaned);
    });
  }

  return [...tags];
}

/**
 * Extract project name from Notion content if present.
 */
function extractProject(content: string): string[] {
  const projectMatch = content.match(/^(?:Project|프로젝트)\s*:\s*(.+)$/im);
  if (projectMatch) {
    return projectMatch[1].split(',').map(p => p.trim()).filter(Boolean);
  }
  return [];
}

export interface ImportResult {
  imported: number;
  errors: string[];
}

/**
 * Import a Notion export folder into JRH-Orbit research notes.
 *
 * @param dataDir - The app's data directory
 * @param files - Array of full file paths to .md files in the Notion export
 * @returns Count of imported files and any errors encountered
 */
export async function importNotionExport(
  dataDir: string,
  files: string[],
): Promise<ImportResult> {
  let imported = 0;
  const errors: string[] = [];

  // Ensure research folder exists
  const researchDir = await join(dataDir, FOLDERS.research);
  await invoke('ensure_dir', { path: researchDir });

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const filename = filePath.split('/').pop() ?? filePath;

    if (!filename.endsWith('.md')) continue;

    try {
      // Read the file content
      const raw = await invoke<string>('read_note', { path: filePath });

      // Strip Notion hash from filename to get title
      const title = stripNotionHash(filename);

      // Detect note type from content
      const noteType = detectNoteType(raw);

      // Convert Notion links to wiki-links
      let body = convertNotionLinks(raw);

      // Extract metadata from content
      const tags = extractTags(raw);
      const project = extractProject(raw);

      // Remove Notion property lines from body (they become frontmatter)
      body = body.replace(/^(?:Tags|태그|Project|프로젝트)\s*:\s*.+$/gim, '').trim();

      // Generate note ID
      const noteId = generateImportId(title, i);
      const now = new Date().toISOString();
      const today = now.slice(0, 10);

      // Build frontmatter
      const fm = buildFrontmatter({
        id: noteId,
        type: noteType,
        title,
        date: today,
        project,
        topic: '',
        subsystem: [],
        tags,
        related: [],
        status: 'complete',
        created: now,
        updated: now,
      });

      // Write the note
      const notePath = await join(researchDir, `${noteId}.md`);
      await invoke('write_note', { path: notePath, content: fm + '\n' + body });

      imported++;
    } catch (e) {
      errors.push(`${filename}: ${String(e)}`);
    }
  }

  return { imported, errors };
}
