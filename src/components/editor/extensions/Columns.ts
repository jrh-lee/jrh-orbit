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
  content: 'column column+',
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
      // 단 사이 경계를 드래그해서 너비 조절 — 퍼센트로 저장
      new Plugin({
        key: new PluginKey('columnResize'),
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
              // Percentages are relative to the row's total column width
              const snapshots = allCols.map(c => c.getBoundingClientRect().width);
              const totalColWidth = snapshots.reduce((s, w) => s + w, 0);
              const pairTotal = leftStart + rightStart;
              const MIN = 60; // px

              // 조절 중인 두 단 외의 단들은 현재 너비로 고정 — 안 그러면
              // 남는 공간이 변하며 다른 단들까지 같이 움직인다
              allCols.forEach((c, i) => {
                if (c !== leftEl && c !== rightEl) {
                  c.style.flex = `0 1 ${(snapshots[i] / totalColWidth) * 100}%`;
                }
              });

              // 드래그 중 비율 가이드 + 노션식 경계 세로선
              const guide = document.createElement('div');
              guide.className = 'col-resize-guide';
              document.body.appendChild(guide);
              const line = document.createElement('div');
              line.className = 'col-resize-line';
              document.body.appendChild(line);
              document.body.classList.add('col-resizing');

              const updateLine = () => {
                const lr = leftEl.getBoundingClientRect();
                const rr = rightEl.getBoundingClientRect();
                const rowR = rowEl.getBoundingClientRect();
                line.style.left = `${(lr.right + rr.left) / 2 - 1.5}px`;
                line.style.top = `${rowR.top}px`;
                line.style.height = `${rowR.height}px`;
              };
              updateLine();

              const onMove = (ev: MouseEvent) => {
                const dx = Math.max(MIN - leftStart, Math.min(ev.clientX - startX, pairTotal - MIN - leftStart));
                const leftPct = ((leftStart + dx) / totalColWidth) * 100;
                const rightPct = ((rightStart - dx) / totalColWidth) * 100;
                leftEl.style.flex = `0 1 ${leftPct}%`;
                rightEl.style.flex = `0 1 ${rightPct}%`;
                guide.textContent = `${Math.round(leftPct)}% : ${Math.round(rightPct)}%`;
                guide.style.left = `${ev.clientX + 12}px`;
                guide.style.top = `${ev.clientY - 28}px`;
                updateLine();
              };
              const onUp = (ev: MouseEvent) => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                guide.remove();
                line.remove();
                document.body.classList.remove('col-resizing');
                const dx = Math.max(MIN - leftStart, Math.min(ev.clientX - startX, pairTotal - MIN - leftStart));
                const leftPct = Math.round(((leftStart + dx) / totalColWidth) * 1000) / 10;
                const rightPct = Math.round(((rightStart - dx) / totalColWidth) * 1000) / 10;
                try {
                  // 모든 단의 너비를 확정 저장 (조절한 두 단 = 새 값, 나머지 = 스냅샷)
                  const rowPos = view.posAtDOM(rowEl, 0) - 1;
                  const rowNode = view.state.doc.nodeAt(rowPos);
                  if (rowNode?.type.name !== 'columns') return;
                  const widths = allCols.map((c, i) => {
                    if (c === leftEl) return leftPct;
                    if (c === rightEl) return rightPct;
                    return Math.round((snapshots[i] / totalColWidth) * 1000) / 10;
                  });
                  const tr = view.state.tr;
                  let off = rowPos + 1;
                  let i = 0;
                  rowNode.forEach((col) => {
                    if (col.type.name === 'column' && widths[i] !== undefined) {
                      tr.setNodeMarkup(off, undefined, { ...col.attrs, width: widths[i] });
                    }
                    off += col.nodeSize;
                    i++;
                  });
                  view.dispatch(tr);
                } catch { /* resize commit failed — live styles stay until next render */ }
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
              return true;
            },
          },
        },
      }),
    ];
  },
});
