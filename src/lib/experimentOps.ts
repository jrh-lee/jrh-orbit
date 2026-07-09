import { invoke } from '@tauri-apps/api/core';
import { findNotesForExperiment } from './db';
import { splitFrontmatter, joinFrontmatter, updateFrontmatterField, formatFrontmatterValue } from './frontmatter';
import { reindexNote } from './searchIndex';
import { useExperimentStore } from '../stores/useExperimentStore';
import type { Experiment, ExperimentStatus } from '../types/experiment';

/** frontmatter의 experiment 필드를 일괄 교체하고 재색인 */
async function retagNotes(experimentName: string, projectName: string, newValue: string): Promise<number> {
  const rows = await findNotesForExperiment(experimentName, projectName);
  let updated = 0;
  for (const row of rows) {
    try {
      const raw = await invoke<string>('read_note', { path: row.path });
      const { frontmatter, body } = splitFrontmatter(raw);
      const fm = updateFrontmatterField(frontmatter, 'experiment', formatFrontmatterValue(newValue));
      await invoke('write_note', { path: row.path, content: joinFrontmatter(fm, body) });
      await reindexNote(row.path, row.note_type);
      updated++;
    } catch { /* skip unreadable note */ }
  }
  if (updated > 0) window.dispatchEvent(new CustomEvent('notes-changed'));
  return updated;
}

/** 이름 변경: experiments.json + 해당 experiment를 단 노트 전부 갱신.
 *  갱신된 노트 수를 반환. */
export async function renameExperiment(
  dataDir: string,
  exp: Experiment,
  newName: string,
  projectName: string,
): Promise<number> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === exp.name) return 0;
  await useExperimentStore.getState().update(dataDir, exp.id, { name: trimmed });
  return retagNotes(exp.name, projectName, trimmed);
}

export async function setExperimentStatus(
  dataDir: string,
  exp: Experiment,
  status: ExperimentStatus,
): Promise<void> {
  await useExperimentStore.getState().update(dataDir, exp.id, { status });
}

/** 삭제: experiments.json에서 제거하고, 노트들의 experiment 필드는 해제(빈 값).
 *  노트 자체는 삭제하지 않는다. */
export async function deleteExperiment(
  dataDir: string,
  exp: Experiment,
  projectName: string,
): Promise<number> {
  await useExperimentStore.getState().remove(dataDir, exp.id);
  return retagNotes(exp.name, projectName, '');
}
