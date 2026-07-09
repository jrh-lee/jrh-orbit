import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { getExtensions, preprocessEmptyCheckboxes } from './extensions';
import type { MathClickInfo } from './extensions';
import { EditorToolbar } from './EditorToolbar';
import { MathEditor } from './MathEditor';
import { searchNotes, getNoteByExactId, type SearchResult } from '../../lib/db';
import type { EditorView } from '@tiptap/pm/view';
import type { Slice, Node as PmDocNode, Fragment } from '@tiptap/pm/model';
import '../../styles/editor.css';

const BORDER_THRESHOLD = 16;

function measureCol(tableEl: HTMLTableElement, colIndex: number): number {
  const span = document.createElement('span');
  span.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;white-space:nowrap;';
  document.body.appendChild(span);
  let maxW = 60;
  for (const r of Array.from(tableEl.rows)) {
    const c = r.cells[colIndex];
    if (!c) continue;
    const cs = getComputedStyle(c);
    span.style.font = cs.font;
    span.style.fontSize = cs.fontSize;
    span.style.fontFamily = cs.fontFamily;
    span.style.fontWeight = cs.fontWeight;
    span.style.letterSpacing = cs.letterSpacing;
    const paras = c.querySelectorAll('p');
    const elems = paras.length > 0 ? Array.from(paras) : [c];
    let cellMax = 0;
    for (const el of elems) {
      span.textContent = el.textContent || '';
      cellMax = Math.max(cellMax, span.offsetWidth);
    }
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
               + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    maxW = Math.max(maxW, cellMax + pad + 4);
  }
  document.body.removeChild(span);
  return maxW;
}

function detectBorderCol(event: MouseEvent): { tableEl: HTMLTableElement; colIndex: number } | null {
  const target = event.target as HTMLElement;
  const cell = target.closest('td, th') as HTMLTableCellElement | null;
  if (!cell) return null;
  const tableEl = cell.closest('table') as HTMLTableElement | null;
  if (!tableEl) return null;
  const row = cell.parentElement as HTMLTableRowElement;
  if (!row) return null;
  const cellIndex = Array.from(row.cells).indexOf(cell);
  if (cellIndex < 0) return null;
  const rect = cell.getBoundingClientRect();
  if (rect.right - event.clientX <= BORDER_THRESHOLD) {
    return { tableEl, colIndex: cellIndex };
  }
  if (event.clientX - rect.left <= BORDER_THRESHOLD && cellIndex > 0) {
    return { tableEl, colIndex: cellIndex - 1 };
  }
  return null;
}

function applyAutoFitCol(view: EditorView, tableEl: HTMLTableElement, colIndex: number) {
  const fitW = measureCol(tableEl, colIndex);
  const pos = view.posAtDOM(tableEl, 0);
  const $pos = view.state.doc.resolve(pos);
  let tblNode = null;
  let tblStart = 0;
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === 'table') {
      tblNode = $pos.node(d);
      tblStart = $pos.start(d);
      break;
    }
  }
  if (!tblNode) return;
  const tr = view.state.tr;
  let off = 0;
  tblNode.forEach((rowNode) => {
    let cc = 0;
    let co = 0;
    rowNode.forEach((cn) => {
      const colspan = cn.attrs.colspan || 1;
      if (cc <= colIndex && colIndex < cc + colspan) {
        const cellPos = tblStart + off + co + 1;
        const cw = cn.attrs.colwidth ? [...cn.attrs.colwidth] : Array(colspan).fill(fitW);
        cw[colIndex - cc] = fitW;
        tr.setNodeMarkup(cellPos, undefined, { ...cn.attrs, colwidth: cw });
      }
      cc += colspan;
      co += cn.nodeSize;
    });
    off += rowNode.nodeSize;
  });
  view.dispatch(tr);
}

/** tiptap-markdown (html:true) entity-escapes `>` to `&gt;` on serialize,
 *  so `A => B` gets stored — and later displayed — as `A =&gt; B`. Undo it
 *  outside fenced code blocks. Line-leading `>` is left escaped so the next
 *  parse doesn't turn the line into a blockquote. Round-trips cleanly:
 *  a mid-line `>` parses back as plain text. */
function unescapeHtmlGt(md: string): string {
  let inFence = false;
  return md.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    if (line.trimStart().startsWith('&gt;')) return line;
    return line.replace(/&gt;/g, '>');
  }).join('\n');
}

function stripLooseListItems(md: string): string {
  const listRe = /^[ \t]*(?:[-*+]|\d+\.) /;
  const lines = md.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      result.push(lines[i]);
      continue;
    }

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

