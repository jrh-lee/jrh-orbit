import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { TopicsFile, TopicEntry } from '../../types/dataFiles';
import clsx from 'clsx';

export function HubLanding() {
  const { dataDir, openProjectHub, openTopicHub } = useAppStore();
  const { projects } = useProjectStore();
  const [topicsByProject, setTopicsByProject] = useState<Map<string, TopicEntry[]>>(new Map());
  const [orphanTopics, setOrphanTopics] = useState<TopicEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!dataDir) return;
    const file = await readJsonFile<TopicsFile>(dataDir, FILES.topics);
    const all = file?.topics || [];

    const projectNames = new Set(projects.map((p) => p.name));
    const byProject = new Map<string, TopicEntry[]>();
    const assigned = new Set<string>();

    for (const p of projects) {
      const matched = all.filter((t) => t.project === p.name);
      byProject.set(p.name, matched);
      for (const t of matched) assigned.add(t.name);
    }

    setTopicsByProject(byProject);
    setOrphanTopics(
      all.filter((t) => !assigned.has(t.name) && (!t.project || !projectNames.has(t.project))),
    );
  }, [dataDir, projects]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('topics-changed', handler);
    window.addEventListener('projects-changed', handler);
    return () => {
      window.removeEventListener('topics-changed', handler);
      window.removeEventListener('projects-changed', handler);
    };
  }, [load]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalTopics = Array.from(topicsByProject.values()).reduce((s, t) => s + t.length, 0) + orphanTopics.length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="px-6 py-4 border-b border-border bg-paper-soft">
        <h1 className="text-lg font-semibold text-ink">Topic Hub</h1>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-3">
          <span>🛰️ {projects.length}개 프로젝트</span>
          <span>📂 {totalTopics}개 토픽</span>
        </div>
      </div>

      <div className="flex-1 py-4 px-4 space-y-2">
        {projects.map((project) => {
          const topics = topicsByProject.get(project.name) || [];
          const isOpen = expanded.has(project.name);

          return (
            <div key={project.id} className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center bg-paper-soft">
                <button
                  onClick={() => toggle(project.name)}
                  className="flex items-center gap-2 flex-1 px-4 py-2.5 text-left hover:bg-paper-muted/30 transition-colors"
                >
                  <svg
                    width="8" height="8" viewBox="0 0 8 8" fill="none"
                    className={clsx('transition-transform shrink-0', isOpen && 'rotate-90')}
                  >
                    <path d="M2.5 1l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="text-sm font-medium text-ink">{project.name}</span>
                  <span className="text-[10px] text-ink-3 ml-1">({topics.length}개 토픽)</span>
                </button>
                <button
                  onClick={() => openProjectHub(project.name)}
                  className="px-3 py-2 text-[10px] text-chrome hover:text-ink transition-colors shrink-0"
                  title="프로젝트 허브 열기"
                >
                  허브 →
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-border/50">
                  {topics.length === 0 ? (
                    <div className="px-4 py-3 text-[11px] text-ink-3 italic">
                      등록된 토픽이 없습니다
                    </div>
                  ) : (
                    <div className="divide-y divide-border/30">
                      {topics.map((topic) => (
                        <button
                          key={topic.name}
                          onClick={() => openTopicHub(topic.name)}
                          className="w-full flex items-center gap-2 px-6 py-2 text-left hover:bg-paper-muted/30 transition-colors"
                        >
                          <span className="text-xs">📂</span>
                          <span className="text-xs text-ink-2">{topic.name}</span>
                          <span className="text-[10px] text-ink-3 ml-auto">{topic.note_count}개 노트</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {orphanTopics.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center bg-paper-soft">
              <button
                onClick={() => toggle('__uncategorized__')}
                className="flex items-center gap-2 flex-1 px-4 py-2.5 text-left hover:bg-paper-muted/30 transition-colors"
              >
                <svg
                  width="8" height="8" viewBox="0 0 8 8" fill="none"
                  className={clsx('transition-transform shrink-0', expanded.has('__uncategorized__') && 'rotate-90')}
                >
                  <path d="M2.5 1l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="w-3 h-3 rounded-full shrink-0 bg-ink-3/30" />
                <span className="text-sm font-medium text-ink-3">미분류</span>
                <span className="text-[10px] text-ink-3 ml-1">({orphanTopics.length}개 토픽)</span>
              </button>
            </div>

            {expanded.has('__uncategorized__') && (
              <div className="border-t border-border/50 divide-y divide-border/30">
                {orphanTopics.map((topic) => (
                  <button
                    key={topic.name}
                    onClick={() => openTopicHub(topic.name)}
                    className="w-full flex items-center gap-2 px-6 py-2 text-left hover:bg-paper-muted/30 transition-colors"
                  >
                    <span className="text-xs">📂</span>
                    <span className="text-xs text-ink-2">{topic.name}</span>
                    <span className="text-[10px] text-ink-3 ml-auto">{topic.note_count}개 노트</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {projects.length === 0 && orphanTopics.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-ink-3">
            <span className="text-3xl mb-3">🛰️</span>
            <p className="text-sm">프로젝트와 토픽이 없습니다</p>
            <p className="text-xs mt-1">노트에 토픽을 추가하면 여기에 표시됩니다</p>
          </div>
        )}
      </div>
    </div>
  );
}
