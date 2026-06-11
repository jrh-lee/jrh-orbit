import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTaskStore } from '../../stores/useTaskStore';
import clsx from 'clsx';

export function SidebarProjectTree() {
  const { setView, setActiveProject } = useAppStore();
  const { projects } = useProjectStore();
  const { filterProject, setFilterProject } = useTaskStore();

  const handleProjectClick = (projectId: string) => {
    if (filterProject === projectId) {
      setFilterProject(null);
      setActiveProject(null);
    } else {
      setFilterProject(projectId);
      setActiveProject(projectId);
      setView('tasks');
    }
  };

  if (projects.length === 0) {
    return <div className="px-2 text-[10px] text-ink-3">No projects</div>;
  }

  return (
    <div className="px-1">
      {projects.map((project) => (
        <div key={project.id} className="mb-0.5">
          <div className="flex items-center">
            <span className="w-4 shrink-0" />
            <button
              onClick={() => handleProjectClick(project.id)}
              className={clsx(
                'flex-1 flex items-center gap-1.5 px-1 py-0.5 rounded text-[11px] text-left transition-colors min-w-0',
                filterProject === project.id
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
        </div>
      ))}
    </div>
  );
}
