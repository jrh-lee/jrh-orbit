import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

/**
 * 단 분리 (2/3-column layout), Notion-style.
 *
 * Markdown round-trip uses fenced containers so column contents stay plain
 * markdown (task-sync regexes and other markdown apps keep working):
 *
 *   :::: columns
 *   ::: column 38.5      ← optional width percentage
 *   (markdown)
 *   :::
 *   ::: column
 *   (markdown)
 *   :::
 *   ::::
 *
 * The outer fence is 4 colons so the nesting is unambiguous.
 * Column borders are draggable to resize (widths persist as percentages).
 */

export function setupColumnsMarkdownIt(md: MarkdownIt) {
  md.use(container as any, 'columns', {
    render(tokens: any[], idx: number) {
      return tokens[idx].nesting === 1
        ? '<div data-type="columns" class="md-columns">\n'
        : '</div>\n';
    },
  });
  md.use(container as any, 'column', {
    render(tokens: any[], idx: number) {
      const token = tokens[idx];
      if (token.nesting !== 1) return '</div>\n';
      const m = token.info.trim().match(/^column\s+([\d.]+)/);
      const width = m ? parseFloat(m[1]) : null;
      const widthAttr = width ? ` data-width="${width}" style="flex: 0 1 ${width}%"` : '';
      return `<div data-type="column" class="md-column"${widthAttr}>\n`;
    },
  });
}

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return {
      /** Width as a percentage of the row (null = share remaining space) */
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute('data-width');
          return w ? parseFloat(w) || null : null;
        },
        renderHTML: (attrs) => {
          if (!attrs.width) return {};
          // shrink 허용(0 1) — 고정 너비 합이 100%를 넘어도 행이 화면을 넘지 않음
          return { 'data-width': String(attrs.width), style: `flex: 0 1 ${attrs.width}%` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'md-column' }), 0];
  },

  addStorage() {
    return {
      markdown: {
        // Columns' serializer emits the fences; a bare column (e.g. inside a
        // copied slice) just renders its content.
        serialize(state: any, node: PmNode) {
          state.renderContent(node);
        },
        parse: {},
      },
    };
  },
});

/** Find the gap boundary under the pointer inside a .md-columns row.
 *  Returns the DOM elements + PM positions of the two adjacent columns. */
