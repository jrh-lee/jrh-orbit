import { useState } from 'react';
import type { TimelineEntry } from '../../stores/useHubStore';
import { TimelineItem } from './shared/TimelineItem';

interface Props {
  entries: TimelineEntry[];
  onOpen: (path: string) => void;
}

const PAGE_SIZE = 30;

export function ProjectTimeline({ entries, onOpen }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, PAGE_SIZE);

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink px-3 mb-2">
        프로젝트 타임라인 <span className="text-ink-3 font-normal">({entries.length})</span>
      </h2>
      {visible.length === 0 ? (
        <p className="text-xs text-ink-3 px-3">항목이 없습니다.</p>
      ) : (
        <div className="space-y-0.5">
          {visible.map((e, i) => (
            <TimelineItem key={`${e.noteId}-${i}`} entry={e} showTopic onOpen={onOpen} />
          ))}
        </div>
      )}
      {!showAll && entries.length > PAGE_SIZE && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[11px] text-chrome hover:underline px-3 mt-2"
        >
          + {entries.length - PAGE_SIZE}개 더 보기
        </button>
      )}
    </section>
  );
}
