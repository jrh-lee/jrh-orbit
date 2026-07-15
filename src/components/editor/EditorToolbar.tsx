import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { sanitizeAttachmentSubdir, encodeAttachmentHref } from '../../lib/attachmentUrls';
import type { Editor } from '@tiptap/react';

interface EditorToolbarProps {
  editor: Editor | null;
  /** 첨부파일을 저장할 attachments/ 하위 폴더 (노트 stem 또는 Daily 날짜) */
  attachmentSubdir?: string;
}

interface ToolbarButton {
  label: string;
  icon: string;
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
}

const buttons: ToolbarButton[] = [
  {
    label: 'Bold',
    icon: 'B',
    action: (e) => e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive('bold'),
  },
  {
    label: 'Italic',
    icon: 'I',
    action: (e) => e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive('italic'),
  },
  {
    label: 'Strikethrough',
    icon: 'S',
    action: (e) => e.chain().focus().toggleStrike().run(),
    isActive: (e) => e.isActive('strike'),
  },
  {
    label: 'Underline (Ctrl+U)',
    icon: 'U',
    action: (e) => e.chain().focus().toggleUnderline().run(),
    isActive: (e) => e.isActive('underline'),
  },
  {
    label: 'Code',
    icon: '<>',
    action: (e) => e.chain().focus().toggleCode().run(),
    isActive: (e) => e.isActive('code'),
  },
  {
    label: 'Highlight',
    icon: 'H',
    action: (e) => e.chain().focus().toggleHighlight().run(),
    isActive: (e) => e.isActive('highlight'),
  },
];

const headingButtons: ToolbarButton[] = [
  {
    label: 'Heading 1',
    icon: 'H1',
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    label: 'Heading 2',
    icon: 'H2',
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    label: 'Heading 3',
    icon: 'H3',
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive('heading', { level: 3 }),
  },
];

function toggleTaskInPlace(editor: Editor) {
  const { state, view } = editor;
  const { $from } = state.selection;
  const { schema } = state;

  let itemDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem') {
      itemDepth = d;
      break;
    }
  }

  if (itemDepth < 1) {
    editor.chain().focus().toggleTaskList().run();
    return;
  }

  const listDepth = itemDepth - 1;
  const parentList = $from.node(listDepth);
  const isTask = parentList.type.name === 'taskList';

  const targetListType = isTask ? schema.nodes.bulletList : schema.nodes.taskList;
  const targetItemType = isTask ? schema.nodes.listItem : schema.nodes.taskItem;

  if (!targetListType || !targetItemType) {
    editor.chain().focus().toggleTaskList().run();
    return;
  }

  const listPos = $from.before(listDepth + 1);

  if (parentList.childCount === 1) {
    const tr = state.tr;
    const itemPos = listPos + 1;
    tr.setNodeMarkup(listPos, targetListType);
    tr.setNodeMarkup(tr.mapping.map(itemPos), targetItemType, isTask ? {} : { checked: false });
    view.dispatch(tr.scrollIntoView());
    return;
  }

  const itemStart = $from.before(itemDepth + 1);

  let itemIndex = -1;
  let offset = 0;
  for (let i = 0; i < parentList.childCount; i++) {
    if (listPos + 1 + offset === itemStart) {
      itemIndex = i;
      break;
    }
    offset += parentList.child(i).nodeSize;
  }

  if (itemIndex < 0) {
    editor.chain().focus().toggleTaskList().run();
    return;
  }

  const before: ReturnType<typeof parentList.child>[] = [];
  const after: ReturnType<typeof parentList.child>[] = [];
  let target: ReturnType<typeof parentList.child> | null = null;

  parentList.forEach((child, _offset, i) => {
    if (i < itemIndex) before.push(child);
    else if (i === itemIndex) target = child;
    else after.push(child);
  });

  if (!target) return;

  const nodes: ReturnType<typeof parentList.type.create>[] = [];
  if (before.length > 0) {
    nodes.push(parentList.type.create(parentList.attrs, before));
  }

  const newItem = targetItemType.create(
    isTask ? {} : { checked: false },
    (target as typeof before[0]).content,
    (target as typeof before[0]).marks,
  );
  nodes.push(targetListType.create(null, [newItem]));

  if (after.length > 0) {
    nodes.push(parentList.type.create(parentList.attrs, after));
  }

  const tr = state.tr;
  tr.replaceWith(listPos, listPos + parentList.nodeSize, nodes);
  view.dispatch(tr.scrollIntoView());
}

