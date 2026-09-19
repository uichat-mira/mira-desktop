import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  CircleAlert,
  FileClock,
  GitBranch,
  Hammer,
  ListTodo,
  Menu,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Terminal,
} from "lucide-react";
import {
  Badge,
  Button,
  Drawer,
  IconButton,
  Modal,
} from "@/shared/ui";
import type {
  ForgeRegisterProjectValues,
  ForgeRuntimeRecord,
  ForgeTask,
  ForgeWorkspaceSnapshot,
} from "../types";
import { ForgeBuilderResultCard } from "./workspace/ForgeBuilderResultCard";
import {
  ForgeDispatchModal,
  type ForgeBuilderChoice,
} from "./workspace/ForgeDispatchModal";
import { ForgeRegisterProjectModal } from "./workspace/ForgeRegisterProjectModal";
import { ForgeRuntimePanel } from "./workspace/ForgeRuntimePanel";
import { ForgeTaskContext } from "./workspace/ForgeTaskContext";
import { ForgeTaskList } from "./workspace/ForgeTaskList";
import { builderLabel } from "./workspace/presentation";

const runViewAction = (
  action: void | Promise<void> | undefined,
) => {
  void Promise.resolve(action).catch(() => undefined);
};

export interface ForgeWorkspaceProps {
  snapshot?: ForgeWorkspaceSnapshot | null;
  busy?: boolean;
  onBackToChat?: () => void;
  onRefresh?: () => void | Promise<void>;
  onSelectProject?: (projectId: string) => void | Promise<void>;
  onSelectTask?: (taskId: string) => void | Promise<void>;
  onRegisterProject?: (
    values: ForgeRegisterProjectValues,
  ) => void | Promise<void>;
  onSendMessage?: (value: string) => void | Promise<void>;
  onDispatch?: (
    task: ForgeTask,
    builder: "opencode" | "piagent" | "codex",
  ) => void | Promise<void>;
  onCancel?: (runtime: ForgeRuntimeRecord) => void | Promise<void>;
  onIntegrate?: (task: ForgeTask) => void | Promise<void>;
  onSwitchView?: () => void;
}

