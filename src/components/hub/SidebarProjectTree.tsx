import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { useExperimentStore, experimentsForProject } from '../../stores/useExperimentStore';
import { experimentEmoji } from '../../types/experiment';
import { findNotesForProject, type HubNoteRow } from '../../lib/db';
import { readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { TodosFile } from '../../types/task';
import clsx from 'clsx';

export function SidebarProjectTree() {
  const { view, setView, setActiveProject, openDashboard, openProjectHub, openExperimentHub, hubTarget, dataDir } = useAppStore();
  const { projects } = useProjectStore();
  const { filterProject, setFilterProject } = useTaskStore();
  // 프로젝트별 3일 이내 마감(미완료) 여부 — 붉은 펄스 점 표시용.
  // 스토어는 Tasks 탭을 열기 전엔 비어 있어 todos.json을 직접 읽는다.
  const [dueSoon, setDueSoon] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!dataDir) return;
    let cancelled = false;
    const compute = async () => {
      try {
        const data = await readJsonFile<TodosFile>(dataDir, FILES.todos);
        const today = new Date(new Date().toDateString()).getTime();
        const s = new Set<string>();
        for (const t of data?.todos ?? []) {
          if (t.status === 'done' || !t.dueDate || !t.projectId) continue;
          const daysLeft = Math.round((new Date(t.dueDate).getTime() - today) / 86400000);
          if (daysLeft <= 3) s.add(t.projectId); // id 또는 레거시 이름 — 표시 시 둘 다 조회
        }
        if (!cancelled) setDueSoon(s);
      } catch { /* keep previous */ }
    };
    compute();
    window.addEventListener('tasks-changed', compute);
    return () => { cancelled = true; window.removeEventListener('tasks-changed', compute); };
  }, [dataDir]);
  const experiments = useExperimentStore((s) => s.experiments);
  const [dashboards, setDashboards] = useState<Record<string, string>>({});
  const [expOpen, setExpOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (dataDir) useExperimentStore.getState().load(dataDir).catch(() => {});
  }, [dataDir]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const map: Record<string, string> = {};
      for (const p of projects) {
        try {
          const rows: HubNoteRow[] = await findNotesForProject(p.name);
          const db = rows.find(r => r.note_type === 'project-dashboard');
          if (db) map[p.id] = db.path;
        } catch { /* skip */ }
      }
      if (!cancelled) setDashboards(map);
    };
    load();
    // The first pass often races the FTS build at startup (empty index) —
    // re-query when the index is ready or notes change.
    const onReady = () => load();
    window.addEventListener('search-index-ready', onReady);
    window.addEventListener('notes-changed', onReady);
    return () => {
      cancelled = true;
      window.removeEventListener('search-index-ready', onReady);
      window.removeEventListener('notes-changed', onReady);
    };
  }, [projects]);

  const handleProjectClick = (projectId: string) => {
    if (filterProject === projectId) {
      setFilterProject(null);
      setActiveProject(null);
    } else {
      setFilterProject(projectId);
      setActiveProject(projectId);
      if (view !== 'notes' && view !== 'tasks') {
        setView('tasks');
      }
    }
  };

  const handleSubView = useCallback((projectId: string, targetView: 'tasks' | 'notes') => {
    setFilterProject(projectId);
    setActiveProject(projectId);
    setView(targetView);
  }, [setFilterProject, setActiveProject, setView]);

  // Dashboard 버튼 → Dashboard 뷰를 열고 해당 프로젝트 탭을 선택한다
  // (이전에는 openNote로 대시보드 노트가 Notes 탭에 열려버렸음)
  const handleOpenDashboard = useCallback((projectId: string) => {
    openDashboard(projectId);
  }, [openDashboard]);

  if (projects.length === 0) {
    return <div className="px-2 text-[10px] text-ink-3">No projects</div>;
  }

  return (
    <div className="px-1">
      {projects.map((project) => {
        const isActive = filterProject === project.id;
        const dbPath = dashboards[project.id];
        return (
          <div key={project.id} className="mb-0.5">
            <div className="flex items-center">
              <span className="w-4 shrink-0" />
              <button
                onClick={() => handleProjectClick(project.id)}
                className={clsx(
                  'flex-1 flex items-center gap-1.5 px-1 py-0.5 rounded text-[11px] text-left transition-colors min-w-0',
                  isActive
                    ? 'bg-chrome/25 text-ink font-medium'
                    : 'text-ink-2 hover:bg-paper-muted/50'
                )}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate">{project.name}</span>
                {(dueSoon.has(project.id) || dueSoon.has(project.name)) && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-badge-high animate-pulse shrink-0 ml-auto"
                    title="3일 이내 마감 Task 있음"
                  />
                )}
              </button>
            </div>

            {isActive && (
              <div className="ml-6 mt-0.5 mb-1 flex flex-col gap-0.5">
                <button
                  onClick={() => handleSubView(project.id, 'tasks')}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] transition-colors',
                    view === 'tasks' ? 'text-chrome font-medium bg-chrome/10' : 'text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30'
                  )}
                >
                  <span>📋</span> Tasks
                </button>
                <button
                  onClick={() => handleSubView(project.id, 'notes')}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] transition-colors',
                    view === 'notes' ? 'text-chrome font-medium bg-chrome/10' : 'text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30'
                  )}
                >
                  <span>📄</span> Notes
                </button>
                <button
                  onClick={() => openProjectHub(project.name)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] transition-colors',
                    view === 'hub' && hubTarget?.type === 'project' && hubTarget.name === project.name
                      ? 'text-chrome font-medium bg-chrome/10'
                      : 'text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30'
                  )}
                >
                  <span>🗂️</span> Hub
                </button>
                {dbPath && (
                  <button
                    onClick={() => handleOpenDashboard(project.id)}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30 transition-colors"
                  >
                    <span>🛰️</span> Dashboard
                  </button>
                )}
                {experimentsForProject(experiments, project.id).length > 0 && (
                  <>
                    <button
                      onClick={() => setExpOpen((prev) => ({ ...prev, [project.id]: !prev[project.id] }))}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30 transition-colors"
                    >
                      <svg
                        width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        className={clsx('shrink-0 transition-transform', expOpen[project.id] && 'rotate-90')}
                      >
                        <path d="M3 1.5L7.5 5 3 8.5" />
                      </svg>
                      <span>🧪</span> Experiment
                      <span className="ml-auto text-[9px] text-ink-3/70">
                        {experimentsForProject(experiments, project.id).length}
                      </span>
                    </button>
                    {expOpen[project.id] && experimentsForProject(experiments, project.id).map((ex) => (
                      <button
                        key={ex.id}
                        onClick={() => openExperimentHub(ex.name, project.name)}
                        className={clsx(
                          'flex items-center gap-1.5 pl-6 pr-2 py-0.5 rounded text-[10px] transition-colors min-w-0',
                          view === 'hub' && hubTarget?.type === 'experiment' && hubTarget.name === ex.name
                            ? 'text-chrome font-medium bg-chrome/10'
                            : ex.status === 'active'
                              ? 'text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30'
                              : 'text-ink-3/60 hover:text-ink-3 hover:bg-paper-muted/30',
                        )}
                        title={ex.name}
                      >
                        <span>{experimentEmoji(ex.name)}</span>
                        <span className="truncate">{ex.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
