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
import { Columns, Column } from './extensions/Columns';
import { Toggle } from './extensions/Toggle';
import { Callout } from './extensions/Callout';
import { BlockEmbed } from './extensions/BlockEmbed';
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

/** 블록 링크의 영구 ID 마커(^abc123)를 화면에서 숨긴다 —
 *  마크다운에는 남아 링크 대상 식별에 쓰인다 (Obsidian block id 방식)
 *  성능: 문서가 바뀔 때만 전체 스캔, 커서 이동 등에는 기존 데코레이션 재사용 */
const hideBlockIdsKey = new PluginKey<DecorationSet>('hideBlockIds');
function buildBlockIdDecos(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    // 마커가 연달아 붙을 수 있음 (편집으로 시작/끝 마커가 한 줄에 합쳐진 경우)
    const m = text.match(/(\s\^[a-z0-9]{4,})+$/);
    if (m && m.index !== undefined) {
      const from = pos + 1 + m.index;
      decorations.push(Decoration.inline(from, from + m[0].length, { class: 'block-id-marker' }));
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}
const HideBlockIds = Extension.create({
  name: 'hideBlockIds',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: hideBlockIdsKey,
        state: {
          init: (_cfg, state) => buildBlockIdDecos(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildBlockIdDecos(tr.doc) : old.map(tr.mapping, tr.doc)),
        },
        props: {
          decorations(state) {
            return hideBlockIdsKey.getState(state);
          },
        },
      }),
    ];
  },
});

const hideTaskMetaKey = new PluginKey<DecorationSet>('hideTaskMeta');
function buildTaskMetaDecos(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const $pos = doc.resolve(pos);
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
  return DecorationSet.create(doc, decorations);
}

const HideTaskMeta = Extension.create({
  name: 'hideTaskMeta',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: hideTaskMetaKey,
        state: {
          init: (_cfg, state) => buildTaskMetaDecos(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildTaskMetaDecos(tr.doc) : old.map(tr.mapping, tr.doc)),
        },
        props: {
          decorations(state) {
            return hideTaskMetaKey.getState(state);
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
      // 아래에서 note:// 프로토콜 등 커스텀 설정으로 직접 등록 — 중복 방지
      link: false,
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
      addStorage() {
        return {
          markdown: {
            // ![alt](src) drops width/caption/align — serialize as a raw
            // <img> tag when any of them is set (html:true parses it back).
            serialize(state: any, node: PmNode) {
              const { src, alt, title, width, caption, textAlign } = node.attrs;
              const hasExtras = !!width || !!caption || (textAlign && textAlign !== 'center');
              if (hasExtras) {
                const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                let tag = `<img src="${esc(src)}"`;
                if (alt) tag += ` alt="${esc(alt)}"`;
                if (title) tag += ` title="${esc(title)}"`;
                if (width) tag += ` width="${parseInt(String(width), 10)}"`;
                if (caption) tag += ` data-caption="${esc(caption)}"`;
                if (textAlign && textAlign !== 'center') tag += ` data-align="${esc(textAlign)}"`;
                tag += '>';
                state.write(tag);
              } else {
                state.write(`![${(alt || '').replace(/([\[\]])/g, '\\$1')}](${src}${title ? ` "${String(title).replace(/"/g, '\\"')}"` : ''})`);
              }
              state.closeBlock(node);
            },
          },
        };
      },
    }).configure({
      inline: false,
      allowBase64: true,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      // note:// 스킴은 main.tsx에서 앱 시작 시 한 번만 linkify에 등록 —
      // 여기(protocols)에 넣으면 에디터 생성마다 재등록 경고가 뜬다.
      // URL 검증: note://, smb://(네트워크 공유), 첨부 상대 경로를 허용 —
      // 안 하면 마크다운 로드 시 링크 마크가 벗겨져 일반 텍스트가 된다.
      isAllowedUri: (url, ctx) =>
        url.startsWith('note://') || url.startsWith('smb://') || url.startsWith('attachments/') ||
        ctx.defaultValidate(url),
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
    HideBlockIds,
    DragHandle,
    HeadingFold,
    SlashCommand,
    Columns,
    Column,
    Toggle,
    Callout,
    BlockEmbed,
    Markdown.configure({
      html: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    TightListSerializer,
  ];
}
