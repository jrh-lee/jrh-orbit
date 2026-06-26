import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:orbit.db');
    await initSchema(db);
  }
  return db;
}

const FTS_SCHEMA_VERSION = 3;

async function initSchema(db: Database): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  const rows = await db.select<{ value: string }[]>(`SELECT value FROM meta WHERE key = 'fts_version'`);
  const current = rows.length > 0 ? parseInt(rows[0].value, 10) : 0;

  if (current < FTS_SCHEMA_VERSION) {
    await db.execute(`DROP TABLE IF EXISTS notes_fts`);
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('fts_version', $1)`, [
      String(FTS_SCHEMA_VERSION),
    ]);
  }

  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path, id, title, note_type, project, subsystem, topic, tags, status, content, created, updated
    )
  `);
}

export interface SearchResult {
  path: string;
  title: string;
  noteType: string;
  snippet: string;
  updated: string;
}

let writeQueue: Promise<void> = Promise.resolve();

export function indexNote(
  path: string,
  id: string,
  title: string,
  noteType: string,
  project: string | string[],
  subsystem: string[],
  topic: string,
  tags: string[],
  status: string,
  content: string,
  created: string,
  updated: string,
): Promise<void> {
  const job = writeQueue.then(async () => {
    const database = await getDb();
    const projectStr = Array.isArray(project) ? project.join(', ') : (project ?? '');
    const subsystemStr = subsystem.join(', ');
    const tagsStr = tags.join(', ');

    console.log(`[indexNote] path=${path}, id=${id}, project="${projectStr}", topic="${topic}"`);

    await database.execute(`DELETE FROM notes_fts WHERE path = $1`, [path]);
    await database.execute(
      `INSERT INTO notes_fts (path, id, title, note_type, project, subsystem, topic, tags, status, content, created, updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [path, id, title, noteType, projectStr, subsystemStr, topic, tagsStr, status, content, created, updated],
    );
  });
  writeQueue = job.catch(() => {});
  return job;
}

export async function searchNotes(query: string): Promise<SearchResult[]> {
  if (!query || !query.trim()) return [];

  const database = await getDb();

  const sanitized = query.trim().replace(/['"]/g, '');
  if (!sanitized) return [];

  const ftsQuery = sanitized
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `"${term}"*`)
    .join(' ');

  if (!ftsQuery) return [];

  try {
    const results = await database.select<SearchResult[]>(
      `SELECT
         path,
         title,
         note_type as noteType,
         snippet(notes_fts, 9, '<mark>', '</mark>', '...', 40) as snippet,
         updated
       FROM notes_fts
       WHERE notes_fts MATCH $1
       ORDER BY rank
       LIMIT 30`,
      [ftsQuery],
    );
    return results;
  } catch {
    return [];
  }
}

export async function removeNoteIndex(path: string): Promise<void> {
  const database = await getDb();
  await database.execute(`DELETE FROM notes_fts WHERE path = $1`, [path]);
}

export async function clearIndex(): Promise<void> {
  const database = await getDb();
  await database.execute(`DELETE FROM notes_fts`);
}

export interface HubNoteRow {
  path: string;
  id: string;
  title: string;
  note_type: string;
  project: string;
  topic: string;
  tags: string;
  content: string;
  created: string;
  updated: string;
}

export async function findNotesForProject(projectName: string): Promise<HubNoteRow[]> {
  const database = await getDb();
  try {
    const all = await database.select<HubNoteRow[]>(
      `SELECT path, id, title, note_type, project, topic, tags, content, created, updated FROM notes_fts`,
    );
    const rows = all.filter(r => r.project && r.project.includes(projectName));
    console.log(`[findNotesForProject] "${projectName}": ${all.length} total, ${rows.length} matched`);
    return rows.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  } catch (e) {
    console.error('[findNotesForProject] query failed:', e);
    return [];
  }
}

export async function findNotesForTopic(topicName: string): Promise<HubNoteRow[]> {
  const database = await getDb();
  try {
    const all = await database.select<HubNoteRow[]>(
      `SELECT path, id, title, note_type, project, topic, tags, content, created, updated FROM notes_fts`,
    );
    const rows = all.filter(r => r.topic === topicName);
    console.log(`[findNotesForTopic] "${topicName}": ${all.length} total, ${rows.length} matched`);
    return rows.sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  } catch (e) {
    console.error('[findNotesForTopic] query failed:', e);
    return [];
  }
}

export async function findNotesByTopic(topic: string, excludeId?: string): Promise<{ id: string; title: string }[]> {
  const database = await getDb();
  try {
    const rows = await database.select<{ id: string; title: string }[]>(
      `SELECT id, title FROM notes_fts WHERE topic = $1 AND id != $2 AND id != '' LIMIT 50`,
      [topic, excludeId ?? ''],
    );
    return rows;
  } catch {
    return [];
  }
}

export async function debugFts(): Promise<{ path: string; id: string; title: string; project: string; topic: string }[]> {
  const database = await getDb();
  return database.select(
    `SELECT path, id, title, project, topic FROM notes_fts ORDER BY created DESC LIMIT 100`,
  );
}
