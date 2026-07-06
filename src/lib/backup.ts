import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { format } from 'date-fns';

/**
 * Daily snapshot backup — protects against logical corruption (the app
 * itself overwriting files, cf. the 2026-07-06 daily-note wipe incident).
 *
 * Snapshots go to `<dataDir>/backups/<stamp>/` on Google Drive (user choice:
 * cloud only, no local copy). Runs at most once per calendar day; keeps the
 * most recent KEEP snapshots. Restore = copy a snapshot's notes/ and data/
 * back over the originals with the app closed.
 */
const KEEP = 30;
const LS_KEY = 'orbit-last-backup-date';

export async function runDailyBackup(dataDir: string): Promise<void> {
  if (!dataDir) return;
  const today = format(new Date(), 'yyyy-MM-dd');
  if (localStorage.getItem(LS_KEY) === today) return;

  const stamp = format(new Date(), 'yyyy-MM-dd_HHmmss');
  const backupRoot = await join(dataDir, 'backups');
  try {
    const count = await invoke<number>('snapshot_data', {
      dataDir,
      backupRoot,
      stamp,
      keep: KEEP,
    });
    localStorage.setItem(LS_KEY, today);
    if (import.meta.env.DEV) console.warn('[backup] snapshot done:', stamp, '| files:', count);
  } catch (e) {
    console.warn('[backup] snapshot failed:', e);
  }
}
