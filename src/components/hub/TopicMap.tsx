import { useMemo } from 'react';
import type { TopicEntry } from '../../types/dataFiles';
import type { TopicLink } from '../../stores/useHubStore';

interface Props {
  topics: TopicEntry[];
  topicLinks: TopicLink[];
  onOpenTopic: (name: string) => void;
}

interface NodePos {
  x: number;
  y: number;
  name: string;
  noteCount: number;
}

export function TopicMap({ topics, topicLinks, onOpenTopic }: Props) {
  const nodes = useMemo(() => {
    if (topics.length === 0) return [];
    const cx = 200;
    const cy = 120;
    const r = Math.min(80, 30 + topics.length * 10);

    return topics.map((t, i): NodePos => {
      const angle = (2 * Math.PI * i) / topics.length - Math.PI / 2;
      return {
        x: topics.length === 1 ? cx : cx + r * Math.cos(angle),
        y: topics.length === 1 ? cy : cy + r * Math.sin(angle),
        name: t.name,
        noteCount: t.note_count,
      };
    });
  }, [topics]);

  if (topics.length === 0) return null;

  const nodeMap = new Map(nodes.map((n) => [n.name, n]));

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink px-3 mb-2">토픽 맵</h2>
      <div className="px-3">
        <svg
          viewBox="0 0 400 240"
          className="w-full max-w-md border border-border rounded-lg bg-paper-soft"
        >
          {topicLinks.map((link, i) => {
            const from = nodeMap.get(link.from);
            const to = nodeMap.get(link.to);
            if (!from || !to) return null;
            return (
              <line
                key={i}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--color-border)"
                strokeWidth={Math.min(3, 1 + link.noteCount * 0.5)}
                strokeDasharray="4 2"
              />
            );
          })}

          {nodes.map((node) => (
            <g
              key={node.name}
              className="cursor-pointer"
              onClick={() => onOpenTopic(node.name)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={Math.min(30, 18 + node.noteCount * 2)}
                fill="var(--color-chrome)"
                fillOpacity={0.15}
                stroke="var(--color-chrome)"
                strokeOpacity={0.4}
                strokeWidth={1.5}
              />
              <text
                x={node.x}
                y={node.y - 4}
                textAnchor="middle"
                className="text-[10px] fill-ink font-medium"
                style={{ pointerEvents: 'none' }}
              >
                {node.name.length > 8 ? node.name.slice(0, 8) + '…' : node.name}
              </text>
              <text
                x={node.x}
                y={node.y + 10}
                textAnchor="middle"
                className="text-[9px] fill-ink-3"
                style={{ pointerEvents: 'none' }}
              >
                {node.noteCount}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