export function ForgeWorkspace({
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
}: ForgeWorkspaceProps) {
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [taskListOpen, setTaskListOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [runtimePanel, setRuntimePanel] = useState<
    "summary" | "inspector" | "events" | null
  >(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [builderChoice, setBuilderChoice] =
    useState<ForgeBuilderChoice>("codex");

  const selectedTask = useMemo(
    () =>
      snapshot?.tasks.find(
        (task) => task.id === snapshot.selectedTaskId,
      ) ??
      snapshot?.tasks[0] ??
      null,
    [snapshot],
  );
  const activeRuntime = snapshot?.runtimes.find(
    (runtime) =>
      runtime.state === "starting" || runtime.state === "running",
  );

  useEffect(() => {
    const choices = snapshot?.builderChoices ?? [];
    if (!choices.length || choices.includes(builderChoice)) return;
    setBuilderChoice(choices.includes("codex") ? "codex" : choices[0]);
  }, [builderChoice, snapshot?.builderChoices]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      } else if (modifier && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (selectedTask) setDispatchOpen(true);
      } else if (modifier && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setRuntimePanel("events");
      } else if (event.key === "Escape") {
        setCommandOpen(false);
        setDispatchOpen(false);
        setRegisterOpen(false);
        setRuntimePanel(null);
        setContextOpen(false);
        setTaskListOpen(false);
        setMobileRailOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedTask]);

  const submitMessage = async () => {
    const value = messageText.trim();
    if (!value || !onSendMessage) return;
    try {
      await onSendMessage(value);
      setMessageText("");
    } catch {
      // The orchestration hook owns user-visible error reporting.
    }
  };

  if (!snapshot || snapshot.projects.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface-secondary text-text-primary">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-primary px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {onBackToChat ? (
              <IconButton ariaLabel="Back to chat" size="sm" onClick={onBackToChat}>
                <ArrowLeft className="h-4 w-4" />
              </IconButton>
            ) : null}
            <span className="grid h-7 w-7 place-items-center rounded-ui-control bg-ink text-xs font-semibold text-text-inverted">
              淬
            </span>
            <span className="font-serif text-lg">淬行</span>
            <span className="text-xs text-text-tertiary">
              Mira Desktop / Forge
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onSwitchView ? (
              <Button size="sm" variant="ghost" onClick={onSwitchView}>
                <Terminal className="h-4 w-4" />
                终端
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={() => setRegisterOpen(true)}>
              <Plus className="h-4 w-4" />
              Register project
            </Button>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 items-center justify-center p-6">
          <section className="max-w-md text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <GitBranch className="h-5 w-5" />
            </div>
            <h1 className="mt-5 font-serif text-3xl">淬行</h1>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Register a local repository to open the Main Thread,
              repository tasks, Builder dispatch, and runtime review flow.
            </p>
            <Button
              className="mt-6"
              variant="primary"
              onClick={() => setRegisterOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Register project
            </Button>
          </section>
        </main>
        <ForgeRegisterProjectModal
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-secondary text-text-primary">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface-primary px-3 sm:px-5">
        <IconButton
          ariaLabel="Open project rail"
          className="md:hidden"
          onClick={() => setMobileRailOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </IconButton>
        {onBackToChat ? (
          <IconButton
            ariaLabel="Back to chat"
            className="hidden md:inline-flex"
            size="sm"
            onClick={onBackToChat}
          >
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-ui-control bg-ink text-xs font-semibold text-text-inverted">
            淬
          </span>
          <span className="font-serif text-lg">淬行</span>
        </div>
        <span className="text-text-tertiary">/</span>
        <span className="min-w-0 truncate text-sm text-text-secondary">
          {snapshot.projects.find(
            (project) => project.id === snapshot.selectedProjectId,
          )?.name ?? "Workspace"}
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-1">
          {activeRuntime ? (
            <Button
              size="sm"
              variant="ghost"
              className="hidden max-w-[240px] sm:inline-flex"
              onClick={() => setRuntimePanel("summary")}
            >
              <Hammer className="h-4 w-4" />
              <span className="truncate">
                {builderLabel(activeRuntime.builder)} · {activeRuntime.taskId}
              </span>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRuntimePanel("summary")}
          >
            <Activity className="h-4 w-4" />
            {snapshot.activeRuntimeCount} active
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="hidden sm:inline-flex"
            onClick={() => setRuntimePanel("inspector")}
          >
            <CircleAlert className="h-4 w-4" />
            {snapshot.attentionCount} attention
          </Button>
          {onSwitchView ? (
            <Button
              size="sm"
              variant="ghost"
              className="hidden sm:inline-flex"
              onClick={onSwitchView}
            >
              <Terminal className="h-4 w-4" />
              终端
            </Button>
          ) : null}
          <IconButton
            ariaLabel="Command palette"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-primary md:flex"
          aria-label="Project Rail"
        >
          <div className="flex h-12 items-center justify-between border-b border-border px-3">
            <span className="text-caption text-text-tertiary">PROJECTS</span>
            <IconButton
              ariaLabel="Register project"
              size="sm"
              onClick={() => setRegisterOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
            {snapshot.projects.map((project) => (
              <button
                key={project.id}
                type="button"
                aria-pressed={project.id === snapshot.selectedProjectId}
                onClick={() => runViewAction(onSelectProject?.(project.id))}
                className={
                  "mb-1 flex w-full items-center gap-2 rounded-ui-control px-2 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 " +
                  (project.id === snapshot.selectedProjectId
                    ? "bg-surface-secondary text-text-primary"
                    : "text-text-secondary hover:bg-surface-secondary")
                }
              >
                <span
                  className={
                    "h-2 w-2 rounded-full " +
                    (project.attentionCount
                      ? "bg-danger"
                      : project.activeRuntimeCount
                        ? "bg-primary"
                        : "bg-success")
                  }
                />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.activeRuntimeCount ? (
                  <span className="font-mono text-[11px] text-primary">
                    {project.activeRuntimeCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border bg-surface-secondary px-4 py-3 sm:px-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-serif text-xl">Main Thread</h1>
                {snapshot.mainThread ? (
                  <Badge
                    variant={
                      snapshot.mainThread.status === "error"
                        ? "danger"
                        : snapshot.mainThread.status === "running"
                          ? "primary"
                          : "muted"
                    }
                  >
                    {snapshot.mainThread.adapter} · {snapshot.mainThread.status}
                  </Badge>
                ) : (
                  <Badge variant="muted">not opened</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-text-tertiary">
                {selectedTask
                  ? selectedTask.id + " · " + selectedTask.title
                  : snapshot.taskSourceError
                    ? "Task Source unavailable"
                    : "No task selected"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTaskListOpen(true)}
              >
                <ListTodo className="h-4 w-4" />
                Tasks
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDispatchOpen(true)}
                disabled={!selectedTask}
              >
                <Play className="h-4 w-4" />
                Dispatch
              </Button>
              <IconButton
                ariaLabel="Open task context"
                className="xl:hidden"
                onClick={() => setContextOpen(true)}
              >
                <PanelRight className="h-4 w-4" />
              </IconButton>
            </div>
          </div>

          <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
            {snapshot.messages.map((item) =>
              item.kind === "builder-result" ? (
                <ForgeBuilderResultCard key={item.id} message={item} />
              ) : (
                <article key={item.id} className="mb-7 flex gap-3">
                  <div
                    className={
                      "grid h-8 w-8 shrink-0 place-items-center rounded-ui-control text-xs font-semibold " +
                      (item.author === "operator"
                        ? "bg-ink text-text-inverted"
                        : "bg-surface-soft text-text-primary")
                    }
                  >
                    {item.author === "operator" ? "你" : "M"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium">
                        {item.author === "operator" ? "Operator" : "Mira"}
                      </span>
                      <span className="text-text-tertiary">{item.createdAt}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-text-secondary">
                      {item.body}
                    </p>
                  </div>
                </article>
              ),
            )}
            {snapshot.messages.length === 0 ? (
              <div className="mx-auto max-w-md py-16 text-center">
                <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-surface-primary text-text-tertiary">
                  <FileClock className="h-4 w-4" />
                </div>
                <div className="mt-4 text-sm font-medium text-text-primary">
                  Main Thread 还没有内容
                </div>
                <p className="mt-2 text-sm leading-6 text-text-tertiary">
                  在这里讨论项目判断、Task 取舍和 Builder 结果。第一次发送时会显式创建 Main Thread。
                </p>
              </div>
            ) : null}
          </div>

          <div className="border-t border-border bg-surface-secondary p-3 sm:p-5">
            <div className="rounded-ui-panel border border-border bg-surface-primary p-3 focus-within:border-primary">
              <textarea
                aria-label="Main Thread message"
                value={messageText}
                disabled={busy}
                onChange={(event) => setMessageText(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                placeholder="Continue the Main Thread…"
                className="min-h-[72px] w-full resize-none border-0 bg-transparent p-0 text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-60"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-text-tertiary">
                  <kbd className="rounded-ui-control border border-border px-1.5 py-0.5 font-mono">
                    ⌘↵
                  </kbd>{" "}
                  send
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || !messageText.trim()}
                  onClick={() => void submitMessage()}
                >
                  <Send className="h-4 w-4" />
                  Send
                </Button>
              </div>
            </div>
          </div>
        </main>

        <aside className="hidden w-80 shrink-0 border-l border-border xl:flex">
          <ForgeTaskContext
            task={selectedTask}
            taskSourceError={snapshot.taskSourceError}
            busy={busy}
            onDispatch={() => setDispatchOpen(true)}
            onIntegrate={() => {
              if (selectedTask) runViewAction(onIntegrate?.(selectedTask));
            }}
          />
        </aside>
      </div>

      <Drawer
        open={mobileRailOpen}
        onClose={() => setMobileRailOpen(false)}
        width={280}
        header={<div className="text-sm font-semibold">Projects</div>}
      >
        <div className="space-y-1">
          {snapshot.projects.map((project) => (
            <Button
              key={project.id}
              variant={
                project.id === snapshot.selectedProjectId
                  ? "secondary"
                  : "ghost"
              }
              className="w-full justify-start"
              onClick={() => {
                setMobileRailOpen(false);
                runViewAction(onSelectProject?.(project.id));
              }}
            >
              {project.name}
            </Button>
          ))}
        </div>
      </Drawer>

      <Drawer
        open={taskListOpen}
        onClose={() => setTaskListOpen(false)}
        width={360}
        header={<div className="text-sm font-semibold">Repository Tasks</div>}
      >
        {snapshot.taskSourceError ? (
          <div className="mb-3 rounded-ui-panel border border-warning-border bg-warning-soft p-3 text-xs leading-5 text-warning-text">
            {snapshot.taskSourceError}
          </div>
        ) : null}
        <ForgeTaskList
          tasks={snapshot.tasks}
          selectedTaskId={snapshot.selectedTaskId}
          onSelect={(taskId) => {
            setTaskListOpen(false);
            runViewAction(onSelectTask?.(taskId));
          }}
        />
      </Drawer>

      <Drawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        width={360}
        header={<div className="text-sm font-semibold">Current Task</div>}
      >
        <ForgeTaskContext
          task={selectedTask}
          taskSourceError={snapshot.taskSourceError}
          busy={busy}
          onDispatch={() => {
            setContextOpen(false);
            setDispatchOpen(true);
          }}
          onIntegrate={() => {
            setContextOpen(false);
            if (selectedTask) runViewAction(onIntegrate?.(selectedTask));
          }}
        />
      </Drawer>

      {runtimePanel ? (
        <ForgeRuntimePanel
          mode={runtimePanel}
          runtimes={snapshot.runtimes}
          events={snapshot.events}
          inspector={snapshot.inspector}
          busy={busy}
          onCancel={(runtime) => runViewAction(onCancel?.(runtime))}
          onClose={() => setRuntimePanel(null)}
        />
      ) : null}

      <ForgeDispatchModal
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

      <ForgeRegisterProjectModal
        open={registerOpen}
        busy={busy}
        onClose={() => setRegisterOpen(false)}
        onSubmit={async (values) => {
          if (!onRegisterProject) return;
          await onRegisterProject(values);
        }}
      />

      <Modal
        open={commandOpen}
        title="Command palette"
        onClose={() => setCommandOpen(false)}
        footer={
          <Button variant="ghost" onClick={() => setCommandOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setCommandOpen(false);
              setTaskListOpen(true);
            }}
          >
            <ListTodo className="h-4 w-4" />
            Tasks
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={!selectedTask}
            onClick={() => {
              setCommandOpen(false);
              setDispatchOpen(true);
            }}
          >
            <Play className="h-4 w-4" />
            Dispatch current Task
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setCommandOpen(false);
              setRuntimePanel("inspector");
            }}
          >
            <PanelRight className="h-4 w-4" />
            Runtime Inspector
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setCommandOpen(false);
              setRuntimePanel("events");
            }}
          >
            <FileClock className="h-4 w-4" />
            Event Log
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setCommandOpen(false);
              setRegisterOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Register project
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={busy}
            onClick={() => {
              setCommandOpen(false);
              runViewAction(onRefresh?.());
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default ForgeWorkspace;
