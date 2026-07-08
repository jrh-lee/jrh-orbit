import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import { Suggestion } from '@tiptap/suggestion';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';

/**
 * Notion-style slash command menu. Type `/` (after a space or at line start)
 * to insert blocks. Plain-DOM popup — no tippy/react renderer dependency.
 */

interface SlashItem {
  title: string;
  icon: string;
  /** Match targets besides the title (english + korean aliases) */
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
}

const ITEMS: SlashItem[] = [
  {
    title: '제목 1', icon: 'H1', keywords: ['h1', 'heading', '제목1', '헤딩'],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run(),
  },
  {
    title: '제목 2', icon: 'H2', keywords: ['h2', 'heading', '제목2', '헤딩'],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run(),
  },
  {
    title: '제목 3', icon: 'H3', keywords: ['h3', 'heading', '제목3', '헤딩'],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run(),
  },
  {
    title: '할 일 목록', icon: '☑', keywords: ['todo', 'task', 'check', '할일', '체크', '체크박스'],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    title: '글머리 목록', icon: '•', keywords: ['bullet', 'list', 'ul', '목록', '글머리', '리스트'],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: '번호 목록', icon: '1.', keywords: ['ordered', 'number', 'ol', '번호', '숫자'],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: '표', icon: '▦', keywords: ['table', '표', '테이블'],
    run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: '코드 블록', icon: '</>', keywords: ['code', '코드'],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: '인용구', icon: '❝', keywords: ['quote', 'blockquote', '인용'],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: '구분선', icon: '—', keywords: ['divider', 'hr', 'line', '구분', '구분선', '수평선'],
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

function filterItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (!q) return ITEMS;
  return ITEMS.filter(
    (i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)),
  );
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        allow: ({ state }) => {
          const { $from } = state.selection;
          return $from.parent.type.name !== 'codeBlock';
        },
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
        items: ({ query }) => filterItems(query),
        render: () => {
          let el: HTMLDivElement | null = null;
          let items: SlashItem[] = [];
          let selected = 0;
          let command: (item: SlashItem) => void = () => {};

          const renderList = () => {
            if (!el) return;
            el.innerHTML = '';
            el.style.display = items.length === 0 ? 'none' : 'block';
            items.forEach((item, i) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'slash-menu-item' + (i === selected ? ' active' : '');
              const icon = document.createElement('span');
              icon.className = 'slash-menu-icon';
              icon.textContent = item.icon;
              const label = document.createElement('span');
              label.textContent = item.title;
              btn.append(icon, label);
              btn.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                command(item);
              });
              el!.appendChild(btn);
            });
          };

          const position = (rect: DOMRect | null) => {
            if (!el || !rect) return;
            const height = el.offsetHeight;
            const top = rect.bottom + 4 + height > window.innerHeight
              ? Math.max(4, rect.top - height - 4)
              : rect.bottom + 4;
            el.style.left = `${Math.min(rect.left, window.innerWidth - 190)}px`;
            el.style.top = `${top}px`;
          };

          return {
            onStart: (props: SuggestionProps<SlashItem>) => {
              el = document.createElement('div');
              el.className = 'slash-menu';
              document.body.appendChild(el);
              items = props.items;
              selected = 0;
              command = (item) => props.command(item);
              renderList();
              position(props.clientRect?.() ?? null);
            },
            onUpdate: (props: SuggestionProps<SlashItem>) => {
              items = props.items;
              if (selected >= items.length) selected = 0;
              command = (item) => props.command(item);
              renderList();
              position(props.clientRect?.() ?? null);
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (!el || items.length === 0) return false;
              if (props.event.key === 'ArrowDown') {
                selected = (selected + 1) % items.length;
                renderList();
                return true;
              }
              if (props.event.key === 'ArrowUp') {
                selected = (selected - 1 + items.length) % items.length;
                renderList();
                return true;
              }
              if (props.event.key === 'Enter' || props.event.key === 'Tab') {
                if (items[selected]) {
                  command(items[selected]);
                  return true;
                }
                return false;
              }
              if (props.event.key === 'Escape') {
                el.style.display = 'none';
                items = [];
                return true;
              }
              return false;
            },
            onExit: () => {
              el?.remove();
              el = null;
            },
          };
        },
      }),
    ];
  },
});
