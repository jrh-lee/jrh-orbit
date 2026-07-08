import { create } from 'zustand';
import type { TopicEntry } from '../types/dataFiles';
import type { Task } from '../types/task';
import type { NoteType } from '../types/note';
import type { Experiment } from '../types/experiment';

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

export interface ExperimentSummary {
  id: string;
  name: string;
  status: Experiment['status'];
  noteCount: number;
}

interface ProjectHubData {
  projectName: string;
  topics: TopicEntry[];
  experiments: ExperimentSummary[];
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

interface ExperimentHubData {
  meta: Experiment;
  projectName: string;
  timeline: TimelineEntry[];
  conclusions: ConclusionEntry[];
  todos: Task[];
}

interface HubState {
  projectHubData: ProjectHubData | null;
  topicHubData: TopicHubData | null;
  experimentHubData: ExperimentHubData | null;
  loading: boolean;
  filterTags: string[];

  setProjectHubData: (data: ProjectHubData | null) => void;
  setTopicHubData: (data: TopicHubData | null) => void;
  setExperimentHubData: (data: ExperimentHubData | null) => void;
  setLoading: (loading: boolean) => void;
  setFilterTags: (tags: string[]) => void;
  toggleFilterTag: (tag: string) => void;
  clear: () => void;
}

export const useHubStore = create<HubState>((set) => ({
  projectHubData: null,
  topicHubData: null,
  experimentHubData: null,
  loading: false,
  filterTags: [],

  setProjectHubData: (data) => set({ projectHubData: data, topicHubData: null, experimentHubData: null, filterTags: [] }),
  setTopicHubData: (data) => set({ topicHubData: data, projectHubData: null, experimentHubData: null, filterTags: [] }),
  setExperimentHubData: (data) => set({ experimentHubData: data, projectHubData: null, topicHubData: null, filterTags: [] }),
  setLoading: (loading) => set({ loading }),
  setFilterTags: (tags) => set({ filterTags: tags }),
  toggleFilterTag: (tag) => set((s) => ({
    filterTags: s.filterTags.includes(tag)
      ? s.filterTags.filter(t => t !== tag)
      : [...s.filterTags, tag],
  })),
  clear: () => set({ projectHubData: null, topicHubData: null, experimentHubData: null, loading: false, filterTags: [] }),
}));
