import { CheckCircle2, CircleAlert, Play, X } from "lucide-react";
import { Badge, Button, IconButton } from "@/shared/ui";
import type { ForgeTask } from "../../types";
import {
  repositoryVariant,
  runtimeLabel,
  runtimeVariant,
} from "./presentation";

export function ForgeStatePair({ task }: { task: ForgeTask }) {
  const drift =
    task.repositoryLedgerState !== "UNKNOWN" &&
    task.repositoryLedgerState !== task.repositoryState;

  return (
    <div className="grid grid-cols-2 divide-x divide-border rounded-ui-panel border border-border bg-surface-primary">
      <div className="p-3">
        <div className="text-caption text-text-tertiary">Repository</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant={repositoryVariant(task.repositoryState)}>
            {task.repositoryState}
          </Badge>
          {drift ? (
            <span className="font-mono text-[10px] text-warning-text">
              ledger {task.repositoryLedgerState}
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-3">
        <div className="text-caption text-text-tertiary">Runtime</div>
        <div className="mt-1.5">
          <Badge variant={runtimeVariant(task.runtimeState)}>
            {runtimeLabel[task.runtimeState]}
          </Badge>
        </div>
      </div>
    </div>
  );
}

export function ForgeTaskContext({
  task,
  taskSourceError,
  busy,
  onDispatch,
  onIntegrate,
  onClose,
}: {
  task: ForgeTask | null;
  taskSourceError: string | null;
  busy: boolean;
  onDispatch: () => void;
  onIntegrate: () => void;
  onClose?: () => void;
}) {
  if (!task) {
    return (
      <div className="h-full bg-surface-primary">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-caption text-text-tertiary">CURRENT TASK</span>
          {onClose ? (
            <IconButton ariaLabel="Close task context" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
        <div className="p-4 text-sm text-text-tertiary">
          {taskSourceError ? "Repository Task Source 当前不可用。" : "No task selected"}
          {taskSourceError ? (
            <p className="mt-2 break-words font-mono text-[11px] leading-5">
              {taskSourceError}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const dispatchable =
    task.readiness === "ready" &&
    (task.runtimeState === "waiting" || task.runtimeState === "fixing");
  const integratable =
    task.runtimeState === "review_passed" &&
    Boolean(task.batchId) &&
    Boolean(task.currentSha) &&
    task.currentSha === task.reviewedSha;

  return (
    <div className="flex h-full flex-col bg-surface-primary">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-caption text-text-tertiary">CURRENT TASK</span>
        {onClose ? (
          <IconButton ariaLabel="Close task context" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        ) : null}
      </div>
      <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-ui-panel border border-border bg-surface-secondary p-4">
          <div className="font-mono text-[11px] text-text-tertiary">{task.id}</div>
          <h2 className="mt-2 text-base font-medium">{task.title}</h2>
          <dl className="mt-4 space-y-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-text-tertiary">Task source</dt>
              <dd className="max-w-[190px] break-all font-mono text-right text-text-secondary">
                {task.source}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-tertiary">Dependencies</dt>
              <dd className="text-right text-text-secondary">
                {task.dependencies.length ? task.dependencies.join(", ") : "None"}
              </dd>
            </div>
            {task.currentSha ? (
              <div className="flex justify-between gap-3">
                <dt className="text-text-tertiary">Current SHA</dt>
                <dd className="font-mono text-right text-text-secondary">
                  {task.currentSha.slice(0, 10)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-caption text-text-tertiary">STATE</div>
          <ForgeStatePair task={task} />
        </div>

        {task.warnings.length ? (
          <div className="mt-4 rounded-ui-panel border border-warning-border bg-warning-soft p-3 text-xs leading-5 text-warning-text">
            <div className="flex items-center gap-2 font-medium">
              <CircleAlert className="h-4 w-4" />
              Repository drift
            </div>
            <ul className="mt-1 space-y-1">
              {task.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {task.readiness === "blocked" ? (
          <div className="mt-4 rounded-ui-panel border border-danger-border bg-danger-soft p-3 text-xs leading-5 text-danger-text">
            <div className="flex items-center gap-2 font-medium">
              <CircleAlert className="h-4 w-4" />
              Dispatch unavailable
            </div>
            <p className="mt-1">
              {task.readinessReasons.length
                ? task.readinessReasons.join(" · ")
                : "Readiness checks have not passed."}
            </p>
          </div>
        ) : null}

        {task.readiness === "unavailable" &&
        task.readinessReasons.length ? (
          <div className="mt-4 rounded-ui-panel border border-warning-border bg-warning-soft p-3 text-xs leading-5 text-warning-text">
            <div className="flex items-center gap-2 font-medium">
              <CircleAlert className="h-4 w-4" />
              Readiness check unavailable
            </div>
            <p className="mt-1 break-words">
              {task.readinessReasons.join(" · ")}
            </p>
          </div>
        ) : null}

        {task.runtimeState === "reviewing" ? (
          <div className="mt-4 rounded-ui-panel border border-border bg-surface-secondary p-3 text-xs leading-5 text-text-secondary">
            Builder 已完成当前施工阶段，Runtime 正等待独立 Review。Builder Result 不等于 Repository PASS。
          </div>
        ) : null}

        {task.runtimeState === "stale" ? (
          <div className="mt-4 rounded-ui-panel border border-warning-border bg-warning-soft p-3 text-xs leading-5 text-warning-text">
            当前 SHA 已变化，旧 Review 不能继续作为可执行 PASS。
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {dispatchable ? (
            <Button
              variant="primary"
              className="w-full"
              disabled={busy}
              onClick={onDispatch}
            >
              <Play className="h-4 w-4" />
              Dispatch Builder
            </Button>
          ) : null}
          {integratable ? (
            <Button
              variant="primary"
              className="w-full"
              disabled={busy}
              onClick={onIntegrate}
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm integrated
            </Button>
          ) : null}
          {!dispatchable && !integratable ? (
            <div className="py-2 text-center text-xs text-text-tertiary">
              当前状态没有可执行动作
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
