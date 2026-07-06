import { invoke } from '@tauri-apps/api/core';
import ICAL from 'ical.js';
import { readJsonFile, writeJsonFile } from './fileSystem';
import { FILES } from './constants';
import type { CalendarEvent } from '../types/calendar';

/**
 * Google Calendar read-only integration.
 *
 * OAuth (consent + token exchange) runs in Rust (`google_oauth_login` /
 * `google_refresh_token`) via a loopback redirect — the webview can't host
 * the consent flow. Calendar reads happen here with plain fetch; googleapis
 * REST endpoints support CORS with a Bearer token.
 *
 * Credentials live in data/google-auth.json (calendar.readonly scope only).
 */
const AUTH_FILE = 'data/google-auth.json';

interface GoogleAuth {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Calendar ids to show. Absent → primary calendar only (subscribed
   *  calendars like holidays would otherwise flood the month view). */
  selectedCalendarIds?: string[];
}

export interface GoogleCalendarInfo {
  id: string;
  name: string;
  primary: boolean;
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

let cachedAccess: { token: string; expiresAt: number } | null = null;

async function getGoogleAuth(dataDir: string): Promise<GoogleAuth | null> {
  const a = await readJsonFile<GoogleAuth>(dataDir, AUTH_FILE);
  return a?.refreshToken ? a : null;
}

export async function isGoogleConnected(dataDir: string): Promise<boolean> {
  return (await getGoogleAuth(dataDir)) !== null;
}

export async function connectGoogle(
  dataDir: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const tokens = await invoke<Tokens>('google_oauth_login', { clientId, clientSecret });
  if (!tokens.refresh_token) {
    throw new Error('refresh_token이 발급되지 않았습니다. Google 계정 설정에서 앱 접근 권한을 제거한 뒤 다시 연결해주세요.');
  }
  await writeJsonFile(dataDir, AUTH_FILE, {
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
  });
  cachedAccess = { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 };
}

export async function disconnectGoogle(dataDir: string): Promise<void> {
  await writeJsonFile(dataDir, AUTH_FILE, {});
  cachedAccess = null;
}

async function getAccessToken(dataDir: string): Promise<string | null> {
  if (cachedAccess && Date.now() < cachedAccess.expiresAt) return cachedAccess.token;
  const auth = await getGoogleAuth(dataDir);
  if (!auth) return null;
  const tokens = await invoke<Tokens>('google_refresh_token', {
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
    refreshToken: auth.refreshToken,
  });
  cachedAccess = { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 };
  return cachedAccess.token;
}

/** List the account's calendars (for the picker UI). */
export async function listGoogleCalendars(dataDir: string): Promise<GoogleCalendarInfo[]> {
  const token = await getAccessToken(dataDir);
  if (!token) return [];
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`calendarList 요청 실패 (${res.status})`);
  const data = await res.json();
  return (data.items ?? []).map((c: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }) => ({
    id: c.id,
    name: c.summaryOverride ?? c.summary ?? c.id,
    primary: !!c.primary,
  }));
}

export async function getSelectedCalendarIds(dataDir: string): Promise<string[] | null> {
  const a = await readJsonFile<GoogleAuth>(dataDir, AUTH_FILE);
  return a?.selectedCalendarIds ?? null;
}

export async function setSelectedCalendarIds(dataDir: string, ids: string[]): Promise<void> {
  const a = await readJsonFile<GoogleAuth>(dataDir, AUTH_FILE);
  if (!a?.refreshToken) return;
  await writeJsonFile(dataDir, AUTH_FILE, { ...a, selectedCalendarIds: ids });
}

/* ── iCal secret-address feeds (no OAuth needed) ──
 * Google Calendar → 설정 → 캘린더의 "비공개 주소(iCal)" URL을 등록하면
 * OAuth/Cloud Console 없이 읽기 연동이 된다. The .ics is fetched in Rust
 * (no CORS headers on calendar.google.com) and parsed here with ical.js,
 * which also expands recurring events (RRULE/EXDATE). */

export interface CalendarFeed {
  id: string;
  name: string;
  url: string;
}

export async function getFeeds(dataDir: string): Promise<CalendarFeed[]> {
  const f = await readJsonFile<{ feeds?: CalendarFeed[] }>(dataDir, FILES.calendarFeeds);
  return f?.feeds ?? [];
}

