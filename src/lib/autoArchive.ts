import { format } from 'date-fns';
import { listNotes, readNote, writeNote, readConfig } from './fileSystem';
import { parseFrontmatterFields, splitFrontmatter, updateFrontmatterField } from './frontmatter';
import { FOLDERS } from './constants';
import { DEFAULT_AUTO_ARCHIVE } from '../types/config';

export async function autoArchiveQuickMemos(dataDir: string): Promise<number> {
  const config = (await readConfig(dataDir)) as Record<string, unknown> | null;
  const archiveCfg = (config?.auto_archive as { quick_memo_days?: number } | undefined);
  const archiveDays = archiveCfg?.quick_memo_days ?? DEFAULT_AUTO_ARCHIVE.quick_memo_days;

  const today = format(new Date(), 'yyyy-MM-dd');
  let archived = 0;

  try {
    const files = await listNotes(dataDir, FOLDERS.research);
    for (const filePath of files) {
      if (!filePath.endsWith('.md')) continue;
      try {
        const raw = await readNote(dataDir, filePath);
        const fields = parseFrontmatterFields(raw);
        if (fields.type !== 'quick-memo') continue;
        if (fields.status !== 'complete') continue;

        const updated = (fields.updated ?? fields.created ?? '').slice(0, 10);
        if (!updated) continue;

        const daysSince = Math.floor(
          (new Date(today).getTime() - new Date(updated).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSince < archiveDays) continue;

        const { frontmatter, body } = splitFrontmatter(raw);
        const newFm = updateFrontmatterField(frontmatter, 'status', '"archived"');
        await writeNote(dataDir, filePath, newFm + body);
        archived++;
      } catch {}
    }
  } catch {}

  return archived;
}
