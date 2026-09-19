import type {
  ForgeProject,
  ForgeRuntimeRecord,
  ForgeTask,
  ForgeWorkspaceSnapshot,
} from "../../types";
import {
  terminalDot,
  TerminalKey,
  terminalTone,
} from "./presentation";
import { builderLabel, runtimeLabel } from "../workspace/presentation";

export function ForgeTerminalControlPane({
  snapshot,
  selectedProject,
  selectedTask,
  activeRuntime,
  selectedRuntime,
  onRefresh,
  onRegisterProject,
  onSelectTask,
  onDispatch,
  onCancel,
  onIntegrate,
}: {
  snapshot: ForgeWorkspaceSnapshot;
  selectedProject: ForgeProject | null;
  selectedTask: ForgeTask | null;
  activeRuntime: ForgeRuntimeRecord | null;
  selectedRuntime: ForgeRuntimeRecord | null;
  onRefresh: () => void;
  onRegisterProject: () => void;
  onSelectTask?: (taskId: string) => void | Promise<void>;
  onDispatch: () => void;
  onCancel: () => void;
  onIntegrate: () => void;
}) {
  const dispatchable =
    selectedTask?.readiness === "ready" &&
    (selectedTask.runtimeState === "waiting" ||
      selectedTask.runtimeState === "fixing");
  const integratable =
    selectedTask?.runtimeState === "review_passed" &&
    Boolean(selectedTask.batchId) &&
    Boolean(selectedTask.currentSha) &&
    selectedTask.currentSha === selectedTask.reviewedSha;

  const selectTask = (taskId: string) => {
    void Promise.resolve(onSelectTask?.(taskId)).catch(
      () => undefined,
    );
  };

  return (
    <section className="flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-text-inverted/15 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold tracking-[0.12em] text-text-inverted/40">
            PROJECT STATUS
          </div>
          <h1 className="mt-1 truncate text-lg font-semibold tracking-tight">
            {selectedProject?.name ?? "workspace"}
          </h1>
          <code className="mt-1 block truncate text-[10px] text-text-inverted/40">
            {selectedProject?.repositoryPath ?? "no project"}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="border border-text-inverted/20 px-2 py-1 text-[10px] text-text-inverted/60 hover:border-primary hover:text-primary"
            onClick={onRefresh}
          >
            ↻ <TerminalKey>r</TerminalKey>
          </button>
          <button
            type="button"
            className="border border-text-inverted/20 px-2 py-1 text-[10px] text-text-inverted/60 hover:border-primary hover:text-primary md:hidden"
            onClick={onRegisterProject}
          >
            + PROJECT
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-text-inverted/15 px-4 py-2.5 text-[10px] text-text-inverted/45 sm:px-5">
        <span>
          <b className="mr-1 text-sm text-text-inverted">
            {snapshot.tasks.length}
          </b>
          tasks
        </span>
        <span>
          <b className="mr-1 text-sm text-warning">
            {snapshot.activeRuntimeCount}
          </b>
          active
        </span>
        <span>
          <b className="mr-1 text-sm text-danger">
            {snapshot.attentionCount}
          </b>
          attention
        </span>
        <span>
          <b className="mr-1 text-sm text-text-inverted">
            {snapshot.events.length}
          </b>
          events
        </span>
      </div>

      <div className="border-b border-text-inverted/15 px-4 py-2 sm:px-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border border-text-inverted/15 px-2.5 py-2 text-[9px] text-text-inverted/45">
          <span className="font-semibold tracking-[0.1em] text-text-inverted/70">
            RUNTIME
          </span>
          <span className="truncate">
            {activeRuntime
              ? builderLabel(activeRuntime.builder) +
                " · " +
                activeRuntime.taskId +
                " · " +
                activeRuntime.state
              : "idle"}
          </span>
          <span>
            {snapshot.activeRuntimeCount +
              " active · " +
              snapshot.attentionCount +
              " attention"}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pb-2 pt-3 text-[9px] tracking-[0.1em] text-text-inverted/45 sm:px-5">
        <span>CURRENT WORK</span>
        <span>
          {selectedTask
            ? selectedTask.id + " selected"
            : "no task selected"}
        </span>
      </div>

      <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-3 sm:px-5">
        {snapshot.tasks.length ? (
          <div className="overflow-x-auto border border-text-inverted/15">
            <div className="min-w-[520px]">
              {snapshot.tasks.map((task) => {
                const selected =
                  task.id === snapshot.selectedTaskId;
                const runtime = snapshot.runtimes.find(
                  (item) => item.taskId === task.id,
                );
                return (
                  <button
                    key={task.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectTask(task.id)}
                    onFocus={() => selectTask(task.id)}
                    className={
                      "grid min-h-9 w-full grid-cols-[8px_72px_minmax(120px,1fr)_90px_100px] items-center gap-2 border-b border-text-inverted/10 px-2 text-left text-[9px] last:border-b-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary " +
                      (selected
                        ? "bg-surface-primary/10"
                        : "hover:bg-surface-primary/5")
                    }
                  >
                    <span
                      className={
                        "h-1.5 w-1.5 rounded-full " +
                        terminalDot(task.runtimeState)
                      }
                    />
                    <b className="truncate font-medium text-info">
                      {task.id}
                    </b>
                    <span className="truncate text-[10px] text-text-inverted/75">
                      {task.title}
                    </span>
                    <span
                      className={
                        "truncate " +
                        terminalTone(task.runtimeState)
                      }
                    >
                      {runtime
                        ? runtime.state
                        : runtimeLabel[task.runtimeState]}
                    </span>
                    <span
                      className={
                        "truncate text-right " +
                        terminalTone(task.readiness)
                      }
                    >
                      {task.readiness}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="border-l-2 border-primary py-4 pl-3 text-[10px] text-text-inverted/45">
            <span className="text-primary">›</span> no repository tasks
          </div>
        )}

        {selectedTask ? (
          <div className="mt-3 border border-text-inverted/15 p-3 text-[9px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-text-inverted/40">TASK</span>
              <b className="text-info">{selectedTask.id}</b>
              <span className="text-text-inverted/55">
                repo {selectedTask.repositoryState}
              </span>
              <span
                className={terminalTone(
                  selectedTask.runtimeState,
                )}
              >
                runtime {selectedTask.runtimeState}
              </span>
              <span
                className={terminalTone(selectedTask.readiness)}
              >
                readiness {selectedTask.readiness}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {dispatchable ? (
                  <button
                    type="button"
                    className="border border-warning px-2 py-1 text-warning hover:bg-surface-primary/5"
                    onClick={onDispatch}
                  >
                    dispatch <TerminalKey>d</TerminalKey>
                  </button>
                ) : null}
                {selectedRuntime ? (
                  <button
                    type="button"
                    className="border border-danger px-2 py-1 text-danger hover:bg-surface-primary/5"
                    onClick={onCancel}
                  >
                    cancel <TerminalKey>x</TerminalKey>
                  </button>
                ) : null}
                {integratable ? (
                  <button
                    type="button"
                    className="border border-success px-2 py-1 text-success hover:bg-surface-primary/5"
                    onClick={onIntegrate}
                  >
                    integrate
                  </button>
                ) : null}
              </span>
            </div>
            <div className="mt-2 grid gap-1 text-text-inverted/40 sm:grid-cols-2">
              <span className="truncate">
                source · {selectedTask.source}
              </span>
              <span className="truncate">
                deps ·{" "}
                {selectedTask.dependencies.length
                  ? selectedTask.dependencies.join(", ")
                  : "none"}
              </span>
            </div>
            {selectedTask.readinessReasons.length ? (
              <div className="mt-2 text-warning">
                ! {selectedTask.readinessReasons.join(" · ")}
              </div>
            ) : null}
          </div>
        ) : null}

        {snapshot.events.length ? (
          <div className="mt-3 overflow-x-auto border border-text-inverted/15">
            <div className="min-w-[560px]">
              <div className="flex items-center justify-between border-b border-text-inverted/15 px-2 py-1.5 text-[9px] tracking-[0.1em] text-text-inverted/45">
                <span>EVENT LOG</span>
                <span>
                  latest {Math.min(snapshot.events.length, 8)}
                </span>
              </div>
              {[...snapshot.events]
                .slice(-8)
                .reverse()
                .map((event) => (
                  <div
                    key={event.id}
                    className="grid grid-cols-[66px_72px_150px_minmax(0,1fr)] gap-2 border-b border-text-inverted/10 px-2 py-1.5 text-[9px] last:border-b-0"
                  >
                    <time className="text-text-inverted/30">
                      {event.timestamp}
                    </time>
                    <span className="truncate text-info">
                      {event.taskId ?? "—"}
                    </span>
                    <strong className="truncate font-medium text-text-inverted/65">
                      {event.kind}
                    </strong>
                    <span className="truncate text-text-inverted/35">
                      {event.message}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex flex-wrap gap-x-3 gap-y-1 border-t border-text-inverted/15 px-4 py-2 text-[9px] text-text-inverted/40 sm:px-5">
        <span>
          <TerminalKey>j</TerminalKey>
          <TerminalKey>k</TerminalKey> project
        </span>
        <span>
          <TerminalKey>tab</TerminalKey> task
        </span>
        <span>
          <TerminalKey>d</TerminalKey> dispatch
        </span>
        <span>
          <TerminalKey>x</TerminalKey> cancel
        </span>
        <span>
          <TerminalKey>n</TerminalKey> project
        </span>
        <span>
          <TerminalKey>/</TerminalKey> commands
        </span>
        <span>
          <TerminalKey>r</TerminalKey> refresh
        </span>
        <span>
          <TerminalKey>esc</TerminalKey> close
        </span>
      </footer>
    </section>
  );
}
