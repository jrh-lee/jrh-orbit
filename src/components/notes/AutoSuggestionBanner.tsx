import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { readJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import { updateNoteLinks, getForwardLinks } from '../../lib/linkGraph';
import { suggestTags } from '../../lib/autoExtract';
import { getBaseConditions, getPreviousTestData, detectCodeReferences } from '../../lib/topicAutoFill';
import { findNotesByTopic } from '../../lib/db';
import type { NoteType } from '../../types/note';
import type { TagsFile, TopicsFile } from '../../types/dataFiles';

interface Suggestion {
  id: string;
  icon: string;
  message: string;
  action?: () => void;
  actionLabel?: string;
}

interface Props {
  noteType: string;
  noteId: string;
  status: string;
  verdict: string;
  topic: string;
  body: string;
  tags: string[];
  subsystem: string[];
  project: string[];
  updatedAt?: string;
  onUpdateStatus: (status: string) => void;
  onPromote?: (targetType: NoteType) => void;
  onAddTag: (tag: string) => void;
  onAddSubsystem: (subsystem: string) => void;
  onUpdateBody?: (body: string) => void;
  onSetTopic?: (topic: string) => void;
}

const PROMOTE_KEYWORDS: { keywords: string[]; type: NoteType; label: string }[] = [
  { keywords: ['시뮬레이션', '결과', '분석', 'simulation', 'result', 'analysis'], type: 'analysis-note', label: 'Analysis Note' },
  { keywords: ['논문', 'paper', 'DOI', 'http://', 'https://'], type: 'study-note', label: 'Study Note' },
  { keywords: ['결정', '선택', '대안', 'decision', 'alternative'], type: 'design-note', label: 'Design Note' },
];

export function AutoSuggestionBanner({
  noteType, noteId, status, verdict, topic, body,
  tags, subsystem: _subsystem, project, updatedAt,
  onUpdateStatus, onPromote, onAddTag, onAddSubsystem: _onAddSubsystem, onUpdateBody, onSetTopic,
}: Props) {
  const { dataDir } = useAppStore();
  const autoTagSuggest = useConfigStore((s) => s.editor.auto_tag_suggest);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`suggestion-dismissed:${noteId}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [tagsFile, setTagsFile] = useState<TagsFile | null>(null);
  const lastBodyRef = useRef('');

  useEffect(() => {
    if (!dataDir) return;
    readJsonFile<TagsFile>(dataDir, FILES.tags).then(t => setTagsFile(t));
  }, [dataDir]);

  // 노트가 바뀌어도 컴포넌트는 리마운트되지 않아 dismissed가 이전 노트
  // (또는 초기 빈 noteId) 것으로 남는다 — noteId 기준으로 다시 로드해야
  // "Dismiss해도 계속 뜨는" 문제가 없다.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`suggestion-dismissed:${noteId}`);
      setDismissed(stored ? new Set(JSON.parse(stored)) : new Set());
    } catch {
      setDismissed(new Set());
    }
  }, [noteId]);

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set([...prev, id]);
      try { localStorage.setItem(`suggestion-dismissed:${noteId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [noteId]);

  useEffect(() => {
    if (lastBodyRef.current === body) return;
    lastBodyRef.current = body;

    const newSuggestions: Suggestion[] = [];

    if (noteType === 'analysis-note' && status !== 'complete' && status !== 'archived') {
      const conclusionMatch = body.match(/## 결론\s*\n([\s\S]*?)(?=\n## |$)/);
      if (conclusionMatch) {
        const raw = conclusionMatch[1];
        const stripped = raw
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/^\d+\.\s*\*\*[^*]+\*\*:\s*$/gm, '')
          .trim();
        if (stripped.length >= 10) {
          newSuggestions.push({
            id: 'status-complete-conclusion',
            icon: '✅',
            message: '결론이 작성되었습니다. status를 complete로 변경할까요?',
            action: () => onUpdateStatus('complete'),
            actionLabel: 'Complete',
          });
        }
      }
    }

    if (noteType === 'test-log' && verdict && status !== 'complete' && status !== 'archived') {
      newSuggestions.push({
        id: 'status-complete-verdict',
        icon: '✅',
        message: `Verdict (${verdict})가 설정되었습니다. status를 complete로 변경할까요?`,
        action: () => onUpdateStatus('complete'),
        actionLabel: 'Complete',
      });
    }

    if (noteType === 'quick-memo' && onPromote) {
      for (const rule of PROMOTE_KEYWORDS) {
        const hasKeyword = rule.keywords.some(kw => body.toLowerCase().includes(kw.toLowerCase()));
        if (hasKeyword) {
          newSuggestions.push({
            id: `promote-${rule.type}`,
            icon: '💡',
            message: `${rule.label}로 승격하시겠습니까?`,
            action: () => onPromote(rule.type),
            actionLabel: `→ ${rule.label}`,
          });
          break;
        }
      }
    }

    const followupSection = body.match(/## 후속 과제\s*\n([\s\S]*?)(?=\n## |$)/);
    if (followupSection) {
      const lines = followupSection[1].split('\n');
      const checkedNoLink = lines
        .filter(l => /^- \[x\]/i.test(l.trim()) && !l.includes('[['))
        .map(l => l.replace(/^- \[x\]\s*/i, '').trim())
        .filter(Boolean);
      for (const item of checkedNoLink.slice(0, 2)) {
        const shortLabel = item.length > 30 ? item.slice(0, 30) + '...' : item;
        newSuggestions.push({
          id: `followup-${item.slice(0, 20)}`,
          icon: '📋',
          message: `후속 과제 완료: "${shortLabel}" — 관련 노트를 생성하시겠습니까?`,
        });
      }
    }

    if (autoTagSuggest) {
      const suggestedTagNames = suggestTags(body, tags, tagsFile);
      for (const tag of suggestedTagNames.slice(0, 3)) {
        newSuggestions.push({
          id: `tag-${tag}`,
          icon: '🏷️',
          message: `tag: ${tag} 추가?`,
          action: () => { onAddTag(tag); dismiss(`tag-${tag}`); },
          actionLabel: 'Add',
        });
      }
    }

    if ((noteType === 'analysis-note' || noteType === 'test-log') && body.includes('## 코드 / 파일 참조')) {
      const codeRefs = detectCodeReferences(body);
      if (codeRefs.length > 0) {
        newSuggestions.push({
          id: 'code-ref-detected',
          icon: '📁',
          message: `코드 참조 감지: ${codeRefs.slice(0, 3).join(', ')}`,
        });
      }
    }

    if (status === 'in-progress' && updatedAt) {
      const daysSinceUpdate = Math.floor(
        (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceUpdate >= 30) {
        newSuggestions.push({
          id: 'stale-archive',
          icon: '📦',
          message: `${daysSinceUpdate}일간 업데이트되지 않았습니다. archived로 변경할까요?`,
          action: () => onUpdateStatus('archived'),
          actionLabel: 'Archive',
        });
      }
    }

    setSuggestions(newSuggestions);
  }, [body, noteType, status, verdict, tags, tagsFile, updatedAt, onUpdateStatus, onPromote, onAddTag, dismiss, autoTagSuggest]);

  useEffect(() => {
    if (!dataDir || !topic || !noteId || !onUpdateBody) return;
    if (noteType !== 'analysis-note' && noteType !== 'test-log') return;
    let cancelled = false;

    (async () => {
      if (noteType === 'analysis-note') {
        const baseConditions = await getBaseConditions(dataDir, topic, noteId);
        if (cancelled || !baseConditions) return;
        const hasEmptyBase = body.includes('### 공통 조건 (Base)') &&
          !body.match(/### 공통 조건 \(Base\)\s*\n\s*\|[^|]+\|[^|]+\|[^|]+\|\s*\n\s*\|---/);
        if (hasEmptyBase) {
          setSuggestions(prev => {
            if (prev.some(s => s.id === 'autofill-base')) return prev;
            return [...prev, {
              id: 'autofill-base',
              icon: '📋',
              message: `이전 분석에서 공통 조건을 가져올 수 있습니다`,
              action: () => {
                const updated = body.replace(
                  /(### 공통 조건 \(Base\)\s*\n)\s*\|[^\n]*\|[^\n]*\|[^\n]*\|\s*\n\s*\|---\|---\|---\|/,
                  `$1${baseConditions}`,
                );
                if (updated !== body) onUpdateBody(updated);
                dismiss('autofill-base');
              },
              actionLabel: 'Apply',
            }];
          });
        }
      }

      if (noteType === 'test-log') {
        const prev = await getPreviousTestData(dataDir, topic, noteId);
        if (cancelled || !prev?.measurements) return;
        setSuggestions(prev2 => {
          if (prev2.some(s => s.id === 'autofill-test')) return prev2;
          return [...prev2, {
            id: 'autofill-test',
            icon: '📊',
            message: `이전 시험 (${prev.noteTitle})의 측정 데이터 구조를 가져올 수 있습니다`,
            action: () => {
              if (!body.includes('## 전후 비교')) {
                const comparison = `\n\n## 전후 비교\n\n### 이전 (${prev.noteTitle})\n${prev.measurements}\n\n### 현재\n(측정 데이터 입력)\n`;
                onUpdateBody(body + comparison);
              }
              dismiss('autofill-test');
            },
            actionLabel: 'Apply',
          }];
        });
      }
    })();

    return () => { cancelled = true; };
  }, [dataDir, topic, noteId, noteType, body, onUpdateBody, dismiss]);

  // Same-topic note link suggestion (via FTS index)
  useEffect(() => {
    if (!dataDir || !topic || !noteId) return;
    let cancelled = false;

    (async () => {
      try {
        const related = await findNotesByTopic(topic, noteId);
        if (cancelled || related.length === 0) return;
        // 이미 연결된 노트는 제외 — 전부 연결돼 있으면 제안 자체를 안 띄운다
        // (예전엔 연결 후에도 계속 떠서 중복 링킹 위험)
        const existing = await getForwardLinks(dataDir, noteId);
        const fresh = related.filter(r => !existing.includes(r.id));
        if (cancelled || fresh.length === 0) return;

        setSuggestions(prev => {
          if (prev.some(s => s.id === 'topic-link')) return prev;
          return [...prev, {
            id: 'topic-link',
            icon: '🔗',
            message: `같은 topic (${topic})의 미연결 노트 ${fresh.length}개 발견`,
            action: async () => {
              const merged = [...new Set([...existing, ...fresh.map(r => r.id)])];
              updateNoteLinks(dataDir, noteId, merged).catch(() => {});
              dismiss('topic-link');
            },
            actionLabel: 'Link All',
          }];
        });
      } catch {}
    })();

    return () => { cancelled = true; };
  }, [dataDir, topic, noteId, dismiss]);

  // Topic auto-recommendation (SPEC §3.16)
  useEffect(() => {
    if (!dataDir || topic || !onSetTopic) return;
    if (noteType === 'daily-log' || noteType === 'quick-memo') return;
    if (body.length < 100) return;
    let cancelled = false;

    (async () => {
      const topicsFile = await readJsonFile<TopicsFile>(dataDir, FILES.topics);
      if (cancelled || !topicsFile?.topics?.length) return;

      let best: { name: string; score: number } | null = null;
      const bodyLower = body.toLowerCase();

      for (const t of topicsFile.topics) {
        let score = 0;
        if (project.length > 0 && project.includes(t.project)) score += 3;
        if (_subsystem.length > 0 && _subsystem.includes(t.subsystem)) score += 2;
        for (const kw of t.keywords) {
          if (tags.includes(kw)) score += 1;
          if (bodyLower.includes(kw.toLowerCase())) score += 1;
        }
        if (score >= 3 && (!best || score > best.score)) {
          best = { name: t.name, score };
        }
      }

      if (cancelled || !best) return;
      const topicName = best.name;

      setSuggestions(prev => {
        if (prev.some(s => s.id === 'topic-recommend')) return prev;
        return [...prev, {
          id: 'topic-recommend',
          icon: '💡',
          message: `이 노트는 '${topicName}' 토픽과 관련된 것 같습니다`,
          action: () => { onSetTopic(topicName); dismiss('topic-recommend'); },
          actionLabel: '연결',
        }];
      });
    })();

    return () => { cancelled = true; };
  }, [dataDir, topic, noteId, noteType, body, tags, _subsystem, project, onSetTopic, dismiss]);

  const visible = suggestions.filter(s => !dismissed.has(s.id));
  if (visible.length === 0) return null;

  return (
    <div className="border-b border-border/50 bg-pastel-cream/20 shrink-0">
      {visible.map(s => (
        <div key={s.id} className="flex items-center gap-2 px-4 py-1.5">
          <span className="text-sm">{s.icon}</span>
          <span className="text-xs text-ink-2 flex-1">{s.message}</span>
          {s.action && (
            <button
              onClick={s.action}
              className="px-2 py-0.5 text-[10px] rounded bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
            >
              {s.actionLabel}
            </button>
          )}
          <button
            onClick={() => dismiss(s.id)}
            className="px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink transition-colors"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
