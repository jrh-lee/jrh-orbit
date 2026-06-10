import { useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useHubStore } from '../../stores/useHubStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { writeJsonFile, readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { TodosFile } from '../../types/task';
import { TopicHeader } from './TopicHeader';
import { TopicTimeline } from './TopicTimeline';
import { ConclusionList } from './ConclusionList';
import { TopicTodoList } from './TopicTodoList';
import { RelatedTopics } from './RelatedTopics';

export function TopicHubView() {
  const { dataDir, openNote, openTopicHub, openProjectHub, goHubLanding } = useAppStore();
  const data = useHubStore((s) => s.topicHubData);

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
        토픽을 선택하세요.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <TopicHeader
        meta={data.meta}
        noteCount={data.timeline.filter((e) => e.type !== 'daily-inline').length}
        onBack={() => data.meta.project ? openProjectHub(data.meta.project) : goHubLanding()}
      />

      <div className="flex-1 py-4 space-y-6">
        <TopicTimeline entries={data.timeline} onOpen={handleOpen} />
        <ConclusionList conclusions={data.conclusions} onOpen={handleOpen} />
        <TopicTodoList todos={data.todos} onToggle={handleToggleTodo} />
        <RelatedTopics topics={data.relatedTopics} onOpenTopic={openTopicHub} />
      </div>
    </div>
  );
}
