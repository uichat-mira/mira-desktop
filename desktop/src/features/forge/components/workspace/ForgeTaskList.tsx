import { Badge } from "@/shared/ui";
import type { ForgeTask } from "../../types";
import { runtimeLabel, runtimeVariant } from "./presentation";

export function ForgeTaskList({
  tasks,
  selectedTaskId,
  onSelect,
}: {
  tasks: ForgeTask[];
  selectedTaskId?: string;
  onSelect: (taskId: string) => void;
}) {
  if (!tasks.length) {
    return (
      <div className="py-8 text-center text-sm text-text-tertiary">
        No repository tasks
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          aria-pressed={task.id === selectedTaskId}
          onClick={() => onSelect(task.id)}
          className={
            "w-full rounded-ui-control border px-3 py-3 text-left transition-colors " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 " +
            (task.id === selectedTaskId
              ? "border-primary/20 bg-primary/5"
              : "border-transparent hover:bg-surface-secondary")
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-text-tertiary">
                {task.id}
              </div>
              <div className="mt-1 truncate text-sm text-text-primary">
                {task.title}
              </div>
            </div>
            <Badge variant={runtimeVariant(task.runtimeState)}>
              {runtimeLabel[task.runtimeState]}
            </Badge>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
            <span>{task.repositoryState}</span>
            <span>·</span>
            <span>{task.readiness}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
