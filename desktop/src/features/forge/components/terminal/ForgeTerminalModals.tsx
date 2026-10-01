import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  ForgeRegisterProjectValues,
  ForgeRuntimeRecord,
  ForgeTask,
} from "../../types";
import type { ForgeBuilderChoice } from "../workspace/ForgeDispatchModal";
import { builderLabel } from "../workspace/presentation";
import { TerminalKey, terminalTone } from "./presentation";

const focusableSelector = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function ForgeTerminalModalFrame({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      const preferred =
        dialog?.querySelector<HTMLElement>("[data-terminal-autofocus]");
      const fallback =
        dialog?.querySelector<HTMLElement>(focusableSelector);
      (preferred ?? fallback)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable =
      dialogRef.current?.querySelectorAll<HTMLElement>(
        focusableSelector,
      );
    if (!focusable?.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-ink/80 p-4 font-mono text-text-inverted"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className="w-full max-w-[460px] border border-text-inverted/25 bg-ink shadow-shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-text-inverted/15 px-3 py-2.5 text-[9px] font-semibold tracking-[0.12em]">
          <span>{title}</span>
          <button
            type="button"
            className="text-text-inverted/45 hover:text-text-inverted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            onClick={onClose}
            aria-label="Close terminal modal"
          >
            <TerminalKey>esc</TerminalKey>
          </button>
        </header>
        <div className="p-3">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

const labelClass =
  "block text-[9px] font-medium uppercase tracking-[0.08em] text-text-inverted/45";
const inputClass =
  "mt-1 block w-full border border-text-inverted/15 bg-surface-primary/5 px-2 py-2 text-[10px] text-text-inverted outline-none placeholder:text-text-inverted/25 focus:border-primary disabled:opacity-45";
const actionClass =
  "mt-3 flex w-full items-center justify-between border border-text-inverted/25 bg-surface-primary/5 px-3 py-2 text-left text-[10px] text-text-inverted/80 hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35";

export function ForgeTerminalRegisterProjectModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: ForgeRegisterProjectValues) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [taskLedger, setTaskLedger] = useState("");
  const [taskDir, setTaskDir] = useState("");

  useEffect(() => {
    if (open) return;
    setName("");
    setRepositoryPath("");
    setBranch("main");
    setTaskLedger("");
    setTaskDir("");
  }, [open]);

  const valid =
    Boolean(name.trim()) &&
    Boolean(repositoryPath.trim()) &&
    Boolean(branch.trim());

  const submit = async () => {
    if (!valid || busy) return;
    await onSubmit({
      name: name.trim(),
      repositoryPath: repositoryPath.trim(),
      branch: branch.trim(),
      ...(taskLedger.trim()
        ? { taskLedger: taskLedger.trim() }
        : {}),
      ...(taskDir.trim() ? { taskDir: taskDir.trim() } : {}),
    });
    onClose();
  };

  return (
    <ForgeTerminalModalFrame
      open={open}
      title="REGISTER PROJECT"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit().catch(() => undefined);
        }}
      >
        <label className={labelClass}>
          project name
          <input
            className={inputClass}
            data-terminal-autofocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="project name"
          />
        </label>

        <label className={"mt-3 " + labelClass}>
          local repository
          <input
            className={inputClass}
            value={repositoryPath}
            onChange={(event) =>
              setRepositoryPath(event.target.value)
            }
            placeholder="C:/work/project"
          />
        </label>

        <label className={"mt-3 " + labelClass}>
          integration branch
          <input
            className={inputClass}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
        </label>

        <div className="mt-4 border-t border-text-inverted/15 pt-3">
          <div className="text-[9px] font-semibold tracking-[0.1em] text-text-inverted/55">
            REPOSITORY TASK SOURCE
          </div>
          <p className="mt-1 text-[9px] leading-5 text-text-inverted/35">
            Ledger and Task Directory are optional as a pair. Forge does
            not invent repository task paths.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              task ledger
              <input
                className={inputClass}
                value={taskLedger}
                onChange={(event) =>
                  setTaskLedger(event.target.value)
                }
                placeholder="docs/project-control/project-control-ledger.md"
              />
            </label>
            <label className={labelClass}>
              task directory
              <input
                className={inputClass}
                value={taskDir}
                onChange={(event) => setTaskDir(event.target.value)}
                placeholder="docs/project-control/tasks"
              />
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={!valid || busy}
          className={actionClass}
        >
          <span>{busy ? "registering…" : "register project"}</span>
          <span>↵</span>
        </button>
      </form>
    </ForgeTerminalModalFrame>
  );
}

