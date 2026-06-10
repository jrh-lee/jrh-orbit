import type { TimelineEntry } from '../../stores/useHubStore';
import { TimelineItem } from './shared/TimelineItem';

interface Props {
  decisions: TimelineEntry[];
  onOpen: (path: string) => void;
}

export function DecisionList({ decisions, onOpen }: Props) {
  if (decisions.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink px-3 mb-2">
        주요 의사결정 <span className="text-ink-3 font-normal">({decisions.length})</span>
      </h2>
      <div className="space-y-0.5">
        {decisions.map((e, i) => (
          <TimelineItem key={`${e.noteId}-${i}`} entry={e} showTopic onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
