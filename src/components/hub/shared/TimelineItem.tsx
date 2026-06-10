import type { TimelineEntry } from '../../../stores/useHubStore';
import { NOTE_TYPE_ICONS } from '../../../types/note';

const TYPE_ICON: Record<string, string> = {
  ...NOTE_TYPE_ICONS,
  'daily-inline': '📋',
};

interface Props {
  entry: TimelineEntry;
  showTopic?: boolean;
  onOpen: (path: string) => void;
}

export function TimelineItem({ entry, showTopic, onOpen }: Props) {
  const icon = TYPE_ICON[entry.type] || '📄';

  return (
    <button
      onClick={() => onOpen(entry.notePath)}
      className="w-full flex items-start gap-2 px-3 py-2 text-left rounded-lg hover:bg-paper-muted/50 transition-colors group"
    >
      <span className="text-xs mt-0.5 shrink-0 opacity-70">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-3 shrink-0">{entry.date}</span>
          {showTopic && entry.topicName && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-chrome/20 text-ink-2 truncate max-w-[120px]"
              style={entry.topicColor ? { backgroundColor: entry.topicColor + '30' } : undefined}
            >
              {entry.topicName}
            </span>
          )}
        </div>
        <div className="text-xs text-ink truncate group-hover:text-ink font-medium">
          {entry.title}
        </div>
        {entry.summary && (
          <div className="text-[11px] text-ink-3 truncate mt-0.5">
            {entry.summary}
          </div>
        )}
      </div>
    </button>
  );
}
