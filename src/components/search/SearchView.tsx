import { useState, useEffect, useRef, useCallback } from 'react';
import { searchNotes, type SearchResult } from '../../lib/db';
import { useAppStore } from '../../stores/useAppStore';

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function noteTypeBadge(noteType: string) {
  const isDaily = noteType === 'daily';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
        isDaily
          ? 'bg-pastel-peach/40 text-ink-2'
          : 'bg-pastel-lavender/40 text-ink-2'
      }`}
    >
      {isDaily ? 'Daily' : 'Research'}
    </span>
  );
}

export function SearchView() {
  const { setView, openNote } = useAppStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await searchNotes(q);
      setResults(res);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInputChange(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(value), 300);
  }

  function handleResultClick(result: SearchResult) {
    if (result.noteType === 'daily') {
      setView('daily');
    } else {
      openNote(result.path);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border bg-paper shrink-0 relative z-10">
        <div className="relative max-w-xl">
          <svg
            width="16"
            height="16"
            viewBox="0 0 18 18"
            fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          >
            <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M12 12l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search all notes..."
            className="w-full pl-9 pr-4 py-2 mb-1 text-sm text-ink bg-paper-soft border border-border rounded-lg outline-none placeholder:text-ink-3 focus:border-chrome transition-colors"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-3.5 h-3.5 border-2 border-ink-3/30 border-t-ink-2 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {!searched && !query.trim() && (
          <div className="flex flex-col items-center justify-center h-full text-ink-3">
            <svg
              width="40"
              height="40"
              viewBox="0 0 18 18"
              fill="none"
              className="mb-3 opacity-30"
            >
              <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1" />
              <path d="M12 12l4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
            <p className="text-sm">Type to search across all notes</p>
          </div>
        )}

        {searched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-ink-3">
            <p className="text-sm">No results found</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="max-w-xl space-y-1">
            <p className="text-[10px] text-ink-3 uppercase tracking-wider mb-2">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </p>
            {results.map((result, idx) => (
              <button
                key={`${result.path}-${idx}`}
                onClick={() => handleResultClick(result)}
                className="w-full text-left px-3 py-2 rounded-lg border border-transparent hover:border-border hover:bg-paper-soft transition-colors group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-ink truncate">
                    {result.title}
                  </span>
                  {noteTypeBadge(result.noteType)}
                </div>
                {result.snippet && (
                  <p
                    className="text-xs text-ink-2 line-clamp-2 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: result.snippet }}
                  />
                )}
                {result.updated && (
                  <p className="text-[10px] text-ink-3 mt-1">
                    {formatDate(result.updated)}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
