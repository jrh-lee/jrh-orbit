import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';

const dragHandleKey = new PluginKey('dragHandle');
interface BlockInfo { pos: number; node: PmNode; dom: HTMLElement; }

function findClosestChild(parent: HTMLElement, y: number): HTMLElement | null {
  const children = parent.children;
  let closest: HTMLElement | null = null;
  let closestDist = Infinity;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement;
    if (!child.getBoundingClientRect) continue;
    const rect = child.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) return child;
    const dist = y < rect.top ? rect.top - y : y - rect.bottom;
    if (dist < closestDist) { closest = child; closestDist = dist; }
  }
  return closestDist <= 30 ? closest : null;
}

function resolveBlock(view: EditorView, y: number): BlockInfo | null {
  const topChild = findClosestChild(view.dom, y);
  if (!topChild) return null;

  // Leaf node views (image 등 react-renderer): coords 기반 해석은 이웃
  // 텍스트블록이나 문서 경계로 빠진다 — DOM 자식에서 위치를 직접 구한다.
  if (topChild.classList?.contains('react-renderer')) {
    try {
      const pos = view.posAtDOM(topChild, 0);
      const $p = view.state.doc.resolve(pos);
      const bp = $p.depth > 0 ? $p.before(1) : pos;
      const node = view.state.doc.nodeAt(bp);
      if (node) return { pos: bp, node, dom: topChild };
    } catch { /* fall through to coords resolution */ }
  }

  const topRect = topChild.getBoundingClientRect();
  const cy = Math.max(topRect.top + 1, Math.min(y, topRect.bottom - 1));

  const contentX = topRect.left + Math.min(200, topRect.width / 2);
  const posInfo = view.posAtCoords({ left: contentX, top: cy });

  if (!posInfo) {
    try {
      const pos = view.posAtDOM(topChild, 0);
      const $pos = view.state.doc.resolve(pos);
      const bp = $pos.depth > 0 ? $pos.before(1) : pos;
      const node = view.state.doc.nodeAt(bp);
      if (!node) return null;
      return { pos: bp, node, dom: topChild };
    } catch { return null; }
  }

  try {
    // 리스트 항목 등에 중첩된 이미지: 리프 노드라 depth 순회에 안 잡힌다 —
    // 좌표가 이미지 위면(inside) 이미지 자체를 블록으로 취급
    if (posInfo.inside >= 0) {
      const inNode = view.state.doc.nodeAt(posInfo.inside);
      if (inNode?.type.name === 'image') {
        const dom = view.nodeDOM(posInfo.inside);
        if (dom instanceof HTMLElement) return { pos: posInfo.inside, node: inNode, dom };
      }
    }

    const $pos = view.state.doc.resolve(posInfo.pos);

    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d);
      // Tables/code blocks/images win over their containing list item —
      // otherwise a nested block can never be selected (and moved) on its own.
      if (node.type.name === 'table' || node.type.name === 'codeBlock' || node.type.name === 'image') {
        const bp = $pos.before(d);
        const dom = view.nodeDOM(bp);
        if (dom && dom instanceof HTMLElement) return { pos: bp, node, dom };
      }
      if (node.type.name === 'taskItem' || node.type.name === 'listItem') {
        const bp = $pos.before(d);
        const dom = view.nodeDOM(bp);
        if (dom && dom instanceof HTMLElement) return { pos: bp, node, dom };
      }
    }

    // depth 0 = 블록 경계(리프 노드 위 좌표) — posAtCoords의 inside가 그 노드
    const bp = $pos.depth > 0
      ? $pos.before(1)
      : (posInfo.inside >= 0 ? posInfo.inside : posInfo.pos);
    const node = view.state.doc.nodeAt(bp);
    if (!node) return null;
    const dom = view.nodeDOM(bp);
    if (dom && dom instanceof HTMLElement) return { pos: bp, node, dom };
    return { pos: bp, node, dom: topChild };
  } catch { return null; }
}

function isInLeftGutter(view: EditorView, clientX: number, clientY: number): boolean {
  const children = view.dom.children;
  let matched = false;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement;
    if (!child.getBoundingClientRect) continue;
    const rect = child.getBoundingClientRect();
    if (clientY >= rect.top - 4 && clientY <= rect.bottom + 4) {
      if (clientX < rect.left) return true;
      matched = true;
      break;
    }
  }
  if (!matched) {
    const firstChild = view.dom.firstElementChild as HTMLElement | null;
    if (firstChild && clientX < firstChild.getBoundingClientRect().left) return true;
  }

  const block = resolveBlock(view, clientY);
  if (!block) return false;
  const isItem = block.node.type.name === 'taskItem' || block.node.type.name === 'listItem';
  if (!isItem) return false;

  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' ||
      (target.tagName === 'LABEL' && target.closest('ul[data-type="taskList"]')))) {
    return false;
  }

  const contentEl = block.dom.querySelector(':scope > p, :scope > div') as HTMLElement | null;
  if (contentEl && clientX < contentEl.getBoundingClientRect().left) return true;

  return false;
}

/** 마지막 블록보다 아래(빈 공간)에 드롭 — 문서 끝으로 이동 */
function fallbackEndTarget(view: EditorView, clientY: number): BlockInfo | null {
  const doc = view.state.doc;
  if (!doc.childCount) return null;
  const lastNode = doc.child(doc.childCount - 1);
  const pos = doc.content.size - lastNode.nodeSize;
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  if (clientY <= dom.getBoundingClientRect().bottom) return null;
  return { pos, node: lastNode, dom };
}