const blockButtons: ToolbarButton[] = [
  {
    label: 'Bullet list',
    icon: '•',
    action: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    label: 'Ordered list',
    icon: '1.',
    action: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive('orderedList'),
  },
  {
    label: 'Task list',
    icon: '☐',
    action: (e) => toggleTaskInPlace(e),
    isActive: (e) => e.isActive('taskList'),
  },
  {
    label: 'Blockquote',
    icon: '"',
    action: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote'),
  },
  {
    label: 'Code block',
    icon: '{}',
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
    isActive: (e) => e.isActive('codeBlock'),
  },
];

function ToolbarGroup({ items, editor }: { items: ToolbarButton[]; editor: Editor }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {items.map((btn) => (
        <button
          key={btn.label}
          onClick={() => btn.action(editor)}
          title={btn.label}
          className={`px-1.5 py-1 text-xs rounded transition-colors min-w-[24px] ${
            btn.isActive?.(editor)
              ? 'bg-chrome/30 text-ink font-semibold'
              : 'text-ink-2 hover:bg-paper-soft'
          }`}
        >
          {btn.icon}
        </button>
      ))}
    </div>
  );
}

function TableToolbar({ editor }: { editor: Editor }) {
  if (!editor.isActive('table')) return null;

  const autoFitAll = () => {
    const { state, view } = editor;
    const { doc, selection } = state;
    const $pos = doc.resolve(selection.from);
    let tableNode = null;
    let tableStart = 0;
    for (let d = $pos.depth; d >= 0; d--) {
      if ($pos.node(d).type.name === 'table') {
        tableNode = $pos.node(d);
        tableStart = $pos.start(d);
        break;
      }
    }
    if (!tableNode) return;

    const tableDom = view.nodeDOM(tableStart - 1) as HTMLElement | null;
    const tableEl = tableDom?.querySelector('table') as HTMLTableElement | null ?? (tableDom instanceof HTMLTableElement ? tableDom : null);
    if (!tableEl) return;

    const numCols = tableEl.rows[0]?.cells.length ?? 0;
    if (numCols === 0) return;

    const span = document.createElement('span');
    span.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;white-space:nowrap;';
    document.body.appendChild(span);

    const widths: number[] = [];
    for (let c = 0; c < numCols; c++) {
      let maxW = 60;
      for (const row of Array.from(tableEl.rows)) {
        const cell = row.cells[c];
        if (!cell) continue;
        const cs = getComputedStyle(cell);
        span.style.font = cs.font;
        span.style.fontSize = cs.fontSize;
        span.style.fontFamily = cs.fontFamily;
        span.style.fontWeight = cs.fontWeight;
        span.style.letterSpacing = cs.letterSpacing;
        const paras = cell.querySelectorAll('p');
        const elems = paras.length > 0 ? Array.from(paras) : [cell];
        let cellMax = 0;
        for (const el of elems) {
          span.textContent = el.textContent || '';
          cellMax = Math.max(cellMax, span.offsetWidth);
        }
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
                   + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
        maxW = Math.max(maxW, cellMax + pad + 4);
      }
      widths.push(maxW);
    }
    document.body.removeChild(span);

    const tr = state.tr;
    let offset = 0;
    tableNode.forEach((row) => {
      let cellCol = 0;
      let cellOffset = 0;
      row.forEach((cellNode) => {
        const colspan = cellNode.attrs.colspan || 1;
        const cellPos = tableStart + offset + cellOffset + 1;
        const cw: number[] = [];
        for (let i = 0; i < colspan; i++) cw.push(widths[cellCol + i] ?? 60);
        tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, colwidth: cw });
        cellCol += colspan;
        cellOffset += cellNode.nodeSize;
      });
      offset += row.nodeSize;
    });
    view.dispatch(tr);
  };

  const actions = [
    { label: '+ Row', action: () => editor.chain().focus().addRowAfter().run() },
    { label: '+ Col', action: () => editor.chain().focus().addColumnAfter().run() },
    { sep: true },
    { label: '- Row', action: () => editor.chain().focus().deleteRow().run(), danger: true },
    { label: '- Col', action: () => editor.chain().focus().deleteColumn().run(), danger: true },
    { label: '- Table', action: () => editor.chain().focus().deleteTable().run(), danger: true },
    { sep: true },
    { label: 'Merge', action: () => editor.chain().focus().mergeCells().run() },
    { label: 'Split', action: () => editor.chain().focus().splitCell().run() },
    { sep: true },
    { label: 'Auto-fit', action: autoFitAll },
  ] as const;

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {actions.map((a, i) =>
        'sep' in a ? (
          <div key={i} className="w-px h-3 bg-border mx-0.5" />
        ) : (
          <button
            key={a.label}
            onClick={a.action}
            title={a.label}
            className={`px-1 py-0.5 text-[10px] rounded transition-colors whitespace-nowrap ${
              'danger' in a && a.danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-ink-3 hover:bg-paper-soft hover:text-ink-2'
            }`}
          >
            {a.label}
          </button>
        ),
      )}
    </div>
  );
}

