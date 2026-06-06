import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { Mathematics } from '@tiptap/extension-mathematics';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Markdown } from 'tiptap-markdown';
import { SmartTransform } from './extensions/SmartTransform';
import { SectionGuide, type SectionGuideMap } from './extensions/SectionGuide';
import { common, createLowlight } from 'lowlight';
import { CodeBlockView } from './CodeBlockView';
import { ResizableImageView } from './ResizableImageView';
import type { Node as PmNode } from '@tiptap/pm/model';
import 'katex/dist/katex.min.css';

const TASK_META_RE = /^(\\?\[[^\]\\]+\\?\]\s*)?(\\?\(이월\\?\)\s*)?/;

const HideTaskMeta = Extension.create({
  name: 'hideTaskMeta',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('hideTaskMeta'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              const $pos = state.doc.resolve(pos);
              if ($pos.depth < 2) return;
              const grandparent = $pos.node($pos.depth - 1);
              if (grandparent?.type.name !== 'taskItem') return;
              const parent = $pos.parent;
              if (parent.type.name !== 'paragraph') return;
              if (parent.firstChild !== node) return;
              const text = node.text ?? '';
              const m = text.match(TASK_META_RE);
              if (m && m[0].length > 0) {
                const hasCarryOver = !!m[2];
                decorations.push(
                  Decoration.inline(pos, pos + m[0].length, { class: 'task-id-hidden' }),
                );
                if (hasCarryOver) {
                  decorations.push(
                    Decoration.widget(pos, () => {
                      const span = document.createElement('span');
                      span.className = 'task-carry-badge';
                      span.textContent = '🔄';
                      span.title = '이월된 항목';
                      return span;
                    }, { side: -1 }),
                  );
                }
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

const ZWS = '​';

function preprocessEmptyCheckboxes(md: string): string {
  return md.replace(/^(- \[[ xX]\])\s*$/gm, `$1 ${ZWS}`);
}

export { preprocessEmptyCheckboxes };

const lowlight = createLowlight(common);

export interface MathClickInfo {
  node: PmNode;
  pos: number;
}

interface ExtensionOptions {
  placeholder?: string;
  onMathClick?: (info: MathClickInfo) => void;
  smartTransform?: boolean;
  sectionGuides?: SectionGuideMap;
}

export function getExtensions(opts?: ExtensionOptions | string) {
  const { placeholder, onMathClick, smartTransform = true, sectionGuides } = typeof opts === 'string'
    ? { placeholder: opts, onMathClick: undefined, smartTransform: true, sectionGuides: undefined }
    : (opts ?? {});

  const mathClickHandler = onMathClick
    ? (node: PmNode, pos: number) => onMathClick({ node, pos })
    : undefined;

  return [
    StarterKit.configure({
      codeBlock: false,
    }),
    Placeholder.configure({
      placeholder: placeholder ?? 'Start writing...',
    }),
    Highlight.configure({
      multicolor: true,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    CodeBlockLowlight.configure({
      lowlight,
    }).extend({
      addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView);
      },
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          backgroundColor: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-bg-color') || el.style.backgroundColor || null,
            renderHTML: (attrs) => {
              if (!attrs.backgroundColor) return {};
              return { 'data-bg-color': attrs.backgroundColor, style: `background-color: ${attrs.backgroundColor}` };
            },
          },
        };
      },
    }),
    TableHeader.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          backgroundColor: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-bg-color') || el.style.backgroundColor || null,
            renderHTML: (attrs) => {
              if (!attrs.backgroundColor) return {};
              return { 'data-bg-color': attrs.backgroundColor, style: `background-color: ${attrs.backgroundColor}` };
            },
          },
        };
      },
    }),
    Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          width: {
            default: null,
            parseHTML: (el) => {
              const w = el.getAttribute('width') || el.style.width;
              return w ? parseInt(w, 10) || null : null;
            },
            renderHTML: (attrs) => {
              if (!attrs.width) return {};
              return { width: attrs.width };
            },
          },
          textAlign: {
            default: 'center',
            parseHTML: (el) => {
              return el.getAttribute('data-align')
                || el.style.textAlign
                || 'center';
            },
            renderHTML: (attrs) => {
              if (!attrs.textAlign || attrs.textAlign === 'center') return {};
              return { 'data-align': attrs.textAlign };
            },
          },
          caption: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-caption') || null,
            renderHTML: (attrs) => {
              if (!attrs.caption) return {};
              return { 'data-caption': attrs.caption };
            },
          },
        };
      },
      addNodeView() {
        return ReactNodeViewRenderer(ResizableImageView);
      },
    }).configure({
      inline: false,
      allowBase64: true,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['note'],
      HTMLAttributes: {
        target: null,
        rel: null,
        class: null,
      },
    }),
    TextStyle,
    Color,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    Mathematics.configure({
      inlineOptions: { onClick: mathClickHandler },
      blockOptions: { onClick: mathClickHandler },
    }),
    ...(smartTransform ? [SmartTransform] : []),
    ...(sectionGuides && Object.keys(sectionGuides).length > 0
      ? [SectionGuide.configure({ guideMap: sectionGuides })]
      : []),
    HideTaskMeta,
    Markdown.configure({
      html: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}
