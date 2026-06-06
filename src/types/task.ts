export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type TaskPriority = 1 | 2 | 3;

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  status?: 'todo' | 'in-progress' | 'done';
  priority?: TaskPriority;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  projectId?: string;
  tags?: string[];
  related_notes?: string[];
}

export interface RecurringRule {
  interval: 'daily' | 'weekly' | 'monthly';
  day?: string | number;
}

export interface Task {
  id: string;
  title: string;
  projectId?: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  subtasks: Subtask[];
  createdAt: string;
  updatedAt: string;
  subsystem?: string;
  tags?: string[];
  related_notes?: string[];
  daily_logs?: string[];
  carry_count?: number;
  recurring?: RecurringRule | null;
  source_note?: string;
  source_section?: string;
}

export interface TodosFile {
  version: number;
  lastModified: string;
  todos: Task[];
}
