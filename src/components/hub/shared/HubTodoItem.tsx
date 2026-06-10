import type { Task } from '../../../types/task';

interface Props {
  task: Task;
  onToggle: (id: string) => void;
}

export function HubTodoItem({ task, onToggle }: Props) {
  const isOverdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <label className="flex items-start gap-2 px-3 py-1.5 rounded-lg hover:bg-paper-muted/50 transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={() => onToggle(task.id)}
        className="mt-0.5 shrink-0 accent-chrome"
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink truncate">
          {task.title}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {task.dueDate && (
            <span className={`text-[10px] ${isOverdue ? 'text-red-500 font-medium' : 'text-ink-3'}`}>
              {isOverdue ? '⚠️ ' : ''}{task.dueDate}
            </span>
          )}
          {task.source_note && (
            <span className="text-[10px] text-ink-3 truncate">
              📎 {task.source_note}
            </span>
          )}
        </div>
      </div>
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
        task.priority === 1 ? 'bg-red-500/10 text-red-500' :
        task.priority === 2 ? 'bg-yellow-500/10 text-yellow-600' :
        'bg-paper-muted text-ink-3'
      }`}>
        {task.priority === 1 ? 'High' : task.priority === 2 ? 'Med' : 'Low'}
      </span>
    </label>
  );
}
