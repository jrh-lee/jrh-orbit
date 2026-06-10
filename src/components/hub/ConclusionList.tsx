import { useState } from 'react';
import type { ConclusionEntry } from '../../stores/useHubStore';

interface Props {
  conclusions: ConclusionEntry[];
  onOpen: (path: string) => void;
}

export function ConclusionList({ conclusions, onOpen }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? conclusions : conclusions.slice(0, 10);

  if (conclusions.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink px-3 mb-2">핵심 결론</h2>
      <div className="space-y-1">
        {visible.map((c, i) => (
          <button
            key={`${c.noteId}-${i}`}
            onClick={() => onOpen(c.notePath)}
            className="w-full flex items-start gap-2 px-3 py-1.5 text-left rounded-lg hover:bg-paper-muted/50 transition-colors group"
          >
            <span className="text-[10px] text-ink-3 mt-0.5 shrink-0">•</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-ink leading-relaxed">{c.text}</div>
              <span className="text-[10px] text-ink-3">{c.date}</span>
            </div>
          </button>
        ))}
      </div>
      {!showAll && conclusions.length > 10 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[11px] text-chrome hover:underline px-3 mt-2"
        >
          + {conclusions.length - 10}개 더 보기
        </button>
      )}
    </section>
  );
}
