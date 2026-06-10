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

interface ProjectHubData {
  projectName: string;
  topics: TopicEntry[];
  timeline: TimelineEntry[];
  decisions: TimelineEntry[];
  todos: Task[];
  milestones: DDayItem[];
  topicLinks: TopicLink[];
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

  setProjectHubData: (data: ProjectHubData | null) => void;
  setTopicHubData: (data: TopicHubData | null) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useHubStore = create<HubState>((set) => ({
  projectHubData: null,
  topicHubData: null,
  loading: false,

  setProjectHubData: (data) => set({ projectHubData: data, topicHubData: null }),
  setTopicHubData: (data) => set({ topicHubData: data, projectHubData: null }),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ projectHubData: null, topicHubData: null, loading: false }),
}));
