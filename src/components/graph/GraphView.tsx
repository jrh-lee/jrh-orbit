import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { buildGraphData, type GraphData } from '../../lib/graphData';
import { ForceGraph, type ForceGraphHandle } from './ForceGraph';
import { Dropdown, type DropdownOption } from '../ui/Dropdown';
import { NOTE_TYPE_LABELS, type NoteType } from '../../types/note';

const NOTE_TYPES: NoteType[] = [
  'daily-log',
  'quick-memo',
  'analysis-note',
  'test-log',
  'design-note',
  'study-note',
  'review',
];

const TYPE_OPTIONS: DropdownOption[] = NOTE_TYPES.map((t) => ({
  value: t,
  label: NOTE_TYPE_LABELS[t],
}));

const TYPE_COLOR_VAR: Record<string, string> = {
  'daily-log': '--color-chrome',
  'analysis-note': '--color-pastel-blue',
  'test-log': '--color-pastel-mint',
  'quick-memo': '--color-pastel-cream',
  'design-note': '--color-pastel-lavender',
  'study-note': '--color-pastel-pink',
  'review': '--color-pastel-peach',
};

function LegendDot({ type }: { type: string }) {
  const cssVar = TYPE_COLOR_VAR[type] ?? '--color-ink-3';
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: `var(${cssVar})` }}
    />
  );
}

export function GraphView() {
  const dataDir = useAppStore((s) => s.dataDir);
  const openNote = useAppStore((s) => s.openNote);

  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [projectFilter, setProjectFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const graphRef = useRef<ForceGraphHandle>(null);

  // Load graph data
  useEffect(() => {
    if (!dataDir) return;
    setLoading(true);
    setError(null);
    buildGraphData(dataDir)
      .then(setGraphData)
      .catch((e) => setError(e?.message ?? 'Failed to load graph data'))
      .finally(() => setLoading(false));
  }, [dataDir]);

  // Listen for links-changed to reload
  useEffect(() => {
    const handler = () => {
      if (!dataDir) return;
      buildGraphData(dataDir).then(setGraphData).catch(() => {});
    };
    window.addEventListener('links-changed', handler);
    return () => window.removeEventListener('links-changed', handler);
  }, [dataDir]);

  // Derive project list from data
  const projectOptions: DropdownOption[] = (() => {
    if (!graphData) return [];
    const set = new Set<string>();
    for (const n of graphData.nodes) {
      for (const p of n.project) set.add(p);
    }
    return Array.from(set)
      .sort()
      .map((p) => ({ value: p, label: p }));
  })();

  // Filter nodes & edges
  const filtered = (() => {
    if (!graphData) return { nodes: [], edges: [] };
    let nodes = graphData.nodes;

    if (projectFilter) {
      nodes = nodes.filter((n) => n.project.includes(projectFilter));
    }
    if (typeFilter) {
      nodes = nodes.filter((n) => n.type === typeFilter);
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );

    return { nodes, edges };
  })();

  const setView = useAppStore((s) => s.setView);
  const handleNodeClick = useCallback(
    (id: string) => {
      if (!graphData) return;
      if (id.startsWith('task:')) {
        setView('tasks');
        return;
      }
      const node = graphData.nodes.find((n) => n.id === id);
      if (node?.path) {
        openNote(node.path);
      }
    },
    [openNote, setView, graphData],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3">
        <div className="flex flex-col items-center gap-2">
          <svg className="animate-spin h-5 w-5 text-chrome" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="text-xs">Loading graph...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3">
        <span className="text-xs">Error: {error}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-paper">
        <span className="text-xs font-medium text-ink-2 mr-1">Graph</span>

        <Dropdown
          value={projectFilter}
          options={projectOptions}
          onChange={setProjectFilter}
          placeholder="All Projects"
          compact
        />

        <Dropdown
          value={typeFilter}
          options={TYPE_OPTIONS}
          onChange={setTypeFilter}
          placeholder="All Types"
          compact
        />

        {(projectFilter || typeFilter) && (
          <button
            onClick={() => { setProjectFilter(''); setTypeFilter(''); }}
            className="text-[10px] text-ink-3 hover:text-ink-2 transition-colors ml-1"
          >
            Clear
          </button>
        )}

        <button
          onClick={() => graphRef.current?.fit()}
          className="text-[10px] px-2 py-0.5 rounded border border-border text-ink-2 hover:text-ink hover:bg-paper-soft transition-colors ml-1"
          title="Fit graph to screen"
        >
          Fit
        </button>

        <div className="flex-1" />

        {/* Inline legend */}
        <div className="hidden sm:flex items-center gap-2 text-[10px] text-ink-3">
          {NOTE_TYPES.map((t) => (
            <span key={t} className="flex items-center gap-1">
              <LegendDot type={t} />
              {NOTE_TYPE_LABELS[t]}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ backgroundColor: '#e879f9', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }} />
            Task
          </span>
        </div>

        <span className="text-[10px] text-ink-3 ml-2 tabular-nums" title="노트 수 (Daily Log 제외)">
          {filtered.nodes.filter((n) => n.type !== 'daily-log').length} / {graphData?.nodes.filter((n) => n.type !== 'daily-log').length ?? 0}
        </span>
      </div>

      {/* Graph canvas area */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {filtered.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-ink-3 text-xs">
            {graphData && graphData.nodes.length > 0
              ? 'No notes match the current filter'
              : 'No notes with links found. Link notes to see the graph.'}
          </div>
        ) : (
          <ForceGraph
            ref={graphRef}
            nodes={filtered.nodes}
            edges={filtered.edges}
            onNodeClick={handleNodeClick}
          />
        )}
      </div>
    </div>
  );
}
