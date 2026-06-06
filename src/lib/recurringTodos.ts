import { format } from 'date-fns';
import { readJsonFile, writeJsonFile } from './fileSystem';
import { FILES } from './constants';
import type { TodosFile, Task } from '../types/task';

export async function processRecurringTodos(dataDir: string): Promise<number> {
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (!todosFile) return 0;

  const today = format(new Date(), 'yyyy-MM-dd');
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dayOfMonth = new Date().getDate();

  let created = 0;
  const newTodos: Task[] = [];

  for (const todo of todosFile.todos) {
    if (!todo.recurring) continue;
    if (todo.status === 'done') continue;

    const rule = todo.recurring;
    let shouldCreate = false;

    if (rule.interval === 'daily') {
      shouldCreate = true;
    } else if (rule.interval === 'weekly' && rule.day) {
      shouldCreate = String(rule.day).toLowerCase() === dayOfWeek;
    } else if (rule.interval === 'monthly' && rule.day) {
      shouldCreate = Number(rule.day) === dayOfMonth;
    }

    if (!shouldCreate) continue;

    const existingToday = todosFile.todos.find(
      t => t.title === todo.title && t.createdAt.startsWith(today) && t.id !== todo.id
    );
    if (existingToday) continue;

    const newId = `${todo.id}-${today}`;
    const alreadyExists = todosFile.todos.some(t => t.id === newId);
    if (alreadyExists) continue;

    newTodos.push({
      id: newId,
      title: todo.title,
      projectId: todo.projectId,
      status: 'todo',
      priority: todo.priority,
      dueDate: today,
      subtasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      subsystem: todo.subsystem,
      tags: todo.tags,
    });
    created++;
  }

  if (newTodos.length > 0) {
    todosFile.todos.push(...newTodos);
    todosFile.lastModified = new Date().toISOString();
    await writeJsonFile(dataDir, FILES.todos, todosFile);
  }

  return created;
}
