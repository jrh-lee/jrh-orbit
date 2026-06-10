import type { TopicEntry } from '../../types/dataFiles';

interface Props {
  meta: TopicEntry;
  noteCount: number;
  onBack?: () => void;
}

export function TopicHeader({ meta, noteCount, onBack }: Props) {
  return (
    <div className="px-6 py-4 border-b border-border bg-paper-soft">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-paper-muted/50 transition-colors text-ink-3 hover:text-ink shrink-0"
            title="뒤로 가기"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <span className="text-2xl">📂</span>
        <div>
          <h1 className="text-lg font-semibold text-ink">{meta.name}</h1>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-3">
            <span>🛰️ {meta.project}</span>
            {meta.subsystem && <span>⚙️ {meta.subsystem}</span>}
            <span>📄 {noteCount}개 노트</span>
            <span>📅 {meta.created} ~ {meta.last_used}</span>
          </div>
        </div>
      </div>
      {meta.keywords.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {meta.keywords.map((kw) => (
            <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded-full bg-chrome/15 text-ink-2">
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
