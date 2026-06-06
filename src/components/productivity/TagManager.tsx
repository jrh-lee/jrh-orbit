import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { splitFrontmatter, parseFrontmatterFields } from '../../lib/frontmatter';
import { readJsonFile } from '../../lib/fileSystem';
import { FOLDERS, FILES } from '../../lib/constants';
import type { TodosFile } from '../../types/task';

interface TagInfo {
  name: string;
  count: number;
  noteCount: number;
  taskCount: number;
}

export function TagManager() {
  const { dataDir, filterByTag, filterByTaskTag } = useAppStore();
  const { setFilterTag } = useTaskStore();
  const [tags, setTags] = useState<TagInfo[]>([]);

  const scanTags = useCallback(async () => {
    if (!dataDir) return;
    try {
      const noteTagMap = new Map<string, number>();
      const taskTagMap = new Map<string, number>();

      const dir = await join(dataDir, FOLDERS.research);
      const files = await invoke<string[]>('list_notes', { dir });
      await Promise.all(
        files.map(async (f) => {
          try {
            const raw = await invoke<string>('read_note', { path: f });
            const { frontmatter } = splitFrontmatter(raw);
            const fields = parseFrontmatterFields(frontmatter);
            if (Array.isArray(fields.tags)) {
              for (const t of fields.tags) {
                if (t) noteTagMap.set(t, (noteTagMap.get(t) ?? 0) + 1);
              }
            }
          } catch {}
        }),
      );

      const todosData = await readJsonFile<TodosFile>(dataDir, FILES.todos);
      if (todosData?.todos) {
        for (const task of todosData.todos) {
          if (Array.isArray(task.tags)) {
            for (const t of task.tags) {
              if (t) taskTagMap.set(t, (taskTagMap.get(t) ?? 0) + 1);
            }
          }
          if (Array.isArray(task.subtasks)) {
            for (const st of task.subtasks) {
              if (Array.isArray(st.tags)) {
                for (const t of st.tags) {
                  if (t) taskTagMap.set(t, (taskTagMap.get(t) ?? 0) + 1);
                }
              }
            }
          }
        }
      }

      const allKeys = new Set([...noteTagMap.keys(), ...taskTagMap.keys()]);
      const sorted = [...allKeys]
        .map((name) => {
          const noteCount = noteTagMap.get(name) ?? 0;
          const taskCount = taskTagMap.get(name) ?? 0;
          return { name, count: noteCount + taskCount, noteCount, taskCount };
        })
        .sort((a, b) => b.count - a.count);
      setTags(sorted);
    } catch {
      setTags([]);
    }
  }, [dataDir]);

  useEffect(() => {
    scanTags();
    const handler = () => scanTags();
    window.addEventListener('tags-changed', handler);
    return () => window.removeEventListener('tags-changed', handler);
  }, [scanTags]);

  const handleTagClick = (t: TagInfo) => {
    if (t.taskCount > 0) {
      setFilterTag(t.name);
    }
    if (t.noteCount > 0) {
      filterByTag(t.name);
    } else {
      filterByTaskTag(t.name);
    }
  };

  return (
    <div className="px-2">
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => {
          const taskOnly = t.noteCount === 0 && t.taskCount > 0;
          return (
            <button
              key={t.name}
              onClick={() => handleTagClick(t)}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full text-tag-text hover:opacity-70 transition-opacity cursor-pointer ${
                taskOnly ? 'bg-chrome/15' : 'bg-pastel-lavender/30'
              }`}
              title={taskOnly
                ? `Filter tasks by "${t.name}" (tasks only)`
                : `Filter notes by "${t.name}"${t.taskCount > 0 ? ` (+${t.taskCount} tasks)` : ''}`}
            >
              {t.name}
              <span className="text-ink-3 ml-0.5">{t.count}</span>
            </button>
          );
        })}
        {tags.length === 0 && (
          <span className="text-[10px] text-ink-3">No tags</span>
        )}
      </div>
    </div>
  );
}
