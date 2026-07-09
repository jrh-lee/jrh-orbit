import { format, subDays } from 'date-fns';
import { readJsonFile, writeJsonFile } from './fileSystem';

/**
 * 날짜별 "수정한 노트" 기록. frontmatter의 updated는 마지막 수정일 하나만
 * 남아서(어제 수정 후 오늘 또 수정하면 어제 기록이 사라짐) 일자별 수정
 * 통계를 낼 수 없다 — 저장 시점에 (날짜 → 노트 id) 로그를 남긴다.
 */

const ACTIVITY_FILE = 'data/note-activity.json';
const KEEP_DAYS = 120;

type ActivityFile = Record<string, string[]>;

let cache: { dataDir: string; data: ActivityFile } | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

export async function recordNoteEdit(dataDir: string, noteId: string): Promise<void> {
  if (!dataDir || !noteId) return;
  try {
    const day = format(new Date(), 'yyyy-MM-dd');
    if (!cache || cache.dataDir !== dataDir) {
      cache = { dataDir, data: (await readJsonFile<ActivityFile>(dataDir, ACTIVITY_FILE)) ?? {} };
    }
    const ids = cache.data[day] ?? (cache.data[day] = []);
    if (ids.includes(noteId)) return; // 오늘 이미 기록됨 — 추가 쓰기 없음

    ids.push(noteId);
    const cutoff = format(subDays(new Date(), KEEP_DAYS), 'yyyy-MM-dd');
    for (const k of Object.keys(cache.data)) {
      if (k < cutoff) delete cache.data[k];
    }
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeJsonFile(dataDir, ACTIVITY_FILE, cache!.data).catch(() => {});
    }, 1500);
  } catch { /* 통계 부가 기능 — 실패해도 저장 흐름에 영향 없음 */ }
}

export async function getNoteActivity(dataDir: string): Promise<ActivityFile> {
  return (await readJsonFile<ActivityFile>(dataDir, ACTIVITY_FILE)) ?? {};
}
