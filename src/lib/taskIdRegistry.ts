import { readJsonFile } from './fileSystem';
import { FILES } from './constants';
import type { TodosFile } from '../types/task';

/** 에디터의 Task ID 숨김 판정용 레지스트리.
 *  패턴 추측([a-z0-9]{8} 등)은 [dfdf], [O1C] 같은 사용자 텍스트와 계속
 *  충돌하므로, todos.json에 실제로 존재하는 id만 숨긴다. */
let known = new Set<string>();

export function isKnownTaskId(id: string): boolean {
  return known.has(id);
}

export async function loadKnownTaskIds(dataDir: string): Promise<void> {
  try {
    const data = await readJsonFile<TodosFile>(dataDir, FILES.todos);
    const next = new Set<string>();
    for (const t of data?.todos ?? []) {
      if (t.id) next.add(t.id);
      for (const st of t.subtasks ?? []) {
        if (st.id) next.add(st.id);
      }
    }
    known = next;
    // 열려 있는 에디터의 데코레이션 갱신 트리거
    window.dispatchEvent(new CustomEvent('task-ids-refreshed'));
  } catch { /* keep previous set */ }
}
