import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  | { status: 'ok'; html: string; noteTitle: string; path: string; segment: string };

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
    .replace(/\s*\^[a-z0-9]{4,}(?![a-z0-9])/g, '')    // 블록 ID 마커 — 마크 구문(** 등)이 뒤따라도 제거
    .replace(/\\?\[TASK-[^\]\\]*\\?\]\s*/g, '')       // Task ID
    .replace(/\\?\(이월[^)]*\\?\)\s*/g, '')            // 이월 태그
    .replace(/^(\s*)- \[ \] /gm, '$1- ☐ ')            // 체크박스 → 기호
    .replace(/^(\s*)- \[[xX]\] /gm, '$1- ☑ ');
}

/** 특정 블록 ID 마커만 제거 (편집 드래프트용 — 구간 안의 다른 링크 마커는 보존) */
function stripMarker(text: string, id: string): string {
  return text.replace(new RegExp(`\\s*\\^${id}(?![a-z0-9])`, 'g'), '');
}

export function BlockEmbedView({ node, selected, editor, getPos }: NodeViewProps) {
  const { openNote } = useAppStore();
  const [state, setState] = useState<EmbedState>({ status: 'loading' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { noteId, blockId, blockEnd } = node.attrs as { noteId: string; blockId: string; blockEnd: string };
  const md = useMemo(createRenderer, []);

  const isDirectlySelected = selected && (() => {
    try {
      const sel = editor.state.selection;
      return sel instanceof NodeSelection && sel.from === getPos();
    } catch { return false; }
  })();

  /** 원본 파일에서 마커로 구간을 찾는다 — 저장 시에도 재사용 */
  const locate = useCallback((raw: string): { lines: string[]; iStart: number; iEnd: number } | null => {
    const lines = raw.split('\n');
    const iStart = lines.findIndex((l) => l.includes(`^${blockId}`));
    if (iStart < 0) return null;
    let iEnd = iStart;
    if (blockEnd) {
      const e = lines.findIndex((l) => l.includes(`^${blockEnd}`));
      if (e >= 0) iEnd = Math.max(e, iStart);
    }
    return { lines, iStart, iEnd };
  }, [blockId, blockEnd]);

  const load = useCallback(async () => {
    try {
      const src = await getNoteByExactId(noteId);
      if (!src) {
        setState({ status: 'missing', reason: `노트를 찾을 수 없음 (${noteId})` });
        return;
      }
      const raw = await invoke<string>('read_note', { path: src.path });
      const loc = locate(raw);
      if (!loc) {
        setState({ status: 'missing', reason: '원본 블록이 삭제되었거나 ID가 지워짐' });
        return;
      }
      const segment = loc.lines.slice(loc.iStart, loc.iEnd + 1).join('\n');
      setState({
        status: 'ok',
        html: md.render(cleanSegment(segment)),
        noteTitle: src.title || noteId,
        path: src.path,
        segment,
      });
    } catch {
      setState({ status: 'missing', reason: '원본을 읽을 수 없음' });
    }
  }, [noteId, locate, md]);

  useEffect(() => {
    load();
    // 원본 노트가 저장될 때마다 미러 갱신 — 이게 "자동 동기화".
    // 앱 내 저장은 파일워처가 writeLock으로 무시하므로 'notes-changed'만으론 부족 —
    // 에디터 저장 직후 발행되는 'note-saved'도 함께 구독한다.
    const handler = () => load();
    window.addEventListener('notes-changed', handler);
    window.addEventListener('note-saved', handler);
    return () => {
      window.removeEventListener('notes-changed', handler);
      window.removeEventListener('note-saved', handler);
    };
  }, [load]);

  const openSource = () => {
    if (state.status === 'ok') openNote(state.path, `^${blockId}`);
  };

  const beginEdit = () => {
    if (state.status !== 'ok') return;
    // 이 미러의 마커만 벗겨서 보여준다 — 구간 안의 다른 블록 링크 마커는 남긴다
    let text = stripMarker(state.segment, blockId);
    if (blockEnd) text = stripMarker(text, blockEnd);
    setDraft(text);
    setSaveError('');
    setEditing(true);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  /** 역기입: 원본 파일의 구간을 드래프트로 교체 (마커 재부착) */
  const saveEdit = useCallback(async () => {
    if (state.status !== 'ok') return;
    const body = draft.replace(/\s+$/, '');
    if (!body.trim()) {
      setSaveError('내용이 비어 있습니다 — 원본을 지우려면 원본 노트에서 직접 지워주세요.');
      return;
    }
    try {
      // 저장 직전에 다시 읽어 최신 파일 기준으로 구간을 찾는다 (그 사이 원본이 바뀌었을 수 있음)
      const raw = await invoke<string>('read_note', { path: state.path });
      const loc = locate(raw);
      if (!loc) {
        setSaveError('원본 블록을 찾지 못했습니다 (마커가 지워졌을 수 있음)');
        return;
      }
      const newLines = body.split('\n');
      // 마커 재부착: 시작 마커는 첫 줄 끝, 끝 마커는 마지막 줄 끝 (한 줄로 합쳐지면 둘 다 첫 줄에)
      newLines[0] += ` ^${blockId}`;
      if (blockEnd) newLines[newLines.length - 1] += ` ^${blockEnd}`;
      loc.lines.splice(loc.iStart, loc.iEnd - loc.iStart + 1, ...newLines);
      await invoke('write_note', { path: state.path, content: loc.lines.join('\n') });
      setEditing(false);
      // 다른 미러들 갱신 + 원본 노트가 열려 있으면 에디터 리로드
      // (열린 에디터가 옛 내용으로 자동저장하면 역기입이 덮여 사라진다)
      window.dispatchEvent(new CustomEvent('note-saved'));
      window.dispatchEvent(new CustomEvent('note-external-edit', { detail: { path: state.path } }));
      load();
    } catch (e) {
      setSaveError(`저장 실패: ${e instanceof Error ? e.message : e}`);
    }
  }, [state, draft, locate, blockId, blockEnd, load]);

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
            {editing ? (
              <>
                <button
                  type="button"
                  className="block-embed-source"
                  title="원본에 저장 (Ctrl+Enter)"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); saveEdit(); }}
                >
                  ✓ 저장
                </button>
                <button
                  type="button"
                  className="block-embed-source"
                  title="편집 취소 (Esc)"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(false); setSaveError(''); }}
                >
                  × 취소
                </button>
              </>
            ) : (
              <button
                type="button"
                className="block-embed-source"
                title="이 자리에서 원본 내용 편집 (원본에 역기입)"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); beginEdit(); }}
              >
                ✎ 편집
              </button>
            )}
            <button
              type="button"
              className="block-embed-source"
              title={`원본 열기: ${state.noteTitle}`}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); openSource(); }}
            >
              ↗ {state.noteTitle}
            </button>
          </div>
          {editing ? (
            <div contentEditable={false}>
              <textarea
                ref={taRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
                  if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setSaveError(''); }
                }}
                onPaste={(e) => e.stopPropagation()}
                className="block-embed-textarea"
                spellCheck={false}
              />
              <div className="block-embed-edit-hint">
                원본 마크다운을 직접 편집합니다 — 저장하면 원본 노트에 바로 반영됩니다 (Ctrl+Enter 저장 / Esc 취소)
              </div>
              {saveError && <div className="block-embed-missing">{saveError}</div>}
            </div>
          ) : (
            <div
              className="block-embed-content dashboard-content"
              onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); beginEdit(); }}
              dangerouslySetInnerHTML={{ __html: state.html }}
            />
          )}
        </>
      )}
    </NodeViewWrapper>
  );
}