function canDrop(doc: PmNode, srcPos: number, srcNode: PmNode, targetPos: number, targetNode: PmNode): boolean {
  try {
    const $src = doc.resolve(srcPos);
    const $target = doc.resolve(targetPos);
    if ($src.parent === $target.parent) return true;

    const srcIsItem = srcNode.type.name === 'taskItem' || srcNode.type.name === 'listItem';
    const targetIsItem = targetNode.type.name === 'taskItem' || targetNode.type.name === 'listItem';

    if (srcIsItem && targetIsItem) return srcNode.type === targetNode.type;
    if (srcIsItem && !targetIsItem) return true;
    // Non-item blocks (tables, code blocks, paragraphs) dropped onto a list
    // item snap to the boundary of the whole list — without this they can't
    // be moved at all in list-heavy documents like the daily note.
    if (!srcIsItem && targetIsItem) return true;

    // 일반 블록 ↔ 일반 블록: 부모가 달라도 허용 — 컬럼 안 이미지를
    // 최상위 문단 옆으로 빼내는 이동이 여기서 막혀 리스트 안으로만
    // 옮겨지던 버그의 원인
    return true;
  } catch { return false; }
}

const ITEM_NAMES = ['taskItem', 'listItem'];
const LIST_NAMES = ['bulletList', 'orderedList', 'taskList'];

/** Where the item's actual text begins — for task items that's the content
 *  div after the checkbox column; for bullet items the li box itself. */
function itemContentLeft(dom: HTMLElement): number {
  const contentEl = dom.querySelector(':scope > div');
  if (contentEl) return contentEl.getBoundingClientRect().left;
  return dom.getBoundingClientRect().left;
}

/** The item's OWN first text row. An item's bounding box includes its whole
 *  nested subtree, which made zone math land on the wrong rows — all zone
 *  decisions must use this rect instead. */
function itemFirstLineRect(dom: HTMLElement): DOMRect {
  const el = (dom.querySelector(':scope > div > p:first-child')
    ?? dom.querySelector(':scope > p:first-child')) as HTMLElement | null;
  return (el ?? dom).getBoundingClientRect();
}

type DropKind = 'before' | 'after' | 'into-first' | 'into-last';
interface DropPlan extends BlockInfo { kind: DropKind }

/** Simple line-based semantics (percent zones were ~6px bands on a 21px row
 *  — impossible to hit):
 *  - non-item block (table/code) over an item's line → ALWAYS into that item
 *    (first-child slot). Beside-the-list placement = drop on non-list blocks.
 *  - item over an item's line: top half = before it, bottom half = into it
 *    (bottom half keeps sibling reorder possible via the next row's top half) */
function planDrop(_view: EditorView, srcTypeName: string, target: BlockInfo, clientY: number): DropPlan {
  const srcIsItem = ITEM_NAMES.includes(srcTypeName);
  const targetIsItem = ITEM_NAMES.includes(target.node.type.name);

  if (!targetIsItem) {
    const r = target.dom.getBoundingClientRect();
    return { ...target, kind: clientY > r.top + r.height / 2 ? 'after' : 'before' };
  }

  if (!srcIsItem) return { ...target, kind: 'into-first' };

  const line = itemFirstLineRect(target.dom);
  const below = clientY > line.top + line.height / 2;
  return { ...target, kind: below ? 'into-first' : 'before' };
}

function drawDropLine(line: HTMLElement, plan: DropPlan): void {
  line.style.height = '';
  const rect = plan.dom.getBoundingClientRect();
  const isItem = ITEM_NAMES.includes(plan.node.type.name);
  if (plan.kind === 'into-first' || plan.kind === 'into-last') {
    // Line starts at the PARENT item's text start — deeper indents read as
    // one level too far (the drop still nests correctly; this is visual only)
    const left = itemContentLeft(plan.dom);
    const top = plan.kind === 'into-first' ? itemFirstLineRect(plan.dom).bottom : rect.bottom;
    line.style.top = `${top - 1}px`;
    line.style.left = `${left}px`;
    line.style.width = `${Math.max(60, rect.right - left)}px`;
  } else {
    const top = plan.kind === 'before'
      ? (isItem ? itemFirstLineRect(plan.dom).top : rect.top)
      : rect.bottom;
    line.style.top = `${top - 1}px`;
    line.style.left = `${rect.left}px`;
    line.style.width = `${rect.width}px`;
  }
  line.style.opacity = '1';
}

/* ── Columns drop integration (Notion-style) ──
   - drop at the right edge of a normal block → wrap both into a 2-column row
   - drop at the right edge of a columns row → append a new column
   - drop inside a column → insert before/after the inner block             */

interface ColPlan {
  kind: 'make-columns' | 'new-column' | 'col-before' | 'col-after';
  pos: number;
  node: PmNode;
  dom: HTMLElement;
}

const COL_EDGE = 36;

function topLevelBlockAt(view: EditorView, clientY: number): BlockInfo | null {
  const block = resolveBlock(view, clientY);
  if (!block) return null;
  try {
    const $p = view.state.doc.resolve(block.pos);
    const topPos = $p.depth > 0 ? $p.before(1) : block.pos;
    const topNode = view.state.doc.nodeAt(topPos);
    const topDom = view.nodeDOM(topPos);
    if (!topNode || !(topDom instanceof HTMLElement)) return null;
    return { pos: topPos, node: topNode, dom: topDom };
  } catch { return null; }
}

