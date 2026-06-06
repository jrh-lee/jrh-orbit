import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { listNotes, readNote } from '../../lib/fileSystem';
import { parseFrontmatterFields, splitFrontmatter } from '../../lib/frontmatter';
import { generateReviewPrompt, saveReviewFromResponse, type ReviewPromptResult } from '../../lib/reviewGenerator';
import { copyToClipboard } from '../../lib/clipboard';
import { open } from '@tauri-apps/plugin-shell';
import { FOLDERS } from '../../lib/constants';
import type { ReviewType } from '../../lib/reviewCollector';
import clsx from 'clsx';

interface ReviewEntry {
  path: string;
  id: string;
  title: string;
  reviewType: string;
  periodStart: string;
  periodEnd: string;
  generated: string;
}

const TABS: { key: ReviewType; label: string; folder: string }[] = [
  { key: 'weekly', label: 'Weekly', folder: FOLDERS.reviewsWeekly },
  { key: 'monthly', label: 'Monthly', folder: FOLDERS.reviewsMonthly },
  { key: 'quarterly', label: 'Quarterly', folder: FOLDERS.reviewsQuarterly },
];

type RightPanel = 'empty' | 'view' | 'prompt' | 'paste';

export function ReviewListView() {
  const { dataDir } = useAppStore();
  const [tab, setTab] = useState<ReviewType>('weekly');
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewContent, setViewContent] = useState('');
  const [error, setError] = useState('');

  // Prompt / paste state
  const [panel, setPanel] = useState<RightPanel>('empty');
  const [promptText, setPromptText] = useState('');
  const [pendingMeta, setPendingMeta] = useState<ReviewPromptResult['meta'] | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentPeriod, setCurrentPeriod] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const loadReviews = useCallback(async () => {
    if (!dataDir) return;
    const folder = TABS.find(t => t.key === tab)!.folder;
    try {
      const files = await listNotes(dataDir, folder);
      const entries: ReviewEntry[] = [];
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        try {
          const raw = await readNote(dataDir, f);
          const fields = parseFrontmatterFields(raw);
          entries.push({
            path: f,
            id: fields.id ?? '',
            title: fields.title ?? f,
            reviewType: fields.review_type ?? tab,
            periodStart: fields.period_start ?? '',
            periodEnd: fields.period_end ?? '',
            generated: fields.generated ?? fields.created ?? '',
          });
        } catch {}
      }
      entries.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
      setReviews(entries);
    } catch {
      setReviews([]);
    }
  }, [dataDir, tab]);

  useEffect(() => {
    loadReviews();
    setSelected(null);
    setViewContent('');
    setPanel('empty');
    setPromptText('');
    setPasteText('');
    setPendingMeta(null);
  }, [loadReviews]);

  const handleSelect = useCallback(async (entry: ReviewEntry) => {
    if (!dataDir) return;
    setSelected(entry.path);
    setPanel('view');
    try {
      const raw = await readNote(dataDir, entry.path);
      const { body } = splitFrontmatter(raw);
      setViewContent(body);
    } catch {
      setViewContent('Failed to load review.');
    }
  }, [dataDir]);

  const handleGeneratePrompt = useCallback(async () => {
    if (!dataDir) return;
    setError('');
    try {
      const result = await generateReviewPrompt(dataDir, tab, undefined, currentPeriod);
      setPromptText(result.fullPrompt);
      setPendingMeta(result.meta);
      setPanel('prompt');
      setSelected(null);

      const ok = await copyToClipboard(result.fullPrompt);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
        try { await open('https://claude.ai'); } catch {}
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to generate prompt');
    }
  }, [dataDir, tab, currentPeriod]);

  const handleCopyAgain = useCallback(async () => {
    const ok = await copyToClipboard(promptText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [promptText]);

  const handleSelectAll = useCallback(() => {
    promptRef.current?.select();
  }, []);

  const handleSaveResult = useCallback(async () => {
    if (!dataDir || !pendingMeta || !pasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const path = await saveReviewFromResponse(dataDir, pasteText.trim(), pendingMeta);
      await loadReviews();
      setSelected(path);
      setViewContent(pasteText.trim());
      setPanel('view');
      setPasteText('');
      setPendingMeta(null);
      window.dispatchEvent(new CustomEvent('notes-changed'));
    } catch (e: any) {
      setError(e.message ?? 'Failed to save review');
    }
    setSaving(false);
  }, [dataDir, pendingMeta, pasteText, loadReviews]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-3 py-1 text-xs rounded-lg transition-colors',
              tab === t.key ? 'bg-chrome text-paper font-medium' : 'text-ink-3 hover:bg-paper-soft',
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => setCurrentPeriod(true)}
            className={clsx('px-2 py-0.5 text-[10px] rounded transition-colors', currentPeriod ? 'bg-chrome/20 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft')}
          >
            이번 기간
          </button>
          <button
            onClick={() => setCurrentPeriod(false)}
            className={clsx('px-2 py-0.5 text-[10px] rounded transition-colors', !currentPeriod ? 'bg-chrome/20 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft')}
          >
            지난 기간
          </button>
        </div>

        <div className="flex-1" />
        <button
          onClick={handleGeneratePrompt}
          className="px-3 py-1 text-xs rounded-lg bg-pastel-lavender text-ink font-medium hover:opacity-90 transition-opacity"
        >
          Generate Prompt
        </button>
      </div>

      {error && (
        <div className="mx-4 mb-2 px-3 py-2 text-xs text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* List */}
        <div className="w-56 shrink-0 border-r border-border overflow-y-auto">
          {reviews.length === 0 ? (
            <div className="p-4 text-xs text-ink-3 text-center">No reviews yet</div>
          ) : (
            reviews.map(r => (
              <button
                key={r.path}
                onClick={() => handleSelect(r)}
                className={clsx(
                  'w-full text-left px-3 py-2 border-b border-border transition-colors',
                  selected === r.path ? 'bg-chrome/10' : 'hover:bg-paper-soft',
                )}
              >
                <div className="text-xs font-medium text-ink truncate">{r.title}</div>
                <div className="text-[10px] text-ink-3 mt-0.5">
                  {r.periodStart} ~ {r.periodEnd}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-y-auto p-4">
          {panel === 'prompt' && (
            <div className="flex flex-col gap-3 h-full">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-ink-2">
                  {copied ? 'Clipboard에 복사됨!' : 'Step 1: 프롬프트를 복사하세요'}
                </span>
                <button
                  onClick={handleCopyAgain}
                  className="px-2 py-0.5 text-[11px] rounded border border-border text-ink-2 hover:bg-paper-soft transition-colors"
                >
                  Copy
                </button>
                <button
                  onClick={handleSelectAll}
                  className="px-2 py-0.5 text-[11px] rounded border border-border text-ink-2 hover:bg-paper-soft transition-colors"
                >
                  Select All
                </button>
                <div className="flex-1" />
                <a
                  href="https://claude.ai"
                  target="_blank"
                  rel="noopener"
                  className="px-2 py-0.5 text-[11px] rounded border border-chrome text-chrome hover:bg-chrome/10 transition-colors"
                >
                  Open claude.ai
                </a>
              </div>

              <textarea
                ref={promptRef}
                readOnly
                value={promptText}
                className="flex-1 min-h-[150px] px-3 py-2 text-xs font-mono rounded-sm border border-border bg-paper-soft text-ink resize-none focus:outline-none focus:border-chrome"
              />

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-ink-2">Step 2: AI 응답을 붙여넣기</span>
              </div>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder="Claude.ai의 응답을 여기에 붙여넣으세요..."
                className="min-h-[150px] px-3 py-2 text-sm rounded-sm border border-border bg-paper text-ink resize-y focus:outline-none focus:border-chrome"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveResult}
                  disabled={saving || !pasteText.trim()}
                  className="px-4 py-1.5 text-sm rounded-sm bg-chrome text-paper font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {saving ? 'Saving...' : 'Save as Review'}
                </button>
                <button
                  onClick={() => { setPanel('empty'); setPromptText(''); setPasteText(''); setPendingMeta(null); }}
                  className="px-3 py-1.5 text-sm rounded-sm border border-border text-ink-2 hover:bg-paper-soft transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {panel === 'view' && viewContent && (
            <div className="prose prose-sm max-w-none text-ink">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{viewContent}</div>
            </div>
          )}

          {panel === 'empty' && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-ink-3">
              <p className="text-sm">리뷰를 선택하거나, "Generate Prompt"로 새 리뷰를 생성하세요</p>
              <div className="text-[11px] text-ink-3/70 max-w-sm text-center leading-relaxed">
                프롬프트에는 daily log, TODO, 근무시간, 노트 목록이 포함됩니다.
                <br />
                claude.ai에 붙여넣으면 AI가 상세 분석 리뷰를 작성합니다.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
