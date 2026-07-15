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

/** 파일이 정말 없을 때만 기본값을 쓴다 — 기존 데이터 폴더를 다시 선택해도
 *  절대 덮어쓰지 않는다 (2026-07-15 위저드 데이터 소실 사고).
 *  읽기 실패 ≠ 파일 부재 (Drive 미수화)이므로 path_exists까지 이중 확인. */
export async function writeJsonIfMissing(dataDir: string, relativePath: string, data: unknown): Promise<void> {
  const existing = await readJsonFile(dataDir, relativePath);
  if (existing !== null) return; // 읽히는 파일이 있음 — 건드리지 않음
  try {
    const path = await join(dataDir, relativePath);
    const exists = await invoke<boolean>('path_exists', { path });
    if (exists) return; // 존재하는데 안 읽힘(미수화 등) — 절대 덮어쓰지 않음
  } catch { /* path_exists 커맨드 불가 — 신규 폴더로 간주하고 진행 */ }
  await writeJsonFile(dataDir, relativePath, data);
}

export async function initDataFiles(dataDir: string): Promise<void> {
  const defaults: [string, unknown][] = [
    [FILES.tags, DEFAULT_TAGS_FILE],
    [FILES.topics, DEFAULT_TOPICS_FILE],
    [FILES.links, DEFAULT_LINKS_FILE],
    [FILES.subsystems, DEFAULT_SUBSYSTEMS_FILE],
  ];

  for (const [relPath, defaultData] of defaults) {
    await writeJsonIfMissing(dataDir, relPath, defaultData);
  }
}

export async function readNote(dataDir: string, relativePath: string): Promise<string> {
  // list_notes(Rust)는 절대 경로를 반환한다 — 절대 경로를 다시 join하면
  // 잘못된 경로가 되어 모든 읽기가 조용히 실패한다 (통계의 노트 수가 항상
  // 0이던 원인). 절대 경로는 그대로 사용.
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith('\\\\') || relativePath.startsWith('/');
  const path = isAbsolute ? relativePath : await join(dataDir, relativePath);
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
