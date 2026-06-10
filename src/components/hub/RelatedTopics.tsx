import type { TopicEntry } from '../../types/dataFiles';

interface Props {
  topics: TopicEntry[];
  onOpenTopic: (name: string) => void;
}

export function RelatedTopics({ topics, onOpenTopic }: Props) {
  if (topics.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink px-3 mb-2">관련 토픽</h2>
      <div className="flex flex-wrap gap-1.5 px-3">
        {topics.map((t) => (
          <button
            key={t.name}
            onClick={() => onOpenTopic(t.name)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-paper-muted/50 transition-colors"
          >
            <span className="text-[10px]">📂</span>
            <span className="text-ink">{t.name}</span>
            <span className="text-[10px] text-ink-3">({t.note_count})</span>
          </button>
        ))}
      </div>
    </section>
  );
}
