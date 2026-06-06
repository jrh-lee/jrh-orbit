import { useState, useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PmNode } from '@tiptap/pm/model';
import katex from 'katex';

interface MathEditorProps {
  editor: Editor;
  node: PmNode;
  pos: number;
  onClose: () => void;
}

export function MathEditor({ editor, node, pos, onClose }: MathEditorProps) {
  const [latex, setLatex] = useState(node.attrs.latex ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const isBlock = node.type.name === 'blockMath';

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!previewRef.current) return;
    try {
      katex.render(latex || '\\text{...}', previewRef.current, {
        displayMode: isBlock,
        throwOnError: false,
      });
    } catch {
      previewRef.current.textContent = latex;
    }
  }, [latex, isBlock]);

  const apply = () => {
    if (!latex.trim()) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    } else {
      const { tr } = editor.state;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex });
      editor.view.dispatch(tr);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      apply();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-paper-soft shrink-0">
      <span className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">
        {isBlock ? 'Block' : 'Inline'} Math
      </span>
      <textarea
        ref={inputRef}
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        className="flex-1 px-2 py-1 text-xs font-mono rounded border border-border bg-paper text-ink focus:outline-none focus:border-chrome resize-none"
        placeholder="LaTeX expression..."
      />
      <div
        ref={previewRef}
        className="px-2 py-0.5 text-sm min-w-[40px] text-center"
      />
      <button
        onClick={apply}
        className="px-2 py-0.5 text-[10px] rounded bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors"
      >
        Apply
      </button>
      <button
        onClick={() => {
          editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
          onClose();
        }}
        className="px-2 py-0.5 text-[10px] rounded text-red-400 hover:bg-red-500/10 transition-colors"
      >
        Delete
      </button>
      <button
        onClick={onClose}
        className="px-1.5 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-muted/50 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
