import { useCallback, useMemo } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useHubStore } from '../../stores/useHubStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { writeJsonFile, readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { TodosFile } from '../../types/task';
import { TopicTimeline } from './TopicTimeline';
import { ConclusionList } from './ConclusionList';
import { TopicTodoList } from './TopicTodoList';

const STATUS_LABELS: Record<string, string> = {
  active: '진행 중',
  done: '완료',
  archived: '보관',
};

export function ExperimentHubView() {
  const { dataDir, openNote, openProjectHub } = useAppStore();
  const data = useHubStore((s) => s.experimentHubData);
  const filterTags = useHubStore((s) => s.filterTags);
  const toggleFilterTag = useHubStore((s) => s.toggleFilterTag);

  const allTags = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.timeline.forEach(e => e.tags?.forEach(t => set.add(t)));
    return [...set].sort();
  }, [data]);

  const filteredTimeline = useMemo(() => {
    if (!data) return [];
    if (filterTags.length === 0) return data.timeline;
    return data.timeline.filter(e =>
      e.tags && filterTags.some(t => e.tags!.includes(t))
    );
  }, [data, filterTags]);

  const handleOpen = useCallback((path: string) => {
    openNote(path);
  }, [openNote]);

  const handleToggleTodo = useCallback(async (id: string) => {
    if (!dataDir) return;
    const file = await readJsonFile<TodosFile>(dataDir, FILES.todos);
    if (!file) return;
    const today = new Date().toISOString().slice(0, 10);
    file.todos = file.todos.map((t) =>
      t.id === id ? { ...t, status: 'done' as const, endDate: today, updatedAt: new Date().toISOString() } : t,
    );
    file.lastModified = new Date().toISOString();
    await writeJsonFile(dataDir, FILES.todos, file);
    useTaskStore.getState().updateTask(id, { status: 'done', endDate: today });
  }, [dataDir]);

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        Experiment를 선택하세요.
      </div>
    );
  }

  const noteCount = data.timeline.filter((e) => e.type !== 'daily-inline').length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="px-6 py-4 border-b border-border bg-paper-soft">
        <div className="flex items-center gap-3">
          <button
            onClick={() => openProjectHub(data.projectName)}
            className="p-1 rounded hover:bg-paper-muted/50 transition-colors text-ink-3 hover:text-ink shrink-0"
            title={`${data.projectName} 허브로`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="text-2xl">🧪</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-ink">{data.meta.name}</h1>
              <span className="px-1.5 py-0.5 text-[10px] rounded-full border border-border text-ink-3">
                {STATUS_LABELS[data.meta.status] ?? data.meta.status}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-3">
              <button
                onClick={() => openProjectHub(data.projectName)}
                className="hover:text-chrome transition-colors"
              >
                🛰️ {data.projectName}
              </button>
              <span>📄 {noteCount}개 노트</span>
              <span>📋 {data.todos.length}개 열린 TODO</span>
            </div>
          </div>
        </div>
        {data.meta.description && (
          <p className="mt-2 text-xs text-ink-2">{data.meta.description}</p>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="px-6 py-2 border-b border-border/50 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-ink-3 uppercase tracking-wider mr-1">Tags</span>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleFilterTag(tag)}
              className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                filterTags.includes(tag)
                  ? 'bg-chrome/30 border-chrome/50 text-ink font-medium'
                  : 'border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted/50'
              }`}
            >
              {tag}
            </button>
          ))}
          {filterTags.length > 0 && (
            <button
              onClick={() => useHubStore.getState().setFilterTags([])}
              className="px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink transition-colors"
            >
              ✕ Clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 py-4 space-y-6">
        <TopicTimeline entries={filteredTimeline} onOpen={handleOpen} />
        <ConclusionList conclusions={data.conclusions} onOpen={handleOpen} />
        <TopicTodoList todos={data.todos} onToggle={handleToggleTodo} />
      </div>
    </div>
  );
}
