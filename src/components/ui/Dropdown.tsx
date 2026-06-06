import { useState, useRef, useEffect, useCallback } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  color?: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

export function Dropdown({ value, options, onChange, placeholder = 'Select...', className = '', compact = false }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setFocusIdx(idx + 1);
    }
  }, [open, options, value]);

  const allItems = [{ value: '', label: placeholder }, ...options];

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusIdx >= 0 && focusIdx < allItems.length) {
        onChange(allItems[focusIdx].value);
        setOpen(false);
      }
    }
  }, [open, focusIdx, allItems, onChange]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const child = listRef.current.children[focusIdx] as HTMLElement | undefined;
    child?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        data-dropdown-trigger=""
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-paper-soft text-ink hover:border-chrome focus:border-chrome transition-colors whitespace-nowrap ${
          compact ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'
        }`}
      >
        {selected ? (
          <>
            {selected.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />}
            <span className="truncate">{selected.label}</span>
          </>
        ) : (
          <span className="text-ink-3">{placeholder}</span>
        )}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-ink-3 shrink-0">
          <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute top-full left-0 mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg py-0.5 min-w-[110px] max-h-40 overflow-y-auto"
        >
          {allItems.map((o, i) => (
            <button
              type="button"
              key={o.value ?? '__placeholder__'}
              role="option"
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              onMouseEnter={() => setFocusIdx(i)}
              className={`w-full text-left px-2 py-1 text-xs flex items-center gap-1.5 transition-colors ${
                i === focusIdx
                  ? 'bg-chrome/15 text-ink font-medium'
                  : o.value === value
                    ? 'bg-chrome/10 text-ink'
                    : 'text-ink-2 hover:bg-paper-soft'
              }`}
            >
              {'color' in o && o.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
