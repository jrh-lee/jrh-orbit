import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { GraphNode, GraphEdge } from '../../lib/graphData';

export interface ForceGraphHandle {
  fit: () => void;
}

/* ── colour mapping ── */
const TYPE_CSS_VAR: Record<string, string> = {
  'daily-log': '--color-chrome',
  'analysis-note': '--color-pastel-blue',
  'test-log': '--color-pastel-mint',
  'quick-memo': '--color-pastel-cream',
  'design-note': '--color-pastel-lavender',
  'study-note': '--color-pastel-pink',
  'review': '--color-pastel-peach',
  'orphan': '--color-ink-3',
};

function resolveColor(cssVar: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || '#888';
}

function nodeColor(type: string): string {
  const v = TYPE_CSS_VAR[type] ?? TYPE_CSS_VAR['orphan'];
  return resolveColor(v);
}

/* ── helpers ── */
function nodeRadius(linkCount: number): number {
  return Math.min(20, Math.max(6, 6 + linkCount * 2));
}

interface SimNode extends GraphNode {
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  pinned: boolean;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (id: string) => void;
}

export const ForceGraph = forwardRef<ForceGraphHandle, Props>(function ForceGraph(
  { nodes, edges, onNodeClick },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const rafRef = useRef<number>(0);
  const tickRef = useRef(0);

  // Camera state
  const cameraRef = useRef({ ox: 0, oy: 0, zoom: 1 });

  // Current canvas CSS size (updated every frame)
  const csRef = useRef({ w: 800, h: 600 });

  // External fit trigger
  const autoFitRef = useRef<(() => void) | null>(null);

  // Interaction state
  const dragNodeRef = useRef<SimNode | null>(null);
  const panRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const hoverNodeRef = useRef<SimNode | null>(null);

  // Colour cache (re-resolved on theme change)
  const colorsRef = useRef<Map<string, string>>(new Map());

  const resolveColors = useCallback(() => {
    const map = new Map<string, string>();
    for (const key of Object.keys(TYPE_CSS_VAR)) {
      map.set(key, nodeColor(key));
    }
    colorsRef.current = map;
  }, []);

  useImperativeHandle(ref, () => ({
    fit: () => autoFitRef.current?.(),
  }));

  /* ── initialise simulation data ── */
  useEffect(() => {
    resolveColors();
    const simNodes: SimNode[] = nodes.map((n) => ({
      ...n,
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
      pinned: false,
    }));
    simNodesRef.current = simNodes;
    edgesRef.current = edges;
    tickRef.current = 0;
  }, [nodes, edges, resolveColors]);

  /* ── observe theme changes for colour refresh ── */
  useEffect(() => {
    const obs = new MutationObserver(() => resolveColors());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, [resolveColors]);

  /* ── force simulation + render loop ── */
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    const borderColor = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#ccc';
    const inkColor = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim() || '#333';
    const paperColor = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim() || '#fff';

    // Build adjacency for quick lookup
    const adjacency = new Map<string, Set<string>>();
    const buildAdj = () => {
      adjacency.clear();
      for (const e of edgesRef.current) {
        if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
        if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
        adjacency.get(e.source)!.add(e.target);
        adjacency.get(e.target)!.add(e.source);
      }
    };
    buildAdj();

    // Index for edge lookup
    const nodeIndex = new Map<string, SimNode>();
    const rebuildIndex = () => {
      nodeIndex.clear();
      for (const n of simNodesRef.current) nodeIndex.set(n.id, n);
    };
    rebuildIndex();

    function simulate() {
      const snodes = simNodesRef.current;
      const sedges = edgesRef.current;
      if (snodes.length === 0) return;

      const tick = tickRef.current++;
      const alpha = tick < 200 ? Math.max(0.01, 1 - tick / 200) : 0.01;

      const repulse = 3000 * alpha;
      for (let i = 0; i < snodes.length; i++) {
        for (let j = i + 1; j < snodes.length; j++) {
          const a = snodes[i], b = snodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 1) dist = 1;
          const force = repulse / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.fx -= fx;
          a.fy -= fy;
          b.fx += fx;
          b.fy += fy;
        }
      }

      const springK = 0.05 * alpha;
      const restLen = 100;
      for (const e of sedges) {
        const a = nodeIndex.get(e.source);
        const b = nodeIndex.get(e.target);
        if (!a || !b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - restLen;
        const fx = (dx / dist) * displacement * springK;
        const fy = (dy / dist) * displacement * springK;
        a.fx += fx;
        a.fy += fy;
        b.fx -= fx;
        b.fy -= fy;
      }

      const gravity = 0.02 * alpha;
      for (const n of snodes) {
        n.fx -= n.x * gravity;
        n.fy -= n.y * gravity;
      }

      const damping = 0.85;
      for (const n of snodes) {
        if (n.pinned) {
          n.fx = 0;
          n.fy = 0;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx = (n.vx + n.fx) * damping;
        n.vy = (n.vy + n.fy) * damping;
        n.x += n.vx;
        n.y += n.vy;
        n.fx = 0;
        n.fy = 0;
      }
    }

    function render() {
      // Read actual CSS size every frame — canvas fills container via CSS
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;
      csRef.current = { w: cw, h: ch };

      const dpr = window.devicePixelRatio || 1;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = paperColor();
      ctx.fillRect(0, 0, cw, ch);

      const cam = cameraRef.current;
      ctx.save();
      ctx.translate(cw / 2 + cam.ox, ch / 2 + cam.oy);
      ctx.scale(cam.zoom, cam.zoom);

      const snodes = simNodesRef.current;
      const sedges = edgesRef.current;
      const hov = hoverNodeRef.current;
      const hovNeighbors = hov ? adjacency.get(hov.id) : null;

      // Draw edges
      const bCol = borderColor();
      for (const e of sedges) {
        const a = nodeIndex.get(e.source);
        const b = nodeIndex.get(e.target);
        if (!a || !b) continue;

        const isHighlighted =
          hov && (a.id === hov.id || b.id === hov.id);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = isHighlighted ? inkColor() : bCol;
        ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
        ctx.globalAlpha = hov ? (isHighlighted ? 0.8 : 0.15) : 0.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Draw nodes
      for (const n of snodes) {
        const r = nodeRadius(n.linkCount);
        const isHov = hov?.id === n.id;
        const isNeighbor = hovNeighbors?.has(n.id);
        const dimmed = hov && !isHov && !isNeighbor;

        const isTask = n.id.startsWith('task:');
        ctx.fillStyle = isTask ? '#e879f9' : (colorsRef.current.get(n.type) ?? '#888');
        ctx.globalAlpha = dimmed ? 0.2 : 1;

        if (isTask) {
          // Diamond shape for tasks
          const s = r * 1.3;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y - s);
          ctx.lineTo(n.x + s, n.y);
          ctx.lineTo(n.x, n.y + s);
          ctx.lineTo(n.x - s, n.y);
          ctx.closePath();
          ctx.fill();
          if (isHov) { ctx.strokeStyle = inkColor(); ctx.lineWidth = 2; ctx.stroke(); }
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fill();
          if (isHov) { ctx.strokeStyle = inkColor(); ctx.lineWidth = 2; ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
      }

      // Draw label on hover
      if (hov) {
        const r = nodeRadius(hov.linkCount);
        const label = hov.title;
        ctx.font = `${Math.round(11 / cam.zoom)}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'system-ui'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const metrics = ctx.measureText(label);
        const pad = 4 / cam.zoom;
        const boxW = metrics.width + pad * 2;
        const boxH = 16 / cam.zoom;
        const boxX = hov.x - boxW / 2;
        const boxY = hov.y - r - 6 / cam.zoom - boxH;

        ctx.fillStyle = paperColor();
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 3 / cam.zoom);
        ctx.fill();
        ctx.strokeStyle = bCol;
        ctx.lineWidth = 0.5 / cam.zoom;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = inkColor();
        ctx.fillText(label, hov.x, hov.y - r - 6 / cam.zoom);
      }

      ctx.restore();

      // Legend / stats in corner
      ctx.font = '10px system-ui';
      ctx.fillStyle = inkColor();
      ctx.globalAlpha = 0.4;
      ctx.textAlign = 'left';
      ctx.fillText(`${snodes.length} nodes  ${sedges.length} edges`, 8, ch - 8);
      ctx.globalAlpha = 1;
    }

    let running = true;
    let fitted = false;

    function autoFit() {
      const snodes = simNodesRef.current;
      if (snodes.length === 0) return;
      const { w, h } = csRef.current;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of snodes) {
        const r = nodeRadius(n.linkCount);
        if (n.x - r < minX) minX = n.x - r;
        if (n.x + r > maxX) maxX = n.x + r;
        if (n.y - r < minY) minY = n.y - r;
        if (n.y + r > maxY) maxY = n.y + r;
      }
      const gw = maxX - minX || 1;
      const gh = maxY - minY || 1;
      const padding = 80;
      const zoom = Math.min((w - padding * 2) / gw, (h - padding * 2) / gh, 1.2);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      cameraRef.current.zoom = zoom;
      cameraRef.current.ox = -cx * zoom;
      cameraRef.current.oy = -cy * zoom;
    }

    function loop() {
      if (!running) return;
      const tick = tickRef.current;
      if (tick < 200 || tick % 4 === 0) {
        simulate();
      }
      if (!fitted && tick >= 200) {
        fitted = true;
        autoFit();
      }
      render();
      rafRef.current = requestAnimationFrame(loop);
    }

    autoFitRef.current = autoFit;
    rebuildIndex();
    buildAdj();
    loop();

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [nodes, edges, resolveColors]);

  /* ── screen → world coords ── */
  const screenToWorld = useCallback(
    (sx: number, sy: number): [number, number] => {
      const cam = cameraRef.current;
      const { w, h } = csRef.current;
      const wx = (sx - w / 2 - cam.ox) / cam.zoom;
      const wy = (sy - h / 2 - cam.oy) / cam.zoom;
      return [wx, wy];
    },
    [],
  );

  const findNodeAt = useCallback(
    (sx: number, sy: number): SimNode | null => {
      const [wx, wy] = screenToWorld(sx, sy);
      for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
        const n = simNodesRef.current[i];
        const r = nodeRadius(n.linkCount);
        const dx = n.x - wx;
        const dy = n.y - wy;
        if (n.id.startsWith('task:')) {
          const s = r * 1.3 + 4;
          if (Math.abs(dx) + Math.abs(dy) <= s) return n;
        } else {
          if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return n;
        }
      }
      return null;
    },
    [screenToWorld],
  );

  /* ── pointer events ── */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const node = findNodeAt(sx, sy);
      if (node) {
        dragNodeRef.current = node;
        node.pinned = true;
      } else {
        panRef.current = {
          sx: e.clientX,
          sy: e.clientY,
          cx: cameraRef.current.ox,
          cy: cameraRef.current.oy,
        };
      }
    },
    [findNodeAt],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (dragNodeRef.current) {
        const [wx, wy] = screenToWorld(sx, sy);
        dragNodeRef.current.x = wx;
        dragNodeRef.current.y = wy;
        dragNodeRef.current.vx = 0;
        dragNodeRef.current.vy = 0;
        tickRef.current = Math.min(tickRef.current, 150);
        return;
      }

      if (panRef.current) {
        cameraRef.current.ox = panRef.current.cx + (e.clientX - panRef.current.sx);
        cameraRef.current.oy = panRef.current.cy + (e.clientY - panRef.current.sy);
        return;
      }

      // Hover detection
      const node = findNodeAt(sx, sy);
      hoverNodeRef.current = node;
      canvasRef.current!.style.cursor = node ? 'pointer' : 'grab';
    },
    [findNodeAt, screenToWorld],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragNodeRef.current) {
        const node = dragNodeRef.current;
        dragNodeRef.current.pinned = false;
        dragNodeRef.current = null;

        const rect = canvasRef.current!.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const hit = findNodeAt(sx, sy);
        if (hit && hit.id === node.id && onNodeClick) {
          onNodeClick(node.id);
        }
        return;
      }
      panRef.current = null;
    },
    [findNodeAt, onNodeClick],
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const { w, h } = csRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(5, Math.max(0.1, cam.zoom * factor));

    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = w / 2 + cam.ox;
    const cy = h / 2 + cam.oy;

    cam.ox += (mx - cx) * (1 - factor);
    cam.oy += (my - cy) * (1 - factor);
    cam.zoom = newZoom;
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverNodeRef.current = null;
    if (dragNodeRef.current) {
      dragNodeRef.current.pinned = false;
      dragNodeRef.current = null;
    }
    panRef.current = null;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onMouseLeave={handleMouseLeave}
    />
  );
});
