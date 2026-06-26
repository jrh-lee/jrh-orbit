import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { findNotesForProject, type HubNoteRow } from '../../lib/db';
import clsx from 'clsx';

export function SidebarProjectTree() {
  const { view, setView, setActiveProject, openNote } = useAppStore();
  const { projects } = useProjectStore();
  const { filterProject, setFilterProject } = useTaskStore();
  const [dashboards, setDashboards] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = {};
      for (const p of projects) {
        try {
          const rows: HubNoteRow[] = await findNotesForProject(p.name);
          const db = rows.find(r => r.note_type === 'project-dashboard');
          if (db) map[p.id] = db.path;
        } catch { /* skip */ }
      }
      if (!cancelled) setDashboards(map);
    })();
    return () => { cancelled = true; };
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
                {dbPath && (
                  <button
                    onClick={() => handleOpenDashboard(dbPath)}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] text-ink-3 hover:text-ink-2 hover:bg-paper-muted/30 transition-colors"
                  >
                    <span>🛰️</span> Dashboard
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
