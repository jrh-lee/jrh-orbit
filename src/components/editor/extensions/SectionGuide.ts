import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type SectionGuideMap = Record<string, string>;

const sectionGuideKey = new PluginKey('sectionGuide');

export function extractGuideMap(templateBody: string): SectionGuideMap {
  const map: SectionGuideMap = {};
  const lines = templateBody.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch) continue;
    const headingText = headingMatch[2].trim();

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line) continue;
      const commentMatch = line.match(/^<!--\s*(.+?)\s*-->$/);
      if (commentMatch) {
        map[headingText] = commentMatch[1];
      }
      break;
    }
  }

  return map;
}

function isSectionEmpty(doc: any, headingEndPos: number, nextHeadingPos: number): boolean {
  let empty = true;
  doc.nodesBetween(headingEndPos, nextHeadingPos, (node: any) => {
    if (node.type.name === 'heading') return false;
    if (node.isText) {
      const text = (node.text ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
      if (text.length > 0) empty = false;
      return false;
    }
    if (node.type.name === 'table' || node.type.name === 'codeBlock' ||
        node.type.name === 'image' || node.type.name === 'taskList' ||
        node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      empty = false;
      return false;
    }
    return true;
  });
  return empty;
}

function findFirstParagraph(doc: any, from: number, to: number): { pos: number; size: number } | null {
  let result: { pos: number; size: number } | null = null;
  doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (result) return false;
    if (node.type.name === 'heading') return false;
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      result = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
}

export const SectionGuide = Extension.create<{ guideMap: SectionGuideMap }>({
  name: 'sectionGuide',

  addOptions() {
    return { guideMap: {} };
  },

  addProseMirrorPlugins() {
    const guideMap = this.options.guideMap;

    const build = (state: { doc: any }): DecorationSet => {
            if (!guideMap || Object.keys(guideMap).length === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            const headings: { text: string; pos: number; endPos: number }[] = [];

            state.doc.descendants((node: any, pos: number) => {
              if (node.type.name === 'heading') {
                headings.push({
                  text: node.textContent.trim(),
                  pos,
                  endPos: pos + node.nodeSize,
                });
                return false;
              }
              return true;
            });

            for (let i = 0; i < headings.length; i++) {
              const h = headings[i];
              const guide = guideMap[h.text];
              if (!guide) continue;

              const sectionEnd = i + 1 < headings.length
                ? headings[i + 1].pos
                : state.doc.content.size;

              if (h.endPos >= sectionEnd) continue;

              const empty = isSectionEmpty(state.doc, h.endPos, sectionEnd);

              if (empty) {
                const para = findFirstParagraph(state.doc, h.endPos, sectionEnd);
                if (para) {
                  decorations.push(
                    Decoration.node(para.pos, para.pos + para.size, {
                      class: 'section-guide-editable',
                      'data-guide': guide,
                    }),
                  );
                  continue;
                }
              }

              decorations.push(
                Decoration.widget(h.endPos, () => {
                  const div = document.createElement('div');
                  div.className = 'section-guide-hint';
                  div.textContent = guide;
                  div.setAttribute('contenteditable', 'false');
                  return div;
                }, { side: -1 }),
              );
            }

            return DecorationSet.create(state.doc, decorations);
    };

    return [
      new Plugin({
        key: sectionGuideKey,
        // 성능: 문서가 바뀔 때만 재계산 — 커서 이동에는 기존 데코레이션 재사용
        state: {
          init: (_cfg, state) => build(state),
          apply: (tr, old, _oldState, newState) => (tr.docChanged ? build(newState) : old.map(tr.mapping, tr.doc)),
        },
        props: {
          decorations(state) {
            return sectionGuideKey.getState(state);
          },
        },
      }),
    ];
  },
});
