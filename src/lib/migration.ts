import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { FOLDERS, SUBSYSTEM_DEFAULTS } from './constants';
import { splitFrontmatter, parseFrontmatterFields, buildFrontmatter } from './frontmatter';
import { normalizeProject, normalizeLegacyType } from '../types/note';
import type { NoteStatus } from '../types/note';

const SUBSYSTEM_TAGS = new Set([
  ...SUBSYSTEM_DEFAULTS.primary.map(s => s.toLowerCase()),
  ...SUBSYSTEM_DEFAULTS.secondary.map(s => s.toLowerCase()),
]);

const TAG_TO_SUBSYSTEM: Record<string, string> = {};
for (const s of [...SUBSYSTEM_DEFAULTS.primary, ...SUBSYSTEM_DEFAULTS.secondary]) {
  TAG_TO_SUBSYSTEM[s.toLowerCase()] = s;
}

interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  errors: string[];
}

function generateId(dateStr: string, noteType: string, seq: number): string {
  const abbrevMap: Record<string, string> = {
    'daily-log': 'daily',
    'quick-memo': 'memo',
    'analysis-note': 'analysis',
    'test-log': 'test',
    'design-note': 'design',
    'study-note': 'study',
    'review': 'review',
  };
  const abbrev = abbrevMap[noteType] || 'note';
  return `${dateStr}-${abbrev}-${String(seq).padStart(3, '0')}`;
}

function extractDateFromCreated(created: string): string {
  if (!created) return new Date().toISOString().slice(0, 10);
  return created.slice(0, 10);
}

function determineStatus(updated: string): NoteStatus {
  if (!updated) return 'complete';
  const diff = Date.now() - new Date(updated).getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return diff > thirtyDays ? 'archived' : 'complete';
}

function extractSubsystemsFromTags(tags: string[]): { subsystems: string[]; remainingTags: string[] } {
  const subsystems: string[] = [];
  const remainingTags: string[] = [];
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (SUBSYSTEM_TAGS.has(lower)) {
      subsystems.push(TAG_TO_SUBSYSTEM[lower]);
    } else {
      remainingTags.push(tag);
    }
  }
  return { subsystems, remainingTags };
}

async function backupFolder(dataDir: string, folder: string): Promise<void> {
  const src = await join(dataDir, folder);
  const backupName = `${folder.replace('/', '_')}_backup_${new Date().toISOString().slice(0, 10)}`;
  const dst = await join(dataDir, backupName);
  try {
    await invoke('copy_dir', { src, dst });
  } catch {
    // copy_dir may not exist — fall through, files are only overwritten in-place
  }
}

async function migrateFolder(
  dataDir: string,
  folder: string,
  defaultType: string,
  idCounters: Map<string, number>,
): Promise<MigrationResult> {
  const result: MigrationResult = { total: 0, migrated: 0, skipped: 0, errors: [] };

  let files: string[] = [];
  try {
    const dir = await join(dataDir, folder);
    files = await invoke<string[]>('list_notes', { dir });
  } catch {
    return result;
  }

  for (const filePath of files) {
    result.total++;
    try {
      const raw = await invoke<string>('read_note', { path: filePath });
      const { frontmatter, body } = splitFrontmatter(raw);
      const fields = parseFrontmatterFields(frontmatter);

      if (fields.id) {
        result.skipped++;
        continue;
      }

      const rawType = fields.type ?? defaultType;
      const noteType = String(normalizeLegacyType(rawType));
      const created = fields.created ?? '';
      const updated = fields.updated ?? '';
      const dateStr = fields.date ?? extractDateFromCreated(created);

      const counterKey = `${dateStr}-${noteType}`;
      const seq = (idCounters.get(counterKey) ?? 0) + 1;
      idCounters.set(counterKey, seq);

      const isDailyLog = noteType === 'daily-log';
      const id = isDailyLog ? `${dateStr}-daily` : generateId(dateStr, noteType, seq);

      const project = normalizeProject(fields.project);
      const rawTags: string[] = Array.isArray(fields.tags) ? fields.tags : [];
      const { subsystems, remainingTags } = extractSubsystemsFromTags(rawTags);
      const existingSubsystems = Array.isArray(fields.subsystem) ? fields.subsystem : [];
      const mergedSubsystems = [...new Set([...existingSubsystems, ...subsystems])];

      const related: string[] = Array.isArray(fields.related) ? fields.related : [];
      if (!isDailyLog && !related.includes(`${dateStr}-daily`)) {
        related.push(`${dateStr}-daily`);
      }

      const status = fields.status ?? determineStatus(updated);

      const newFields: Record<string, any> = {
        id,
        type: noteType,
        title: fields.title ?? '',
        date: dateStr,
        project,
        topic: fields.topic ?? fields.experiment ?? '',
        subsystem: mergedSubsystems,
        tags: remainingTags,
        related,
        status,
        created: created || new Date().toISOString(),
        updated: updated || new Date().toISOString(),
      };

      if (noteType === 'test-log') {
        newFields.verdict = fields.verdict ?? '';
      }
      if (isDailyLog) {
        newFields.workhour = fields.workhour ?? 0;
        newFields.workhour_detail = fields.workhour_detail ?? [];
        newFields.summary = fields.summary ?? '';
        newFields.carried_over = fields.carried_over ?? [];
      }

      const newFm = buildFrontmatter(newFields);
      await invoke('write_note', { path: filePath, content: newFm + body });
      result.migrated++;
    } catch (e) {
      result.errors.push(`${filePath}: ${String(e)}`);
    }
  }

  return result;
}

export async function migrateNotes(dataDir: string): Promise<MigrationResult> {
  await backupFolder(dataDir, FOLDERS.daily);
  await backupFolder(dataDir, FOLDERS.research);

  const idCounters = new Map<string, number>();

  const dailyResult = await migrateFolder(dataDir, FOLDERS.daily, 'daily-log', idCounters);
  const researchResult = await migrateFolder(dataDir, FOLDERS.research, 'analysis-note', idCounters);

  return {
    total: dailyResult.total + researchResult.total,
    migrated: dailyResult.migrated + researchResult.migrated,
    skipped: dailyResult.skipped + researchResult.skipped,
    errors: [...dailyResult.errors, ...researchResult.errors],
  };
}
