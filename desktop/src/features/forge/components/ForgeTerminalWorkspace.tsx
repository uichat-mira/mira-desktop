import { useEffect, useMemo, useState } from "react";
import type {
  ForgeRuntimeRecord,
  ForgeWorkspaceSnapshot,
} from "../types";
import type { ForgeWorkspaceProps } from "./ForgeWorkspace";
import type { ForgeBuilderChoice } from "./workspace/ForgeDispatchModal";
import { builderLabel } from "./workspace/presentation";
import { ForgeTerminalCommandPalette } from "./terminal/ForgeTerminalCommandPalette";
import { ForgeTerminalControlPane } from "./terminal/ForgeTerminalControlPane";
import { ForgeTerminalMainThread } from "./terminal/ForgeTerminalMainThread";
import { ForgeTerminalProjectRail } from "./terminal/ForgeTerminalProjectRail";
import {
  ForgeTerminalCancelModal,
  ForgeTerminalDispatchModal,
  ForgeTerminalRegisterProjectModal,
} from "./terminal/ForgeTerminalModals";
import { TerminalKey } from "./terminal/presentation";

const runViewAction = (
  action: void | Promise<void> | undefined,
) => {
  void Promise.resolve(action).catch(() => undefined);
};

export interface ForgeTerminalWorkspaceProps
  extends ForgeWorkspaceProps {
  snapshot?: ForgeWorkspaceSnapshot | null;
}

