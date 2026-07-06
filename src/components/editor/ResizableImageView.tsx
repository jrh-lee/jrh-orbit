import { useRef, useState, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';

const ALIGN_OPTIONS = [
  { value: 'left', icon: 'align-left', title: 'Align left' },
  { value: 'center', icon: 'align-center', title: 'Align center' },
  { value: 'right', icon: 'align-right', title: 'Align right' },
] as const;

type TextAlign = 'left' | 'center' | 'right';

/* Minimal inline SVG alignment icons (16x16) */
function AlignIcon({ type }: { type: TextAlign }) {
  const lines: [number, number][] =
    type === 'left'
      ? [[2, 14], [2, 10], [2, 14], [2, 10]]
      : type === 'right'
        ? [[2, 14], [6, 14], [2, 14], [6, 14]]
        : [[2, 14], [4, 12], [2, 14], [4, 12]];
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1={lines[0][0]} y1="3" x2={lines[0][1]} y2="3" />
      <line x1={lines[1][0]} y1="7" x2={lines[1][1]} y2="7" />
      <line x1={lines[2][0]} y1="11" x2={lines[2][1]} y2="11" />
    </svg>
  );
}

export function ResizableImageView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  // `selected` is true whenever the selection RANGE covers this image — e.g.
  // selecting a list item that contains it. Only show the selected style when
  // the image itself is the node selection.
  const isDirectlySelected = selected && (() => {
    try {
      const sel = editor.state.selection;
      return sel instanceof NodeSelection && sel.from === getPos();
    } catch { return false; }
  })();
  const imgRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [captionOpen, setCaptionOpen] = useState(false);

  const align: TextAlign = node.attrs.textAlign ?? 'center';
  const caption: string = node.attrs.caption ?? '';
  // Caption input is opt-in: shown only when a caption exists or the user opened it
  const showCaption = captionOpen || caption.length > 0;

  /* ── Right-corner resize ── */
  const handleResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = imgRef.current?.offsetWidth ?? 200;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(80, startWidth + (ev.clientX - startX));
      updateAttributes({ width: newWidth });
    };
    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [updateAttributes]);

  /* ── Left-corner resize ── */
  const handleResizeLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = imgRef.current?.offsetWidth ?? 200;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(80, startWidth - (ev.clientX - startX));
      updateAttributes({ width: newWidth });
    };
    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [updateAttributes]);

  const showControls = isDirectlySelected || hovered;

  return (
    <NodeViewWrapper
      className="resizable-image-wrapper"
      style={{ textAlign: align }}
      data-drag-handle
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="resizable-image-inner"
        style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined }}
      >
        {/* ── Alignment toolbar ── */}
        <div className={`image-align-toolbar ${showControls ? 'visible' : ''}`}>
          {ALIGN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={opt.title}
              className={`image-align-btn ${align === opt.value ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                updateAttributes({ textAlign: opt.value });
              }}
            >
              <AlignIcon type={opt.value} />
            </button>
          ))}
          <button
            type="button"
            title={showCaption ? '캡션 제거' : '캡션 추가'}
            className={`image-align-btn ${showCaption ? 'active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (showCaption) {
                setCaptionOpen(false);
                updateAttributes({ caption: '' });
              } else {
                setCaptionOpen(true);
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="2" y="3" width="12" height="8" rx="1" />
              <line x1="4" y1="14" x2="12" y2="14" />
            </svg>
          </button>
        </div>

        {/* ── Image ── */}
        {loadError ? (
          <div
            className="flex flex-col items-center justify-center gap-1.5 py-4 px-3 rounded bg-paper-muted/50 border border-border/50 text-ink-3"
            style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
              <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="text-[11px]">이미지를 불러올 수 없습니다</span>
            <span className="text-[9px] text-ink-3/70 max-w-full truncate px-2" title={node.attrs.src ?? ''}>
              {(node.attrs.src ?? '').startsWith('data:') ? '(내장 이미지 데이터 손상)' : (node.attrs.src ?? '(경로 없음)')}
            </span>
            <button
              className="px-2 py-0.5 text-[10px] rounded border border-border text-ink-3 hover:text-ink-2 hover:bg-paper-muted transition-colors"
              onClick={(e) => { e.preventDefault(); setLoadError(false); setRetryKey(k => k + 1); }}
            >
              다시 시도
            </button>
          </div>
        ) : (
          <img
            key={retryKey}
            ref={imgRef}
            src={node.attrs.src}
            alt={node.attrs.alt ?? ''}
            title={node.attrs.title ?? undefined}
            className={`resizable-image-img ${isDirectlySelected ? 'selected' : ''} ${resizing ? 'resizing' : ''}`}
            style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined }}
            draggable={false}
            onError={() => setLoadError(true)}
          />
        )}

        {/* ── Resize handles ── */}
        <div
          onMouseDown={handleResizeRight}
          className={`image-resize-handle image-resize-handle--right ${showControls ? 'visible' : ''}`}
        />
        <div
          onMouseDown={handleResizeLeft}
          className={`image-resize-handle image-resize-handle--left ${showControls ? 'visible' : ''}`}
        />

        {/* ── Caption (opt-in via toolbar button) ── */}
        {showCaption && (
          <input
            type="text"
            className="image-caption-input"
            placeholder="캡션 입력..."
            value={caption}
            autoFocus={captionOpen && caption.length === 0}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
            onBlur={() => {
              if (!caption.trim()) setCaptionOpen(false);
            }}
            onKeyDown={(e) => {
              // Prevent editor key bindings from firing inside the caption
              e.stopPropagation();
            }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}
