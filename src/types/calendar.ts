export interface CalendarEvent {
  id: string;
  title: string;
  /** yyyy-MM-dd */
  date: string;
  /** yyyy-MM-dd — inclusive end for multi-day events */
  endDate?: string;
  /** HH:mm */
  startTime?: string;
  endTime?: string;
  memo?: string;
  color?: string;
  /** Minutes before start to fire a notification (0 = at start). Absent = no reminder.
   *  All-day events (no startTime) treat the start as 09:00. */
  reminderMinutes?: number;
  source: 'local' | 'google';
  /** Google event id — set only for source: 'google' */
  googleId?: string;
  calendarName?: string;
}

export interface CalendarFile {
  version: number;
  events: CalendarEvent[];
}

export const DEFAULT_CALENDAR_FILE: CalendarFile = { version: 1, events: [] };
