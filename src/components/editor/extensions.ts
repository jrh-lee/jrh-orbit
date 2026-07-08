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
import { DragHandle } from './extensions/DragHandle';
import { HeadingFold } from './extensions/HeadingFold';
import { SlashCommand } from './extensions/SlashCommand';
import { common, createLowlight } from 'lowlight';
import { CodeBlockView } from './CodeBlockView';
import { ResizableImageView } from './ResizableImageView';
import type { Node as PmNode } from '@tiptap/pm/model';
import 'katex/dist/katex.min.css';

const TaskListWithTight = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          class: attributes.tight ? 'tight' : null,
          'data-tight': attributes.tight ? 'true' : null,
        }),
      },
    };
  },
});

function stripBlanksInLists(md: string): string {
  const listRe = /^[ \t]*(?:[-*+]|\d+\.) /;
  const lines = md.split('\n');
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') { result.push(lines[i]); continue; }
    let prev = result.length - 1;
    while (prev >= 0 && result[prev].trim() === '') prev--;
    let next = i + 1;
    while (next < lines.length && lines[next].trim() === '') next++;
    if (prev >= 0 && next < lines.length && listRe.test(result[prev]) && listRe.test(lines[next])) {
      while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();
    } else {
      result.push(lines[i]);
    }
  }
  return result.join('\n');
}

const TightListSerializer = Extension.create({
  name: 'tightListSerializer',
  onCreate() {
    const serializer = (this.editor.storage as Record<string, any>).markdown?.serializer;
    if (!serializer) return;
    const orig = serializer.serialize.bind(serializer);
    serializer.serialize = (content: any) => stripBlanksInLists(orig(content));
  },
});

const TASK_META_RE = /^(\\?\[[^\]\\]+\\?\]\s*)?(\\?\(이월[^)]*\\?\)\s*)?(\\?\(시작 [^)]*\\?\)\s*)?/;

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
              if (!m || m[0].length === 0) return;

              // Hide the [TASK-xxx] id and the (이월) tag; show a badge instead
              const hideLen = (m[1]?.length ?? 0) + (m[2]?.length ?? 0);
              if (hideLen > 0) {
                decorations.push(
                  Decoration.inline(pos, pos + hideLen, { class: 'task-id-hidden' }),
                );
              }
              if (m[2]) {
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
              // (시작 M/D) — keep visible but subtle, and dim the whole item
              if (m[3]) {
                decorations.push(
                  Decoration.inline(pos + hideLen, pos + hideLen + m[3].length, { class: 'task-start-badge' }),
                );
                const itemPos = $pos.before($pos.depth - 1);
                decorations.push(
                  Decoration.node(itemPos, itemPos + grandparent.nodeSize, { class: 'task-scheduled' }),
                );
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
  // Indented (subtask) empty checkboxes need the ZWS too, or the markdown
  // parser renders them as literal "[ ]" text instead of a checkbox.
  return md.replace(/^([ \t]*- \[[ xX]\])\s*$/gm, `$1 ${ZWS}`);
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
    TaskListWithTight,
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
            parseHTML: (el) => {
              const bg = el.getAttribute('data-bg-color') || el.style.backgroundColor || null;
              if (!bg) return null;
              const norm = bg.toLowerCase().replace(/\s/g, '');
              if (['white', '#fff', '#ffffff', 'rgb(255,255,255)', 'transparent', 'initial'].includes(norm)) return null;
              return bg;
            },
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
            parseHTML: (el) => {
              const bg = el.getAttribute('data-bg-color') || el.style.backgroundColor || null;
              if (!bg) return null;
              const norm = bg.toLowerCase().replace(/\s/g, '');
              if (['white', '#fff', '#ffffff', 'rgb(255,255,255)', 'transparent', 'initial'].includes(norm)) return null;
              return bg;
            },
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
    DragHandle,
    HeadingFold,
    SlashCommand,
    Markdown.configure({
      html: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    TightListSerializer,
  ];
}
