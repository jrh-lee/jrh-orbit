import { create } from 'zustand';
import type { Task, TaskStatus } from '../types/task';

interface TaskState {
  tasks: Task[];
  filterProject: string | null;
  filterStatus: TaskStatus | null;
  filterTag: string | null;

  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  setFilterProject: (project: string | null) => void;
  setFilterStatus: (status: TaskStatus | null) => void;
  setFilterTag: (tag: string | null) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  filterProject: null,
  filterStatus: null,
  filterTag: null,

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
  updateTask: (id, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  setFilterProject: (project) => set({ filterProject: project }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setFilterTag: (tag) => set({ filterTag: tag }),
}));
