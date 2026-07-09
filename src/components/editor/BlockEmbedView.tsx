import { useState, useEffect, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { invoke } from '@tauri-apps/api/core';
import { getNoteByExactId } from '../../lib/db';
import { useAppStore } from '../../stores/useAppStore';

type EmbedState =
  | { status: 'loading' }
  | { status: 'missing'; reason: string }
  | { status: 'ok'; text: string; noteTitle: string; path: string };

/** 원본 블록의 라인에서 마커/메타를 벗겨 표시용 텍스트로 */
function cleanLine(line: string): string {
  return line
    .replace(/\s*\^[a-z0-9]{4,}\s*$/, '')
    .replace(/^[\s]*[-*+]\s+/, '')
    .replace(/^[\s]*\d+\.\s+/, '')
    .replace(/^\s*\\?\[[ xX]?\\?\]\s*/, '')
    .replace(/^#+\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/\\?\[TASK-[^\]\\]*\\?\]\s*/, '')
    .replace(/\\([\[\]()])/g, '$1')
    .trim();
}

export function BlockEmbedView({ node, selected, editor, getPos }: NodeViewProps) {
  const { openNote } = useAppStore();
  const [state, setState] = useState<EmbedState>({ status: 'loading' });
  const { noteId, blockId } = node.attrs as { noteId: string; blockId: string };

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
      const line = raw.split('\n').find((l) => l.includes(`^${blockId}`));
      if (!line) {
        setState({ status: 'missing', reason: '원본 블록이 삭제되었거나 ID가 지워짐' });
        return;
      }
      setState({ status: 'ok', text: cleanLine(line), noteTitle: src.title || noteId, path: src.path });
    } catch {
      setState({ status: 'missing', reason: '원본을 읽을 수 없음' });
    }
  }, [noteId, blockId]);

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
          <span className="block-embed-text">{state.text}</span>
          <button
            type="button"
            className="block-embed-source"
            title={`원본 열기: ${state.noteTitle}`}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); openSource(); }}
          >
            ↗ {state.noteTitle}
          </button>
        </>
      )}
    </NodeViewWrapper>
  );
}
