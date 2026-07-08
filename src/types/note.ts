export type NoteType =
  | 'daily-log'
  | 'quick-memo'
  | 'analysis-note'
  | 'test-log'
  | 'design-note'
  | 'study-note'
  | 'review'
  | 'project-dashboard'
  | 'blank';

export type LegacyNoteType = 'daily' | 'research';

export type NoteStatus = 'draft' | 'in-progress' | 'complete' | 'archived';

export type TestVerdict = 'pass' | 'fail' | 'conditional' | '';

export interface WorkhourDetail {
  project: string;
  hours: number;
}

export interface CarriedOverItem {
  from: string;
  items: string[];
}

export interface NoteMeta {
  id?: string;
  title: string;
  type: NoteType | LegacyNoteType;
  date?: string;
  project: string | string[];
  topic?: string;
  /** Experiment name (data/experiments.json) this note belongs to */
  experiment?: string;
  subsystem?: string[];
  tags: string[];
  related?: string[];
  status?: NoteStatus;
  verdict?: TestVerdict;
  workhour?: number;
  workhour_detail?: WorkhourDetail[];
  summary?: string;
  carried_over?: CarriedOverItem[];
  created: string;
  updated: string;
  path: string;
}

export interface NoteFile {
  meta: NoteMeta;
  content: string;
}

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  'daily-log': 'Daily Log',
  'quick-memo': 'Quick Memo',
  'analysis-note': 'Analysis Note',
  'test-log': 'Test Log',
  'design-note': 'Design Note',
  'study-note': 'Study Note',
  'review': 'Review',
  'project-dashboard': 'Project Dashboard',
  'blank': 'Blank',
};

export const NOTE_TYPE_ICONS: Record<NoteType, string> = {
  'daily-log': '📅',
  'quick-memo': '💬',
  'analysis-note': '📊',
  'test-log': '🔧',
  'design-note': '📐',
  'study-note': '📚',
  'review': '🔍',
  'project-dashboard': '🛰️',
  'blank': '📝',
};

export const NOTE_TYPE_ABBREV: Record<NoteType, string> = {
  'daily-log': 'daily',
  'quick-memo': 'memo',
  'analysis-note': 'analysis',
  'test-log': 'test',
  'design-note': 'design',
  'study-note': 'study',
  'review': 'review',
  'project-dashboard': 'dashboard',
  'blank': 'note',
};

export function isLegacyType(type: string): type is LegacyNoteType {
  return type === 'daily' || type === 'research';
}

export function normalizeLegacyType(type: string): NoteType | LegacyNoteType {
  if (type === 'daily') return 'daily-log';
  if (type === 'research') return 'analysis-note';
  return type as NoteType;
}

export function normalizeProject(project: string | string[] | undefined): string[] {
  if (!project) return [];
  if (Array.isArray(project)) return project;
  if (typeof project === 'string' && project.trim()) return [project.trim()];
  return [];
}
