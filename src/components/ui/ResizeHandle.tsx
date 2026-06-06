import { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  onResize: (delta: number) => void;
  direction?: 'horizontal' | 'vertical';
}

export function ResizeHandle({ onResize, direction = 'horizontal' }: ResizeHandleProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

      function onMove(ev: MouseEvent) {
        if (!dragging.current) return;
        const pos = direction === 'horizontal' ? ev.clientX : ev.clientY;
        const delta = pos - lastPos.current;
        lastPos.current = pos;
        onResize(delta);
      }

      function onUp() {
        dragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }

      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [onResize, direction],
  );

  const isH = direction === 'horizontal';

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`shrink-0 ${
        isH ? 'w-1 cursor-col-resize hover:bg-chrome/30' : 'h-1 cursor-row-resize hover:bg-chrome/30'
      } transition-colors group relative`}
    >
      <div
        className={`absolute ${
          isH
            ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full'
            : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-0.5 w-6 rounded-full'
        } opacity-0 group-hover:opacity-100 bg-chrome/50 transition-all`}
      />
    </div>
  );
}