export function ForgeTerminalDispatchModal({
  open,
  busy,
  task,
  builderChoice,
  builderChoices,
  onBuilderChange,
  onClose,
  onDispatch,
}: {
  open: boolean;
  busy: boolean;
  task: ForgeTask | null;
  builderChoice: ForgeBuilderChoice;
  builderChoices: ForgeBuilderChoice[];
  onBuilderChange: (value: ForgeBuilderChoice) => void;
  onClose: () => void;
  onDispatch: (
    task: ForgeTask,
    builder: ForgeBuilderChoice,
  ) => Promise<void>;
}) {
  const dispatchable =
    task?.readiness === "ready" &&
    (task.runtimeState === "waiting" ||
      task.runtimeState === "fixing");

  const submit = async () => {
    if (!task || !dispatchable || busy) return;
    await onDispatch(task, builderChoice);
    onClose();
  };

  return (
    <ForgeTerminalModalFrame
      open={open}
      title={task ? "DISPATCH " + task.id : "DISPATCH"}
      onClose={onClose}
    >
      {task ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit().catch(() => undefined);
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-text-inverted/15 pb-3">
            <div className="min-w-0">
              <strong className="block truncate text-[11px] font-medium">
                {task.title}
              </strong>
              <span className="mt-1 block text-[9px] text-text-inverted/35">
                repository task · serial Builder
              </span>
            </div>
            <div className="grid shrink-0 gap-1 text-right text-[9px]">
              <span className={terminalTone(task.repositoryState)}>
                repo {task.repositoryState}
              </span>
              <span className={terminalTone(task.runtimeState)}>
                runtime {task.runtimeState}
              </span>
              <span className={terminalTone(task.readiness)}>
                {task.readiness}
              </span>
            </div>
          </div>

          <label className={"mt-3 " + labelClass}>
            builder
            <select
              className={inputClass}
              data-terminal-autofocus
              value={builderChoice}
              onChange={(event) =>
                onBuilderChange(
                  event.target.value as ForgeBuilderChoice,
                )
              }
            >
              {builderChoices.map((builder) => (
                <option key={builder} value={builder}>
                  {builderLabel(builder)}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 border-l-2 border-primary bg-surface-primary/5 px-3 py-2 text-[9px] leading-5 text-text-inverted/45">
            Dispatch is explicit. No Builder fallback, auto push,
            merge, or deploy.
          </div>

          {!dispatchable ? (
            <div className="mt-3 border-l-2 border-danger bg-danger/10 px-3 py-2 text-[9px] leading-5 text-danger">
              ! dispatch unavailable ·{" "}
              {task.readinessReasons.length
                ? task.readinessReasons.join(" · ")
                : "backend readiness has not passed"}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!dispatchable || busy}
            className={actionClass}
          >
            <span>{busy ? "dispatching…" : "dispatch task"}</span>
            <span>↵</span>
          </button>
        </form>
      ) : (
        <div className="text-[10px] text-text-inverted/45">
          no task selected
        </div>
      )}
    </ForgeTerminalModalFrame>
  );
}

export function ForgeTerminalCancelModal({
  open,
  busy,
  target,
  onClose,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  target: ForgeRuntimeRecord | null;
  onClose: () => void;
  onCancel: (runtime: ForgeRuntimeRecord) => void | Promise<void>;
}) {
  const submit = async () => {
    if (!target || busy) return;
    await onCancel(target);
    onClose();
  };

  return (
    <ForgeTerminalModalFrame
      open={open}
      title={target ? "CANCEL " + target.taskId : "CANCEL"}
      onClose={onClose}
    >
      {target ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit().catch(() => undefined);
          }}
        >
          <div className="border-b border-text-inverted/15 pb-3">
            <strong className="block text-[11px] font-medium">
              {target.id}
            </strong>
            <span className="mt-1 block text-[9px] text-text-inverted/35">
              {target.builder + " · " + target.state}
            </span>
          </div>

          <p className="mt-3 text-[9px] leading-5 text-text-inverted/45">
            This cancels the supervised Builder dispatch. Runtime truth
            remains authoritative and the Repository Task is not marked
            PASS.
          </p>

          <button
            type="submit"
            data-terminal-autofocus
            disabled={busy}
            className={
              actionClass +
              " border-danger/60 bg-danger/10 text-danger hover:border-danger hover:text-danger"
            }
          >
            <span>{busy ? "cancelling…" : "cancel dispatch"}</span>
            <span>↵</span>
          </button>
        </form>
      ) : null}
    </ForgeTerminalModalFrame>
  );
}
