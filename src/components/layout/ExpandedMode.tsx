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

const views = {
  daily: DailyLog,
  notes: NoteListView,
  tasks: TaskListView,
  search: SearchView,
  statistics: StatisticsView,
  graph: GraphView,
  settings: SettingsView,
} as const;

const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 300;

export function ExpandedMode() {
  const { view } = useAppStore();
  const zoomLevel = useConfigStore((s) => s.window.zoom_level);
  const ViewComponent = views[view];
  const [sidebarWidth, setSidebarWidth] = useState(180);

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w + delta)));
  }, []);

  const zoomStyle = zoomLevel !== 100 ? { zoom: zoomLevel / 100 } as React.CSSProperties : undefined;

  return (
    <div className="flex-1 flex min-h-0" style={zoomStyle}>
      <div style={{ width: sidebarWidth }} className="shrink-0 border-r border-border">
        <Sidebar />
      </div>
      <ResizeHandle onResize={handleSidebarResize} />
      <main id="main-content" role="main" className="flex-1 flex flex-col min-h-0 min-w-0 bg-paper">
        <ViewComponent />
      </main>
    </div>
  );
}
