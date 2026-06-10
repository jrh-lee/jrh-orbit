import type { DDayItem } from '../../stores/useHubStore';

interface Props {
  milestones: DDayItem[];
}

function calcDDay(targetDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate + 'T00:00:00');
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'D-Day';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

export function MilestoneBar({ milestones }: Props) {
  if (milestones.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink px-3 mb-2">마일스톤</h2>
      <div className="flex flex-wrap gap-2 px-3">
        {milestones.map((m) => {
          const dd = calcDDay(m.targetDate);
          const isPast = dd.startsWith('D+');
          return (
            <div
              key={m.id}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                isPast ? 'border-ink-3/20 text-ink-3' : 'border-chrome/30 text-ink'
              }`}
            >
              <span className="font-medium">{dd}</span>
              <span>{m.name}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
