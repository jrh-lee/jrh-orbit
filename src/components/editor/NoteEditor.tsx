import { useEditor, EditorContent } from '@tiptap/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { getExtensions, preprocessEmptyCheckboxes } from './extensions';
import type { MathClickInfo } from './extensions';
import { EditorToolbar } from './EditorToolbar';
import { MathEditor } from './MathEditor';
import { searchNotes, type SearchResult } from '../../lib/db';
import type { EditorView } from '@tiptap/pm/view';
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

interface NoteEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  skipBlankLineInsertion?: boolean;
  sectionGuides?: SectionGuideMap;
}

interface WikiLinkState {
  query: string;
  from: number;
  coords: { left: number; top: number };
}

export function NoteEditor({ content, onChange, placeholder, skipBlankLineInsertion, sectionGuides }: NoteEditorProps) {
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

  const onMathClick = useCallback((info: MathClickInfo) => {
    setMathEdit(info);
  }, []);

  const handleImageDrop = useCallback(async (file: File) => {
    if (!dataDir || !file.type.startsWith('image/')) return null;
    try {
      const ext = file.name.split('.').pop() ?? 'png';
      const filename = `img-${Date.now().toString(36)}.${ext}`;
      const attachDir = await join(dataDir, 'attachments');
      await invoke('ensure_dir', { path: attachDir });
      const destPath = await join(attachDir, filename);

      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      await invoke('write_binary', { path: destPath, data: bytes });
      return convertFileSrc(destPath);
    } catch {
      const reader = new FileReader();
      return new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    }
  }, [dataDir]);

  const lastAutoFitRef = useRef(0);

  const editor = useEditor({
    extensions: getExtensions({ placeholder, onMathClick, smartTransform: smartTransformEnabled, sectionGuides }),
    content: preprocessEmptyCheckboxes(content),
    shouldRerenderOnTransaction: true,
    editorProps: {
      handleDOMEvents: {
        click(view, event) {
          const link = (event.target as HTMLElement).closest('a');
          if (link) {
            const href = link.getAttribute('href');
            if (!href) return false;
            event.preventDefault();
            if (href.startsWith('note://')) {
              const noteId = href.slice(7);
              searchNotes(noteId).then(results => {
                if (results.length > 0) openNote(results[0].path);
              });
              return true;
            }
            const isLocal = href.startsWith('/') || href.startsWith('file://');
            if (isLocal || event.metaKey || event.ctrlKey) {
              const path = href.startsWith('file://') ? href.slice(7) : href;
              invoke('open_path', { path }).catch(() => {});
            }
            return false;
          }

          if (event.metaKey || event.ctrlKey) {
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
        const storage = e.storage as Record<string, any>;
        const md: string = storage.markdown?.getMarkdown?.() ?? '';
        const spaced = ensureMarkdownSpacing(md);
        lastEmittedContent.current = spaced;
        onChange(spaced);
      }, 300);

      checkWikiLink(e);
    },
    onSelectionUpdate: ({ editor: e }) => {
      checkWikiLink(e);
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
    const titleOrId = result.title || result.path.split('/').pop()?.replace('.md', '') || '';
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
    if (!editor) return;
    if (lastEmittedContent.current !== null && content === lastEmittedContent.current) return;
    isLoadingContent.current = true;
    editor.commands.setContent(preprocessEmptyCheckboxes(content));
    if (!skipBlankLineInsertion) {
      insertBlankLinesBeforeHeadings(editor);
    }
    isLoadingContent.current = false;
  }, [editor, content]);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

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
    const files = e.dataTransfer?.files;
    if (!files?.length || !editor) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      e.preventDefault();
      const src = await handleImageDrop(file);
      if (src) {
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
        className="flex-1 overflow-y-auto"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
