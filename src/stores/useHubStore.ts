import { create } from 'zustand';
import type { TopicEntry } from '../types/dataFiles';
import type { Task } from '../types/task';
import type { NoteType } from '../types/note';

export interface TimelineEntry {
  date: string;
  type: NoteType | 'daily-inline';
  title: string;
  summary: string;
  noteId: string;
  notePath: string;
  topicName?: string;
  topicColor?: string;
  tags?: string[];
}

export interface ConclusionEntry {
  text: string;
  noteId: string;
  notePath: string;
  date: string;
}

export interface TopicLink {
  from: string;
  to: string;
  noteCount: number;
}

export interface DDayItem {
  id: string;
  name: string;
  targetDate: string;
}

export interface DashboardNote {
  path: string;
  id: string;
  title: string;
  summary: string;
}

interface ProjectHubData {
  projectName: string;
  topics: TopicEntry[];
  timeline: TimelineEntry[];
  decisions: TimelineEntry[];
  todos: Task[];
  milestones: DDayItem[];
  topicLinks: TopicLink[];
  dashboardNote: DashboardNote | null;
}

interface TopicHubData {
  meta: TopicEntry;
  timeline: TimelineEntry[];
  conclusions: ConclusionEntry[];
  todos: Task[];
  relatedTopics: TopicEntry[];
}

interface HubState {
  projectHubData: ProjectHubData | null;
  topicHubData: TopicHubData | null;
  loading: boolean;
  filterTags: string[];

  setProjectHubData: (data: ProjectHubData | null) => void;
  setTopicHubData: (data: TopicHubData | null) => void;
  setLoading: (loading: boolean) => void;
  setFilterTags: (tags: string[]) => void;
  toggleFilterTag: (tag: string) => void;
  clear: () => void;
}

export const useHubStore = create<HubState>((set) => ({
  projectHubData: null,
  topicHubData: null,
  loading: false,
  filterTags: [],

  setProjectHubData: (data) => set({ projectHubData: data, topicHubData: null, filterTags: [] }),
  setTopicHubData: (data) => set({ topicHubData: data, projectHubData: null, filterTags: [] }),
  setLoading: (loading) => set({ loading }),
  setFilterTags: (tags) => set({ filterTags: tags }),
  toggleFilterTag: (tag) => set((s) => ({
    filterTags: s.filterTags.includes(tag)
      ? s.filterTags.filter(t => t !== tag)
      : [...s.filterTags, tag],
  })),
  clear: () => set({ projectHubData: null, topicHubData: null, loading: false, filterTags: [] }),
}));