export function ForgeTerminalWorkspace({
  snapshot,
  busy = false,
  onBackToChat,
  onRefresh,
  onSelectProject,
  onSelectTask,
  onRegisterProject,
  onSendMessage,
  onDispatch,
  onCancel,
  onIntegrate,
  onSwitchView,
}: ForgeTerminalWorkspaceProps) {
  const [registerOpen, setRegisterOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [cancelTarget, setCancelTarget] =
    useState<ForgeRuntimeRecord | null>(null);
  const [builderChoice, setBuilderChoice] =
    useState<ForgeBuilderChoice>("codex");

  const selectedProject = useMemo(
    () =>
      snapshot?.projects.find(
        (project) => project.id === snapshot.selectedProjectId,
      ) ??
      snapshot?.projects[0] ??
      null,
    [snapshot],
  );

  const selectedTask = useMemo(
    () =>
      snapshot?.tasks.find(
        (task) => task.id === snapshot.selectedTaskId,
      ) ??
      snapshot?.tasks[0] ??
      null,
    [snapshot],
  );

  const activeRuntime = useMemo(
    () =>
      snapshot?.runtimes.find(
        (runtime) =>
          runtime.state === "starting" ||
          runtime.state === "running",
      ) ?? null,
    [snapshot?.runtimes],
  );

  const selectedRuntime = useMemo(
    () =>
      selectedTask
        ? snapshot?.runtimes.find(
            (runtime) =>
              runtime.taskId === selectedTask.id &&
              (runtime.state === "starting" ||
                runtime.state === "running"),
          ) ?? null
        : null,
    [selectedTask, snapshot?.runtimes],
  );

  useEffect(() => {
    const choices = snapshot?.builderChoices ?? [];
    if (!choices.length || choices.includes(builderChoice)) return;
    setBuilderChoice(
      choices.includes("codex") ? "codex" : choices[0],
    );
  }, [builderChoice, snapshot?.builderChoices]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
        target.tagName,
      );

      if (event.key === "Escape") {
        setCommandOpen(false);
        setDispatchOpen(false);
        setRegisterOpen(false);
        setCancelTarget(null);
        return;
      }

      if (typing || dispatchOpen || registerOpen || cancelTarget) return;

      if (commandOpen) {
        const key = event.key.toLowerCase();
        if (["q", "n", "d", "x", "r"].includes(key)) {
          event.preventDefault();
        }
        if (key === "q") {
          setCommandOpen(false);
        } else if (key === "n") {
          setCommandOpen(false);
          setRegisterOpen(true);
        } else if (key === "d" && selectedTask) {
          setCommandOpen(false);
          setDispatchOpen(true);
        } else if (key === "x" && selectedRuntime) {
          setCommandOpen(false);
          setCancelTarget(selectedRuntime);
        } else if (key === "r") {
          setCommandOpen(false);
          runViewAction(onRefresh?.());
        }
        return;
      }

      const projects = snapshot?.projects ?? [];
      const activeIndex = Math.max(
        projects.findIndex(
          (project) => project.id === snapshot?.selectedProjectId,
        ),
        0,
      );

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next =
          projects[
            Math.min(
              activeIndex + 1,
              Math.max(projects.length - 1, 0),
            )
          ];
        if (next) runViewAction(onSelectProject?.(next.id));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = projects[Math.max(activeIndex - 1, 0)];
        if (next) runViewAction(onSelectProject?.(next.id));
      } else if (event.key === "/") {
        event.preventDefault();
        setCommandOpen(true);
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        runViewAction(onRefresh?.());
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setRegisterOpen(true);
      } else if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (selectedTask) setDispatchOpen(true);
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        if (selectedRuntime) setCancelTarget(selectedRuntime);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    cancelTarget,
    commandOpen,
    dispatchOpen,
    onRefresh,
    onSelectProject,
    registerOpen,
    selectedRuntime,
    selectedTask,
    snapshot?.projects,
    snapshot?.selectedProjectId,
  ]);

  if (!snapshot || snapshot.projects.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-col bg-ink font-mono text-text-inverted"
        data-testid="forge-terminal-view"
      >
        <header className="flex h-10 shrink-0 items-center gap-3 border-b border-text-inverted/15 px-3 text-[10px]">
          {onBackToChat ? (
            <button
              type="button"
              className="text-text-inverted/55 hover:text-text-inverted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              onClick={onBackToChat}
            >
              ← CHAT
            </button>
          ) : null}
          <strong className="tracking-[0.16em]">MIRA / FORGE</strong>
          <span className="text-text-inverted/40">
            / empty workspace
          </span>
          <div className="ml-auto flex items-center gap-3">
            {onSwitchView ? (
              <button
                type="button"
                className="text-text-inverted/55 hover:text-text-inverted"
                onClick={onSwitchView}
              >
                [ UI ]
              </button>
            ) : null}
            <span className="text-success">● LOCAL</span>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-lg border-l-2 border-primary pl-4">
            <div className="text-primary">›</div>
            <h1 className="mt-2 text-sm font-semibold tracking-wide">
              workspace is empty
            </h1>
            <p className="mt-2 text-xs leading-6 text-text-inverted/55">
              Register a local repository. Forge keeps Repository Task
              truth and Runtime truth separate.
            </p>
            <button
              type="button"
              className="mt-4 border border-text-inverted/20 px-3 py-2 text-xs hover:border-primary hover:text-primary"
              onClick={() => setRegisterOpen(true)}
            >
              + new project <TerminalKey>n</TerminalKey>
            </button>
          </div>
        </main>
        <footer className="border-t border-text-inverted/15 px-3 py-2 text-[9px] text-text-inverted/45">
          <TerminalKey>n</TerminalKey> new project ·{" "}
          <TerminalKey>esc</TerminalKey> close
        </footer>
        <ForgeTerminalRegisterProjectModal
          open={registerOpen}
          busy={busy}
          onClose={() => setRegisterOpen(false)}
          onSubmit={async (values) => {
            if (!onRegisterProject) return;
            await onRegisterProject(values);
          }}
        />
      </div>
    );
  }

  const registerProject = () => setRegisterOpen(true);
  const dispatchTask = () => {
    if (selectedTask) setDispatchOpen(true);
  };
  const cancelRuntime = () => {
    if (selectedRuntime) setCancelTarget(selectedRuntime);
  };
  const refresh = () => runViewAction(onRefresh?.());

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-ink font-mono text-text-inverted"
      data-testid="forge-terminal-view"
    >
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-text-inverted/15 px-3 text-[10px]">
        {onBackToChat ? (
          <button
            type="button"
            className="text-text-inverted/55 hover:text-text-inverted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            onClick={onBackToChat}
          >
            ← CHAT
          </button>
        ) : null}
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <strong className="tracking-[0.16em]">MIRA / FORGE</strong>
        <span className="min-w-0 flex-1 truncate text-text-inverted/45">
          / {selectedProject?.name ?? "workspace"}
        </span>
        {activeRuntime ? (
          <span className="hidden text-warning sm:inline">
            {builderLabel(activeRuntime.builder) +
              " · " +
              activeRuntime.taskId}
          </span>
        ) : null}
        {onSwitchView ? (
          <button
            type="button"
            className="text-text-inverted/55 hover:text-text-inverted"
            onClick={onSwitchView}
            aria-label="Switch to standard Forge view"
          >
            [ UI ]
          </button>
        ) : null}
        <span className="text-success">● LOCAL</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <ForgeTerminalProjectRail
          projects={snapshot.projects}
          selectedProjectId={snapshot.selectedProjectId}
          onSelectProject={onSelectProject}
          onRegisterProject={registerProject}
        />

        <div className="flex min-w-0 flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_380px]">
          <ForgeTerminalControlPane
            snapshot={snapshot}
            selectedProject={selectedProject}
            selectedTask={selectedTask}
            activeRuntime={activeRuntime}
            selectedRuntime={selectedRuntime}
            onRefresh={refresh}
            onRegisterProject={registerProject}
            onSelectTask={onSelectTask}
            onDispatch={dispatchTask}
            onCancel={cancelRuntime}
            onIntegrate={() => {
              if (selectedTask) {
                runViewAction(onIntegrate?.(selectedTask));
              }
            }}
          />
          <ForgeTerminalMainThread
            snapshot={snapshot}
            busy={busy}
            onSendMessage={onSendMessage}
          />
        </div>
      </div>

      <ForgeTerminalDispatchModal
        open={dispatchOpen}
        busy={busy}
        task={selectedTask}
        builderChoice={builderChoice}
        builderChoices={snapshot.builderChoices}
        onBuilderChange={setBuilderChoice}
        onClose={() => setDispatchOpen(false)}
        onDispatch={async (task, builder) => {
          if (!onDispatch) return;
          await onDispatch(task, builder);
        }}
      />

      <ForgeTerminalRegisterProjectModal
        open={registerOpen}
        busy={busy}
        onClose={() => setRegisterOpen(false)}
        onSubmit={async (values) => {
          if (!onRegisterProject) return;
          await onRegisterProject(values);
        }}
      />

      <ForgeTerminalCancelModal
        open={Boolean(cancelTarget)}
        busy={busy}
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancel={async (runtime) => {
          if (!onCancel) return;
          await onCancel(runtime);
        }}
      />

      <ForgeTerminalCommandPalette
        open={commandOpen}
        hasTask={Boolean(selectedTask)}
        hasActiveRuntime={Boolean(selectedRuntime)}
        onClose={() => setCommandOpen(false)}
        onRegisterProject={registerProject}
        onDispatch={dispatchTask}
        onCancel={cancelRuntime}
        onRefresh={refresh}
      />
    </div>
  );
}

export default ForgeTerminalWorkspace;