function ensureMarkdownSpacing(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = /^#{1,6} /.test(line);

    if (isHeading && out.length > 0) {
      let lastContentIdx = out.length - 1;
      while (lastContentIdx >= 0 && out[lastContentIdx] === '') lastContentIdx--;

      const prevLine = lastContentIdx >= 0 ? out[lastContentIdx] : '';
      const prevIsHeading = /^#{1,6} /.test(prevLine);
      const prevIsHr = /^-{3,}\s*$/.test(prevLine);

      if (prevIsHr) {
        while (out.length > 0 && out[out.length - 1] === '') out.pop();
      } else if (prevIsHeading) {
        const prevLevel = (prevLine.match(/^(#{1,6}) /) || [])[1]?.length ?? 0;
        const curLevel = (line.match(/^(#{1,6}) /) || [])[1]?.length ?? 0;
        while (out.length > 0 && out[out.length - 1] === '') out.pop();
        if (curLevel <= prevLevel) {
          out.push('', '');
        }
      } else {
        while (out.length > 0 && out[out.length - 1] === '') out.pop();
        out.push('', '');
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

export function insertBlankLinesBeforeHeadings(editor: { state: any; view: any } | null, count = 2) {
  if (!editor) return;
  const { doc, schema } = editor.state;
  const emptyPara = schema.nodes.paragraph.create();
  const insertions: { pos: number; needed: number }[] = [];

  let inTaskSection = false;

  doc.forEach((node: any, offset: number, index: number) => {
    if (node.type.name === 'heading' && node.attrs.level === 2) {
      const text = node.textContent || '';
      inTaskSection = /^작업/.test(text.trim());
    }

    if (node.type.name === 'heading' && index > 0) {
      if (inTaskSection && node.attrs.level === 3) return;

      let prevContentIdx = index - 1;
      while (prevContentIdx >= 0) {
        const prev = doc.child(prevContentIdx);
        if (prev.type.name === 'paragraph' && prev.content.size === 0) {
          prevContentIdx--;
        } else {
          break;
        }
      }
      if (prevContentIdx >= 0) {
        const prevNode = doc.child(prevContentIdx);
        if (prevNode.type.name === 'horizontalRule') {
          return;
        }
        if (prevNode.type.name === 'heading') {
          const prevLevel = prevNode.attrs.level ?? 1;
          const curLevel = node.attrs.level ?? 1;
          if (curLevel > prevLevel) return;
        }
      }

      let existingEmpty = 0;
      for (let i = index - 1; i >= 0; i--) {
        const prev = doc.child(i);
        if (prev.type.name === 'paragraph' && prev.content.size === 0) {
          existingEmpty++;
        } else {
          break;
        }
      }
      const needed = count - existingEmpty;
      if (needed > 0) {
        insertions.push({ pos: offset, needed });
      }
    }
  });

  if (insertions.length === 0) return;

  const tr = editor.state.tr;
  for (let i = insertions.length - 1; i >= 0; i--) {
    const { pos, needed } = insertions[i];
    for (let n = 0; n < needed; n++) {
      tr.insert(pos, emptyPara);
    }
  }

  editor.view.dispatch(tr);
}

import type { SectionGuideMap } from './extensions/SectionGuide';

/* ── Plain-text copy serialization ──
 * Default markdown copy emits raw `- [ ]` markers (doubled for nested task
 * items) and internal metadata. Produce clean text instead: single-line
 * selections copy as bare text; multi-line as •/✓ bullets with indentation.
 * The rich text/html clipboard flavor is unaffected, so pasting into Word
 * or other rich editors keeps real list formatting. */

function cleanTaskText(text: string): string {
  return text
    .replace(/[​‌‍﻿]/g, '')
    .replace(/^\[[A-Za-z0-9-]+(?:\.\d+)?\]\s*/, '')
    .replace(/^\(이월[^)]*\)\s*/, '')
    .trim();
}

function countTextblocks(frag: Fragment): number {
  let n = 0;
  frag.forEach((child) => {
    if (child.isTextblock) n++;
    n += countTextblocks(child.content);
  });
  return n;
}

function sliceToPlainText(slice: Slice): string {
  if (countTextblocks(slice.content) <= 1) {
    return cleanTaskText(slice.content.textBetween(0, slice.content.size, '\n'));
  }

  const lines: string[] = [];
  const BULLETS = ['•', '◦', '▪'];
  const visit = (node: PmDocNode, depth: number) => {
    const t = node.type.name;
    if (t === 'taskItem' || t === 'listItem') {
      const first = node.firstChild;
      const mark = t === 'taskItem' && node.attrs.checked ? '✓' : BULLETS[depth % BULLETS.length];
      lines.push('  '.repeat(depth) + mark + ' ' + cleanTaskText(first?.isTextblock ? first.textContent : ''));
      node.forEach((child) => {
        if (child === first) return;
        if (/List$/.test(child.type.name)) {
          child.forEach((li) => visit(li, depth + 1));
        } else if (child.isTextblock) {
          lines.push('  '.repeat(depth + 1) + cleanTaskText(child.textContent));
        }
      });
      return;
    }
    if (/List$/.test(t)) {
      node.forEach((li) => visit(li, depth));
      return;
    }
    if (t === 'table') {
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(cell.textContent.trim()));
        lines.push(cells.join('\t'));
      });
      return;
    }
    if (node.isTextblock) {
      const text = cleanTaskText(node.textContent);
      if (text || lines.length > 0) lines.push('  '.repeat(depth) + text);
      return;
    }
    node.forEach((child) => visit(child, depth));
  };
  slice.content.forEach((node) => visit(node, 0));
  return lines.join('\n');
}

interface NoteEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  skipBlankLineInsertion?: boolean;
  sectionGuides?: SectionGuideMap;
  /** Exposes the TipTap editor so parents can patch the doc via transactions
   *  (content-prop replacement resets the cursor — see jrh-orbit-dev skill). */
  editorRef?: MutableRefObject<Editor | null>;
  /** Fired when the editor loses focus — safe moment for doc normalization. */
  onEditorBlur?: () => void;
  /** Frontmatter id of the note being edited — enables 블록 링크 복사 */
  noteId?: string;
  /** Block-link anchor to scroll to once content is loaded */
  scrollAnchor?: string | null;
  /** Called after the anchor scroll attempt finishes (found or not) */
  onAnchorScrolled?: () => void;
}

interface WikiLinkState {
  query: string;
  from: number;
  coords: { left: number; top: number };
}

export function NoteEditor({ content, onChange, placeholder, skipBlankLineInsertion, sectionGuides, editorRef, onEditorBlur, noteId, scrollAnchor, onAnchorScrolled }: NoteEditorProps) {
  const { dataDir, openNote } = useAppStore();
  const smartTransformEnabled = useConfigStore((s) => s.editor.smart_transform);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastEmittedContent = useRef<string | null>(null);
  const isLoadingContent = useRef(false);
  const [mathEdit, setMathEdit] = useState<MathClickInfo | null>(null);
  const [wikiLink, setWikiLink] = useState<WikiLinkState | null>(null);
  const [wikiResults, setWikiResults] = useState<SearchResult[]>([]);
  const [wikiIndex, setWikiIndex] = useState(0);
  const wikiSearchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; linkPos: number | null; linkHref: string | null; blockAnchor: string | null; blockPos: number | null } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [linkPrompt, setLinkPrompt] = useState<{ x: number; y: number; from: number; to: number } | null>(null);
  // The click handler lives in the useEditor config closure — read fresh
  // values through refs (the editor instance outlives prop changes).
  const noteIdRef = useRef<string | undefined>(noteId);
  noteIdRef.current = noteId;
  const scrollToAnchorRef = useRef<(anchor: string) => boolean>(() => false);

  // Keep the context menu fully on-screen — right-clicking near the bottom
  // edge used to push it below the viewport.
  useLayoutEffect(() => {
    const el = ctxMenuRef.current;
    if (!el || !ctxMenu) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.max(4, Math.min(ctxMenu.x, window.innerWidth - rect.width - 8));
    const ny = Math.max(4, Math.min(ctxMenu.y, window.innerHeight - rect.height - 8));
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  }, [ctxMenu]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const onMathClick = useCallback((info: MathClickInfo) => {
    setMathEdit(info);
  }, []);

  const handleImageDrop = useCallback(async (file: File) => {
    if (!dataDir || !file.type.startsWith('image/')) return null;
    // Read once as data URI — used both for the base64 IPC payload and as fallback src
    const dataUri = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    try {
      const ext = file.name.split('.').pop() ?? 'png';
      const filename = `img-${Date.now().toString(36)}.${ext}`;
      const attachDir = await join(dataDir, 'attachments');
      await invoke('ensure_dir', { path: attachDir });
      const destPath = await join(attachDir, filename);

      if (!dataUri) throw new Error('failed to read image file');
      const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
      await invoke('write_binary_b64', { path: destPath, data: base64 });
      return convertFileSrc(destPath);
    } catch (err) {
      console.warn('[image] save to attachments failed, falling back to data URI:', err);
      return dataUri;
    }
  }, [dataDir]);

  const lastAutoFitRef = useRef(0);

  const editor = useEditor({
    extensions: getExtensions({ placeholder, onMathClick, smartTransform: smartTransformEnabled, sectionGuides }),
    content: preprocessEmptyCheckboxes(content),
    shouldRerenderOnTransaction: true,
    editorProps: {
      clipboardTextSerializer: (slice) => sliceToPlainText(slice),
      transformPastedHTML(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('table').forEach(table => {
          const firstRow = table.querySelector('tr');
          if (!firstRow) return;
          const hasHeader = table.querySelector('th');
          if (hasHeader) return;
          firstRow.querySelectorAll('td').forEach(td => {
            const th = doc.createElement('th');
            th.innerHTML = td.innerHTML;
            for (const attr of td.attributes) th.setAttribute(attr.name, attr.value);
            td.replaceWith(th);
          });
        });
        return doc.body.innerHTML;
      },
      handleDrop: (view, event) => {
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return false;
        const imageFiles = Array.from(dt.files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        const coords = { left: event.clientX, top: event.clientY };
        const dropPos = view.posAtCoords(coords);
        (async () => {
          for (const file of imageFiles) {
            const src = await handleImageDrop(file);
            if (src && view.state) {
              const pos = dropPos?.pos ?? view.state.doc.content.size;
              const node = view.state.schema.nodes.image.create({ src });
              const tr = view.state.tr.insert(pos, node);
              view.dispatch(tr);
            }
          }
        })();
        return true;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        // Excel/Sheets put both text/html (the table) and image/png (a preview
        // bitmap) on the clipboard — prefer the table over the image.
        const html = event.clipboardData?.getData('text/html') ?? '';
        if (/<table[\s>]/i.test(html)) return false;
        const imageItems = Array.from(items).filter(i => i.type.startsWith('image/'));
        if (imageItems.length === 0) return false;
        event.preventDefault();
        (async () => {
          for (const item of imageItems) {
            const file = item.getAsFile();
            if (!file) continue;
            const src = await handleImageDrop(file);
            if (src && view.state) {
              const node = view.state.schema.nodes.image.create({ src });
              const tr = view.state.tr.replaceSelectionWith(node);
              view.dispatch(tr);
            }
          }
        })();
        return true;
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          event.preventDefault();
          // Detect a link under the right-click point so the menu can offer
          // 링크 제거 — links are easy to create but were impossible to remove
          let linkPos: number | null = null;
          let linkHref: string | null = null;
          let blockAnchor: string | null = null;
          let blockPos: number | null = null;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (at) {
            const node = view.state.doc.nodeAt(at.pos);
            const $pos = view.state.doc.resolve(at.pos);
            const linkMark =
              node?.marks.find((mk) => mk.type.name === 'link') ??
              $pos.marks().find((mk) => mk.type.name === 'link');
            if (linkMark) {
              linkPos = at.pos;
              linkHref = linkMark.attrs.href ?? null;
            }
            // Nearest textblock = block-link target
            for (let d = $pos.depth; d > 0; d--) {
              const n = $pos.node(d);
              if (n.isTextblock) {
                const text = n.textContent.trim();
                if (text) {
                  blockAnchor = text.slice(0, 60);
                  blockPos = $pos.before(d);
                }
                break;
              }
            }
          }
          setCtxMenu({ x: event.clientX, y: event.clientY, linkPos, linkHref, blockAnchor, blockPos });
          return true;
        },
        click(view, event) {
          const link = (event.target as HTMLElement).closest('a');
          if (link) {
            const href = link.getAttribute('href');
            if (!href) return false;
            event.preventDefault();
            if (href.startsWith('note://')) {
              const [targetId, hashPart] = href.slice(7).split('#');
              const anchor = hashPart ? decodeURIComponent(hashPart) : undefined;
              // Same-note block link: just scroll, no navigation
              if (anchor && noteIdRef.current && targetId === noteIdRef.current) {
                scrollToAnchorRef.current(anchor);
                return true;
              }
              // Exact id lookup first — ranked FTS can return the daily log
              // (whose body embeds the id) instead of the target note.
              getNoteByExactId(targetId).then(exact => {
                if (exact) {
                  openNote(exact.path, anchor);
                  return;
                }
                searchNotes(targetId).then(results => {
                  if (results.length > 0) openNote(results[0].path, anchor);
                });
              });
              return true;
            }
            const isLocal = href.startsWith('/') || href.startsWith('file://');
            const macPlatform = /Mac|iPhone|iPad/.test(navigator.platform);
            if (isLocal || (macPlatform ? event.metaKey : event.ctrlKey)) {
              const path = href.startsWith('file://') ? href.slice(7) : href;
              invoke('open_path', { path }).catch(() => {});
            }
            return false;
          }

          if (/Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey) {
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (pos) {
              const $pos = view.state.doc.resolve(pos.pos);
              const text = $pos.parent.textContent;
              const offset = $pos.parentOffset;
              const before = text.slice(0, offset);
              const after = text.slice(offset);
              const openIdx = before.lastIndexOf('[[');
              const closeAfter = after.indexOf(']]');
              if (openIdx >= 0 && closeAfter >= 0) {
                const closeBefore = before.lastIndexOf(']]');
                if (openIdx > closeBefore) {
                  const noteRef = before.slice(openIdx + 2) + after.slice(0, closeAfter);
                  if (noteRef.trim()) {
                    event.preventDefault();
                    searchNotes(noteRef.trim()).then(results => {
                      if (results.length > 0) openNote(results[0].path);
                    });
                    return true;
                  }
                }
              }
            }
          }
          return false;
        },
        dblclick(view, event) {
          const hit = detectBorderCol(event);
          if (!hit) return false;
          event.preventDefault();
          applyAutoFitCol(view, hit.tableEl, hit.colIndex);
          lastAutoFitRef.current = Date.now();
          return true;
        },
      },
    },
    onUpdate: ({ editor: e }) => {
      if (isLoadingContent.current) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = undefined;
        const storage = e.storage as Record<string, any>;
        const md: string = storage.markdown?.getMarkdown?.() ?? '';
        const tight = stripLooseListItems(md);
        const spaced = unescapeHtmlGt(ensureMarkdownSpacing(tight));
        lastEmittedContent.current = spaced;
        onChange(spaced);
      }, 300);

      checkWikiLink(e);
    },
    onSelectionUpdate: ({ editor: e }) => {
      checkWikiLink(e);
    },
    onBlur: () => {
      onEditorBlurRef.current?.();
    },
  });

  function checkWikiLink(e: ReturnType<typeof useEditor> extends infer T ? (T extends null ? never : NonNullable<T>) : never) {
    const { $from } = e.state.selection;
    const fullText = $from.parent.textContent;
    const textBefore = fullText.slice(0, $from.parentOffset);
    const textAfter = fullText.slice($from.parentOffset);
    const openIdx = textBefore.lastIndexOf('[[');
    const closeIdx = textBefore.lastIndexOf(']]');

    if (openIdx >= 0 && openIdx > closeIdx) {
      const closeAfter = textAfter.indexOf(']]');
      if (closeAfter >= 0) {
        setWikiLink(null);
        return;
      }

      const query = textBefore.slice(openIdx + 2);
      if (query.length > 30) { setWikiLink(null); return; }
      const from = $from.pos - ($from.parentOffset - openIdx);
      const coords = e.view.coordsAtPos($from.pos);
      setWikiLink({ query, from, coords: { left: coords.left, top: coords.bottom } });
      setWikiIndex(0);

      clearTimeout(wikiSearchRef.current);
      if (query.trim()) {
        wikiSearchRef.current = setTimeout(async () => {
          const results = await searchNotes(query);
          setWikiResults(results.slice(0, 8));
        }, 100);
      } else {
        setWikiResults([]);
      }
    } else {
      setWikiLink(null);
    }
  }

  const insertWikiLink = useCallback((result: SearchResult) => {
    if (!editor || !wikiLink) return;
    const titleOrId = result.title || result.path.split(/[/\\]/).pop()?.replace('.md', '') || '';
    const text = `[[${titleOrId}]]`;
    const { from } = wikiLink;
    const to = editor.state.selection.$from.pos;
    editor.chain().focus()
      .command(({ tr }) => {
        tr.replaceWith(from, to, editor.state.schema.text(text));
        return true;
      })
      .run();
    setWikiLink(null);
    setWikiResults([]);
  }, [editor, wikiLink]);

  useEffect(() => {
    if (!editor || !wikiLink || wikiResults.length === 0) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setWikiIndex(i => Math.min(i + 1, wikiResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setWikiIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertWikiLink(wikiResults[wikiIndex]);
      } else if (e.key === 'Escape') {
        setWikiLink(null);
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [editor, wikiLink, wikiResults, wikiIndex, insertWikiLink]);

  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => { editorRef.current = null; };
  }, [editor, editorRef]);

  /** Find the block matching a block-link anchor and scroll to it.
   *  `^abc123` 형태 = 영구 블록 ID 마커 (텍스트를 고쳐도 유지),
   *  그 외 = 레거시 텍스트 프리픽스 매칭. */
  const scrollToAnchor = useCallback((anchor: string): boolean => {
    if (!editor) return false;
    const target = anchor.trim();
    if (!target) return false;
    const findBlock = (matcher: (text: string) => boolean): number | null => {
      let found: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.isTextblock && matcher(node.textContent.trim())) {
          found = pos;
          return false;
        }
        return true;
      });
      return found;
    };
    const pos = target.startsWith('^')
      ? findBlock((t) => t.endsWith(target))
      : (findBlock((t) => !!t && t.startsWith(target))
        ?? findBlock((t) => !!t && t.includes(target.slice(0, 20))));
    if (pos === null) return false;
    const dom = editor.view.nodeDOM(pos);
    const el = dom instanceof HTMLElement ? dom : (dom as Node | null)?.parentElement ?? null;
    if (!el) return false;
    // 부드러운 스크롤 유지 — 플래시는 스크롤이 "도착한 뒤" 시작해야 보인다
    const startFlash = () => {
      el.classList.add('block-link-flash');
      setTimeout(() => el.classList.remove('block-link-flash'), 2600);
    };
    const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
    const sr = scroller?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const alreadyVisible = !!sr && r.top >= sr.top && r.bottom <= sr.bottom;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (alreadyVisible || !scroller) {
      startFlash();
    } else {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        scroller.removeEventListener('scrollend', finish);
        startFlash();
      };
      scroller.addEventListener('scrollend', finish, { once: true });
      // 스크롤 거리가 짧아 scrollend가 안 오는 경우 폴백
      setTimeout(finish, 1200);
    }
    return true;
  }, [editor]);
  scrollToAnchorRef.current = scrollToAnchor;

  // Block-link navigation: retry a few times while the note content loads
  useEffect(() => {
    if (!scrollAnchor || !editor) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (scrollToAnchor(scrollAnchor) || ++tries >= 6) {
        onAnchorScrolled?.();
        return;
      }
      timer = setTimeout(attempt, 300);
    };
    timer = setTimeout(attempt, 150);
    return () => clearTimeout(timer);
  }, [scrollAnchor, editor, scrollToAnchor, onAnchorScrolled]);

  /** 위/아래에 줄 삽입 — 커서가 리스트 항목 안이면 같은 종류의 항목을 그 줄
   *  바로 옆에 삽입한다. before(1)로 최상위 블록(리스트 전체) 옆에 넣으면
   *  현재 줄이 아니라 리스트 밖에 줄이 생긴다. */
  const insertLineNear = useCallback((where: 'above' | 'below') => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    let itemDepth = 0;
    for (let d = $from.depth; d > 0; d--) {
      const name = $from.node(d).type.name;
      if (name === 'listItem' || name === 'taskItem') { itemDepth = d; break; }
    }
    if (itemDepth > 0) {
      const itemNode = $from.node(itemDepth);
      const pos = where === 'above' ? $from.before(itemDepth) : $from.after(itemDepth);
      const attrs = itemNode.type.name === 'taskItem' ? { ...itemNode.attrs, checked: false } : itemNode.attrs;
      const empty = itemNode.type.createAndFill(attrs);
      if (!empty) return;
      editor.view.dispatch(editor.state.tr.insert(pos, empty));
      editor.chain().focus().setTextSelection(pos + 2).run();
    } else {
      const pos = where === 'above' ? $from.before(1) : $from.after(1);
      editor.chain().focus().insertContentAt(pos, { type: 'paragraph' }).setTextSelection(pos + 1).run();
    }
  }, [editor]);

  const applyLink = useCallback((raw: string) => {
    const lp = linkPrompt;
    setLinkPrompt(null);
    if (!lp || !editor) return;
    let href = raw.trim();
    if (!href) return;
    // 마크다운 링크 전체를 붙여넣은 경우 URL만 추출 —
    // 안 그러면 "[제목](note://...)" 앞에 https://가 붙어 깨진다.
    // 라벨의 이스케이프된 대괄호(\[Trial#1\])도 통과해야 한다.
    const mdMatch = href.match(/^\[(?:\\.|[^\]\\])*\]\((.+)\)\s*$/);
    if (mdMatch) href = mdMatch[1].trim();
    // Bare domains get https:// — note://, file paths, and full URLs pass through
    if (!/^[a-zA-Z][\w+.-]*:/.test(href) && !href.startsWith('/')) href = `https://${href}`;
    if (lp.from !== lp.to) {
      editor.chain().focus().setTextSelection({ from: lp.from, to: lp.to }).setLink({ href }).run();
    } else {
      editor.chain().focus().setTextSelection(lp.from)
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    }
  }, [linkPrompt, editor]);

  useEffect(() => {
    if (!editor) return;
    if (lastEmittedContent.current !== null && content === lastEmittedContent.current) return;
    isLoadingContent.current = true;
    // Programmatic setContent replaces the whole doc and resets the selection.
    // Save/restore the cursor so external body updates don't yank it away mid-typing.
    const hadFocus = editor.isFocused;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(preprocessEmptyCheckboxes(content));
    if (!skipBlankLineInsertion) {
      insertBlankLinesBeforeHeadings(editor);
    }
    if (hadFocus) {
      const size = editor.state.doc.content.size;
      try {
        editor.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) });
        editor.commands.focus(undefined, { scrollIntoView: false });
      } catch { /* selection restore is best-effort */ }
    }
    isLoadingContent.current = false;
  }, [editor, content]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorBlurRef = useRef(onEditorBlur);
  onEditorBlurRef.current = onEditorBlur;

  useEffect(() => {
    if (!editor) return;
    return () => {
      // Flush a pending debounced change on unmount — otherwise the last
      // ~300ms of typing dies with the timer when the user switches views.
      if (debounceRef.current === undefined) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      if (editor.isDestroyed) return;
      try {
        const storage = editor.storage as Record<string, any>;
        const md: string = storage.markdown?.getMarkdown?.() ?? '';
        const tight = stripLooseListItems(md);
        const spaced = unescapeHtmlGt(ensureMarkdownSpacing(tight));
        lastEmittedContent.current = spaced;
        onChangeRef.current(spaced);
      } catch { /* flush is best-effort */ }
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let lastUpTime = 0;
    let lastUpCol = -1;

    function handleMouseUp(e: MouseEvent) {
      const hit = detectBorderCol(e);
      if (!hit) { lastUpTime = 0; return; }
      const now = Date.now();
      if (now - lastUpTime < 500 && lastUpCol === hit.colIndex) {
        if (now - lastAutoFitRef.current > 300) {
          applyAutoFitCol(editor.view, hit.tableEl, hit.colIndex);
          lastAutoFitRef.current = now;
        }
        lastUpTime = 0;
        lastUpCol = -1;
      } else {
        lastUpTime = now;
        lastUpCol = hit.colIndex;
      }
    }

    dom.addEventListener('mouseup', handleMouseUp);
    return () => {
      dom.removeEventListener('mouseup', handleMouseUp);
    };
  }, [editor]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    // Drops on the editor content bubble up AFTER editorProps.handleDrop
    // already inserted the image — handling them here too doubled every image.
    if ((e.target as HTMLElement)?.closest?.('.ProseMirror')) return;
    const files = e.dataTransfer?.files;
    if (!files?.length || !editor) return;
    // OS-explorer drops need dragDropEnabled:false in tauri.conf.json —
    // otherwise the webview swallows the HTML5 drop and files is empty.
    const coords = { left: e.clientX, top: e.clientY };
    e.preventDefault();

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const src = await handleImageDrop(file);
      if (!src) continue;
      const at = editor.view.posAtCoords(coords);
      if (at) {
        editor.chain().focus().insertContentAt(at.pos, { type: 'image', attrs: { src } }).run();
      } else {
        editor.chain().focus().setImage({ src }).run();
      }
    }
  }, [editor, handleImageDrop]);

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <EditorToolbar editor={editor} />
      {mathEdit && editor && (
        <MathEditor
          editor={editor}
          node={mathEdit.node}
          pos={mathEdit.pos}
          onClose={() => setMathEdit(null)}
        />
      )}
      {wikiLink && wikiResults.length > 0 && (
        <div
          className="fixed z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[200px] max-w-[320px]"
          style={{ left: wikiLink.coords.left, top: wikiLink.coords.top + 4 }}
        >
          {wikiResults.map((r, i) => (
            <button
              key={r.path}
              onMouseDown={e => { e.preventDefault(); insertWikiLink(r); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                i === wikiIndex ? 'bg-chrome/20 text-ink' : 'text-ink-2 hover:bg-paper-soft'
              }`}
            >
              <div className="font-medium truncate">{r.title}</div>
              <div className="text-[10px] text-ink-3 truncate">{r.noteType} · {r.updated?.slice(0, 10)}</div>
            </button>
          ))}
        </div>
      )}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto relative"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => ctxMenu && setCtxMenu(null)}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>

      {ctxMenu && editor && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          {[
            { label: '잘라내기', action: () => { document.execCommand('cut'); }, key: 'Ctrl+X' },
            { label: '복사', action: () => { document.execCommand('copy'); }, key: 'Ctrl+C' },
            { label: '붙여넣기', action: () => { navigator.clipboard.readText().then(t => editor.commands.insertContent(t)); }, key: 'Ctrl+V' },
            null,
            // 링크 위에서는 복사/제거, 아니면 삽입 — 같은 자리에 하나의 그룹으로
            ...(ctxMenu.linkPos !== null ? [
              {
                label: '링크 복사',
                action: () => {
                  if (ctxMenu.linkHref) navigator.clipboard.writeText(ctxMenu.linkHref).catch(() => {});
                },
                key: '',
              },
              {
                label: '링크 제거',
                action: () => {
                  editor.chain().focus()
                    .setTextSelection(ctxMenu.linkPos!)
                    .extendMarkRange('link')
                    .unsetLink()
                    .run();
                },
                key: '',
              },
            ] : [
              {
                label: '링크 삽입',
                action: () => {
                  const { from, to } = editor.state.selection;
                  setLinkPrompt({ x: ctxMenu.x, y: Math.min(ctxMenu.y, window.innerHeight - 60), from, to });
                },
                key: '',
              },
            ]),
            ...(noteId && ctxMenu.blockPos !== null ? [
              {
                label: '블록 링크 복사',
                action: () => {
                  // 영구 블록 ID 마커(^abc123)를 블록 끝에 심어 링크가
                  // 텍스트 수정에도 살아남게 한다 (Obsidian 방식)
                  const pos = ctxMenu.blockPos!;
                  const node = editor.state.doc.nodeAt(pos);
                  if (!node?.isTextblock) return;
                  const text = node.textContent;
                  let bid = text.match(/\^([a-z0-9]{4,})\s*$/)?.[1];
                  if (!bid) {
                    bid = Math.random().toString(36).slice(2, 8);
                    const insertPos = pos + 1 + node.content.size;
                    editor.view.dispatch(editor.state.tr.insertText(` ^${bid}`, insertPos));
                  }
                  const plain = text.replace(/\s*\^[a-z0-9]{4,}\s*$/, '').trim();
                  const label = plain.length > 30 ? `${plain.slice(0, 30)}…` : plain || '블록';
                  const md = `[${label.replace(/([\[\]])/g, '\\$1')}](note://${noteId}#${encodeURIComponent(`^${bid}`)})`;
                  navigator.clipboard.writeText(md).catch(() => {});
                },
                key: '',
              },
            ] : []),
            null,
            { label: '전체 선택', action: () => editor.commands.selectAll(), key: 'Ctrl+A' },
            null,
            { label: '실행 취소', action: () => editor.commands.undo(), key: 'Ctrl+Z' },
            { label: '다시 실행', action: () => editor.commands.redo(), key: 'Ctrl+Y' },
            null,
            { label: '블록 삭제', action: () => editor.commands.deleteNode(editor.state.selection.$from.parent.type.name), key: '' },
            { label: '위에 줄 삽입', action: () => insertLineNear('above'), key: '' },
            { label: '아래에 줄 삽입', action: () => insertLineNear('below'), key: '' },
          ].map((item, i) =>
            item === null ? (
              <div key={i} className="h-px bg-border my-1" />
            ) : (
              <button
                key={i}
                onClick={() => { item.action(); setCtxMenu(null); }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-ink-2 hover:bg-paper-soft hover:text-ink transition-colors"
              >
                <span>{item.label}</span>
                {item.key && <span className="text-[10px] text-ink-3 ml-4">{item.key}</span>}
              </button>
            )
          )}
        </div>
      )}

      {linkPrompt && (
        <div
          className="fixed z-50 bg-paper border border-border rounded-lg shadow-lg p-1.5 flex items-center gap-1"
          style={{ left: Math.min(linkPrompt.x, window.innerWidth - 260), top: linkPrompt.y }}
        >
          <input
            autoFocus
            placeholder="URL 입력... (Enter)"
            className="text-xs px-2 py-1 rounded border border-border bg-paper-soft text-ink focus:outline-none focus:border-chrome w-56"
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setLinkPrompt(null);
            }}
            onBlur={() => setLinkPrompt(null)}
          />
        </div>
      )}
    </div>
  );
}
