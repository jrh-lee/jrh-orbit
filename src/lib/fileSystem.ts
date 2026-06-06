import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { FOLDERS, FILES } from './constants';
import {
  DEFAULT_TAGS_FILE,
  DEFAULT_LINKS_FILE,
  DEFAULT_SUBSYSTEMS_FILE,
  DEFAULT_TOPICS_FILE,
} from '../types/dataFiles';

export async function ensureDataDir(dataDir: string): Promise<void> {
  for (const folder of Object.values(FOLDERS)) {
    const path = await join(dataDir, folder);
    await invoke('ensure_dir', { path });
  }
}

export async function initDataFiles(dataDir: string): Promise<void> {
  const defaults: [string, unknown][] = [
    [FILES.tags, DEFAULT_TAGS_FILE],
    [FILES.topics, DEFAULT_TOPICS_FILE],
    [FILES.links, DEFAULT_LINKS_FILE],
    [FILES.subsystems, DEFAULT_SUBSYSTEMS_FILE],
  ];

  for (const [relPath, defaultData] of defaults) {
    const existing = await readJsonFile(dataDir, relPath);
    if (existing === null) {
      await writeJsonFile(dataDir, relPath, defaultData);
    }
  }
}

export async function readNote(dataDir: string, relativePath: string): Promise<string> {
  const path = await join(dataDir, relativePath);
  return invoke<string>('read_note', { path });
}

export async function writeNote(dataDir: string, relativePath: string, content: string): Promise<void> {
  const path = await join(dataDir, relativePath);
  await invoke('write_note', { path, content });
}

export async function listNotes(dataDir: string, folder: string): Promise<string[]> {
  const dir = await join(dataDir, folder);
  return invoke<string[]>('list_notes', { dir });
}

export async function readJsonFile<T>(dataDir: string, relativePath: string): Promise<T | null> {
  try {
    const path = await join(dataDir, relativePath);
    const content = await invoke<string>('read_note', { path });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile<T>(dataDir: string, relativePath: string, data: T): Promise<void> {
  const path = await join(dataDir, relativePath);
  const content = JSON.stringify(data, null, 2);
  await invoke('write_note', { path, content });
}

export async function readConfig(dataDir: string) {
  return readJsonFile(dataDir, FILES.config);
}
