import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line,
} from 'recharts';
import { useAppStore } from '../../stores/useAppStore';
import {
  getDashboardStats, calculateGrowthScore,
  getWorkhourByDay, getMonthlyHeatmap, getWritingStreak,
  getFocusTimeDistribution, getWorkPattern, getProductivityTrend, getWeeklyComparison,
  type DashboardStats, type WorkhourByDay, type WeeklyHeatmapCell, type WritingStreak,
  type FocusTimeData, type WorkPatternCell, type ProductivityPoint, type WeeklyComparison,
} from '../../lib/statistics';
import { runHealthCheck, type HealthIssue } from '../../lib/noteHealth';
import { NOTE_TYPE_LABELS, NOTE_TYPE_ICONS, type NoteType } from '../../types/note';
import { ReviewListView } from './ReviewListView';
import clsx from 'clsx';

type StatTab = 'dashboard' | 'reviews';
type Period = 'week' | 'month';

const PIE_COLORS = [
  'var(--color-pastel-pink)',
  'var(--color-pastel-mint)',
  'var(--color-pastel-blue)',
  'var(--color-pastel-lavender)',
  'var(--color-pastel-cream)',
  'var(--color-pastel-peach)',
];

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="bg-paper-soft rounded-xl p-3 border border-border">
      <div className="text-[10px] uppercase tracking-wider text-ink-3 mb-1">{label}</div>
      <div className={clsx('text-xl font-semibold', warn ? 'text-red-500' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}

function RateCard({ label, rate, total }: { label: string; rate: number; total: number }) {
  if (rate < 0) {
    return (
      <div className="bg-paper-soft rounded-xl p-3 border border-border">
        <div className="text-[10px] uppercase tracking-wider text-ink-3 mb-1">{label}</div>
        <div className="text-sm text-ink-3">No data</div>
      </div>
    );
  }
  const pct = Math.round(rate * 100);
  return (
    <div className="bg-paper-soft rounded-xl p-3 border border-border">
      <div className="text-[10px] uppercase tracking-wider text-ink-3 mb-1">{label}</div>
      <div className="flex items-end gap-1.5">
        <span className="text-xl font-semibold text-ink">{pct}%</span>
        <span className="text-[11px] text-ink-3 mb-0.5">/ {total}</span>
      </div>
      <div className="mt-1.5 h-1.5 bg-paper-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: pct >= 70 ? 'var(--color-pastel-mint)' : pct >= 40 ? 'var(--color-pastel-yellow)' : 'var(--color-pastel-pink)',
          }}
        />
      </div>
    </div>
  );
}

