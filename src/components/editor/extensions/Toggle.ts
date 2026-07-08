import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

/**
 * Notion식 토글 블록.
 *
 * 첫 문단 = 요약 줄, 나머지 = 접히는 내용. 접기 화살표는 본문이 아니라
 * 왼쪽 드래그 거터 위치에 표시된다 (헤딩 접기와 동일한 자리).
 *
 * 마크다운 왕복은 5-콜론 펜스 — 내부는 순수 마크다운 유지:
 *
 *   ::::: toggle open      ← open = 펼쳐진 상태로 저장
 *   요약 줄
 *
 *   내용...
 *   :::::
 *
 * (컬럼의 ::::/:::와 콜론 수가 달라 중첩이 모호하지 않다)
 */

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'paragraph block*',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false',
        renderHTML: (attrs) => ({ 'data-open': String(attrs.open !== false) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle', class: 'md-toggle' }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          state.write(`::::: toggle${node.attrs.open ? ' open' : ''}\n\n`);
          state.renderContent(node);
          state.write(':::::');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(container as any, 'toggle', {
              render(tokens: any[], idx: number) {
                const token = tokens[idx];
                if (token.nesting !== 1) return '</div>\n';
                const open = /\bopen\b/.test(token.info);
                return `<div data-type="toggle" class="md-toggle" data-open="${open}">\n`;
              },
            });
          },
        },
      },
    };
  },

  addCommands() {
    return {
      insertToggle:
        () =>
        ({ chain }: any) =>
          chain()
            .insertContent({ type: 'toggle', attrs: { open: true }, content: [{ type: 'paragraph' }] })
            .run(),
    } as any;
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('toggleArrow'),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'toggle') return true;
              const open = node.attrs.open !== false;
              decos.push(
                Decoration.widget(
                  pos + 1,
                  (view) => {
                    const btn = document.createElement('button');
                    btn.className = 'md-toggle-arrow' + (open ? ' open' : '');
                    btn.type = 'button';
                    btn.title = open ? '접기' : '펼치기';
                    btn.contentEditable = 'false';
                    btn.innerHTML =
                      '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1.5L7.5 5 3 8.5"/></svg>';
                    btn.addEventListener('mousedown', (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: !open });
                      tr.setMeta('addToHistory', false);
                      view.dispatch(tr);
                    });
                    return btn;
                  },
                  { side: -1, ignoreSelection: true, key: `toggle-${pos}-${open}` },
                ),
              );
              return true; // 토글 안 토글도 지원
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
