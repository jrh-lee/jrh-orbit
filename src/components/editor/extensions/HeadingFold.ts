import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/**
 * Obsidian/Notion-style heading folding.
 *
 * Each top-level heading gets a fold arrow (visible on hover, or always when
 * folded). Folding hides every following top-level block until the next
 * heading of the same or higher level.
 *
 * The `folded` attribute is view-state only (`rendered: false`): it never
 * reaches the markdown serialization, so folded content is always saved in
 * full and fold state resets when a note is reopened.
 */

function toggleFold(view: EditorView, pos: number, node: PMNode, hiddenEnd: number) {
  const folded = node.attrs.folded === true;
  let tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, folded: !folded });
  // Folding with the cursor inside the soon-hidden region would leave an
  // invisible cursor editing hidden text — park it at the heading end instead.
  if (!folded) {
    const { from } = view.state.selection;
    const start = pos + node.nodeSize;
    if (from >= start && from <= hiddenEnd) {
      tr = tr.setSelection(TextSelection.create(tr.doc, pos + node.nodeSize - 1));
    }
  }
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
}

export const HeadingFold = Extension.create({
  name: 'headingFold',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          folded: {
            default: false,
            rendered: false,
            keepOnSplit: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingFold'),
        props: {
          decorations(state) {
            const doc = state.doc;
            const children: { node: PMNode; pos: number }[] = [];
            doc.forEach((node, offset) => children.push({ node, pos: offset }));

            const decos: Decoration[] = [];

            for (let i = 0; i < children.length; i++) {
              const { node, pos } = children[i];
              if (node.type.name !== 'heading') continue;

              const level: number = node.attrs.level ?? 1;
              const folded = node.attrs.folded === true;

              // Range of blocks this heading governs
              let end = i;
              for (let j = i + 1; j < children.length; j++) {
                const c = children[j];
                if (c.node.type.name === 'heading' && (c.node.attrs.level ?? 1) <= level) break;
                end = j;
              }
              const hasBody = end > i;
              const hiddenEnd = hasBody ? children[end].pos + children[end].node.nodeSize : pos + node.nodeSize;

              if (hasBody || folded) {
                decos.push(
                  Decoration.widget(
                    pos + 1,
                    (view) => {
                      const btn = document.createElement('button');
                      btn.className = 'heading-fold-arrow' + (folded ? ' folded' : '');
                      btn.type = 'button';
                      btn.title = folded ? '펼치기' : '접기';
                      btn.contentEditable = 'false';
                      btn.tabIndex = -1; // Tab 포커스 이동 대상에서 제외
                      btn.innerHTML =
                        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1.5L7.5 5 3 8.5"/></svg>';
                      btn.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFold(view, pos, node, hiddenEnd);
                      });
                      return btn;
                    },
                    { side: -1, ignoreSelection: true, key: `fold-${pos}-${folded}` },
                  ),
                );
              }

              if (folded) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'heading-is-folded' }));
                for (let j = i + 1; j <= end; j++) {
                  const c = children[j];
                  decos.push(Decoration.node(c.pos, c.pos + c.node.nodeSize, { class: 'heading-fold-hidden' }));
                }
              }
            }

            return DecorationSet.create(doc, decos);
          },
        },
      }),
    ];
  },
});
