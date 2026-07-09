import { useState, useEffect, useCallback, useMemo } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { invoke } from '@tauri-apps/api/core';
import MarkdownIt from 'markdown-it';
import container from 'markdown-it-container';
import { getNoteByExactId } from '../../lib/db';
import { useAppStore } from '../../stores/useAppStore';
import { setupColumnsMarkdownIt } from './extensions/Columns';

type EmbedState =
  | { status: 'loading' }
  | { status: 'missing'; reason: string }
  | { status: 'ok'; html: string; noteTitle: string; path: string };

/** 미러 렌더링용 markdown-it — 컬럼/토글 펜스도 이해한다 */
function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: false });
  setupColumnsMarkdownIt(md);
  md.use(container as any, 'toggle', {
    render(tokens: any[], idx: number) {
      return tokens[idx].nesting === 1 ? '<div class="md-toggle-static">\n' : '</div>\n';
    },
  });
  return md;
}

/** 원본 구간을 표시용 마크다운으로 정리 — 서식은 유지, 내부 메타만 제거 */
function cleanSegment(segment: string): string {
  return segment
    .replace(/\s*\^[a-z0-9]{4,}(?=\s|$)/gm, '')      // 블록 ID 마커 (줄 중간 포함)
    .replace(/\\?\[TASK-[^\]\\]*\\?\]\s*/g, '')       // Task ID
    .replace(/\\?\(이월[^)]*\\?\)\s*/g, '')            // 이월 태그
    .replace(/^(\s*)- \[ \] /gm, '$1- ☐ ')            // 체크박스 → 기호
    .replace(/^(\s*)- \[[xX]\] /gm, '$1- ☑ ');
}

export function BlockEmbedView({ node, selected, editor, getPos }: NodeViewProps) {
  const { openNote } = useAppStore();
  const [state, setState] = useState<EmbedState>({ status: 'loading' });
  const { noteId, blockId, blockEnd } = node.attrs as { noteId: string; blockId: string; blockEnd: string };
  const md = useMemo(createRenderer, []);

  const isDirectlySelected = selected && (() => {
    try {
      const sel = editor.state.selection;
      return sel instanceof NodeSelection && sel.from === getPos();
    } catch { return false; }
  })();

  const load = useCallback(async () => {
    try {
      const src = await getNoteByExactId(noteId);
      if (!src) {
        setState({ status: 'missing', reason: `노트를 찾을 수 없음 (${noteId})` });
        return;
      }
      const raw = await invoke<string>('read_note', { path: src.path });
      const lines = raw.split('\n');
      const iStart = lines.findIndex((l) => l.includes(`^${blockId}`));
      if (iStart < 0) {
        setState({ status: 'missing', reason: '원본 블록이 삭제되었거나 ID가 지워짐' });
        return;
      }
      let iEnd = iStart;
      if (blockEnd) {
        const e = lines.findIndex((l) => l.includes(`^${blockEnd}`));
        if (e >= 0) iEnd = Math.max(e, iStart);
      }
      const segment = cleanSegment(lines.slice(iStart, iEnd + 1).join('\n'));
      setState({ status: 'ok', html: md.render(segment), noteTitle: src.title || noteId, path: src.path });
    } catch {
      setState({ status: 'missing', reason: '원본을 읽을 수 없음' });
    }
  }, [noteId, blockId, blockEnd, md]);

  useEffect(() => {
    load();
    // 원본 노트가 저장될 때마다 미러 갱신 — 이게 "자동 동기화"
    const handler = () => load();
    window.addEventListener('notes-changed', handler);
    return () => window.removeEventListener('notes-changed', handler);
  }, [load]);

  const openSource = () => {
    if (state.status === 'ok') openNote(state.path, `^${blockId}`);
  };

  return (
    <NodeViewWrapper
      className={`block-embed-card ${isDirectlySelected ? 'selected' : ''}`}
      data-drag-handle
      contentEditable={false}
    >
      {state.status === 'loading' && (
        <span className="block-embed-loading">동기화 블록 불러오는 중…</span>
      )}
      {state.status === 'missing' && (
        <span className="block-embed-missing">⚠ 동기화 블록: {state.reason}</span>
      )}
      {state.status === 'ok' && (
        <>
          <div className="block-embed-header" contentEditable={false}>
            <span className="block-embed-badge" title="동기화 블록 — 원본을 수정하면 자동 반영">⟲ 동기화</span>
            <button
              type="button"
              className="block-embed-source"
              title={`원본 열기: ${state.noteTitle}`}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); openSource(); }}
            >
              ↗ {state.noteTitle}
            </button>
          </div>
          <div
            className="block-embed-content dashboard-content"
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        </>
      )}
    </NodeViewWrapper>
  );
}
