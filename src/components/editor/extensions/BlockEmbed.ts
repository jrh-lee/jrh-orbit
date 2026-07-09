import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { Node as PmNode } from '@tiptap/pm/model';
import { BlockEmbedView } from '../BlockEmbedView';

/**
 * Synced Block (블록 미러) — Notion의 synced block v1.
 *
 * 원본 블록(영구 ID ^abc123)이 단일 진실이고, 이 노드는 그 내용을 실시간
 * 렌더링하는 읽기 전용 미러다. 원본을 수정하면 모든 미러가 자동 갱신된다.
 * 마크다운에는 HTML 태그로 저장되어 (html:true) 왕복이 안전하다:
 *
 *   <div data-type="block-embed" data-note="2026-07-06-analysis-001" data-block="^ab12cd"></div>
 */
export const BlockEmbed = Node.create({
  name: 'blockEmbed',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      noteId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-note') ?? '',
      },
      blockId: {
        default: '',
        parseHTML: (el) => (el.getAttribute('data-block') ?? '').replace(/^\^/, ''),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-embed"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'block-embed',
        'data-note': node.attrs.noteId,
        'data-block': `^${node.attrs.blockId}`,
        class: 'block-embed',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockEmbedView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          state.write(
            `<div data-type="block-embed" data-note="${esc(node.attrs.noteId)}" data-block="^${esc(node.attrs.blockId)}"></div>`,
          );
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