export async function saveFeeds(dataDir: string, feeds: CalendarFeed[]): Promise<void> {
  await writeJsonFile(dataDir, FILES.calendarFeeds, { feeds });
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function pushOccurrence(
  out: CalendarEvent[],
  feed: CalendarFeed,
  uid: string,
  summary: string,
  start: Date,
  end: Date,
  isAllDay: boolean,
) {
  const startDate = fmtDate(start);
  // all-day DTEND is exclusive → pull back one day
  const endAdj = isAllDay ? new Date(end.getTime() - 86_400_000) : end;
  const endDate = fmtDate(endAdj);
  out.push({
    id: `ics-${feed.id}-${uid}-${startDate}`,
    title: summary || '(제목 없음)',
    date: startDate,
    ...(endDate > startDate ? { endDate } : {}),
    ...(isAllDay ? {} : { startTime: fmtTime(start), endTime: fmtTime(end) }),
    source: 'google',
    calendarName: feed.name,
  });
}

export async function fetchIcsEvents(
  feeds: CalendarFeed[],
  windowStart: Date,
  windowEnd: Date,
): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  for (const feed of feeds) {
    let text: string;
    try {
      text = await invoke<string>('http_get_text', { url: feed.url });
    } catch (e) {
      throw new Error(`${feed.name}: ${e instanceof Error ? e.message : e}`);
    }
    let comp: ICAL.Component;
    try {
      comp = new ICAL.Component(ICAL.parse(text));
    } catch {
      throw new Error(`${feed.name}: iCal 파싱 실패 — 비공개 주소(.ics)가 맞는지 확인해주세요`);
    }
    // register timezones shipped inside the feed so DTSTART;TZID resolves
    for (const tz of comp.getAllSubcomponents('vtimezone')) {
      ICAL.TimezoneService.register(new ICAL.Timezone(tz));
    }
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      const event = new ICAL.Event(vevent);
      const isAllDay = event.startDate?.isDate ?? false;
      try {
        if (event.isRecurring()) {
          const iter = event.iterator();
          let next: ICAL.Time | null;
          let guard = 0;
          while ((next = iter.next()) && guard++ < 1000) {
            const occ = event.getOccurrenceDetails(next);
            const start = occ.startDate.toJSDate();
            if (start > windowEnd) break;
            const end = occ.endDate.toJSDate();
            if (end < windowStart) continue;
            pushOccurrence(out, feed, event.uid ?? String(guard), event.summary, start, end, isAllDay);
          }
        } else {
          const start = event.startDate?.toJSDate();
          const end = event.endDate?.toJSDate() ?? start;
          if (!start || !end) continue;
          if (end < windowStart || start > windowEnd) continue;
          pushOccurrence(out, feed, event.uid ?? '', event.summary, start, end, isAllDay);
        }
      } catch { /* skip malformed events, keep the rest */ }
    }
  }
  return out;
}

/** Fetch events from all selected calendars within [timeMin, timeMax). */
export async function fetchGoogleEvents(
  dataDir: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<CalendarEvent[]> {
  const token = await getAccessToken(dataDir);
  if (!token) return [];
  const headers = { Authorization: `Bearer ${token}` };
  const selected = await getSelectedCalendarIds(dataDir);

  const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers });
  if (!calRes.ok) throw new Error(`calendarList 요청 실패 (${calRes.status})`);
  const calList = await calRes.json();

  const events: CalendarEvent[] = [];
  for (const cal of calList.items ?? []) {
    // No explicit selection → primary calendar only; subscribed calendars
    // (holidays, sports, …) would flood the view otherwise.
    if (selected ? !selected.includes(cal.id) : !cal.primary) continue;
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`,
    );
    url.searchParams.set('timeMin', timeMinIso);
    url.searchParams.set('timeMax', timeMaxIso);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '250');
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of data.items ?? []) {
      if (item.status === 'cancelled') continue;
      const startDate: string | undefined = item.start?.date ?? item.start?.dateTime?.slice(0, 10);
      if (!startDate) continue;
      let endDate: string | undefined = item.end?.date ?? item.end?.dateTime?.slice(0, 10);
      if (item.end?.date) {
        // all-day events: Google's end.date is exclusive — pull back one day
        const d = new Date(item.end.date + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      events.push({
        id: `g-${item.id}`,
        googleId: item.id,
        title: item.summary ?? '(제목 없음)',
        date: startDate,
        ...(endDate && endDate !== startDate ? { endDate } : {}),
        ...(item.start?.dateTime ? { startTime: item.start.dateTime.slice(11, 16) } : {}),
        ...(item.end?.dateTime ? { endTime: item.end.dateTime.slice(11, 16) } : {}),
        source: 'google',
        calendarName: cal.summaryOverride ?? cal.summary,
      });
    }
  }
  return events;
}
