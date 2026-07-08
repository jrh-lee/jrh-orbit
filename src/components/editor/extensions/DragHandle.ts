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

  const topRect = topChild.getBoundingClientRect();
  const cy = Math.max(topRect.top + 1, Math.min(y, topRect.bottom - 1));

  const contentX = topRect.left + Math.min(200, topRect.width / 2);
  const posInfo = view.posAtCoords({ left: contentX, top: cy });

  if (!posInfo) {
    try {
      const pos = view.posAtDOM(topChild, 0);
      const $pos = view.state.doc.resolve(pos);
      const bp = $pos.depth > 0 ? $pos.before(1) : 0;
      const node = view.state.doc.nodeAt(bp);
      if (!node) return null;
      return { pos: bp, node, dom: topChild };
    } catch { return null; }
  }

  try {
    const $pos = view.state.doc.resolve(posInfo.pos);

    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d);
      // Tables/code blocks win over their containing list item — otherwise a
      // nested block can never be selected (and moved) on its own.
      if (node.type.name === 'table' || node.type.name === 'codeBlock') {
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

    const bp = $pos.depth > 0 ? $pos.before(1) : 0;
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

    return false;
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
            if (event.target instanceof Element && event.target.closest('.heading-fold-arrow')) return;
            const inGutter = isInLeftGutter(editorView, event.clientX, event.clientY);
            if (!inGutter) return;

            const block = resolveBlock(editorView, event.clientY);
            if (import.meta.env.DEV) console.warn('[drag] down: block=', block?.node.type.name, '@', block?.pos);
            if (!block) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            try {
              editorView.dispatch(
                editorView.state.tr.setSelection(NodeSelection.create(editorView.state.doc, block.pos)),
              );
              // Focus so Tab/Shift-Tab work right after selecting via gutter
              editorView.focus();
            } catch { return; }

            const srcPos = block.pos;
            const srcNodeSize = block.node.nodeSize;
            const srcNodeType = block.node.type.name;
            const startY = event.clientY;
            let dragging = false;

            const onMove = (e: MouseEvent) => {
              if (!dragging && Math.abs(e.clientY - startY) > 5) {
                dragging = true;
                editorView.dom.classList.add('block-dragging');
              }
              if (!dragging || !dropLine) return;

              const rawTarget = resolveBlock(editorView, e.clientY);
              if (!rawTarget || rawTarget.pos === srcPos) { hideDropLine(); return; }

              const srcNode = editorView.state.doc.nodeAt(srcPos);
              if (!srcNode || !canDrop(editorView.state.doc, srcPos, srcNode, rawTarget.pos, rawTarget.node)) {
                hideDropLine();
                return;
              }
              const plan = planDrop(editorView, srcNodeType, rawTarget, e.clientY);
              if (plan.pos === srcPos) { hideDropLine(); return; }
              // dropping into/next to one's own subtree corrupts the doc — hide
              if (plan.pos > srcPos && plan.pos < srcPos + srcNodeSize) { hideDropLine(); return; }

              drawDropLine(dropLine, plan);
            };

            const onUp = (e: MouseEvent) => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              editorView.dom.classList.remove('block-dragging');
              hideDropLine();
              if (!dragging) return;

              try {
                const doc = editorView.state.doc;
                const srcNode = doc.nodeAt(srcPos);
                if (!srcNode || srcNode.type.name !== srcNodeType || srcNode.nodeSize !== srcNodeSize) {
                  if (import.meta.env.DEV) console.warn('[drag] drop abort: src changed');
                  return;
                }

                const rawTarget = resolveBlock(editorView, e.clientY);
                if (import.meta.env.DEV) console.warn('[drag] drop: target=', rawTarget?.node.type.name, '@', rawTarget?.pos, 'src=', srcNodeType, '@', srcPos);
                if (!rawTarget) return;
                if (!canDrop(doc, srcPos, srcNode, rawTarget.pos, rawTarget.node)) {
                  if (import.meta.env.DEV) console.warn('[drag] drop abort: canDrop=false');
                  return;
                }
                const plan = planDrop(editorView, srcNodeType, rawTarget, e.clientY);
                if (plan.pos === srcPos) return;
                if (import.meta.env.DEV) console.warn('[drag] plan:', plan.kind, plan.node.type.name, '@', plan.pos);

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

          return {
            destroy() {
              editorView.dom.removeEventListener('mousedown', onMouseDown, true);
              dropLine?.remove();
              dropLine = null;
            },
          };
        },
      }),
    ];
  },
});
