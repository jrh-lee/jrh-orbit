import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

/**
 * Notion식 콜아웃 블록 — 아이콘 + 배경 박스로 강조.
 *
 * 마크다운 왕복은 admonition 스타일 `!` 마커 펜스 — 컬럼(::::)/토글(:::::)의
 * `:` 마커와 다르므로 어떤 조합으로 중첩해도 모호하지 않다:
 *
 *   !!! callout 💡 #fff4c0     ← 아이콘, (선택) 배경색
 *   내용...
 *   !!!
 */

const DEFAULT_EMOJI = '💡';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph block*',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: DEFAULT_EMOJI,
        parseHTML: (el) => el.getAttribute('data-emoji') || DEFAULT_EMOJI,
      },
      bg: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-bg') ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: 'md-callout',
        'data-emoji': node.attrs.emoji || DEFAULT_EMOJI,
        'data-bg': node.attrs.bg || '',
        ...(node.attrs.bg ? { style: `background: ${node.attrs.bg}` } : {}),
      }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          // info 라인은 공백으로 파싱하므로 색상값의 공백 제거 (rgba(1, 2 …) 대비)
          const bgVal = String(node.attrs.bg || '').replace(/\s+/g, '');
          const bg = bgVal ? ` ${bgVal}` : '';
          state.write(`!!! callout ${node.attrs.emoji || DEFAULT_EMOJI}${bg}\n\n`);
          state.renderContent(node);
          state.write('!!!');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(container as any, 'callout', {
              marker: '!',
              render(tokens: any[], idx: number) {
                const token = tokens[idx];
                if (token.nesting !== 1) return '</div>\n';
                // info: "callout 💡 #fff4c0"
                const parts = String(token.info).trim().split(/\s+/);
                const emoji = parts[1] || DEFAULT_EMOJI;
                const raw = parts[2] || '';
                const bg = /^[#a-zA-Z0-9(),.%-]*$/.test(raw) ? raw : '';
                const style = bg ? ` style="background: ${bg}"` : '';
                return `<div data-type="callout" class="md-callout" data-emoji="${emoji}" data-bg="${bg}"${style}>\n`;
              },
            });
          },
        },
      },
    };
  },

  addCommands() {
    return {
      insertCallout:
        (emoji?: string, bg?: string) =>
        ({ chain }: any) =>
          chain()
            .insertContent({
              type: 'callout',
              attrs: { emoji: emoji || DEFAULT_EMOJI, bg: bg || '' },
              content: [{ type: 'paragraph' }],
            })
            .run(),
    } as any;
  },
});

/** 외부 렌더러(BlockEmbedView 등)에서 콜아웃 펜스를 이해시키는 셋업 */
export function setupCalloutMarkdownIt(md: MarkdownIt) {
  md.use(container as any, 'callout', {
    marker: '!',
    render(tokens: any[], idx: number) {
      const token = tokens[idx];
      if (token.nesting !== 1) return '</div>\n';
      const parts = String(token.info).trim().split(/\s+/);
      const emoji = parts[1] || DEFAULT_EMOJI;
      const raw = parts[2] || '';
      const bg = /^[#a-zA-Z0-9(),.%-]*$/.test(raw) ? raw : '';
      const style = bg ? ` style="background: ${bg}"` : '';
      return `<div class="md-callout" data-emoji="${emoji}"${style}>\n`;
    },
  });
}