function ImageUrlInput({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [url, setUrl] = useState('');
  return (
    <div className="flex items-center gap-1 shrink-0">
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && url.trim()) {
            editor.chain().focus().setImage({ src: url.trim() }).run();
            onClose();
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Paste image URL..."
        className="px-2 py-0.5 text-xs rounded border border-border bg-paper-soft text-ink w-48 focus:outline-none focus:border-chrome placeholder:text-ink-3"
      />
      <button
        onClick={() => {
          if (url.trim()) editor.chain().focus().setImage({ src: url.trim() }).run();
          onClose();
        }}
        className="px-1.5 py-0.5 text-[10px] rounded bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors"
      >
        Insert
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

export const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#e06c75', '#d19a66', '#e5c07b', '#98c379', '#56b6c2', '#61afef', '#c678dd',
  '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a8b', '#1f618d', '#7d3c98',
  '#ffc1d6', '#ffd3b6', '#fff4c0', '#c6ecd7', '#a9cdf5', '#d8cdf5', '#fdff85',
  '#f5b7b1', '#f8c471', '#f9e79f', '#a9dfbf', '#aed6f1', '#d2b4de', '#e8daef',
];

/** 사용자 등록 색상 (HEX) — 테마와 무관하게 유지 */
const CUSTOM_COLORS_KEY = 'orbit-custom-colors';
function loadCustomColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string') : [];
  } catch { return []; }
}
function saveCustomColors(colors: string[]) {
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
}
function normalizeHex(input: string): string | null {
  let v = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(v)) v = v.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return `#${v.toLowerCase()}`;
}

/** Current theme's own colors — lets you paint something the same color the
 *  theme uses by default (table headers, body text, …). Read at open time so
 *  the swatches always match the active theme. */
function getThemeSwatches(): { color: string; label: string }[] {
  const cs = getComputedStyle(document.documentElement);
  const entries: [string, string][] = [
    ['--color-ink', '기본 글자색'],
    ['--color-ink-2', '보조 글자색'],
    ['--color-ink-3', '흐린 글자색'],
    ['--color-highlight', '기본 하이라이트'],
    ['--color-paper-soft', '표 헤더/배경'],
    ['--color-paper-muted', '옅은 배경'],
    ['--color-chrome', '포인트색'],
  ];
  return entries
    .map(([v, label]) => ({ color: cs.getPropertyValue(v).trim(), label }))
    .filter((e) => !!e.color);
}