function planColumnsDrop(view: EditorView, clientX: number, clientY: number): ColPlan | null {
  const top = topLevelBlockAt(view, clientY);
  if (!top) return null;
  const rect = top.dom.getBoundingClientRect();
  if (clientY < rect.top - 4 || clientY > rect.bottom + 4) return null;

  if (top.node.type.name === 'columns') {
    if (clientX >= rect.right - COL_EDGE && clientX <= rect.right + 40) {
      return { kind: 'new-column', pos: top.pos, node: top.node, dom: top.dom };
    }
    // inside a specific column → before/after one of its direct child blocks
    const cols = Array.from(top.dom.children).filter(
      (c) => (c as HTMLElement).classList?.contains('md-column'),
    ) as HTMLElement[];
    for (const colEl of cols) {
      const cr = colEl.getBoundingClientRect();
      if (clientX < cr.left || clientX > cr.right) continue;
      let colPos: number;
      try { colPos = view.posAtDOM(colEl, 0) - 1; } catch { return null; }
      const colNode = view.state.doc.nodeAt(colPos);
      if (!colNode || colNode.type.name !== 'column') return null;
      let best: ColPlan | null = null;
      let bestDist = Infinity;
      let offsetAcc = 0;
      colNode.forEach((child) => {
        const childPos = colPos + 1 + offsetAcc;
        offsetAcc += child.nodeSize;
        const dom = view.nodeDOM(childPos);
        if (!(dom instanceof HTMLElement)) return;
        const r = dom.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = { kind: clientY > mid ? 'col-after' : 'col-before', pos: childPos, node: child, dom };
        }
      });
      return best;
    }
    return null;
  }

  // normal top-level block: right edge → make a new 2-column row
  if (clientX >= rect.right - COL_EDGE && clientX <= rect.right + 40) {
    return { kind: 'make-columns', pos: top.pos, node: top.node, dom: top.dom };
  }
  return null;
}

/** 본문 스크롤 영역 rect — 고정 오버레이는 이 밖(툴바/메타 영역)으로
 *  나가면 안 된다. 화면보다 큰 블록이 스크롤로 잘려 있을 때 필요. */
function contentClipRect(dom: HTMLElement): DOMRect | null {
  const scroller = dom.closest('.overflow-y-auto') as HTMLElement | null;
  return scroller?.getBoundingClientRect() ?? null;
}

function drawColDropLine(line: HTMLElement, plan: ColPlan): void {
  const rect = plan.dom.getBoundingClientRect();
  if (plan.kind === 'make-columns' || plan.kind === 'new-column') {
    // 라인은 항상 노트 본문(.ProseMirror) 영역 안에 — 블록 래퍼가 전체 폭인
    // 경우(이미지/컬럼 행) 바깥에 그리면 페이지를 벗어난다
    const pmEl = plan.dom.closest('.ProseMirror') as HTMLElement | null;
    const maxX = pmEl ? pmEl.getBoundingClientRect().right - 18 : window.innerWidth - 14;
    const x = Math.min(rect.right - 8, maxX);
    // 세로 방향은 본문 스크롤 영역으로 클립 (툴바 위까지 침범 금지)
    const clip = contentClipRect(plan.dom);
    const top = clip ? Math.max(rect.top, clip.top + 2) : rect.top;
    const bottom = clip ? Math.min(rect.bottom, clip.bottom - 2) : rect.bottom;
    line.style.top = `${top}px`;
    line.style.left = `${x}px`;
    line.style.width = '3px';
    line.style.height = `${Math.max(0, bottom - top)}px`;
  } else {
    line.style.height = '';
    const top = plan.kind === 'col-before' ? rect.top : rect.bottom;
    line.style.top = `${top - 1}px`;
    line.style.left = `${rect.left}px`;
    line.style.width = `${rect.width}px`;
  }
  line.style.opacity = '1';
}

