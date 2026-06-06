import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { generateReviewPrompt } from '../../lib/reviewGenerator';
import { copyToClipboard } from '../../lib/clipboard';
import { open } from '@tauri-apps/plugin-shell';
import type { ReviewType } from '../../lib/reviewCollector';

const CONFIG_KEY = 'jrh-orbit-review-config';

interface ReviewConfig {
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  quarterlyEnabled: boolean;
  scheduleHour: number;
}

function getDefaultConfig(): ReviewConfig {
  return {
    weeklyEnabled: true,
    monthlyEnabled: true,
    quarterlyEnabled: true,
    scheduleHour: 8,
  };
}

function loadConfig(): ReviewConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...getDefaultConfig(), ...JSON.parse(raw) };
  } catch {}
  return getDefaultConfig();
}

function saveConfig(config: ReviewConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function getNextScheduledDate(type: ReviewType, config: ReviewConfig): Date | null {
  if (type === 'weekly' && !config.weeklyEnabled) return null;
  if (type === 'monthly' && !config.monthlyEnabled) return null;
  if (type === 'quarterly' && !config.quarterlyEnabled) return null;

  const now = new Date();
  const hour = config.scheduleHour;

  if (type === 'weekly') {
    const d = new Date(now);
    const dayOfWeek = d.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? (d.getHours() >= hour ? 7 : 0) : 8 - dayOfWeek;
    d.setDate(d.getDate() + daysUntilMonday);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  if (type === 'monthly') {
    const d = new Date(now.getFullYear(), now.getMonth() + (now.getDate() === 1 && now.getHours() < hour ? 0 : 1), 1);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  const qMonths = [0, 3, 6, 9];
  const currentMonth = now.getMonth();
  let nextQ = qMonths.find(m => m > currentMonth);
  let nextYear = now.getFullYear();
  if (nextQ === undefined) {
    if (qMonths.includes(currentMonth) && now.getDate() === 1 && now.getHours() < hour) {
      nextQ = currentMonth;
    } else {
      nextQ = 0;
      nextYear++;
    }
  }
  const d = new Date(nextYear, nextQ, 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ReviewSchedulerStatus() {
  const { dataDir } = useAppStore();
  const [config, setConfig] = useState<ReviewConfig>(loadConfig);
  const [copiedType, setCopiedType] = useState<ReviewType | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    saveConfig(config);
    window.dispatchEvent(new CustomEvent('review-config-changed'));
  }, [config]);

  const handleToggle = useCallback((type: ReviewType) => {
    setConfig(prev => ({
      ...prev,
      [`${type}Enabled`]: !prev[`${type}Enabled` as keyof ReviewConfig],
    }));
  }, []);

  const handleHourChange = useCallback((hour: number) => {
    setConfig(prev => ({ ...prev, scheduleHour: hour }));
  }, []);

  const handleCopyPrompt = useCallback(async (type: ReviewType) => {
    if (!dataDir) return;
    setCopyError(null);
    try {
      const result = await generateReviewPrompt(dataDir, type);
      const ok = await copyToClipboard(result.fullPrompt);
      if (ok) {
        setCopiedType(type);
        setTimeout(() => setCopiedType(null), 3000);
        try { await open('https://claude.ai'); } catch {}
      } else {
        setCopyError('클립보드 복사 실패. Statistics > Reviews에서 복사해주세요.');
        setTimeout(() => setCopyError(null), 5000);
      }
    } catch (e: any) {
      setCopyError(e.message ?? 'Failed to generate prompt');
      setTimeout(() => setCopyError(null), 5000);
    }
  }, [dataDir]);

  const reviewTypes: { type: ReviewType; label: string; icon: string }[] = [
    { type: 'weekly', label: 'Weekly', icon: 'W' },
    { type: 'monthly', label: 'Monthly', icon: 'M' },
    { type: 'quarterly', label: 'Quarterly', icon: 'Q' },
  ];

  return (
      <div className="space-y-2 max-w-lg">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm text-ink-2">Reminder Time</span>
          <select
            value={config.scheduleHour}
            onChange={e => handleHourChange(Number(e.target.value))}
            className="px-2 py-1 text-sm rounded-sm border border-border bg-paper text-ink focus:outline-none focus:border-chrome"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {String(i).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>

        {reviewTypes.map(({ type, label, icon }) => {
          const enabled = config[`${type}Enabled` as keyof ReviewConfig] as boolean;
          const nextDate = getNextScheduledDate(type, config);

          return (
            <div
              key={type}
              className="flex items-center gap-3 px-3 py-2 rounded-sm border border-border bg-paper-soft"
            >
              <button
                onClick={() => handleToggle(type)}
                className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${
                  enabled ? 'bg-chrome' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-paper shadow transition-all ${
                    enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>

              <span className="w-5 h-5 rounded bg-chrome/20 text-[10px] font-bold text-ink flex items-center justify-center shrink-0">
                {icon}
              </span>
              <span className="text-sm text-ink font-medium w-20">{label}</span>

              <div className="flex-1 text-[11px] text-ink-3 min-w-0 truncate">
                {enabled && nextDate && (
                  <span>Next: {formatDate(nextDate)}</span>
                )}
                {!enabled && <span>Disabled</span>}
              </div>

              <button
                onClick={() => handleCopyPrompt(type)}
                disabled={!dataDir}
                className="px-2.5 py-1 text-[11px] rounded-sm border border-border hover:bg-paper-soft transition-colors disabled:opacity-40 shrink-0"
              >
                {copiedType === type ? 'Copied!' : 'Copy Prompt'}
              </button>
            </div>
          );
        })}

        {copyError && (
          <div className="text-[11px] px-3 py-1.5 rounded-sm text-red-500 bg-red-50">{copyError}</div>
        )}

        <p className="text-[11px] text-ink-3 mt-2">
          Copy Prompt → <a href="https://claude.ai" target="_blank" rel="noopener" className="text-chrome underline">claude.ai</a>에 붙여넣기 → 결과를 Statistics {'>'} Reviews에서 저장.
        </p>
      </div>
  );
}