export function ColorPicker({ anchor, onChange, onClose, label, value }: {
  anchor: HTMLElement | null;
  onChange: (color: string) => void;
  onClose: () => void;
  label: string;
  value: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [custom, setCustom] = useState<string[]>(loadCustomColors);
  const [hexInput, setHexInput] = useState('');
  const [hexError, setHexError] = useState(false);

  const addCustom = (raw: string, apply = true) => {
    const c = normalizeHex(raw);
    if (!c) { setHexError(true); return; }
    setHexError(false);
    const next = [...custom.filter((x) => x !== c), c].slice(-14);
    setCustom(next);
    saveCustomColors(next);
    setHexInput('');
    // 등록+적용하되 창은 유지 — 색을 확정하고 닫는 건 스와치 클릭으로
    if (apply) onChange(c);
  };
  const removeCustom = (c: string) => {
    const next = custom.filter((x) => x !== c);
    setCustom(next);
    saveCustomColors(next);
  };

  // 네이티브 색상 팝업(WebView2)에는 확인 버튼이 없다 — 고르는 색을 실시간으로
  // HEX 입력칸에 동기화하고, 커밋은 우리 피커의 [확인] 버튼으로만 한다.
  // 팝업을 닫으려는 바깥 클릭이 피커 전체를 닫지 않도록 직후 클릭은 무시한다.
  const colorInputRef = useRef<HTMLInputElement>(null);
  const lastDialogInputRef = useRef(0);
  useEffect(() => {
    const el = colorInputRef.current;
    if (!el) return;
    const sync = () => {
      lastDialogInputRef.current = Date.now();
      setHexInput(el.value);
      setHexError(false);
    };
    el.addEventListener('input', sync);
    el.addEventListener('change', sync);
    return () => {
      el.removeEventListener('input', sync);
      el.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const pickerH = 330;
    const pickerW = 192;
    let top = rect.top - 4;
    let left = rect.left;
    if (top - pickerH < 0) {
      top = rect.bottom + 4 + pickerH;
    }
    if (left + pickerW > window.innerWidth) {
      left = window.innerWidth - pickerW - 8;
    }
    if (left < 4) left = 4;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // 색상 팝업을 닫으려는 클릭이 피커 전체를 닫아버리지 않도록,
      // 팝업 조작 직후 1초 안의 바깥 클릭은 무시한다
      if (Date.now() - lastDialogInputRef.current < 1000) return;
      if (ref.current && !ref.current.contains(e.target as Node) &&
          anchor && !anchor.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchor]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] bg-paper border border-border rounded-lg shadow-lg p-2 w-48"
      style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
    >
      <div className="text-[10px] text-ink-3 mb-1">{label}</div>
      <div className="grid grid-cols-7 gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => { onChange(c); onClose(); }}
            className={`w-5 h-5 rounded border transition-transform hover:scale-110 ${
              value === c ? 'border-ink ring-1 ring-chrome' : 'border-border'
            }`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="text-[10px] text-ink-3 mt-1.5 mb-1">테마 색</div>
      <div className="grid grid-cols-7 gap-1">
        {getThemeSwatches().map((s) => (
          <button
            key={s.label}
            title={s.label}
            onClick={() => { onChange(s.color); onClose(); }}
            className="w-5 h-5 rounded border border-border transition-transform hover:scale-110"
            style={{ background: s.color }}
          />
        ))}
      </div>
      <div className="text-[10px] text-ink-3 mt-1.5 mb-1">내 색상 <span className="opacity-60">(우클릭 삭제)</span></div>
      {custom.length > 0 && (
        <div className="grid grid-cols-7 gap-1 mb-1">
          {custom.map((c) => (
            <button
              key={c}
              title={`${c} — 우클릭으로 삭제`}
              onClick={() => { onChange(c); onClose(); }}
              onContextMenu={(e) => { e.preventDefault(); removeCustom(c); }}
              className={`w-5 h-5 rounded border transition-transform hover:scale-110 ${
                value === c ? 'border-ink ring-1 ring-chrome' : 'border-border'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={hexInput}
          onChange={(e) => { setHexInput(e.target.value); setHexError(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(hexInput); } e.stopPropagation(); }}
          placeholder="#HEX 입력"
          spellCheck={false}
          className={`flex-1 min-w-0 text-[10px] px-1.5 py-0.5 rounded border bg-paper text-ink placeholder:text-ink-3 outline-none ${
            hexError ? 'border-red-400' : 'border-border focus:border-chrome'
          }`}
        />
        <label
          className="w-5 h-5 rounded border border-border cursor-pointer overflow-hidden relative shrink-0"
          title="색상 고르기 — 고른 색이 왼쪽 칸에 채워지면 [확인]을 누르세요"
          style={{
            background: normalizeHex(hexInput) ?? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
          }}
        >
          <input
            ref={colorInputRef}
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <button
          onClick={() => addCustom(hexInput)}
          disabled={!normalizeHex(hexInput)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-chrome/60 text-ink font-medium hover:bg-chrome/20 transition-colors shrink-0 disabled:opacity-40 disabled:border-border disabled:font-normal"
        >
          확인
        </button>
      </div>
      <button
        onClick={() => { onChange(''); onClose(); }}
        className="mt-1.5 w-full text-[10px] text-ink-3 hover:text-ink-2 py-0.5 rounded border border-border/60 hover:bg-paper-soft transition-colors"
      >
        기본 (색 지정 해제)
      </button>
    </div>,
    document.body,
  );
}

function TextColorButton({ editor }: { editor: Editor }) {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const color = editor.getAttributes('textStyle')?.color ?? '';
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setShow(!show)}
        title="Text color"
        className="px-1.5 py-1 text-xs rounded transition-colors min-w-[24px] text-ink-2 hover:bg-paper-soft shrink-0"
      >
        <span style={{ borderBottom: `2px solid ${color || 'currentColor'}` }}>A</span>
      </button>
      {show && (
        <ColorPicker
          label="Text color"
          value={color}
          anchor={btnRef.current}
          onChange={(c) => {
            if (c) editor.chain().focus().setColor(c).run();
            else editor.chain().focus().unsetColor().run();
          }}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

function TextHighlightButton({ editor }: { editor: Editor }) {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hlAttrs = editor.getAttributes('highlight');
  const color = hlAttrs?.color ?? '';
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setShow(!show)}
        title="Text background color"
        className="px-1.5 py-1 text-xs rounded transition-colors min-w-[24px] text-ink-2 hover:bg-paper-soft shrink-0"
      >
        <span
          className="px-0.5"
          style={{ background: color || 'var(--color-highlight)' }}
        >A</span>
      </button>
      {show && (
        <ColorPicker
          label="Text background"
          value={color}
          anchor={btnRef.current}
          onChange={(c) => {
            if (c) editor.chain().focus().toggleHighlight({ color: c }).run();
            else editor.chain().focus().unsetHighlight().run();
          }}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

function CellColorButton({ editor }: { editor: Editor }) {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setShow(!show)}
        title="Cell background color"
        className="px-1 py-0.5 text-[10px] rounded transition-colors text-ink-3 hover:bg-paper-soft hover:text-ink-2 shrink-0 whitespace-nowrap"
      >
        Cell BG
      </button>
      {show && (
        <ColorPicker
          label="Cell background"
          value=""
          anchor={btnRef.current}
          onChange={(c) => {
            if (c) editor.chain().focus().setCellAttribute('backgroundColor', c).run();
            else editor.chain().focus().setCellAttribute('backgroundColor', '').run();
          }}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

function AlignButtons({ editor }: { editor: Editor }) {
  const aligns = [
    { icon: '≡L', value: 'left', label: 'Align left' },
    { icon: '≡C', value: 'center', label: 'Align center' },
    { icon: '≡R', value: 'right', label: 'Align right' },
    { icon: '≡J', value: 'justify', label: 'Justify' },
  ] as const;

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {aligns.map((a) => (
        <button
          key={a.value}
          onClick={() => editor.chain().focus().setTextAlign(a.value).run()}
          title={a.label}
          className={`px-1 py-1 text-[10px] rounded transition-colors min-w-[22px] ${
            editor.isActive({ textAlign: a.value })
              ? 'bg-chrome/30 text-ink font-semibold'
              : 'text-ink-2 hover:bg-paper-soft'
          }`}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

async function resolveAttachDir(dataDir: string, subdir?: string): Promise<string> {
  const sub = subdir ? sanitizeAttachmentSubdir(subdir) : '';
  return sub ? join(dataDir, 'attachments', sub) : join(dataDir, 'attachments');
}

async function pickAttachFile(dataDir: string, subdir?: string): Promise<{ href: string; filename: string } | null> {
  try {
    const result = await open({
      multiple: false,
      filters: [
        { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'tar', 'gz', 'hwp', 'hwpx'] },
      ],
    });
    if (!result) return null;
    const filePath = result;
    const originalName = filePath.split(/[/\\]/).pop() ?? 'file';
    const attachDir = await resolveAttachDir(dataDir, subdir);
    await invoke('ensure_dir', { path: attachDir });
    // 원본 이름 그대로 저장 — 같은 이름이 이미 있을 때만 접두사로 회피
    const safeName = originalName.replace(/[()]/g, '_');
    let filename = safeName;
    const exists = await invoke<boolean>('path_exists', { path: await join(attachDir, filename) }).catch(() => false);
    if (exists) filename = `att-${Date.now().toString(36)}-${safeName}`;
    const destPath = await join(attachDir, filename);
    await invoke('copy_file', { src: filePath, dest: destPath });
    // 상대 경로 href — 클릭 시 dataDir 기준으로 해석해서 연다 (NoteEditor)
    const sub = subdir ? sanitizeAttachmentSubdir(subdir) : '';
    const href = 'attachments/' + encodeAttachmentHref(sub ? `${sub}/${filename}` : filename);
    return { href, filename: originalName };
  } catch {
    return null;
  }
}

async function pickImageFile(dataDir: string, subdir?: string): Promise<string | null> {
  try {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    });
    if (!result) return null;
    const filePath = result;
    const ext = filePath.split('.').pop() ?? 'png';
    const filename = `img-${Date.now().toString(36)}.${ext}`;
    const attachDir = await resolveAttachDir(dataDir, subdir);
    await invoke('ensure_dir', { path: attachDir });
    const destPath = await join(attachDir, filename);
    await invoke('copy_file', { src: filePath, dest: destPath });
    return convertFileSrc(destPath);
  } catch {
    return null;
  }
}

export function EditorToolbar({ editor, attachmentSubdir }: EditorToolbarProps) {
  const { dataDir } = useAppStore();
  const [showImageInput, setShowImageInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!scrollRef.current) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scrollRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  if (!editor) return null;

  const handleImageInsert = async () => {
    if (!dataDir) return;
    const src = await pickImageFile(dataDir, attachmentSubdir);
    if (src) {
      editor.chain().focus().setImage({ src }).run();
    }
  };

  const handleFileAttach = async () => {
    if (!dataDir) return;
    const result = await pickAttachFile(dataDir, attachmentSubdir);
    if (result) {
      editor.chain().focus().insertContent({
        type: 'paragraph',
        content: [{
          type: 'text',
          marks: [{ type: 'link', attrs: { href: result.href } }],
          text: result.filename,
        }],
      }).run();
    }
  };

  const insertTableWithEqualWidths = (e: Editor) => {
    e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    setTimeout(() => {
      const { state, view } = e;
      const { doc, selection, tr } = state;
      const $pos = doc.resolve(selection.from);
      let tableNode = null;
      let tableStart = 0;
      for (let d = $pos.depth; d >= 0; d--) {
        if ($pos.node(d).type.name === 'table') {
          tableNode = $pos.node(d);
          tableStart = $pos.start(d);
          break;
        }
      }
      if (!tableNode) return;
      const tableDom = view.nodeDOM(tableStart - 1) as HTMLElement | null;
      const wrapper = tableDom?.closest('.tableWrapper') ?? tableDom;
      const containerW = (wrapper?.clientWidth ?? 600) - 2;
      let numCols = 0;
      tableNode.firstChild?.forEach((cell) => { numCols += cell.attrs.colspan || 1; });
      if (numCols === 0) return;
      const colW = Math.floor(containerW / numCols);
      let offset = 0;
      tableNode.forEach((row) => {
        let cellOffset = 0;
        row.forEach((cell) => {
          const colspan = cell.attrs.colspan || 1;
          const cellPos = tableStart + offset + cellOffset + 1;
          tr.setNodeMarkup(cellPos, undefined, {
            ...cell.attrs,
            colwidth: Array(colspan).fill(colW),
          });
          cellOffset += cell.nodeSize;
        });
        offset += row.nodeSize;
      });
      view.dispatch(tr);
    }, 0);
  };

  const insertButtons: ToolbarButton[] = [
    {
      label: 'Table',
      icon: '⊞',
      action: insertTableWithEqualWidths,
    },
    {
      label: 'Inline Math ($...$)',
      icon: '∑',
      action: (e) => {
        e.chain().focus().insertContent({
          type: 'inlineMath',
          attrs: { latex: 'x^2 + y^2 = z^2' },
        }).run();
      },
    },
    {
      label: 'Block Math ($$...$$)',
      icon: '∫',
      action: (e) => {
        e.chain().focus().insertContent({
          type: 'blockMath',
          attrs: { latex: '\\int_0^\\infty f(x)\\,dx' },
        }).run();
      },
    },
    {
      label: 'Horizontal Rule',
      icon: '—',
      action: (e) => e.chain().focus().setHorizontalRule().run(),
    },
  ];

  return (
    <div ref={scrollRef} className="editor-toolbar border-b border-border bg-paper shrink-0 overflow-x-auto">
      <div className="flex items-center gap-1.5 px-3 py-1.5 w-max">
        <ToolbarGroup items={buttons} editor={editor} />
        <div className="w-px h-4 bg-border shrink-0" />
        <ToolbarGroup items={headingButtons} editor={editor} />
        <div className="w-px h-4 bg-border shrink-0" />
        <ToolbarGroup items={blockButtons} editor={editor} />
        <div className="w-px h-4 bg-border shrink-0" />
        <TextColorButton editor={editor} />
        <TextHighlightButton editor={editor} />
        <div className="w-px h-4 bg-border shrink-0" />
        <AlignButtons editor={editor} />
        <div className="w-px h-4 bg-border shrink-0" />
        <ToolbarGroup items={insertButtons} editor={editor} />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleImageInsert}
            title="Insert image from file"
            className="px-1.5 py-1 text-xs rounded transition-colors min-w-[24px] text-ink-2 hover:bg-paper-soft"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="2" y="2" width="12" height="12" rx="1.5" />
              <circle cx="6" cy="6.5" r="1.5" />
              <path d="M2 12l3.5-4 2.5 3 2-2 4 3" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => setShowImageInput(true)}
            title="Insert image from URL"
            className="px-1 py-1 text-[10px] rounded transition-colors text-ink-3 hover:bg-paper-soft"
          >
            URL
          </button>
          <button
            onClick={handleFileAttach}
            title="Attach file (Cmd/Ctrl+Click to open)"
            className="px-1.5 py-1 text-xs rounded transition-colors min-w-[24px] text-ink-2 hover:bg-paper-soft"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5l5.8-5.8a2.1 2.1 0 013 3l-5.8 5.7a1.1 1.1 0 01-1.5-1.5l5.3-5.3" />
            </svg>
          </button>
        </div>
        {editor.isActive('table') && (
          <>
            <div className="w-px h-4 bg-border shrink-0" />
            <TableToolbar editor={editor} />
            <CellColorButton editor={editor} />
          </>
        )}
        {showImageInput && (
          <>
            <div className="w-px h-4 bg-border shrink-0" />
            <ImageUrlInput editor={editor} onClose={() => setShowImageInput(false)} />
          </>
        )}
        <div className="w-2 shrink-0" />
      </div>
    </div>
  );
}
