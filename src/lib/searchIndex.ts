import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { splitFrontmatter, parseFrontmatterFields } from './frontmatter';
import { FOLDERS } from './constants';
import { indexNote, clearIndex } from './db';
import { normalizeProject, normalizeLegacyType } from '../types/note';

export async function reindexNote(filePath: string, fallbackType: string): Promise<void> {
  const raw = await invoke<string>('read_note', { path: filePath });
  const { frontmatter, body } = splitFrontmatter(raw);
  const fields = parseFrontmatterFields(frontmatter);
  const id = fields.id ?? '';
  const title = fields.title ?? filePath.split(/[/\\]/).pop()?.replace('.md', '') ?? '';
  const noteType = fields.type ? String(normalizeLegacyType(fields.type)) : fallbackType;
  const project = normalizeProject(fields.project);
  const subsystem = Array.isArray(fields.subsystem) ? fields.subsystem : [];
  const topic = fields.topic ?? fields.experiment ?? '';
  const tags = Array.isArray(fields.tags) ? fields.tags : [];
  const status = fields.status ?? '';
  const created = fields.created ?? '';
  const updated = fields.updated ?? '';
  await indexNote(filePath, id, title, noteType, project, subsystem, topic, tags, status, body, created, updated);
}

export async function buildIndex(dataDir: string): Promise<void> {
  if (!dataDir) return;

  await clearIndex();

  const folders: { folder: string; fallbackType: string }[] = [
    { folder: FOLDERS.daily, fallbackType: 'daily-log' },
    { folder: FOLDERS.research, fallbackType: 'analysis-note' },
  ];

  for (const { folder, fallbackType } of folders) {
    let files: string[] = [];
    try {
      const dir = await join(dataDir, folder);
      files = await invoke<string[]>('list_notes', { dir });
    } catch {
      continue;
    }

    for (const filePath of files) {
      try {
        const raw = await invoke<string>('read_note', { path: filePath });
        const { frontmatter, body } = splitFrontmatter(raw);
        const fields = parseFrontmatterFields(frontmatter);

        const id = fields.id ?? '';
        const title = fields.title ?? filePath.split('/').pop()?.replace('.md', '') ?? '';
        const noteType = fields.type ? String(normalizeLegacyType(fields.type)) : fallbackType;
        const project = normalizeProject(fields.project);
        const subsystem = Array.isArray(fields.subsystem) ? fields.subsystem : [];
        const topic = fields.topic ?? fields.experiment ?? '';
        const tags = Array.isArray(fields.tags) ? fields.tags : [];
        const status = fields.status ?? '';
        const created = fields.created ?? '';
        const updated = fields.updated ?? '';

        await indexNote(filePath, id, title, noteType, project, subsystem, topic, tags, status, body, created, updated);
      } catch {
        continue;
      }
    }
  }
}
