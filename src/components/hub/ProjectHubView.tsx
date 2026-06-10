import { useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useHubStore } from '../../stores/useHubStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { writeJsonFile, readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { TodosFile } from '../../types/task';
import { TopicMap } from './TopicMap';
import { ProjectTimeline } from './ProjectTimeline';
import { DecisionList } from './DecisionList';
import { ProjectTodoList } from './ProjectTodoList';
import { MilestoneBar } from './MilestoneBar';

export function ProjectHubView() {
  const { dataDir, openNote, openTopicHub, goHubLanding } = useAppStore();
  const data = useHubStore((s) => s.projectHubData);

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
        프로젝트를 선택하세요.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="px-6 py-4 border-b border-border bg-paper-soft">
        <div className="flex items-center gap-3">
          <button
            onClick={goHubLanding}
            className="p-1 rounded hover:bg-paper-muted/50 transition-colors text-ink-3 hover:text-ink shrink-0"
            title="뒤로 가기"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="text-2xl">🛰️</span>
          <div>
            <h1 className="text-lg font-semibold text-ink">{data.projectName}</h1>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-3">
              <span>📂 {data.topics.length}개 토픽</span>
              <span>📄 {data.timeline.filter((e) => e.type !== 'daily-inline').length}개 노트</span>
              <span>📋 {data.todos.length}개 열린 TODO</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 py-4 space-y-6">
        <TopicMap topics={data.topics} topicLinks={data.topicLinks} onOpenTopic={openTopicHub} />
        <MilestoneBar milestones={data.milestones} />
        <ProjectTimeline entries={data.timeline} onOpen={handleOpen} />
        <DecisionList decisions={data.decisions} onOpen={handleOpen} />
        <ProjectTodoList todos={data.todos} onToggle={handleToggleTodo} />
      </div>
    </div>
  );
}
