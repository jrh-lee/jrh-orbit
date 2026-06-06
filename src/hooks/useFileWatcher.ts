import { useEffect, useRef } from 'react';
import { watch } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../stores/useAppStore';
import { FOLDERS, FILES } from '../lib/constants';
import { indexNote, removeNoteIndex } from '../lib/db';
import { splitFrontmatter, parseFrontmatterFields } from '../lib/frontmatter';
import { normalizeProject, normalizeLegacyType } from '../types/note';
import { invalidateLinksCache } from '../lib/linkGraph';
import { invalidateNotesCache } from '../lib/statistics';
import type { UnwatchFn } from '@tauri-apps/plugin-fs';

type SyncEvent =
  | 'tasks-changed'
  | 'projects-changed'
  | 'ddays-changed'
  | 'playlist-changed'
  | 'config-changed'
  | 'notes-changed'
  | 'tags-changed'
  | 'links-changed'
  | 'subsystems-changed'
  | 'topics-changed'
  | 'workhours-changed';

const JSON_FILE_EVENTS: Record<string, SyncEvent> = {
  'todos.json': 'tasks-changed',
  'projects.json': 'projects-changed',
  'ddays.json': 'ddays-changed',
  'playlist.json': 'playlist-changed',
  'links.json': 'links-changed',
  'subsystems.json': 'subsystems-changed',
  'topics.json': 'topics-changed',
};

async function reindexNote(filePath: string, fallbackType: string) {
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
    await removeNoteIndex(filePath).catch(() => {});
  }
}

function classifyPath(dataDir: string, fullPath: string): { event: SyncEvent; notePath?: string } | null {
  const rel = fullPath.startsWith(dataDir) ? fullPath.slice(dataDir.length + 1) : null;
  if (!rel) return null;

  if (rel === FILES.config) return { event: 'config-changed' };

  if (rel.startsWith(FOLDERS.data + '/')) {
    if (rel.startsWith(FOLDERS.workhours + '/') && rel.endsWith('.json')) {
      return { event: 'workhours-changed' };
    }
    const filename = rel.split('/').pop() ?? '';
    const ev = JSON_FILE_EVENTS[filename];
    if (ev) return { event: ev };
  }

  if (rel.endsWith('.md') && rel.startsWith(FOLDERS.notes + '/')) {
    return { event: 'notes-changed', notePath: fullPath };
  }

  return null;
}

export function useFileWatcher() {
  const { dataDir } = useAppStore();
  const writeLockUntil = useRef(0);

  useEffect(() => {
    if (!dataDir) return;

    let stopWatching: UnwatchFn | null = null;
    let cancelled = false;

    async function startWatching() {
      try {
        const notesDir = await join(dataDir, FOLDERS.notes);
        const dataJsonDir = await join(dataDir, FOLDERS.data);
        const configPath = await join(dataDir, FILES.config);

        if (cancelled) return;

        stopWatching = await watch(
          [notesDir, dataJsonDir, configPath],
          (event) => {
            if (Date.now() < writeLockUntil.current) return;

            const dispatched = new Set<SyncEvent>();

            for (const p of event.paths) {
              if (!p) continue;

              const classified = classifyPath(dataDir, p);
              if (!classified) continue;

              if (classified.notePath) {
                const fallback = classified.notePath.includes('/daily/') ? 'daily-log' : 'analysis-note';
                reindexNote(classified.notePath, fallback);
              }

              if (!dispatched.has(classified.event)) {
                dispatched.add(classified.event);
                window.dispatchEvent(new CustomEvent(classified.event));
              }
            }

            if (dispatched.has('notes-changed')) {
              invalidateNotesCache();
              window.dispatchEvent(new CustomEvent('tags-changed'));
            }
            if (dispatched.has('links-changed')) {
              invalidateLinksCache();
            }
          },
          { recursive: true, delayMs: 800 },
        );
      } catch {}
    }

    startWatching();

    return () => {
      cancelled = true;
      if (stopWatching) stopWatching();
    };
  }, [dataDir]);

  return writeLockUntil;
}
