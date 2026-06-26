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

    return false;
  } catch { return false; }
}

export const DragHandle = Extension.create({
  name: 'dragHandle',

  addKeyboardShortcuts() {
    const LIST_TYPES = ['bulletList', 'orderedList', 'taskList'];
    return {
      Tab: () => {
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
            if (!isInLeftGutter(editorView, event.clientX, event.clientY)) return;

            const block = resolveBlock(editorView, event.clientY);
            if (!block) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            try {
              editorView.dispatch(
                editorView.state.tr.setSelection(NodeSelection.create(editorView.state.doc, block.pos)),
              );
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

              const target = resolveBlock(editorView, e.clientY);
              if (!target || target.pos === srcPos) { hideDropLine(); return; }

              const srcNode = editorView.state.doc.nodeAt(srcPos);
              if (!srcNode || !canDrop(editorView.state.doc, srcPos, srcNode, target.pos, target.node)) {
                hideDropLine();
                return;
              }

              const targetRect = target.dom.getBoundingClientRect();
              const isBelow = e.clientY > targetRect.top + targetRect.height / 2;
              dropLine.style.top = `${(isBelow ? targetRect.bottom : targetRect.top) - 1}px`;
              dropLine.style.left = `${targetRect.left}px`;
              dropLine.style.width = `${targetRect.width}px`;
              dropLine.style.opacity = '1';
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
                if (!srcNode || srcNode.type.name !== srcNodeType || srcNode.nodeSize !== srcNodeSize) return;

                const target = resolveBlock(editorView, e.clientY);
                if (!target) return;
                if (!canDrop(doc, srcPos, srcNode, target.pos, target.node)) return;

                const $src = doc.resolve(srcPos);
                const srcIsItem = srcNode.type.name === 'taskItem' || srcNode.type.name === 'listItem';
                const targetIsItem = target.node.type.name === 'taskItem' || target.node.type.name === 'listItem';
                const srcIsOnlyChild = srcIsItem && $src.parent.childCount === 1;

                const targetRect = target.dom.getBoundingClientRect();
                const isBelow = e.clientY > targetRect.top + targetRect.height / 2;
                const insertAt = isBelow ? target.pos + target.node.nodeSize : target.pos;

                let delFrom = srcPos;
                let delTo = srcPos + srcNode.nodeSize;
                if (srcIsOnlyChild) {
                  delFrom = $src.before($src.depth);
                  delTo = delFrom + $src.parent.nodeSize;
                }

                let nodeToInsert: PmNode = srcNode;
                if (srcIsItem && !targetIsItem) {
                  if (srcIsOnlyChild) {
                    nodeToInsert = $src.parent;
                  } else {
                    nodeToInsert = $src.parent.type.create($src.parent.attrs, srcNode);
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
