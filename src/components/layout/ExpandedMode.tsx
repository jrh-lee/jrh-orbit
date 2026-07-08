import { useState, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { Sidebar } from './Sidebar';
import { ResizeHandle } from '../ui/ResizeHandle';
import { DailyLog } from '../notes/DailyLog';
import { TaskListView } from '../tasks/TaskListView';
import { NoteListView } from '../notes/NoteListView';
import { SearchView } from '../search/SearchView';
import { StatisticsView } from '../statistics/StatisticsView';
import { GraphView } from '../graph/GraphView';
import { SettingsView } from '../settings/SettingsView';
import { HubView } from '../hub/HubView';
import { DashboardView } from '../dashboard/DashboardView';
import { CalendarView } from '../calendar/CalendarView';

const views = {
  daily: DailyLog,
  notes: NoteListView,
  tasks: TaskListView,
  calendar: CalendarView,
  search: SearchView,
  statistics: StatisticsView,
  graph: GraphView,
  settings: SettingsView,
  hub: HubView,
  dashboard: DashboardView,
} as const;

const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 300;

export function ExpandedMode() {
  const { view, sidebarHidden, toggleSidebar } = useAppStore();
  const zoomLevel = useConfigStore((s) => s.window.zoom_level);
  const ViewComponent = views[view];
  const [sidebarWidth, setSidebarWidth] = useState(180);

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w + delta)));
  }, []);

  const zoomStyle = zoomLevel !== 100 ? { zoom: zoomLevel / 100 } as React.CSSProperties : undefined;

  return (
    <div className="flex-1 flex min-h-0 relative" style={zoomStyle}>
      {!sidebarHidden && (
        <>
          <div style={{ width: sidebarWidth }} className="shrink-0 border-r border-border">
            <Sidebar />
          </div>
          <ResizeHandle onResize={handleSidebarResize} />
        </>
      )}
      {sidebarHidden && (
        <button
          onClick={toggleSidebar}
          title="사이드바 표시 (Ctrl+\)"
          className="absolute left-1 top-1.5 z-40 p-1 rounded-md text-ink-3/50 hover:text-ink hover:bg-paper-soft transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 3l4 4-4 4M8 3l4 4-4 4" />
          </svg>
        </button>
      )}
      <main id="main-content" role="main" className="flex-1 flex flex-col min-h-0 min-w-0 bg-paper">
        <ViewComponent />
      </main>
    </div>
  );
}
