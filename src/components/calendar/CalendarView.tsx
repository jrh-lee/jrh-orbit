import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, isSameMonth, parseISO,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import clsx from 'clsx';
import { useAppStore } from '../../stores/useAppStore';
import { readJsonFile, writeJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import {
  isGoogleConnected, connectGoogle, disconnectGoogle, fetchGoogleEvents,
  listGoogleCalendars, getSelectedCalendarIds, setSelectedCalendarIds,
  type GoogleCalendarInfo,
} from '../../lib/googleCalendar';
import type { CalendarEvent, CalendarFile } from '../../types/calendar';
import type { Task, TodosFile } from '../../types/task';

interface DDayEvent { id: string; name: string; targetDate: string }
interface DDaysFile { events: DDayEvent[] }

interface DayItem {
  key: string;
  kind: 'event' | 'google' | 'due' | 'dday';
  label: string;
  time?: string;
  event?: CalendarEvent;
  done?: boolean;
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function CalendarView() {
  const { dataDir, openDaily } = useAppStore();
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ddays, setDdays] = useState<DDayEvent[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [gClientId, setGClientId] = useState('');
  const [gClientSecret, setGClientSecret] = useState('');
  const [showCalPicker, setShowCalPicker] = useState(false);
  const [gcalList, setGcalList] = useState<GoogleCalendarInfo[]>([]);
  const [gcalSelected, setGcalSelected] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    if (!dataDir) return;
    const [cal, todos, dd] = await Promise.all([
      readJsonFile<CalendarFile>(dataDir, FILES.calendar),
      readJsonFile<TodosFile>(dataDir, FILES.todos),
      readJsonFile<DDaysFile>(dataDir, FILES.ddays),
    ]);
    setEvents(cal?.events ?? []);
    setTasks(todos?.todos ?? []);
    setDdays(dd?.events ?? []);
  }, [dataDir]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const handler = () => loadAll();
    for (const ev of ['calendar-changed', 'tasks-changed', 'ddays-changed'] as const) {
      window.addEventListener(ev, handler);
    }
    return () => {
      for (const ev of ['calendar-changed', 'tasks-changed', 'ddays-changed'] as const) {
        window.removeEventListener(ev, handler);
      }
    };
  }, [loadAll]);

  const persistEvents = useCallback(async (updated: CalendarEvent[]) => {
    setEvents(updated);
    if (!dataDir) return;
    await writeJsonFile(dataDir, FILES.calendar, { version: 1, events: updated }).catch(() => {});
  }, [dataDir]);

  // ── Google Calendar (read-only) ──
  useEffect(() => {
    if (!dataDir) return;
    isGoogleConnected(dataDir).then(setGoogleConnected).catch(() => {});
  }, [dataDir]);

  const refreshGoogle = useCallback(async () => {
    if (!dataDir || !googleConnected) return;
    setGoogleBusy(true);
    setGoogleError('');
    try {
      const timeMin = startOfWeek(startOfMonth(month)).toISOString();
      const timeMax = addDays(endOfWeek(endOfMonth(month)), 1).toISOString();
      setGoogleEvents(await fetchGoogleEvents(dataDir, timeMin, timeMax));
    } catch (e) {
      setGoogleError(String(e instanceof Error ? e.message : e));
    } finally {
      setGoogleBusy(false);
    }
  }, [dataDir, googleConnected, month]);

  useEffect(() => { refreshGoogle(); }, [refreshGoogle]);

  const handleGoogleConnect = useCallback(async () => {
    if (!dataDir || !gClientId.trim() || !gClientSecret.trim()) return;
    setGoogleBusy(true);
    setGoogleError('');
    try {
      await connectGoogle(dataDir, gClientId.trim(), gClientSecret.trim());
      setGoogleConnected(true);
      setShowGoogleSetup(false);
      setGClientId('');
      setGClientSecret('');
    } catch (e) {
      setGoogleError(String(e instanceof Error ? e.message : e));
    } finally {
      setGoogleBusy(false);
    }
  }, [dataDir, gClientId, gClientSecret]);

  const handleGoogleDisconnect = useCallback(async () => {
    if (!dataDir) return;
    await disconnectGoogle(dataDir).catch(() => {});
    setGoogleConnected(false);
    setGoogleEvents([]);
    setShowCalPicker(false);
  }, [dataDir]);

  const openCalPicker = useCallback(async () => {
    if (!dataDir) return;
    setShowCalPicker((v) => !v);
    try {
      const [list, sel] = await Promise.all([
        listGoogleCalendars(dataDir),
        getSelectedCalendarIds(dataDir),
      ]);
      setGcalList(list);
      // no explicit selection yet → the primary calendar is the implicit default
      setGcalSelected(new Set(sel ?? list.filter((c) => c.primary).map((c) => c.id)));
    } catch (e) {
      setGoogleError(String(e instanceof Error ? e.message : e));
    }
  }, [dataDir]);

  const toggleCalendar = useCallback(async (id: string) => {
    if (!dataDir) return;
    const next = new Set(gcalSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGcalSelected(next);
    await setSelectedCalendarIds(dataDir, [...next]).catch(() => {});
    refreshGoogle();
  }, [dataDir, gcalSelected, refreshGoogle]);

  // Map yyyy-MM-dd → items shown in that cell
  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    const push = (day: string, item: DayItem) => {
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(item);
    };
    for (const e of [...events, ...googleEvents]) {
      const start = parseISO(e.date);
      const end = e.endDate ? parseISO(e.endDate) : start;
      for (let d = start; d <= end; d = addDays(d, 1)) {
        push(format(d, 'yyyy-MM-dd'), {
          key: `ev-${e.id}-${format(d, 'dd')}`,
          kind: e.source === 'google' ? 'google' : 'event',
          label: e.title,
          time: e.startTime,
          event: e,
        });
      }
    }
    for (const t of tasks) {
      if (!t.dueDate && !t.startDate) continue;
      const done = t.status === 'done';
      // start~due range → the task spans every day of the range
      if (t.startDate && t.dueDate && t.startDate <= t.dueDate) {
        const start = parseISO(t.startDate);
        const end = parseISO(t.dueDate);
        let guard = 0;
        for (let d = start; d <= end && guard < 92; d = addDays(d, 1), guard++) {
          const day = format(d, 'yyyy-MM-dd');
          push(day, {
            key: `due-${t.id}-${day}`,
            kind: 'due',
            label: day === t.dueDate ? `${t.title} (마감)` : t.title,
            done,
          });
        }
      } else if (t.dueDate) {
        push(t.dueDate, { key: `due-${t.id}`, kind: 'due', label: `${t.title} (마감)`, done });
      } else if (t.startDate) {
        push(t.startDate, { key: `start-${t.id}`, kind: 'due', label: `${t.title} (시작)`, done });
      }
    }
    for (const d of ddays) {
      push(d.targetDate, { key: `dd-${d.id}`, kind: 'dday', label: d.name });
    }
    // Sort: all-day/no-time entries (마감, D-Day, 종일 일정) on top,
    // then timed events in time order
    for (const items of map.values()) {
      items.sort((a, b) => {
        const at = a.time ? 1 : 0;
        const bt = b.time ? 1 : 0;
        if (at !== bt) return at - bt;
        return (a.time ?? '').localeCompare(b.time ?? '');
      });
    }
    return map;
  }, [events, googleEvents, tasks, ddays]);

  const weeks = useMemo(() => {
    const first = startOfWeek(startOfMonth(month));
    const last = endOfWeek(endOfMonth(month));
    const days: Date[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [month]);

  // Fixed uniform row height (fits the 7-chip cap) — computing it from the
  // busiest cell made the layout shift whenever content/selection changed.
  const ROW_MIN_PX = 140;

  const addEvent = useCallback(() => {
    const title = newTitle.trim();
    if (!title) return;
    const ev: CalendarEvent = {
      id: generateId(),
      title,
      date: selected,
      // multi-day: end date must be after the start to count
      ...(newEndDate && newEndDate > selected ? { endDate: newEndDate } : {}),
      ...(newTime ? { startTime: newTime } : {}),
      source: 'local',
    };
    persistEvents([...events, ev]);
    setNewTitle('');
    setNewTime('');
    setNewEndDate('');
  }, [newTitle, newTime, newEndDate, selected, events, persistEvents]);

  const removeEvent = useCallback((id: string) => {
    persistEvents(events.filter((e) => e.id !== id));
  }, [events, persistEvents]);

  const selectedItems = itemsByDay.get(selected) ?? [];
  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => subMonths(m, 1))}
            className="p-1.5 rounded-lg hover:bg-paper-soft text-ink-2 transition-colors"
            title="이전 달"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={() => { setMonth(new Date()); setSelected(today); }}
            className="px-2 py-1 text-xs rounded-lg hover:bg-paper-soft text-ink-2 transition-colors"
          >
            오늘
          </button>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="p-1.5 rounded-lg hover:bg-paper-soft text-ink-2 transition-colors"
            title="다음 달"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className="text-base font-semibold text-ink">
          {format(month, 'yyyy년 M월', { locale: ko })}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-ink-3">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pastel-blue inline-block" />일정</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pastel-lavender inline-block" />Google</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pastel-peach inline-block" />마감</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pastel-pink inline-block" />D-Day</span>
          {googleConnected ? (
            <>
              <button
                onClick={refreshGoogle}
                disabled={googleBusy}
                className="px-1.5 py-0.5 rounded border border-border hover:bg-paper-soft text-ink-2 transition-colors disabled:opacity-50"
                title="Google 일정 새로고침"
              >
                {googleBusy ? '⟳...' : '⟳ Google'}
              </button>
              <button
                onClick={openCalPicker}
                className="px-1.5 py-0.5 rounded border border-border hover:bg-paper-soft text-ink-2 transition-colors"
                title="표시할 캘린더 선택"
              >
                캘린더 선택
              </button>
              <button
                onClick={handleGoogleDisconnect}
                className="text-ink-3 hover:text-badge-high transition-colors"
                title="Google 연결 해제"
              >
                해제
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowGoogleSetup((v) => !v)}
              className="px-1.5 py-0.5 rounded border border-border hover:bg-paper-soft text-ink-2 transition-colors"
            >
              Google 연결
            </button>
          )}
        </div>
      </div>

      {/* ── Google setup panel ── */}
      {showGoogleSetup && !googleConnected && (
        <div className="px-4 py-2.5 border-b border-border bg-paper-soft/60 shrink-0 space-y-1.5">
          <div className="text-[11px] text-ink-2">
            Google Cloud Console에서 <b>데스크톱 앱</b> 유형의 OAuth 클라이언트를 만들고
            (Calendar API 사용 설정 필요), Client ID / Secret을 입력하세요.
            연결 버튼을 누르면 브라우저에서 Google 로그인 창이 열립니다.
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={gClientId}
              onChange={(e) => setGClientId(e.target.value)}
              placeholder="Client ID (…apps.googleusercontent.com)"
              className="flex-1 text-[11px] px-2 py-1 rounded border border-border bg-paper text-ink placeholder:text-ink-3"
            />
            <input
              type="password"
              value={gClientSecret}
              onChange={(e) => setGClientSecret(e.target.value)}
              placeholder="Client Secret"
              className="w-48 text-[11px] px-2 py-1 rounded border border-border bg-paper text-ink placeholder:text-ink-3"
            />
            <button
              onClick={handleGoogleConnect}
              disabled={googleBusy || !gClientId.trim() || !gClientSecret.trim()}
              className="px-2.5 py-1 text-[11px] rounded-lg border border-border text-ink-2 hover:bg-paper-muted transition-colors disabled:opacity-50 shrink-0"
            >
              {googleBusy ? '연결 중... (브라우저 확인)' : '연결'}
            </button>
          </div>
          {googleError && <div className="text-[10px] text-badge-high">{googleError}</div>}
        </div>
      )}
      {googleError && !showGoogleSetup && (
        <div className="px-4 py-1 border-b border-border bg-badge-high-bg text-[10px] text-badge-high shrink-0">
          Google: {googleError}
        </div>
      )}

      {/* ── Calendar picker ── */}
      {showCalPicker && googleConnected && (
        <div className="px-4 py-2 border-b border-border bg-paper-soft/60 shrink-0">
          <div className="text-[10px] text-ink-3 mb-1">표시할 캘린더 (체크한 것만 월간 뷰에 나타납니다)</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {gcalList.length === 0 && <span className="text-[11px] text-ink-3">불러오는 중...</span>}
            {gcalList.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-[11px] text-ink-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gcalSelected.has(c.id)}
                  onChange={() => toggleCalendar(c.id)}
                  className="accent-[var(--color-chrome)]"
                />
                {c.name}{c.primary ? ' (기본)' : ''}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Month grid + day panel share one page-level scroll.
           scrollbar-gutter keeps the width stable when the scrollbar
           appears/disappears (cell expansion used to make it wobble) ── */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="px-3 pt-2">
        <div className="grid grid-cols-7 sticky top-0 bg-paper z-10">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={clsx('text-center text-[11px] font-medium py-1',
              i === 0 ? 'text-badge-high' : i === 6 ? 'text-pastel-blue' : 'text-ink-3')}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid gap-px bg-border rounded-lg overflow-hidden border border-border"
             style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(${ROW_MIN_PX}px, auto))` }}>
          {weeks.map((row, ri) => (
            <div key={ri} className="grid grid-cols-7 gap-px">
              {row.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const items = itemsByDay.get(key) ?? [];
                const inMonth = isSameMonth(day, month);
                const isToday = key === today;
                const isSelected = key === selected;
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    className={clsx(
                      'flex flex-col items-stretch text-left p-1 transition-colors',
                      inMonth ? 'bg-paper' : 'bg-paper-soft/60',
                      isSelected && 'ring-2 ring-inset ring-chrome',
                      'hover:bg-paper-soft',
                    )}
                  >
                    <span className={clsx(
                      'text-[11px] leading-5 w-5 text-center rounded-full shrink-0',
                      isToday ? 'bg-chrome text-paper font-bold' : inMonth ? 'text-ink-2' : 'text-ink-3/60',
                      day.getDay() === 0 && !isToday && 'text-badge-high/80',
                    )}>
                      {format(day, 'd')}
                    </span>
                    <div className="flex flex-col gap-px mt-0.5">
                      {/* selected day expands in place — all items shown in the cell */}
                      {(isSelected ? items : items.slice(0, 7)).map((it) => (
                        <span
                          key={it.key}
                          className={clsx(
                            'text-[9px] leading-3.5 px-1 rounded truncate',
                            it.kind === 'event' && 'bg-pastel-blue/40 text-ink-2',
                            it.kind === 'google' && 'bg-pastel-lavender/40 text-ink-2',
                            it.kind === 'due' && 'bg-pastel-peach/40 text-ink-2',
                            it.kind === 'dday' && 'bg-pastel-pink/40 text-ink-2',
                            it.done && 'line-through opacity-50',
                          )}
                        >
                          {it.time ? `${it.time} ` : ''}{it.label}
                        </span>
                      ))}
                      {!isSelected && items.length > 7 && (
                        <span className="text-[9px] text-ink-3 px-1">+{items.length - 7}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        </div>

        {/* ── Selected day panel — flush under the grid, no own scroll ── */}
        <div className="border-t border-border px-4 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs font-semibold text-ink">
            {format(parseISO(selected), 'M월 d일 (EEEE)', { locale: ko })}
          </div>
          <button
            onClick={() => openDaily(selected)}
            className="text-[10px] text-ink-3 hover:text-ink-2 transition-colors"
            title="이 날짜의 Daily 노트로 이동"
          >
            Daily 열기 →
          </button>
        </div>
        <div className="space-y-1 mb-2">
          {selectedItems.length === 0 && (
            <div className="text-[11px] text-ink-3">일정 없음</div>
          )}
          {selectedItems.map((it) => (
            <div key={it.key} className="flex items-center gap-1.5 group">
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0',
                it.kind === 'event' && 'bg-pastel-blue',
                it.kind === 'google' && 'bg-pastel-lavender',
                it.kind === 'due' && 'bg-pastel-peach',
                it.kind === 'dday' && 'bg-pastel-pink',
              )} />
              {it.time && <span className="text-[10px] text-ink-3 font-mono shrink-0">{it.time}</span>}
              <span className={clsx('text-xs text-ink-2 truncate', it.done && 'line-through opacity-50')}>
                {it.label}
              </span>
              {it.kind === 'due' && <span className="text-[9px] text-ink-3 shrink-0">마감</span>}
              {it.kind === 'dday' && <span className="text-[9px] text-ink-3 shrink-0">D-Day</span>}
              {it.kind === 'google' && <span className="text-[9px] text-ink-3 shrink-0">{it.event?.calendarName ?? 'Google'}</span>}
              {it.kind === 'event' && it.event && (
                <button
                  onClick={() => removeEvent(it.event!.id)}
                  className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-badge-high text-[10px] transition-opacity shrink-0"
                  title="삭제"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            title="시간 (선택)"
            className="text-[11px] px-1.5 py-1 rounded border border-border bg-paper text-ink-2 w-[84px] shrink-0"
          />
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addEvent(); }}
            placeholder="새 일정 추가... (Enter)"
            className="flex-1 text-xs px-2 py-1 rounded border border-border bg-paper text-ink placeholder:text-ink-3"
          />
          <span className="text-[10px] text-ink-3 shrink-0">~</span>
          <input
            type="date"
            value={newEndDate}
            min={selected}
            onChange={(e) => setNewEndDate(e.target.value)}
            title="종료일 (선택 — 여러 날 일정)"
            className="text-[11px] px-1.5 py-1 rounded border border-border bg-paper text-ink-2 w-[120px] shrink-0"
          />
          <button
            onClick={addEvent}
            className="px-2.5 py-1 text-xs rounded-lg border border-border text-ink-2 hover:bg-paper-soft transition-colors shrink-0"
          >
            추가
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