function findColumnBoundary(view: EditorView, e: MouseEvent): {
  leftEl: HTMLElement; rightEl: HTMLElement; leftPos: number; rightPos: number; rowEl: HTMLElement;
} | null {
  const target = e.target as HTMLElement | null;
  const rowEl = target?.closest?.('.md-columns') as HTMLElement | null;
  if (!rowEl || !view.dom.contains(rowEl)) return null;
  const cols = Array.from(rowEl.children).filter(c => (c as HTMLElement).classList?.contains('md-column')) as HTMLElement[];
  for (let i = 0; i < cols.length - 1; i++) {
    const gapLeft = cols[i].getBoundingClientRect().right;
    const gapRight = cols[i + 1].getBoundingClientRect().left;
    if (e.clientX >= gapLeft - 3 && e.clientX <= gapRight + 3) {
      try {
        const leftPos = view.posAtDOM(cols[i], 0) - 1;
        const rightPos = view.posAtDOM(cols[i + 1], 0) - 1;
        return { leftEl: cols[i], rightEl: cols[i + 1], leftPos, rightPos, rowEl };
      } catch { return null; }
    }
  }
  return null;
}

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  // column+ (2개 강제 아님): 단 하나만 남는 상태를 스키마상 허용해야
  // "마지막 단 빼내기 → 행 자동 해제"가 가능하다 (아래 appendTransaction이
  // 1단 행을 즉시 풀어버리므로 실제로 지속되지는 않음)
  content: 'column+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'md-columns' }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          state.write(':::: columns\n\n');
          node.forEach((col: PmNode) => {
            const w = col.attrs.width ? ` ${col.attrs.width}` : '';
            state.write(`::: column${w}\n\n`);
            state.renderContent(col);
            state.write(':::\n\n');
          });
          state.write('::::');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            setupColumnsMarkdownIt(markdownit);
          },
        },
      },
    };
  },

  addCommands() {
    return {
      insertColumns:
        (count: number = 2) =>
        ({ chain }: any) => {
          const columns = Array.from({ length: Math.max(2, count) }, () => ({
            type: 'column',
            content: [{ type: 'paragraph' }],
          }));
          return chain().insertContent({ type: 'columns', content: columns }).run();
        },
    } as any;
  },

  addProseMirrorPlugins() {
    return [
      // 단이 하나만 남은 행은 자동 해제 — 컬럼을 밖으로 빼내거나 지웠을 때
      // 빈 껍데기가 남지 않도록
      new Plugin({
        key: new PluginKey('columnsNormalize'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          let tr: ReturnType<typeof newState.tr.setMeta> | null = null;
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'columns') return true;
            if (node.childCount === 1) {
              tr = tr ?? newState.tr;
              const from = tr.mapping.map(pos);
              tr.replaceWith(from, from + node.nodeSize, node.child(0).content);
            }
            return false; // columns는 중첩되지 않음
          });
          return tr;
        },
      }),
      // 단 사이 경계를 드래그해서 너비 조절 — 퍼센트로 저장
      new Plugin({
        key: new PluginKey('columnResize'),
        view() {
          // 비정상 종료(과거 버전 포함)로 남은 고아 오버레이 청소
          document.querySelectorAll('.col-resize-line, .col-resize-guide').forEach((el) => el.remove());
          document.body.classList.remove('col-resizing');
          return {};
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              // 블록 드래그 중에는 리사이즈 커서/점선이 끼어들지 않게
              if (view.dom.classList.contains('block-dragging')) return false;
              const boundary = findColumnBoundary(view, event);
              view.dom.querySelectorAll('.md-columns.col-resize-hover').forEach(el => {
                if (!boundary || el !== boundary.rowEl) el.classList.remove('col-resize-hover');
              });
              boundary?.rowEl.classList.add('col-resize-hover');
              return false;
            },
            mousedown(view, event) {
              if (event.button !== 0) return false;
              const boundary = findColumnBoundary(view, event);
              if (!boundary) return false;
              event.preventDefault();

              const { leftEl, rightEl, rowEl } = boundary;
              const startX = event.clientX;
              const leftStart = leftEl.getBoundingClientRect().width;
              const rightStart = rightEl.getBoundingClientRect().width;
              const allCols = (Array.from(rowEl.children) as HTMLElement[])
                .filter(c => c.classList?.contains('md-column'));
              const leftIdx = allCols.indexOf(leftEl);
              const rightIdx = allCols.indexOf(rightEl);
              // Percentages are relative to the row's total column width
              const snapshots = allCols.map(c => c.getBoundingClientRect().width);
              const totalColWidth = snapshots.reduce((s, w) => s + w, 0);
              const pairTotal = leftStart + rightStart;
              const MIN = 60; // px

              // 위치는 지금 캡처 — 드래그 중 리렌더로 DOM 요소가 교체되면
              // mouseup 시점의 posAtDOM은 detached 요소라 실패한다
              let rowPos: number;
              try { rowPos = view.posAtDOM(rowEl, 0) - 1; } catch { return false; }
              if (view.state.doc.nodeAt(rowPos)?.type.name !== 'columns') return false;

              // 라이브 스타일 직접 조작은 ProseMirror가 되돌려버림 —
              // 드래그 중에도 트랜잭션으로 적용 (히스토리 제외, mouseup만 기록)
              const applyWidths = (leftPct: number, rightPct: number, withHistory: boolean) => {
                const rowNode = view.state.doc.nodeAt(rowPos);
                if (rowNode?.type.name !== 'columns') return;
                const tr = view.state.tr;
                let off = rowPos + 1;
                let i = 0;
                rowNode.forEach((col) => {
                  let w = (snapshots[i] / totalColWidth) * 100;
                  if (i === leftIdx) w = leftPct;
                  if (i === rightIdx) w = rightPct;
                  tr.setNodeMarkup(off, undefined, { ...col.attrs, width: Math.round(w * 10) / 10 });
                  off += col.nodeSize;
                  i++;
                });
                if (!withHistory) tr.setMeta('addToHistory', false);
                view.dispatch(tr);
              };

              // 드래그 중 비율 가이드 + 노션식 경계 세로선
              const guide = document.createElement('div');
              guide.className = 'col-resize-guide';
              document.body.appendChild(guide);
              const line = document.createElement('div');
              line.className = 'col-resize-line';
              document.body.appendChild(line);
              document.body.classList.add('col-resizing');

              const updateLine = () => {
                // 리렌더로 요소가 바뀔 수 있어 항상 위치 기준으로 다시 조회
                const rowDom = view.nodeDOM(rowPos);
                if (!(rowDom instanceof HTMLElement)) return;
                const cols = (Array.from(rowDom.children) as HTMLElement[])
                  .filter(c => c.classList?.contains('md-column'));
                const l = cols[leftIdx]?.getBoundingClientRect();
                const r = cols[rightIdx]?.getBoundingClientRect();
                const rowR = rowDom.getBoundingClientRect();
                if (!l || !r) return;
                line.style.left = `${(l.right + r.left) / 2 - 1.5}px`;
                line.style.top = `${rowR.top}px`;
                line.style.height = `${rowR.height}px`;
              };
              updateLine();

              const calcPcts = (clientX: number) => {
                const dx = Math.max(MIN - leftStart, Math.min(clientX - startX, pairTotal - MIN - leftStart));
                return {
                  leftPct: ((leftStart + dx) / totalColWidth) * 100,
                  rightPct: ((rightStart - dx) / totalColWidth) * 100,
                };
              };

              const onMove = (ev: MouseEvent) => {
                const { leftPct, rightPct } = calcPcts(ev.clientX);
                applyWidths(leftPct, rightPct, false);
                guide.textContent = `${Math.round(leftPct)}% : ${Math.round(rightPct)}%`;
                guide.style.left = `${ev.clientX + 12}px`;
                guide.style.top = `${ev.clientY - 28}px`;
                updateLine();
              };
              const cleanup = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                window.removeEventListener('blur', cleanup);
                guide.remove();
                line.remove();
                document.body.classList.remove('col-resizing');
              };
              const onUp = (ev: MouseEvent) => {
                cleanup();
                try {
                  const { leftPct, rightPct } = calcPcts(ev.clientX);
                  applyWidths(leftPct, rightPct, true);
                } catch { /* resize commit failed */ }
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
              window.addEventListener('blur', cleanup);
              return true;
            },
          },
        },
      }),
    ];
  },
});
