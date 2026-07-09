import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { useExperimentStore, experimentsForProject } from '../../stores/useExperimentStore';
import { experimentEmoji } from '../../types/experiment';
import { findNotesForProject, type HubNoteRow } from '../../lib/db';
import clsx from 'clsx';

export function SidebarProjectTree() {
  const { view, setView, setActiveProject, openNote, openProjectHub, openExperimentHub, hubTarget, dataDir } = useAppStore();
  const { projects } = useProjectStore();
  const { filterProject, setFilterProject } = useTaskStore();
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

  const handleOpenDashboard = useCallback((path: string) => {
    openNote(path);
  }, [openNote]);

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
                    onClick={() => handleOpenDashboard(dbPath)}
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
