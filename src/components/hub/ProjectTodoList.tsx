import type { Task } from '../../types/task';
import { HubTodoItem } from './shared/HubTodoItem';

interface Props {
  todos: Task[];
  onToggle: (id: string) => void;
}

export function ProjectTodoList({ todos, onToggle }: Props) {
  if (todos.length === 0) return null;

  const overdue = todos.filter((t) => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10));
  const rest = todos.filter((t) => !overdue.includes(t));

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink px-3 mb-2">
        열린 TODO <span className="text-ink-3 font-normal">({todos.length})</span>
      </h2>
      {overdue.length > 0 && (
        <div className="mb-1">
          <div className="text-[10px] text-red-500 font-medium px-3 mb-0.5">기한 초과</div>
          {overdue.map((t) => (
            <HubTodoItem key={t.id} task={t} onToggle={onToggle} />
          ))}
        </div>
      )}
      {rest.map((t) => (
        <HubTodoItem key={t.id} task={t} onToggle={onToggle} />
      ))}
    </section>
  );
}
