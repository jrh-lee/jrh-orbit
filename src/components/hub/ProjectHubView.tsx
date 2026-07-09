import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { useHubStore } from '../../stores/useHubStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { writeJsonFile, readJsonFile } from '../../lib/fileSystem';
import { FILES, FOLDERS } from '../../lib/constants';
import { buildFrontmatter } from '../../lib/frontmatter';
import { todayKey } from '../../lib/dateUtils';
import { reindexNote } from '../../lib/searchIndex';
import type { TodosFile } from '../../types/task';
import { experimentEmoji } from '../../types/experiment';
import { TopicMap } from './TopicMap';
import { ProjectTimeline } from './ProjectTimeline';
import { DecisionList } from './DecisionList';
import { ProjectTodoList } from './ProjectTodoList';
import { MilestoneBar } from './MilestoneBar';

function dashboardTemplate(projectName: string): string {
  return [
    '',
    '## 프로젝트 개요',
    '',
    '| 항목 | 내용 |',
    '|------|------|',
    '| 프로젝트명 | ' + projectName + ' |',
    '| 상태 |  |',
    '| 시작일 |  |',
    '| 목표 완료일 |  |',
    '',
    '## 하드웨어 사양',
    '',
    '- ',
    '',
    '## 궤도 파라미터',
    '',
    '| 파라미터 | 값 |',
    '|----------|-----|',
    '| 궤도 고도 |  |',
    '| 궤도 경사각 |  |',
    '| 궤도 주기 |  |',
    '',
    '## 운용 모드',
    '',
    '- ',
    '',
    '## 하위 시스템',
    '',
    '- ',
    '',
    '## 핵심 메모',
    '',
    '- ',
    '',
  ].join('\n');
}

export function ProjectHubView() {
  const { dataDir, openNote, openTopicHub, openExperimentHub, goHubLanding } = useAppStore();
  const [showDone, setShowDone] = useState(false);
  const data = useHubStore((s) => s.projectHubData);
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

  const filteredDecisions = useMemo(() => {
    if (filterTags.length === 0) return data?.decisions ?? [];
    return filteredTimeline.filter(e => e.type === 'design-note');
  }, [filteredTimeline, filterTags, data]);

  const handleOpen = useCallback((path: string) => {
    openNote(path);
  }, [openNote]);

  const handleCreateDashboard = useCallback(async () => {
    if (!dataDir || !data) return;
    const today = todayKey();
    const iso = new Date().toISOString();
    const noteId = `${today}-dashboard-${data.projectName.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-')}`;
    const title = `${data.projectName} Dashboard`;
    const fm = buildFrontmatter({
      id: noteId,
      type: 'project-dashboard',
      title,
      date: today,
      project: [data.projectName],
      topic: '',
      tags: ['dashboard'],
      related: [],
      status: 'in-progress',
      created: iso,
      updated: iso,
    });
    const body = dashboardTemplate(data.projectName);
    const fullPath = await join(dataDir, FOLDERS.research, `${noteId}.md`);
    await invoke('ensure_dir', { path: await join(dataDir, FOLDERS.research) });
    await invoke('write_note', { path: fullPath, content: fm + body });
    reindexNote(fullPath, 'project-dashboard').catch(() => {});
    window.dispatchEvent(new CustomEvent('notes-changed'));
    openNote(fullPath);
  }, [dataDir, data, openNote]);

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

  const dashboard = data.dashboardNote;

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
              {data.experiments.length > 0 && <span>🧪 {data.experiments.length}개 실험</span>}
              <span>📂 {data.topics.length}개 토픽</span>
              <span>📄 {data.timeline.filter((e) => e.type !== 'daily-inline').length}개 노트</span>
              <span>📋 {data.openTodoCount}개 열린 TODO</span>
            </div>
          </div>
        </div>
      </div>

      {dashboard ? (
        <div className="px-6 py-3 border-b border-border/50 bg-paper-soft/50">
          <button
            onClick={() => openNote(dashboard.path)}
            className="flex items-center gap-2 group w-full text-left"
          >
            <span className="text-base">📋</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-ink group-hover:text-chrome transition-colors">{dashboard.title}</span>
              {dashboard.summary && (
                <p className="text-[10px] text-ink-3 truncate mt-0.5">{dashboard.summary}</p>
              )}
            </div>
            <span className="text-[10px] text-ink-3 group-hover:text-chrome transition-colors shrink-0">열기 →</span>
          </button>
        </div>
      ) : (
        <div className="px-6 py-2.5 border-b border-border/50">
          <button
            onClick={handleCreateDashboard}
            className="flex items-center gap-1.5 text-[10px] text-ink-3 hover:text-chrome transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            프로젝트 대시보드 만들기
          </button>
        </div>
      )}

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
        {data.experiments.length > 0 && (
          <section className="px-6">
            <h2 className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider mb-2">🧪 Experiments</h2>
            <div className="flex flex-wrap gap-1.5">
              {data.experiments.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => openExperimentHub(ex.name, data.projectName)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
                    ex.status === 'active'
                      ? 'border-border text-ink-2 hover:border-chrome/60 hover:text-ink'
                      : 'border-border/50 text-ink-3 opacity-70 hover:opacity-100'
                  }`}
                >
                  <span>{experimentEmoji(ex.name)}</span>
                  <span className="truncate max-w-[180px]">{ex.name}</span>
                  <span className="text-[9px] text-ink-3">{ex.noteCount}</span>
                  {ex.status === 'done' && <span className="text-[9px] text-chrome">✓</span>}
                  {ex.status === 'archived' && <span className="text-[9px]">📦</span>}
                </button>
              ))}
            </div>
          </section>
        )}
        <TopicMap topics={data.topics} topicLinks={data.topicLinks} onOpenTopic={openTopicHub} />
        <MilestoneBar milestones={data.milestones} />
        <ProjectTimeline entries={filteredTimeline} onOpen={handleOpen} />
        <DecisionList decisions={filteredDecisions} onOpen={handleOpen} />
        <ProjectTodoList todos={data.todos} onToggle={handleToggleTodo} />

        {data.doneTodos.length > 0 && (
          <section className="px-6 pb-4">
            <button
              onClick={() => setShowDone(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-3 uppercase tracking-wider hover:text-ink-2 transition-colors"
            >
              <svg
                width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className={`shrink-0 transition-transform ${showDone ? 'rotate-90' : ''}`}
              >
                <path d="M3 1.5L7.5 5 3 8.5" />
              </svg>
              지난 TODO ({data.doneTodos.length})
            </button>
            {showDone && (
              <div className="mt-2 space-y-1">
                {data.doneTodos.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs text-ink-3">
                    <span className="text-chrome shrink-0">✓</span>
                    <span className="line-through truncate">{t.title}</span>
                    {t.endDate && <span className="text-[10px] shrink-0 ml-auto tabular-nums">{t.endDate}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
