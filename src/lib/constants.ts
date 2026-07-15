export const DATA_DIR_NAME = 'JRH-Orbit-Data';

export const FOLDERS = {
  notes: 'notes',
  daily: 'notes/daily',
  research: 'notes/research',
  reviews: 'reviews',
  reviewsWeekly: 'reviews/weekly',
  reviewsMonthly: 'reviews/monthly',
  reviewsQuarterly: 'reviews/quarterly',
  data: 'data',
  workhours: 'data/workhours',
  attachments: 'attachments',
  templates: 'templates',
} as const;

export const FILES = {
  todos: 'data/todos.json',
  projects: 'data/projects.json',
  experiments: 'data/experiments.json',
  tags: 'data/tags.json',
  topics: 'data/topics.json',
  links: 'data/links.json',
  subsystems: 'data/subsystems.json',
  ddays: 'data/ddays.json',
  calendar: 'data/calendar.json',
  calendarFeeds: 'data/calendar-feeds.json',
  playlist: 'data/playlist.json',
  templates: 'data/templates.json',
  timerState: 'data/timer-state.json',
  config: 'config.json',
} as const;

export const POMODORO_DEFAULTS = {
  work: 25 * 60,
  break: 5 * 60,
  longBreak: 15 * 60,
  sessionsBeforeLong: 4,
} as const;

export const SUBSYSTEM_DEFAULTS = {
  primary: ['ADCS', 'Orbit'],
  secondary: ['OBC', 'EPS', 'COM', 'STR', 'Thermal', 'Payload'],
} as const;