export const DragHandle = Extension.create({
  name: 'dragHandle',
  // Above the Table extension so Tab on a gutter-selected block (table/code)
  // indents the block instead of jumping to the next cell.
  priority: 1000,

  addKeyboardShortcuts() {
    const LIST_TYPES = ['bulletList', 'orderedList', 'taskList'];
    const ITEM_TYPES = ['taskItem', 'listItem'];

    /** Block selected via the drag gutter (table, code block, …):
     *  Tab tucks it into the last item of the list right above it. */
    const indentSelectedBlock = (): boolean => {
      const { state, view } = this.editor;
      const sel = state.selection;
      if (!(sel instanceof NodeSelection) || ITEM_TYPES.includes(sel.node.type.name)) return false;
      try {
        const $pos = state.doc.resolve(sel.from);
        const parent = $pos.parent;
        // Find the list above, skipping blank spacer paragraphs in between
        let boundary = sel.from;
        let list: PmNode | null = null;
        let listStart = -1;
        for (let i = $pos.index() - 1; i >= 0; i--) {
          const sib = parent.child(i);
          boundary -= sib.nodeSize;
          if (sib.type.name === 'paragraph' && sib.content.size === 0) continue;
          if (LIST_TYPES.includes(sib.type.name)) {
            list = sib;
            listStart = boundary;
          }
          break;
        }
        if (!list) {
          if (import.meta.env.DEV) console.warn('[drag-indent] no list above the selected block');
          return false;
        }
        // end of the list's last item = list end - 2 (item + list closing tokens)
        const insertPos = listStart + list.nodeSize - 2;
        const tr = state.tr;
        tr.delete(sel.from, sel.from + sel.node.nodeSize);
        const mapped = tr.mapping.map(insertPos, -1);
        tr.insert(mapped, sel.node);
        tr.setSelection(NodeSelection.create(tr.doc, mapped));
        view.dispatch(tr.scrollIntoView());
        return true;
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[drag-indent] failed:', e);
        return false;
      }
    };

    /** Shift-Tab pulls a nested non-item block back out, after the whole list. */
    const outdentSelectedBlock = (): boolean => {
      const { state, view } = this.editor;
      const sel = state.selection;
      if (!(sel instanceof NodeSelection) || ITEM_TYPES.includes(sel.node.type.name)) return false;
      try {
        const $pos = state.doc.resolve(sel.from);
        let inItem = false;
        for (let d = $pos.depth; d >= 1; d--) {
          if (ITEM_TYPES.includes($pos.node(d).type.name)) { inItem = true; break; }
        }
        if (!inItem) return false;
        const topPos = $pos.before(1);
        const topNode = state.doc.nodeAt(topPos);
        if (!topNode) return false;
        const after = topPos + topNode.nodeSize;
        const tr = state.tr;
        tr.delete(sel.from, sel.from + sel.node.nodeSize);
        const mapped = tr.mapping.map(after, -1);
        tr.insert(mapped, sel.node);
        tr.setSelection(NodeSelection.create(tr.doc, mapped));
        view.dispatch(tr.scrollIntoView());
        return true;
      } catch { return false; }
    };

    return {
      Tab: () => {
        if (indentSelectedBlock()) return true;
        if (this.editor.can().sinkListItem('taskItem')) return this.editor.commands.sinkListItem('taskItem');
        if (this.editor.can().sinkListItem('listItem')) return this.editor.commands.sinkListItem('listItem');
        const { state, view } = this.editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d >= 1; d--) {
          const node = $from.node(d);
          if (!LIST_TYPES.includes(node.type.name)) continue;
          if ($from.index(d) !== 0) break;
          const listStart = $from.before(d);
          if (listStart <= 0) break;
          const $ls = state.doc.resolve(listStart);
          if (!$ls.nodeBefore || $ls.nodeBefore.type.name !== node.type.name) break;
          try {
            if (!state.tr.join(listStart).docChanged) break;
            view.dispatch(state.tr.join(listStart));
            if (this.editor.can().sinkListItem('taskItem')) return this.editor.commands.sinkListItem('taskItem');
            if (this.editor.can().sinkListItem('listItem')) return this.editor.commands.sinkListItem('listItem');
            return true;
          } catch { break; }
        }
        return false;
      },
      'Shift-Tab': () => {
        if (outdentSelectedBlock()) return true;
        // Count list ancestors: at nesting depth 1 the item is already at the
        // top level of its list — lifting there breaks the item out of the
        // list and drags surrounding blocks along with it. Consume the key
        // and do nothing instead.
        const { $from } = this.editor.state.selection;
        let listLevels = 0;
        for (let d = $from.depth; d >= 1; d--) {
          if (LIST_TYPES.includes($from.node(d).type.name)) listLevels++;
        }
        if (listLevels <= 1) return listLevels === 1;
        if (this.editor.can().liftListItem('taskItem')) return this.editor.commands.liftListItem('taskItem');
        if (this.editor.can().liftListItem('listItem')) return this.editor.commands.liftListItem('listItem');
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    let dropLine: HTMLElement | null = null;
    function hideDropLine() { if (dropLine) dropLine.style.opacity = '0'; }

    return [
      new Plugin({
        key: dragHandleKey,
        view(editorView) {
          dropLine = document.createElement('div');
          dropLine.className = 'block-drop-indicator';
          dropLine.setAttribute('aria-hidden', 'true');
          document.body.appendChild(dropLine);

          const onMouseDown = (event: MouseEvent) => {
            if (event.button !== 0) return;
            // The heading-fold arrow lives in the gutter — this capture-phase
            // listener would swallow its clicks before they reach the button.
            // Element, not HTMLElement: clicking the arrow graphic targets an SVG node.
            if (event.target instanceof Element && event.target.closest('.heading-fold-arrow, .md-toggle-arrow')) return;
            const inGutter = isInLeftGutter(editorView, event.clientX, event.clientY);
            if (!inGutter) return;

            const block = resolveBlock(editorView, event.clientY);
            if (import.meta.env.DEV) console.warn('[drag] down: block=', block?.node.type.name, '@', block?.pos);
            if (!block) return;

            // Multi-block: a text selection spanning several top-level blocks
            // + gutter-drag on one of them moves the whole span together.
            let multiSpan: { from: number; to: number } | null = null;
            {
              const sel = editorView.state.selection;
              if (!sel.empty && !(sel instanceof NodeSelection)) {
                const docNow = editorView.state.doc;
                const $f = docNow.resolve(sel.from);
                const $t = docNow.resolve(sel.to);
                const fromTop = $f.depth > 0 ? $f.before(1) : sel.from;
                const toTop = $t.depth > 0 ? $t.after(1) : sel.to;
                let count = 0;
                for (let p = fromTop; p < toTop; ) {
                  const child = docNow.nodeAt(p);
                  if (!child) break;
                  count++;
                  p += child.nodeSize;
                }
                if (count > 1 && block.pos >= fromTop && block.pos < toTop) {
                  multiSpan = { from: fromTop, to: toTop };
                }
              }
            }

            beginDrag(event, block, multiSpan);
          };

          /** 실제 드래그 세션 — 거터와 컬럼 내부 ⠿ 핸들이 공유 */
          const beginDrag = (
            event: MouseEvent,
            block: BlockInfo,
            multiSpan: { from: number; to: number } | null,
          ) => {
            event.preventDefault();
            event.stopImmediatePropagation();

            if (!multiSpan) {
              try {
                editorView.dispatch(
                  editorView.state.tr.setSelection(NodeSelection.create(editorView.state.doc, block.pos)),
                );
                // Focus so Tab/Shift-Tab work right after selecting via gutter
                editorView.focus();
              } catch { return; }
            }

            const srcPos = multiSpan ? multiSpan.from : block.pos;
            const srcFirstNode = multiSpan ? editorView.state.doc.nodeAt(srcPos) : block.node;
            if (!srcFirstNode) return;
            const srcNodeSize = srcFirstNode.nodeSize;
            const srcNodeType = srcFirstNode.type.name;
            // Folded heading: drag the whole governed section (until the next
            // heading of the same/higher level), not just the heading line.
            let srcRangeEnd = multiSpan ? multiSpan.to : srcPos + srcNodeSize;
            // 접힌 헤딩의 범위 확장은 최상위 헤딩만 (컬럼 안 헤딩은 단일 이동)
            if (!multiSpan && srcNodeType === 'heading' && block.node.attrs.folded === true
                && editorView.state.doc.resolve(srcPos).depth === 0) {
              const docNow = editorView.state.doc;
              const level: number = block.node.attrs.level ?? 1;
              let pos = srcRangeEnd;
              while (pos < docNow.content.size) {
                const child = docNow.nodeAt(pos);
                if (!child) break;
                if (child.type.name === 'heading' && (child.attrs.level ?? 1) <= level) break;
                pos += child.nodeSize;
                srcRangeEnd = pos;
              }
            }
            const isRangeDrag = srcRangeEnd > srcPos + srcNodeSize;
            const startY = event.clientY;
            const startX = event.clientX;
            let dragging = false;

            // Images (and other draggable nodes) start a NATIVE HTML5 drag on
            // move, which kills our mousemove-based drag — suppress it for
            // the duration of this gutter drag.
            const onDragStart = (ev: DragEvent) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
            document.addEventListener('dragstart', onDragStart, true);

            // If the drag aborts without a mouseup (native drag slipped
            // through, window lost focus), listeners must still be torn down —
            // stale ones acted as a zombie drag that moved blocks on the next
            // click.
            const cancelDrag = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              document.removeEventListener('dragstart', onDragStart, true);
              document.removeEventListener('dragend', cancelDrag, true);
              window.removeEventListener('blur', cancelDrag);
              editorView.dom.classList.remove('block-dragging');
              hideDropLine();
            };
            document.addEventListener('dragend', cancelDrag, true);
            window.addEventListener('blur', cancelDrag);

            const onMove = (e: MouseEvent) => {
              // 창 밖에서 버튼을 떼면 mouseup이 안 온다 — 버튼이 떼진 채
              // mousemove가 오면 좀비 드래그가 되므로 즉시 중단
              if (e.buttons === 0) { cancelDrag(); return; }
              // X counts too — make-columns drags are mostly horizontal
              if (!dragging && (Math.abs(e.clientY - startY) > 5 || Math.abs(e.clientX - startX) > 8)) {
                dragging = true;
                editorView.dom.classList.add('block-dragging');
              }
              if (!dragging || !dropLine) return;

              // Notion-style columns targets take precedence
              if (!isRangeDrag && srcNodeType !== 'columns') {
                const colPlan = planColumnsDrop(editorView, e.clientX, e.clientY);
                if (colPlan && !(colPlan.pos >= srcPos && colPlan.pos < srcRangeEnd)) {
                  drawColDropLine(dropLine, colPlan);
                  return;
                }
              }

              const rawTarget = resolveBlock(editorView, e.clientY) ?? fallbackEndTarget(editorView, e.clientY);
              if (!rawTarget || rawTarget.pos === srcPos) { hideDropLine(); return; }

              const srcNode = editorView.state.doc.nodeAt(srcPos);
              if (!srcNode || !canDrop(editorView.state.doc, srcPos, srcNode, rawTarget.pos, rawTarget.node)) {
                hideDropLine();
                return;
              }
              const plan = planDrop(editorView, srcNodeType, rawTarget, e.clientY);
              if (plan.pos === srcPos) { hideDropLine(); return; }
              // dropping into/next to one's own subtree corrupts the doc — hide
              // (srcRangeEnd covers the folded section when range-dragging)
              if (plan.pos > srcPos && plan.pos < srcRangeEnd) { hideDropLine(); return; }
              if (isRangeDrag && plan.kind !== 'before' && plan.kind !== 'after') { hideDropLine(); return; }

              drawDropLine(dropLine, plan);
            };

            const onUp = (e: MouseEvent) => {
              cancelDrag();
              if (!dragging) return;

              try {
                const doc = editorView.state.doc;
                const srcNode = doc.nodeAt(srcPos);
                if (!srcNode || srcNode.type.name !== srcNodeType || srcNode.nodeSize !== srcNodeSize) {
                  if (import.meta.env.DEV) console.warn('[drag] drop abort: src changed');
                  return;
                }

                // Columns targets (make-columns / new-column / into-column)
                if (!isRangeDrag && srcNodeType !== 'columns') {
                  const colPlan = planColumnsDrop(editorView, e.clientX, e.clientY);
                  if (colPlan) {
                    if (colPlan.pos >= srcPos && colPlan.pos < srcRangeEnd) return;
                    const $src2 = doc.resolve(srcPos);
                    const srcIsItem2 = ITEM_NAMES.includes(srcNode.type.name);
                    const srcIsOnly2 = srcIsItem2 && $src2.parent.childCount === 1;
                    const payload: PmNode = srcIsItem2
                      ? (srcIsOnly2 ? $src2.parent : $src2.parent.type.create($src2.parent.attrs, srcNode))
                      : srcNode;
                    let delFrom = srcPos;
                    let delTo = srcPos + srcNode.nodeSize;
                    if (srcIsOnly2) {
                      delFrom = $src2.before($src2.depth);
                      delTo = delFrom + $src2.parent.nodeSize;
                    }
                    // 단의 마지막 블록이면 그 단도 함께 제거
                    {
                      const $del = doc.resolve(delFrom);
                      if ($del.parent.type.name === 'column' && $del.parent.childCount === 1) {
                        delFrom = $del.before();
                        delTo = delFrom + $del.parent.nodeSize;
                      }
                    }
                    const columnType = editorView.state.schema.nodes.column;
                    const columnsType = editorView.state.schema.nodes.columns;
                    if (!columnType || !columnsType) return;
                    const tr = editorView.state.tr;
                    if (colPlan.kind === 'make-columns') {
                      tr.delete(delFrom, delTo);
                      const tPos = tr.mapping.map(colPlan.pos);
                      const tNode = tr.doc.nodeAt(tPos);
                      if (!tNode || tNode.type.name !== colPlan.node.type.name) return;
                      tr.replaceWith(
                        tPos,
                        tPos + tNode.nodeSize,
                        columnsType.create(null, [columnType.create(null, tNode), columnType.create(null, payload)]),
                      );
                    } else if (colPlan.kind === 'new-column') {
                      tr.delete(delFrom, delTo);
                      const cPos = tr.mapping.map(colPlan.pos);
                      const cNode = tr.doc.nodeAt(cPos);
                      if (!cNode || cNode.type.name !== 'columns') return;
                      tr.insert(cPos + cNode.nodeSize - 1, columnType.create(null, payload));
                      // 고정 너비가 남아 있으면 새 단이 화면 밖으로 밀림 —
                      // 전부 지워서 1/n 균등 분배로 리셋
                      const cNode2 = tr.doc.nodeAt(cPos);
                      if (cNode2) {
                        let off = cPos + 1;
                        cNode2.forEach((col) => {
                          if (col.attrs.width) {
                            tr.setNodeMarkup(off, undefined, { ...col.attrs, width: null });
                          }
                          off += col.nodeSize;
                        });
                      }
                    } else {
                      const insertAt = colPlan.kind === 'col-after' ? colPlan.pos + colPlan.node.nodeSize : colPlan.pos;
                      // 제거 범위가 단 전체로 확장된 경우 그 안으로의 이동은 무효
                      if (insertAt >= delFrom && insertAt <= delTo) return;
                      if (insertAt <= delFrom) {
                        tr.insert(insertAt, payload);
                        tr.delete(tr.mapping.map(delFrom), tr.mapping.map(delTo));
                      } else {
                        tr.delete(delFrom, delTo);
                        tr.insert(tr.mapping.map(insertAt), payload);
                      }
                    }
                    editorView.dispatch(tr.scrollIntoView());
                    editorView.focus();
                    return;
                  }
                }

                const rawTarget = resolveBlock(editorView, e.clientY) ?? fallbackEndTarget(editorView, e.clientY);
                if (import.meta.env.DEV) console.warn('[drag] drop: target=', rawTarget?.node.type.name, '@', rawTarget?.pos, 'src=', srcNodeType, '@', srcPos);
                if (!rawTarget) return;
                if (!canDrop(doc, srcPos, srcNode, rawTarget.pos, rawTarget.node)) {
                  if (import.meta.env.DEV) console.warn('[drag] drop abort: canDrop=false');
                  return;
                }
                const plan = planDrop(editorView, srcNodeType, rawTarget, e.clientY);
                if (plan.pos === srcPos) return;
                if (import.meta.env.DEV) console.warn('[drag] plan:', plan.kind, plan.node.type.name, '@', plan.pos);

                // Folded-heading section move: shift the whole block range.
                // Only top-level before/after placements — a folded section
                // can't nest inside list items.
                if (isRangeDrag) {
                  if (plan.kind !== 'before' && plan.kind !== 'after') return;
                  if (doc.resolve(plan.pos).depth !== 0) return;
                  const insertAt = plan.kind === 'after' ? plan.pos + plan.node.nodeSize : plan.pos;
                  if (insertAt >= srcPos && insertAt <= srcRangeEnd) return;
                  const content = doc.slice(srcPos, srcRangeEnd).content;
                  const tr = editorView.state.tr;
                  if (insertAt <= srcPos) {
                    tr.insert(insertAt, content);
                    tr.delete(tr.mapping.map(srcPos), tr.mapping.map(srcRangeEnd));
                  } else {
                    tr.delete(srcPos, srcRangeEnd);
                    tr.insert(tr.mapping.map(insertAt), content);
                  }
                  editorView.dispatch(tr.scrollIntoView());
                  editorView.focus();
                  return;
                }

                const $src = doc.resolve(srcPos);
                const srcIsItem = ITEM_NAMES.includes(srcNode.type.name);
                const planTargetIsItem = ITEM_NAMES.includes(plan.node.type.name);
                const srcIsOnlyChild = srcIsItem && $src.parent.childCount === 1;

                let insertAt: number;
                let nodeToInsert: PmNode = srcNode;

                if (plan.kind === 'into-first') {
                  // first-child slot: right after the target item's own paragraph
                  const para = plan.node.firstChild;
                  insertAt = plan.pos + 1 + (para ? para.nodeSize : 0);
                  const second = plan.node.maybeChild(1);
                  if (second && LIST_NAMES.includes(second.type.name)
                      && second.firstChild && second.firstChild.type === srcNode.type) {
                    insertAt += 1; // step inside the existing child list, at its start
                  } else {
                    nodeToInsert = $src.parent.type.create($src.parent.attrs, srcNode);
                  }
                } else if (plan.kind === 'into-last') {
                  insertAt = plan.pos + plan.node.nodeSize - 1;
                } else {
                  insertAt = plan.kind === 'after' ? plan.pos + plan.node.nodeSize : plan.pos;
                  if (srcIsItem && !planTargetIsItem) {
                    nodeToInsert = srcIsOnlyChild
                      ? $src.parent
                      : $src.parent.type.create($src.parent.attrs, srcNode);
                  }
                }

                let delFrom = srcPos;
                let delTo = srcPos + srcNode.nodeSize;
                if (srcIsOnlyChild) {
                  delFrom = $src.before($src.depth);
                  delTo = delFrom + $src.parent.nodeSize;
                }
                // 단의 마지막 블록을 빼내면 그 단도 함께 제거
                // (1단만 남은 행은 Columns의 normalize가 자동 해제)
                {
                  const $del = doc.resolve(delFrom);
                  if ($del.parent.type.name === 'column' && $del.parent.childCount === 1) {
                    delFrom = $del.before();
                    delTo = delFrom + $del.parent.nodeSize;
                  }
                }

                if (insertAt === delFrom || insertAt === delTo) return;
                if (insertAt > delFrom && insertAt < delTo) return;

                const tr = editorView.state.tr;
                if (insertAt <= delFrom) {
                  tr.insert(insertAt, nodeToInsert);
                  const mFrom = tr.mapping.map(delFrom);
                  const mTo = tr.mapping.map(delTo);
                  tr.delete(mFrom, mTo);
                } else {
                  tr.delete(delFrom, delTo);
                  const mapped = tr.mapping.map(insertAt);
                  tr.insert(mapped, nodeToInsert);
                }

                editorView.dispatch(tr.scrollIntoView());
                editorView.focus();
              } catch { /* move failed */ }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          };

          editorView.dom.addEventListener('mousedown', onMouseDown, true);

          // ── 컬럼 내부 블록용 ⠿ 호버 핸들 ──
          // 왼쪽 거터는 컬럼 행 전체를 잡으므로, 단 안의 개별 블록은
          // 블록 왼쪽에 나타나는 핸들로 잡아서 꺼내거나 재배치한다.
          const colHandle = document.createElement('div');
          colHandle.className = 'col-block-handle';
          colHandle.title = '드래그하여 이동';
          colHandle.innerHTML =
            '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">'
            + '<circle cx="3" cy="2.5" r="1.15"/><circle cx="7" cy="2.5" r="1.15"/>'
            + '<circle cx="3" cy="7" r="1.15"/><circle cx="7" cy="7" r="1.15"/>'
            + '<circle cx="3" cy="11.5" r="1.15"/><circle cx="7" cy="11.5" r="1.15"/>'
            + '</svg>';
          colHandle.style.display = 'none';
          document.body.appendChild(colHandle);
          let colHoverPos: number | null = null;

          const hideColHandle = () => { colHandle.style.display = 'none'; colHoverPos = null; };

          const showHandleAt = (pos: number, rect: DOMRect, x: number) => {
            colHoverPos = pos;
            colHandle.style.display = 'flex';
            colHandle.style.left = `${x}px`;
            colHandle.style.top = `${rect.top + Math.max(0, (Math.min(rect.height, 24) - 20) / 2)}px`;
          };

          const onHover = (e: MouseEvent) => {
            if (editorView.dom.classList.contains('block-dragging')) { hideColHandle(); return; }

            // 1) 컬럼 안 블록: 컬럼 노드의 자식들을 위치로 순회하며 DOM 일치로
            //    찾는다 (posAtDOM은 이미지 같은 리프 노드뷰에서 실패).
            const colEl = (e.target as HTMLElement)?.closest?.('.md-column') as HTMLElement | null;
            if (colEl && editorView.dom.contains(colEl)) {
              let targetEl: HTMLElement | null = null;
              for (const child of Array.from(colEl.children) as HTMLElement[]) {
                const r = child.getBoundingClientRect();
                if (e.clientY >= r.top && e.clientY <= r.bottom) { targetEl = child; break; }
              }
              if (!targetEl) { hideColHandle(); return; }
              try {
                const colInner = editorView.posAtDOM(colEl, 0);
                const $c = editorView.state.doc.resolve(colInner);
                if ($c.parent.type.name !== 'column') { hideColHandle(); return; }
                let p = $c.start();
                let found: number | null = null;
                $c.parent.forEach((child) => {
                  if (found === null) {
                    const dom = editorView.nodeDOM(p);
                    if (dom === targetEl || (dom instanceof HTMLElement && (dom.contains(targetEl) || targetEl.contains(dom)))) {
                      found = p;
                    }
                  }
                  p += child.nodeSize;
                });
                if (found === null) { hideColHandle(); return; }
                const tr = targetEl.getBoundingClientRect();
                showHandleAt(found, tr, tr.left - 17);
              } catch { hideColHandle(); }
              return;
            }

            // 2) 일반 블록: 보이지 않는 거터 대신 명시적인 그립 칩을 모든
            //    블록에 표시. 최상위 블록은 바깥 슬롯(-46px)이라 접기/토글
            //    화살표(안쪽 슬롯)와 겹치지 않는다.
            const block = resolveBlock(editorView, e.clientY);
            if (!block) { hideColHandle(); return; }
            const isItem = ITEM_NAMES.includes(block.node.type.name);
            const rect = isItem ? itemFirstLineRect(block.dom) : block.dom.getBoundingClientRect();
            if (e.clientY < rect.top - 8 || e.clientY > (isItem ? rect.bottom + 8 : block.dom.getBoundingClientRect().bottom + 8)) {
              hideColHandle();
              return;
            }
            // X는 항상 왼쪽 여백(바깥 슬롯)으로 통일 — 들여쓰기 줄 옆에 띄우면
            // 체크박스/불릿을 가린다. Y만 해당 줄을 따라간다.
            const gutterX = editorView.dom.getBoundingClientRect().left + 4;
            showHandleAt(block.pos, rect, gutterX);
          };
          const onLeave = (e: MouseEvent) => {
            // 핸들 자체로 이동하는 중이면 유지 (핸들은 body 소속이라 leave로 잡힘)
            if (e.relatedTarget === colHandle) return;
            hideColHandle();
          };
          colHandle.addEventListener('mouseleave', () => hideColHandle());

          const onColHandleDown = (event: MouseEvent) => {
            if (event.button !== 0 || colHoverPos === null) return;
            const node = editorView.state.doc.nodeAt(colHoverPos);
            const dom = editorView.nodeDOM(colHoverPos);
            if (!node || !(dom instanceof HTMLElement)) return;
            const info: BlockInfo = { pos: colHoverPos, node, dom };
            hideColHandle();
            beginDrag(event, info, null);
          };

          editorView.dom.addEventListener('mousemove', onHover);
          editorView.dom.addEventListener('mouseleave', onLeave);
          colHandle.addEventListener('mousedown', onColHandleDown);

          // ── 그립 칩 우클릭: 블록 변환/삽입 메뉴 ──
          let blockMenu: HTMLDivElement | null = null;
          const closeBlockMenu = () => {
            blockMenu?.remove();
            blockMenu = null;
            document.removeEventListener('mousedown', onDocDownForMenu, true);
          };
          const onDocDownForMenu = (ev: MouseEvent) => {
            if (blockMenu && ev.target instanceof Node && !blockMenu.contains(ev.target)) closeBlockMenu();
          };

          const insertColumnsBelow = (pos: number, count: number) => {
            const node = editorView.state.doc.nodeAt(pos);
            const { columns, column, paragraph } = editorView.state.schema.nodes;
            if (!node || !columns || !column || !paragraph) return;
            const cols = Array.from({ length: count }, () => column.create(null, paragraph.create()));
            try {
              const tr = editorView.state.tr.insert(pos + node.nodeSize, columns.create(null, cols));
              editorView.dispatch(tr.scrollIntoView());
              editorView.focus();
            } catch { /* schema가 허용하지 않는 위치 */ }
          };
          const wrapInToggle = (pos: number) => {
            const node = editorView.state.doc.nodeAt(pos);
            const { toggle, paragraph } = editorView.state.schema.nodes;
            if (!node || !toggle || !paragraph) return;
            const content = node.type.name === 'paragraph' ? [node] : [paragraph.create(), node];
            try {
              const tr = editorView.state.tr.replaceWith(pos, pos + node.nodeSize, toggle.create({ open: true }, content));
              editorView.dispatch(tr.scrollIntoView());
              editorView.focus();
            } catch { /* 첫 문단 자리 등 스키마 제약 */ }
          };
          const duplicateBlock = (pos: number) => {
            const node = editorView.state.doc.nodeAt(pos);
            if (!node) return;
            try {
              editorView.dispatch(editorView.state.tr.insert(pos + node.nodeSize, node).scrollIntoView());
            } catch { /* 복제 불가 위치 */ }
          };
          const deleteBlock = (pos: number) => {
            const node = editorView.state.doc.nodeAt(pos);
            if (!node) return;
            let delFrom = pos;
            let delTo = pos + node.nodeSize;
            try {
              const $d = editorView.state.doc.resolve(delFrom);
              if ($d.parent.type.name === 'column' && $d.parent.childCount === 1) {
                delFrom = $d.before();
                delTo = delFrom + $d.parent.nodeSize;
              }
              editorView.dispatch(editorView.state.tr.delete(delFrom, delTo));
            } catch { /* delete failed */ }
          };

          const openBlockMenu = (x: number, y: number, pos: number) => {
            closeBlockMenu();
            const node = editorView.state.doc.nodeAt(pos);
            if (!node) return;
            const menu = document.createElement('div');
            menu.className = 'slash-menu';

            const add = (label: string, action: () => void) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'slash-menu-item';
              const span = document.createElement('span');
              span.textContent = label;
              btn.appendChild(span);
              btn.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                closeBlockMenu();
                action();
              });
              menu.appendChild(btn);
            };
            const divider = () => {
              const d = document.createElement('div');
              d.className = 'slash-menu-divider';
              menu.appendChild(d);
            };

            const inside = Math.min(pos + 1, editorView.state.doc.content.size);
            const chain = () => editor.chain().focus().setTextSelection(inside);

            if (node.isTextblock) {
              add('문단으로 전환', () => chain().setNode('paragraph').run());
              add('제목 1', () => chain().setNode('heading', { level: 1 }).run());
              add('제목 2', () => chain().setNode('heading', { level: 2 }).run());
              add('제목 3', () => chain().setNode('heading', { level: 3 }).run());
              add('코드 블록으로', () => chain().setNode('codeBlock').run());
              add('인용구 토글', () => chain().toggleBlockquote().run());
              divider();
            }
            add('아래에 2단 컬럼 삽입', () => insertColumnsBelow(pos, 2));
            add('아래에 3단 컬럼 삽입', () => insertColumnsBelow(pos, 3));
            if (node.type.name !== 'toggle' && node.type.name !== 'columns') {
              add('토글로 감싸기', () => wrapInToggle(pos));
            }
            divider();
            add('블록 복제', () => duplicateBlock(pos));
            add('블록 삭제', () => deleteBlock(pos));

            document.body.appendChild(menu);
            const mr = menu.getBoundingClientRect();
            menu.style.left = `${Math.min(x, window.innerWidth - mr.width - 8)}px`;
            menu.style.top = `${Math.min(y, window.innerHeight - mr.height - 8)}px`;
            blockMenu = menu;
            setTimeout(() => document.addEventListener('mousedown', onDocDownForMenu, true), 0);
          };

          colHandle.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (colHoverPos !== null) openBlockMenu(ev.clientX, ev.clientY, colHoverPos);
          });

          return {
            destroy() {
              editorView.dom.removeEventListener('mousedown', onMouseDown, true);
              editorView.dom.removeEventListener('mousemove', onHover);
              editorView.dom.removeEventListener('mouseleave', onLeave);
              closeBlockMenu();
              colHandle.remove();
              dropLine?.remove();
              dropLine = null;
            },
          };
        },
      }),
    ];
  },
});
