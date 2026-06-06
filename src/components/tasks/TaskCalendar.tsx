import { useMemo } from 'react';
import type { Task } from '../../types/task';

const CELL = 11;
const GAP = 2;
const WEEKS = 20;
const DAYS = 7;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(d);
  start.setDate(start.getDate() - diff);
  return start;
}

function getColor(count: number): string {
  if (count === 0) return 'var(--color-paper-muted)';
  if (count <= 1) return 'var(--color-pastel-mint)';
  if (count <= 3) return 'var(--color-chrome)';
  return 'var(--color-pastel-lavender)';
}

export function TaskCalendar({ tasks }: { tasks: Task[] }) {
  const { grid, months } = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const t of tasks) {
      const key = t.dueDate ?? t.createdAt?.slice(0, 10);
      if (key) countMap.set(key, (countMap.get(key) ?? 0) + 1);
      if (t.subtasks) {
        for (const st of t.subtasks) {
          const sk = st.dueDate ?? t.createdAt?.slice(0, 10);
          if (sk) countMap.set(sk, (countMap.get(sk) ?? 0) + 1);
        }
      }
    }

    const today = new Date();
    const endWeekStart = getWeekStart(today);
    const startDate = new Date(endWeekStart);
    startDate.setDate(startDate.getDate() - (WEEKS - 1) * 7);

    const cells: { date: string; count: number; col: number; row: number }[] = [];
    const monthLabels: { label: string; col: number }[] = [];
    let lastMonth = -1;

    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < DAYS; d++) {
        const cellDate = new Date(startDate);
        cellDate.setDate(cellDate.getDate() + w * 7 + d);
        if (cellDate > today) continue;
        const key = dateKey(cellDate);
        cells.push({ date: key, count: countMap.get(key) ?? 0, col: w, row: d });

        const m = cellDate.getMonth();
        if (m !== lastMonth && d === 0) {
          monthLabels.push({ label: cellDate.toLocaleDateString('en', { month: 'short' }), col: w });
          lastMonth = m;
        }
      }
    }
    return { grid: cells, months: monthLabels };
  }, [tasks]);

  const labelW = 24;
  const svgW = labelW + WEEKS * (CELL + GAP);
  const svgH = 12 + DAYS * (CELL + GAP);

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} className="block">
        {months.map((m, i) => (
          <text key={i} x={labelW + m.col * (CELL + GAP)} y={8} className="fill-ink-3" fontSize="9" fontFamily="inherit">
            {m.label}
          </text>
        ))}
        {DAY_LABELS.map((l, i) => (
          l ? <text key={i} x={0} y={12 + i * (CELL + GAP) + CELL - 1} className="fill-ink-3" fontSize="8" fontFamily="inherit">{l}</text> : null
        ))}
        {grid.map((c) => (
          <rect
            key={c.date}
            x={labelW + c.col * (CELL + GAP)}
            y={12 + c.row * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={2}
            fill={getColor(c.count)}
            opacity={c.count === 0 ? 0.5 : 1}
          >
            <title>{c.date}: {c.count} task{c.count !== 1 ? 's' : ''}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
