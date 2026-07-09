import { useState } from 'react';
import { useAppStore, type AppView } from '../../stores/useAppStore';
import { ProjectManager } from '../projects/ProjectManager';
import { SidebarProjectTree } from '../hub/SidebarProjectTree';
import { DDayCounter } from '../productivity/DDayCounter';
import { TagManager } from '../productivity/TagManager';
import { WorkhourTimer } from '../productivity/WorkhourTimer';
import clsx from 'clsx';

const navItems: { view: AppView; label: string; icon: React.ReactNode }[] = [
  {
    view: 'daily',
    label: 'Daily',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="3" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M2 7h14" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M6 1v4M12 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    view: 'notes',
    label: 'Notes',
    icon: (
      <svg width="16" height="16" viewBox="-0.5 -0.5 19 19" fill="none">
        <path d="M4 2h7l5 5v9a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M11 2v5h5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M6 10h6M6 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    view: 'tasks',
    label: 'Tasks',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M6 7l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    view: 'calendar',
    label: 'Calendar',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="3" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M2 7h14" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M6 1v4M12 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="6" cy="10.5" r="1" fill="currentColor"/>
        <circle cx="9" cy="10.5" r="1" fill="currentColor"/>
        <circle cx="12" cy="10.5" r="1" fill="currentColor"/>
        <circle cx="6" cy="13.5" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    view: 'hub',
    label: 'Hub',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="3" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
        <circle cx="15" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
        <circle cx="3" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
        <circle cx="15" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
        <path d="M4.3 5.2L7 7.5M13.7 5.2L11 7.5M4.3 12.8L7 10.5M13.7 12.8L11 10.5" stroke="currentColor" strokeWidth="1"/>
      </svg>
    ),
  },
  {
    view: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="10" y="2" width="6" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="10" y="7" width="6" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    view: 'graph',
    label: 'Graph',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="13" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="9" cy="14" r="2" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M6.5 6.5L8 12M11.5 6.5L10 12" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    ),
  },
  {
    view: 'search',
    label: 'Search',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M12 12l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    view: 'statistics',
    label: 'Stats',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="10" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="7.5" y="6" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="13" y="2" width="3" height="14" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    view: 'settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M9 2v2M9 14v2M2 9h2M14 9h2M4.2 4.2l1.4 1.4M12.4 12.4l1.4 1.4M13.8 4.2l-1.4 1.4M5.6 12.4l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export function Sidebar() {
  const { view, setView, toggleSidebar } = useAppStore();
  const [openSections, setOpenSections] = useState({ projects: true, dday: true, tags: false });
  const [projectAdding, setProjectAdding] = useState(false);
  const [ddayAdding, setDdayAdding] = useState(false);

  function toggle(key: keyof typeof openSections) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className="w-full h-full bg-paper-soft flex flex-col min-h-0 relative group/sidebar">
      <button
        onClick={toggleSidebar}
        title="사이드바 숨기기 (Ctrl+\)"
        className="absolute right-1 top-2 z-10 p-1 rounded text-ink-3 opacity-0 group-hover/sidebar:opacity-100 hover:text-ink hover:bg-paper-muted/60 transition-all"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3L6 7l4 4M6 3L2 7l4 4" />
        </svg>
      </button>
      <nav className="p-1.5 space-y-px" role="navigation" aria-label="Main navigation">
        {navItems.map((item) => (
          <button
            key={item.view}
            onClick={() => setView(item.view)}
            aria-current={view === item.view ? 'page' : undefined}
            className={clsx(
              'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-[13px] transition-colors',
              view === item.view
                ? 'bg-chrome/30 text-ink font-medium'
                : 'text-ink-2 hover:bg-paper-muted/50'
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto min-h-0">
        <SidebarSection
          label="Projects"
          open={openSections.projects}
          onToggle={() => toggle('projects')}
          action={
            <button
              onClick={(e) => { e.stopPropagation(); setProjectAdding(!projectAdding); if (!openSections.projects) toggle('projects'); }}
              className="w-4 h-4 flex items-center justify-center text-ink-3 hover:text-ink transition-colors rounded"
              title="Add project"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          }
        >
          <ProjectManager adding={projectAdding} setAdding={setProjectAdding} />
          <SidebarProjectTree />
        </SidebarSection>

        <SidebarSection
          label="D-Day"
          open={openSections.dday}
          onToggle={() => toggle('dday')}
          action={
            <button
              onClick={(e) => { e.stopPropagation(); setDdayAdding(!ddayAdding); if (!openSections.dday) toggle('dday'); }}
              className="w-4 h-4 flex items-center justify-center text-ink-3 hover:text-ink transition-colors rounded"
              title="Add event"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          }
        >
          <DDayCounter adding={ddayAdding} setAdding={setDdayAdding} />
        </SidebarSection>

        <SidebarSection label="Tags" open={openSections.tags} onToggle={() => toggle('tags')}>
          <TagManager />
        </SidebarSection>
      </div>

      <WorkhourTimer />

      <div className="px-2.5 py-1.5 shrink-0">
        <div className="text-[10px] text-ink-3">JRH-Orbit v0.4.1</div>
      </div>
    </aside>
  );
}

function SidebarSection({ label, open, onToggle, action, children }: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border">
      <div className="flex items-center px-2 py-1.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 flex-1 min-w-0 text-[10px] font-semibold text-ink-3 uppercase tracking-wider hover:text-ink-2 transition-colors"
        >
          <svg
            width="8" height="8" viewBox="0 0 8 8" fill="none"
            className={clsx('transition-transform shrink-0', open && 'rotate-90')}
          >
            <path d="M2.5 1l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {label}
        </button>
        {action}
      </div>
      {open && <div className="pb-1.5">{children}</div>}
    </div>
  );
}
