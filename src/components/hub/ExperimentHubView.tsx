import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useHubStore } from '../../stores/useHubStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { useExperimentStore } from '../../stores/useExperimentStore';
import { writeJsonFile, readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { TodosFile } from '../../types/task';
import type { ExperimentStatus } from '../../types/experiment';
import { experimentEmoji } from '../../types/experiment';
import { renameExperiment, setExperimentStatus, deleteExperiment } from '../../lib/experimentOps';
import { Dropdown } from '../ui/Dropdown';
import { TopicTimeline } from './TopicTimeline';
import { ConclusionList } from './ConclusionList';
import { TopicTodoList } from './TopicTodoList';

const STATUS_LABELS: Record<string, string> = {
  active: '진행 중',
  done: '완료',
  archived: '보관',
};

export function ExperimentHubView() {
  const { dataDir, openNote, openProjectHub, openExperimentHub } = useAppStore();
  const data = useHubStore((s) => s.experimentHubData);
  const filterTags = useHubStore((s) => s.filterTags);
  const toggleFilterTag = useHubStore((s) => s.toggleFilterTag);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dataDir) useExperimentStore.getState().load(dataDir).catch(() => {});
  }, [dataDir]);

  const canManage = !!data?.meta.id; // frontmatter에만 존재하는 고아 experiment는 관리 불가

  const handleRename = useCallback(async () => {
    if (!data || !dataDir || busy) return;
    const newName = renameValue.trim();
    setRenaming(false);
    if (!newName || newName === data.meta.name) return;
    setBusy(true);
    try {
      await renameExperiment(dataDir, data.meta, newName, data.projectName);
      openExperimentHub(newName, data.projectName); // 새 이름으로 허브 재로드
    } finally {
      setBusy(false);
    }
  }, [data, dataDir, renameValue, busy, openExperimentHub]);

  const handleStatus = useCallback(async (status: string) => {
    if (!data || !dataDir || busy) return;
    setBusy(true);
    try {
      await setExperimentStatus(dataDir, data.meta, status as ExperimentStatus);
      useHubStore.getState().setExperimentHubData({ ...data, meta: { ...data.meta, status: status as ExperimentStatus } });
    } finally {
      setBusy(false);
    }
  }, [data, dataDir, busy]);

  const handleDelete = useCallback(async () => {
    if (!data || !dataDir || busy) return;
    if (!confirm(`Experiment "${data.meta.name}"을(를) 삭제할까요?\n노트는 남고 experiment 지정만 해제됩니다.`)) return;
    setBusy(true);
    try {
      await deleteExperiment(dataDir, data.meta, data.projectName);
      openProjectHub(data.projectName);
    } finally {
      setBusy(false);
    }
  }, [data, dataDir, busy, openProjectHub]);

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
          <span className="text-2xl">{experimentEmoji(data.meta.name)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {renaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  onBlur={handleRename}
                  className="text-lg font-semibold text-ink bg-paper border border-chrome rounded px-2 py-0.5 focus:outline-none min-w-0"
                />
              ) : (
                <h1 className="text-lg font-semibold text-ink truncate">{data.meta.name}</h1>
              )}
              {canManage ? (
                <Dropdown
                  value={data.meta.status}
                  onChange={handleStatus}
                  options={[
                    { value: 'active', label: STATUS_LABELS.active },
                    { value: 'done', label: STATUS_LABELS.done },
                    { value: 'archived', label: STATUS_LABELS.archived },
                  ]}
                  compact
                />
              ) : (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full border border-border text-ink-3">
                  {STATUS_LABELS[data.meta.status] ?? data.meta.status}
                </span>
              )}
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
          {canManage && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => { setRenameValue(data.meta.name); setRenaming(true); }}
                disabled={busy}
                title="이름 변경 (노트의 experiment 지정도 함께 갱신)"
                className="p-1.5 rounded text-ink-3 hover:text-ink hover:bg-paper-muted/60 transition-colors disabled:opacity-40"
              >
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                  <path d="M8.5 1.5l2 2L4 10H2v-2l6.5-6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                title="Experiment 삭제 (노트는 유지, 지정만 해제)"
                className="p-1.5 rounded text-ink-3 hover:text-red-500 hover:bg-paper-muted/60 transition-colors disabled:opacity-40"
              >
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                  <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5L9 3M5 5v3.5M7 5v3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
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
