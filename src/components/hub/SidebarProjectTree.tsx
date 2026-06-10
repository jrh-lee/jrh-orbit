import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { TopicsFile, TopicEntry } from '../../types/dataFiles';
import clsx from 'clsx';

interface TopicNode {
  name: string;
  noteCount: number;
}

interface ProjectNode {
  id: string;
  name: string;
  color: string;
  topics: TopicNode[];
  unclassified: number;
}

export function SidebarProjectTree() {
  const { dataDir, openProjectHub, openTopicHub, hubTarget, view } = useAppStore();
  const { projects } = useProjectStore();
  const [treeData, setTreeData] = useState<ProjectNode[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const loadTopics = useCallback(async () => {
    if (!dataDir) return;
    const topicsFile = await readJsonFile<TopicsFile>(dataDir, FILES.topics);
    const allTopics = topicsFile?.topics || [];

    const projectNames = new Set(projects.map((p) => p.name));
    const assignedTopicNames = new Set<string>();

    const tree: ProjectNode[] = projects.map((p) => {
      const projectTopics = allTopics.filter((t: TopicEntry) => t.project === p.name);
      for (const t of projectTopics) assignedTopicNames.add(t.name);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        topics: projectTopics.map((t: TopicEntry) => ({
          name: t.name,
          noteCount: t.note_count,
        })),
        unclassified: 0,
      };
    });

    const orphanTopics = allTopics.filter(
      (t: TopicEntry) => !assignedTopicNames.has(t.name) && (!t.project || !projectNames.has(t.project)),
    );
    if (orphanTopics.length > 0) {
      tree.push({
        id: '__uncategorized__',
        name: 'Uncategorized',
        color: '#888888',
        topics: orphanTopics.map((t: TopicEntry) => ({
          name: t.name,
          noteCount: t.note_count,
        })),
        unclassified: orphanTopics.length,
      });
    }

    setTreeData(tree);
  }, [dataDir, projects]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  useEffect(() => {
    const handler = () => loadTopics();
    window.addEventListener('topics-changed', handler);
    window.addEventListener('projects-changed', handler);
    return () => {
      window.removeEventListener('topics-changed', handler);
      window.removeEventListener('projects-changed', handler);
    };
  }, [loadTopics]);

  const toggleExpand = (projectName: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) next.delete(projectName);
      else next.add(projectName);
      return next;
    });
  };

  const isActiveProject = (name: string) =>
    view === 'hub' && hubTarget?.type === 'project' && hubTarget.name === name;
  const isActiveTopic = (name: string) =>
    view === 'hub' && hubTarget?.type === 'topic' && hubTarget.name === name;

  if (treeData.length === 0) {
    return <div className="px-2 text-[10px] text-ink-3">No projects</div>;
  }

  return (
    <div className="px-1">
      {treeData.map((project) => {
        const expanded = expandedProjects.has(project.name);
        const hasTopics = project.topics.length > 0;

        return (
          <div key={project.id} className="mb-0.5">
            <div className="flex items-center">
              {hasTopics ? (
                <button
                  onClick={() => toggleExpand(project.name)}
                  className="w-4 h-4 flex items-center justify-center shrink-0 text-ink-3 hover:text-ink-2"
                >
                  <svg
                    width="7" height="7" viewBox="0 0 8 8" fill="none"
                    className={clsx('transition-transform', expanded && 'rotate-90')}
                  >
                    <path d="M2.5 1l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <button
                onClick={() => openProjectHub(project.name)}
                className={clsx(
                  'flex-1 flex items-center gap-1.5 px-1 py-0.5 rounded text-[11px] text-left transition-colors min-w-0',
                  isActiveProject(project.name)
                    ? 'bg-chrome/25 text-ink font-medium'
                    : 'text-ink-2 hover:bg-paper-muted/50'
                )}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate">{project.name}</span>
              </button>
            </div>

            {expanded && hasTopics && (
              <div className="ml-4 border-l border-border/50 pl-1">
                {project.topics.map((topic) => (
                  <button
                    key={topic.name}
                    onClick={() => openTopicHub(topic.name)}
                    className={clsx(
                      'w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] text-left transition-colors',
                      isActiveTopic(topic.name)
                        ? 'bg-chrome/20 text-ink font-medium'
                        : 'text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30'
                    )}
                  >
                    <span className="shrink-0">📂</span>
                    <span className="truncate">{topic.name}</span>
                    <span className="text-ink-3 ml-auto shrink-0">({topic.noteCount})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
