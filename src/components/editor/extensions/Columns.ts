import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

/**
 * 단 분리 (2/3-column layout), Notion-style.
 *
 * Markdown round-trip uses fenced containers so column contents stay plain
 * markdown (task-sync regexes and other markdown apps keep working):
 *
 *   :::: columns
 *   ::: column
 *   (markdown)
 *   :::
 *   ::: column
 *   (markdown)
 *   :::
 *   ::::
 *
 * The outer fence is 4 colons so the nesting is unambiguous.
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
      return tokens[idx].nesting === 1
        ? '<div data-type="column" class="md-column">\n'
        : '</div>\n';
    },
  });
}

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

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
            state.write('::: column\n\n');
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
});