function HealthBanner({ issues, onClickIssue }: { issues: HealthIssue[]; onClickIssue: (issue: HealthIssue) => void }) {
  if (issues.length === 0) {
    return (
      <div className="bg-paper-soft rounded-xl p-3 border border-border text-center">
        <span className="text-sm text-ink-3">All notes are healthy</span>
      </div>
    );
  }

  const grouped = new Map<string, HealthIssue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.type) ?? [];
    list.push(issue);
    grouped.set(issue.type, list);
  }

  return (
    <div className="space-y-2">
      {[...grouped.entries()].map(([type, items]) => (
        <div key={type} className="bg-paper-soft rounded-xl p-3 border border-border">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-ink-2">{items[0].label}</span>
            <span className="text-[10px] text-ink-3 bg-paper-muted px-1.5 py-0.5 rounded-full">{items.length}</span>
          </div>
          <div className="space-y-1">
            {items.slice(0, 5).map((issue, i) => (
              <button
                key={i}
                onClick={() => onClickIssue(issue)}
                className="w-full text-left flex items-center gap-2 px-2 py-1 rounded-md text-xs text-ink-2 hover:bg-paper-muted transition-colors"
              >
                {/* 태그 이슈처럼 특정 노트에 속하지 않는 항목은 설명만 전체 폭으로 */}
                {(issue.noteTitle ?? issue.todoTitle) ? (
                  <>
                    <span className="truncate flex-1">{issue.noteTitle ?? issue.todoTitle}</span>
                    <span className="text-ink-3 shrink-0">{issue.description}</span>
                  </>
                ) : (
                  <span className="truncate flex-1 text-ink-2">{issue.description}</span>
                )}
              </button>
            ))}
            {items.length > 5 && (
              <div className="text-[10px] text-ink-3 px-2">+{items.length - 5} more</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatisticsView() {
  const [statTab, setStatTab] = useState<StatTab>('dashboard');

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-4 pt-3 pb-1 border-b border-border">
        {([['dashboard', 'Dashboard'], ['reviews', 'Reviews']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStatTab(key)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-t-lg transition-colors border-b-2',
              statTab === key
                ? 'border-chrome text-ink font-medium'
                : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {statTab === 'dashboard' ? <DashboardPanel /> : <ReviewListView />}
    </div>
  );
}

function WorkhourByDayChart({ data, period }: { data: WorkhourByDay[]; period: 'week' | 'month' }) {
  const title = period === 'week' ? 'Workhour by Day' : 'Workhour by Week';
  return (
    <div className="bg-paper-soft rounded-xl p-4 border border-border">
      <h3 className="text-xs font-medium text-ink-2 mb-3">{title}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="day" tick={{ fontSize: period === 'month' ? 10 : 9 }} stroke="var(--color-ink-3)" />
            <YAxis yAxisId="h" tick={{ fontSize: 10 }} stroke="var(--color-ink-3)" />
            <YAxis yAxisId="n" orientation="right" tick={{ fontSize: 10 }} stroke="var(--color-ink-3)" />
            <Tooltip
              contentStyle={{ background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
            />
            <Bar yAxisId="h" dataKey="hours" name="Work (h)" fill="var(--color-pastel-mint)" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="n" dataKey="createdNotes" name="노트 생성" stackId="notes" fill="var(--color-pastel-lavender)" />
            <Bar yAxisId="n" dataKey="editedNotes" name="노트 수정" stackId="notes" fill="var(--color-pastel-blue)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MonthlyHeatmap({ data }: { data: WeeklyHeatmapCell[] }) {
  const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const maxWeek = Math.max(...data.map(c => c.week), 1);
  const maxHours = Math.max(...data.map(c => c.hours), 1);

  function cellColor(hours: number) {
    if (hours === 0) return 'var(--color-paper-muted)';
    const intensity = Math.min(hours / maxHours, 1);
    if (intensity < 0.3) return 'var(--color-pastel-mint)';
    if (intensity < 0.6) return 'var(--color-pastel-blue)';
    return 'var(--color-chrome)';
  }

  return (
    <div className="bg-paper-soft rounded-xl p-4 border border-border flex flex-col h-full">
      <h3 className="text-xs font-medium text-ink-2 mb-3">Monthly Heatmap</h3>
      <div className="flex-1 flex items-center justify-center">
        <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `auto repeat(${maxWeek}, 1fr)` }}>
          {/* Header row */}
          <div />
          {Array.from({ length: maxWeek }, (_, w) => (
            <div key={w} className="text-center text-[10px] text-ink-3 font-medium pb-1">{w + 1}주</div>
          ))}
          {/* Day rows */}
          {dayLabels.map((label, idx) => {
            const dow = dayOrder[idx];
            return [
              <div key={`label-${dow}`} className="text-[10px] text-ink-3 pr-2 flex items-center">{label}</div>,
              ...Array.from({ length: maxWeek }, (_, w) => {
                const cell = data.find(c => c.week === w + 1 && c.dayIndex === dow);
                return (
                  <div
                    key={`${dow}-${w}`}
                    className="aspect-square rounded-sm min-w-[22px] min-h-[22px]"
                    style={{ background: cellColor(cell?.hours ?? 0) }}
                    title={cell ? `${cell.date}: ${cell.hours}h` : ''}
                  />
                );
              }),
            ];
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-ink-3">
        <span>Less</span>
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-paper-muted)' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-pastel-mint)' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-pastel-blue)' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-chrome)' }} />
        <span>More</span>
      </div>
    </div>
  );
}

function FocusTimeChart({ data, projects, period }: { data: FocusTimeData[]; projects: string[]; period: 'week' | 'month' }) {
  return (
    <div className="bg-paper-soft rounded-xl p-4 border border-border">
      <h3 className="text-xs font-medium text-ink-2 mb-3">Focus Time Distribution</h3>
      <div className="h-48">
        {projects.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
              <XAxis dataKey="day" tick={{ fontSize: period === 'month' ? 9 : 10 }} stroke="var(--color-ink-3)" />
              <YAxis domain={[0, 'auto']} allowDecimals={false} tick={{ fontSize: 10 }} stroke="var(--color-ink-3)" unit="h" />
              <Tooltip
                contentStyle={{ background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                formatter={(v) => {
                  const n = Number(v) || 0;
                  const h = Math.floor(Math.abs(n));
                  const m = Math.round((Math.abs(n) - h) * 60);
                  return [`${String(h).padStart(2, '0')}H ${String(m).padStart(2, '0')}M`];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {projects.map((proj, i) => (
                <Bar key={proj} dataKey={proj} stackId="a" fill={PIE_COLORS[i % PIE_COLORS.length]} radius={i === projects.length - 1 ? [3, 3, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-ink-3">No workhour data</div>
        )}
      </div>
    </div>
  );
}

function WorkPatternChart({ data, period }: { data: WorkPatternCell[]; period?: 'week' | 'month' }) {
  const maxCount = Math.max(...data.map(c => c.count), 1);
  const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const slots = ['오전', '오후', '야간'];

  function cellColor(count: number) {
    if (count === 0) return 'var(--color-paper-muted)';
    const intensity = Math.min(count / maxCount, 1);
    if (intensity < 0.3) return 'var(--color-pastel-mint)';
    if (intensity < 0.6) return 'var(--color-pastel-blue)';
    return 'var(--color-chrome)';
  }

  return (
    <div className="bg-paper-soft rounded-xl p-4 border border-border flex flex-col h-full">
      <h3 className="text-xs font-medium text-ink-2 mb-3">{period === 'month' ? 'Monthly Work Pattern' : 'Work Pattern'}</h3>
      <div className="flex-1 flex items-center justify-center">
        <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `auto repeat(${slots.length}, 1fr)` }}>
          <div />
          {slots.map(slot => (
            <div key={slot} className="text-center text-[10px] text-ink-3 font-medium pb-1">{slot}</div>
          ))}
          {dayLabels.map((label, idx) => {
            const di = dayOrder[idx];
            return [
              <div key={`label-${di}`} className="text-[10px] text-ink-3 pr-2 flex items-center">{label}</div>,
              ...slots.map((slotName, si) => {
                const cell = data.find(c => c.slotIndex === si && c.dayIndex === di);
                const cnt = cell?.count ?? 0;
                return (
                  <div
                    key={`${si}-${di}`}
                    className="aspect-square rounded-sm min-w-[24px] min-h-[24px] flex items-center justify-center text-[9px] font-medium"
                    style={{ background: cellColor(cnt), color: cnt > 0 ? 'var(--color-ink)' : 'var(--color-ink-3)' }}
                    title={`${label} ${slotName}: ${cnt}`}
                  >
                    {cnt > 0 ? cnt : ''}
                  </div>
                );
              }),
            ];
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-ink-3">
        <span>Less</span>
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-paper-muted)' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-pastel-mint)' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-pastel-blue)' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-chrome)' }} />
        <span>More</span>
      </div>
    </div>
  );
}

function WeeklyComparisonChart({ data }: { data: WeeklyComparison[] }) {
  return (
    <div className="bg-paper-soft rounded-xl p-4 border border-border h-full flex flex-col">
      <h3 className="text-xs font-medium text-ink-2 mb-3">vs Last Week</h3>
      <div className="flex-1 flex flex-col justify-center space-y-4">
        {data.map(d => {
          const max = Math.max(d.thisWeek, d.lastWeek, 0.1);
          const diff = d.lastWeek > 0 ? Math.round(((d.thisWeek - d.lastWeek) / d.lastWeek) * 100) : (d.thisWeek > 0 ? 100 : 0);
          const isUp = diff > 0;
          const isDown = diff < 0;
          const formatVal = (v: number) => {
            if (d.metric === 'Workhour') {
              return `${Math.floor(v)}H ${String(Math.round((v % 1) * 60)).padStart(2, '0')}m`;
            }
            return String(v);
          };
          return (
            <div key={d.metric}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-ink-2 font-medium">{d.metric}</span>
                <span className={`text-[10px] font-medium ${isUp ? 'text-green-500' : isDown ? 'text-red-400' : 'text-ink-3'}`}>
                  {isUp ? '↑' : isDown ? '↓' : '→'} {Math.abs(diff)}%
                </span>
              </div>
              <div className="flex gap-1.5 items-center">
                <span className="text-[8px] text-ink-3 w-6 shrink-0">Now</span>
                <div className="flex-1 h-3.5 bg-paper-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max((d.thisWeek / max) * 100, 2)}%`, background: 'var(--color-pastel-blue)' }} />
                </div>
                <span className="text-[10px] text-ink font-medium w-12 text-right shrink-0">{formatVal(d.thisWeek)}</span>
              </div>
              <div className="flex gap-1.5 items-center mt-0.5">
                <span className="text-[8px] text-ink-3 w-6 shrink-0">Prev</span>
                <div className="flex-1 h-3.5 bg-paper-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max((d.lastWeek / max) * 100, 2)}%`, background: 'var(--color-pastel-lavender)' }} />
                </div>
                <span className="text-[10px] text-ink-3 w-12 text-right shrink-0">{formatVal(d.lastWeek)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductivityTrendChart({ data, period }: { data: ProductivityPoint[]; period: 'week' | 'month' }) {
  return (
    <div className="bg-paper-soft rounded-xl p-4 border border-border">
      <h3 className="text-xs font-medium text-ink-2 mb-3">Productivity Score</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="day" tick={{ fontSize: period === 'month' ? 8 : 10 }} stroke="var(--color-ink-3)" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="var(--color-ink-3)" />
            <Tooltip
              contentStyle={{ background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
              formatter={(v) => [`${v}/100`, '']}
            />
            <Line type="monotone" dataKey="score" name="Score" stroke="var(--color-pastel-blue)" strokeWidth={2} dot={{ r: 3, fill: 'var(--color-pastel-blue)' }} />
            <Line type="monotone" dataKey="avg" name="Avg" stroke="var(--color-pastel-lavender)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StreakCard({ streak }: { streak: WritingStreak }) {
  return (
    <div className="bg-paper-soft rounded-xl p-3 border border-border">
      <div className="text-[10px] uppercase tracking-wider text-ink-3 mb-1">Writing Streak</div>
      <div className="flex items-end gap-2">
        <span className="text-xl font-semibold text-ink">{streak.current}</span>
        <span className="text-sm mb-0.5">days</span>
      </div>
      <div className="text-[11px] text-ink-3 mt-0.5">Longest: {streak.longest} days</div>
    </div>
  );
}

function DashboardPanel() {
  const { dataDir, openNote } = useAppStore();
  const [period, setPeriod] = useState<Period>('week');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [health, setHealth] = useState<HealthIssue[]>([]);
  const [workhourByDay, setWorkhourByDay] = useState<WorkhourByDay[]>([]);
  const [heatmap, setHeatmap] = useState<WeeklyHeatmapCell[]>([]);
  const [streak, setStreak] = useState<WritingStreak>({ current: 0, longest: 0 });
  const [focusTime, setFocusTime] = useState<{ data: FocusTimeData[]; projects: string[] }>({ data: [], projects: [] });
  const [workPattern, setWorkPattern] = useState<WorkPatternCell[]>([]);
  const [prodTrend, setProdTrend] = useState<ProductivityPoint[]>([]);
  const [weeklyComp, setWeeklyComp] = useState<WeeklyComparison[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dataDir) return;
    setLoading(true);
    try {
      const [s, wbd, hm, st, ft, wp, pt, wc] = await Promise.all([
        getDashboardStats(dataDir, period),
        getWorkhourByDay(dataDir, period),
        period === 'month' ? getMonthlyHeatmap(dataDir) : Promise.resolve([]),
        getWritingStreak(dataDir),
        getFocusTimeDistribution(dataDir, period),
        getWorkPattern(dataDir, period),
        getProductivityTrend(dataDir, period),
        getWeeklyComparison(dataDir),
      ]);
      const h = await runHealthCheck(dataDir, s.notesMeta);
      setStats(s);
      setWorkhourByDay(wbd);
      setHeatmap(hm);
      setStreak(st);
      setFocusTime(ft);
      setWorkPattern(wp);
      setProdTrend(pt);
      setWeeklyComp(wc);
      setHealth(h);
    } catch {}
    setLoading(false);
  }, [dataDir, period]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const refresh = () => { load(); };
    window.addEventListener('workhours-changed', refresh);
    return () => window.removeEventListener('workhours-changed', refresh);
  }, [load]);

  const handleClickIssue = useCallback((issue: HealthIssue) => {
    if (issue.notePath) {
      openNote(issue.notePath);
    }
  }, [openNote]);

  if (loading || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-ink-3">
        Loading statistics...
      </div>
    );
  }

  const workhourData = stats.workhourByProject.length > 0
    ? stats.workhourByProject
    : [{ project: 'No data', hours: 0 }];

  const noteTypeData = Object.entries(stats.notesByType).map(([type, count]) => ({
    name: NOTE_TYPE_LABELS[type as NoteType] ?? type,
    icon: NOTE_TYPE_ICONS[type as NoteType] ?? '',
    value: count,
  }));

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Dashboard</h1>
        <div className="flex gap-1">
          {(['week', 'month'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                'px-3 py-1 text-xs rounded-lg transition-colors',
                period === p
                  ? 'bg-chrome text-paper font-medium'
                  : 'text-ink-3 hover:bg-paper-soft'
              )}
            >
              {p === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards + Heatmaps (unified grid) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Workhour"
          value={`${Math.floor(stats.totalWorkhour)}H ${String(Math.round((stats.totalWorkhour % 1) * 60)).padStart(2, '0')}m`}
          sub={`${stats.workhourByProject.length} projects`}
        />
        <StatCard
          label="Notes"
          value={`${stats.totalNotes + stats.editedNotes}`}
          sub={`생성 ${stats.totalNotes} · 수정 ${stats.editedNotes}`}
        />
        {period === 'month' && heatmap.length > 0 ? (
          <>
            <div className="sm:row-span-3 h-full"><MonthlyHeatmap data={heatmap} /></div>
            <div className="sm:row-span-3 h-full"><WorkPatternChart data={workPattern} period={period} /></div>
          </>
        ) : (
          <>
            <StatCard
              label="Overdue TODOs"
              value={String(stats.overdueCount)}
              warn={stats.overdueCount > 0}
            />
            <div className="sm:row-span-2 h-full"><WorkPatternChart data={workPattern} period={period} /></div>
          </>
        )}
        {period === 'month' && (
          <StatCard
            label="Overdue TODOs"
            value={String(stats.overdueCount)}
            warn={stats.overdueCount > 0}
          />
        )}
        <RateCard
          label="TODO Completion"
          rate={stats.todoCompletionRate}
          total={stats.todoTotal}
        />
        <RateCard
          label="Note Completion"
          rate={stats.completionRate}
          total={stats.totalNotes}
        />
        <RateCard
          label="Test Pass Rate"
          rate={stats.testPassRate}
          total={stats.testTotal}
        />
        <StatCard
          label="TODO Done"
          value={`${stats.todoDone} / ${stats.todoTotal}`}
        />
        <RateCard
          label="Study Applied"
          rate={stats.studyToApplication}
          total={stats.notesByType['study-note'] ?? 0}
        />
        <StatCard
          label="Carry-over Rate"
          value={stats.carryOverRate > 0 ? `${Math.round(stats.carryOverRate * 100)}%` : '0%'}
          sub="carry >= 3"
          warn={stats.carryOverRate > 0.3}
        />
        <StreakCard streak={streak} />
      </div>

      {/* Workhour by Day + Weekly Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WorkhourByDayChart data={workhourByDay} period={period} />
        <WeeklyComparisonChart data={weeklyComp} />
      </div>

      {/* Focus Time + Productivity Trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FocusTimeChart data={focusTime.data} projects={focusTime.projects} period={period} />
        <ProductivityTrendChart data={prodTrend} period={period} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Workhour by Project */}
        <div className="bg-paper-soft rounded-xl p-4 border border-border">
          <h3 className="text-xs font-medium text-ink-2 mb-3">Workhour by Project</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workhourData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis dataKey="project" tick={{ fontSize: 10 }} stroke="var(--color-ink-3)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-ink-3)" />
                <Tooltip
                  contentStyle={{ background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v) => [`${Math.floor(Number(v))}H ${String(Math.round((Number(v) % 1) * 60)).padStart(2, '0')}m`, 'Work']}
                />
                <Bar dataKey="hours" fill="var(--color-pastel-blue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Notes by Type */}
        <div className="bg-paper-soft rounded-xl p-4 border border-border">
          <h3 className="text-xs font-medium text-ink-2 mb-3">Notes by Type</h3>
          <div className="h-48">
            {noteTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={noteTypeData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    innerRadius={30}
                    paddingAngle={2}
                    label={({ name, value }) => `${name} (${value})`}
                  >
                    {noteTypeData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-ink-3">No notes in this period</div>
            )}
          </div>
        </div>
      </div>

      {/* Growth Score Radar */}
      {(() => {
        const growth = calculateGrowthScore(stats);
        const radarData = [
          { axis: 'Productivity', value: growth.productivity },
          { axis: 'Tech Growth', value: growth.techGrowth },
          { axis: 'Engineering', value: growth.engineering },
          { axis: 'Knowledge Mgmt', value: growth.knowledgeMgmt },
        ];
        return (
          <div className="bg-paper-soft rounded-xl p-4 border border-border">
            <h3 className="text-xs font-medium text-ink-2 mb-3">Growth Score</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="var(--color-border)" />
                  <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: 'var(--color-ink-2)' }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} stroke="var(--color-ink-3)" />
                  <Radar
                    dataKey="value"
                    stroke="var(--color-pastel-blue)"
                    fill="var(--color-pastel-blue)"
                    fillOpacity={0.3}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--color-paper)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`${v}/100`, 'Score']}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center mt-2">
              <span className="text-sm font-semibold text-ink">Growth Score: {growth.total}/100</span>
            </div>
          </div>
        );
      })()}

      {/* Health Check */}
      <div>
        <h3 className="text-xs font-medium text-ink-2 mb-2">
          Note Health Check
          {health.length > 0 && (
            <span className="ml-1.5 text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">{health.length} issues</span>
          )}
        </h3>
        <HealthBanner issues={health} onClickIssue={handleClickIssue} />
      </div>
    </div>
  );
}
