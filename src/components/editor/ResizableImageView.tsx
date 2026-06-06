import { useRef, useState, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';

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

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);
  const [hovered, setHovered] = useState(false);

  const align: TextAlign = node.attrs.textAlign ?? 'center';
  const caption: string = node.attrs.caption ?? '';

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

  const showControls = selected || hovered;

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
        </div>

        {/* ── Image ── */}
        <img
          ref={imgRef}
          src={node.attrs.src}
          alt={node.attrs.alt ?? ''}
          title={node.attrs.title ?? undefined}
          className={`resizable-image-img ${selected ? 'selected' : ''} ${resizing ? 'resizing' : ''}`}
          style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined }}
          draggable={false}
        />

        {/* ── Resize handles ── */}
        <div
          onMouseDown={handleResizeRight}
          className={`image-resize-handle image-resize-handle--right ${showControls ? 'visible' : ''}`}
        />
        <div
          onMouseDown={handleResizeLeft}
          className={`image-resize-handle image-resize-handle--left ${showControls ? 'visible' : ''}`}
        />

        {/* ── Caption ── */}
        <input
          type="text"
          className="image-caption-input"
          placeholder="Add a caption..."
          value={caption}
          onChange={(e) => updateAttributes({ caption: e.target.value })}
          onKeyDown={(e) => {
            // Prevent editor key bindings from firing inside the caption
            e.stopPropagation();
          }}
        />
      </div>
    </NodeViewWrapper>
  );
}
