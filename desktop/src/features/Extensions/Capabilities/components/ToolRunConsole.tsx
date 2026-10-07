import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown, ChevronUp, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/shared/ui/Button";
import TerminalPanel from "@/shared/ui/TerminalPanel";
import type { ToolInvocation, ToolInvocationStatus } from "@/shared/api/tools";
import type { CapabilityRunState, CapabilityTool } from "../types";
import {
  formatCapabilityDuration,
  stringifyCapabilityValue,
  summarizeCapabilityInvocation,
} from "../utils";

type ConsoleStatus = ToolInvocationStatus | "idle";
type ConsoleTabId =
  | "interaction"
  | "artifacts"
  | "result"
  | "error"
  | "evidence"
  | "trace"
  | "events"
  | "source";

type ToolRunConsoleProps = {
  open: boolean;
  onToggle: () => void;
  status: ConsoleStatus;
  runState: CapabilityRunState;
  selectedTool: CapabilityTool;
  isResolvingApproval: boolean;
  onResolveApproval: (decision: "approved" | "rejected") => void | Promise<void>;
};

const PANE_HEADER_HEIGHT = 44;
const DEFAULT_PANE_BODY_HEIGHT = 260;
const MIN_PANE_BODY_HEIGHT = 140;

const getMaxPaneBodyHeight = () =>
  Math.max(
    MIN_PANE_BODY_HEIGHT,
    Math.floor(
      (typeof window === "undefined" ? 768 : window.innerHeight) * 0.5 -
        PANE_HEADER_HEIGHT,
    ),
  );

const clampPaneBodyHeight = (height: number) =>
  Math.min(getMaxPaneBodyHeight(), Math.max(MIN_PANE_BODY_HEIGHT, height));

const statusTone: Record<ConsoleStatus, string> = {
  idle: "text-text-tertiary",
  queued: "text-text-secondary",
  running: "text-primary",
  awaiting_approval: "text-warning",
  completed: "text-success",
  failed: "text-danger",
  cancelled: "text-text-tertiary",
};

export default function ToolRunConsole({
  open,
  onToggle,
  status,
  runState,
  selectedTool,
  isResolvingApproval,
  onResolveApproval,
}: ToolRunConsoleProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ConsoleTabId>("interaction");
  const [paneBodyHeight, setPaneBodyHeight] = useState(() =>
    clampPaneBodyHeight(DEFAULT_PANE_BODY_HEIGHT),
  );
  const [isResizing, setIsResizing] = useState(false);
  const approvalFocusRef = useRef<HTMLButtonElement>(null);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );
  const originalInvocation = runState.invocation;
  const displayInvocation = runState.resolutionInvocation ?? originalInvocation;
  const approval = originalInvocation?.approval;
  const approvalPending =
    originalInvocation?.status === "awaiting_approval" &&
    !approval?.resolution;

  const sourceDetails = useMemo(
    () => ({
      id: selectedTool.id,
      source: selectedTool.source,
      sourceLabel: selectedTool.sourceLabel,
      domain: selectedTool.domain,
      externalServerId: selectedTool.externalServerId,
      agentAccessEnabled: selectedTool.agentAccessEnabled,
      capabilities: selectedTool.capabilities,
    }),
    [selectedTool],
  );

  const tabs = useMemo(
    () =>
      [
        {
          id: "interaction" as const,
          label: t("settings.development.capabilities.consoleTabs.interaction"),
          visible: true,
        },
        {
          id: "artifacts" as const,
          label: t("settings.development.capabilities.consoleTabs.artifacts"),
          visible: Boolean(displayInvocation?.artifacts.length),
        },
        {
          id: "result" as const,
          label: t("settings.development.capabilities.consoleTabs.result"),
          visible: displayInvocation?.result !== undefined,
        },
        {
          id: "error" as const,
          label: t("settings.development.capabilities.consoleTabs.error"),
          visible: Boolean(displayInvocation?.error || runState.transportError),
        },
        {
          id: "evidence" as const,
          label: t("settings.development.capabilities.consoleTabs.evidence"),
          visible: displayInvocation?.evidence !== undefined,
        },
        {
          id: "trace" as const,
          label: t("settings.development.capabilities.consoleTabs.trace"),
          visible: Boolean(runState.trace),
        },
        {
          id: "events" as const,
          label: t("settings.development.capabilities.consoleTabs.events"),
          visible: runState.events.length > 0,
        },
        {
          id: "source" as const,
          label: t("settings.development.capabilities.consoleTabs.source"),
          visible: true,
        },
      ].filter((tab) => tab.visible),
    [
      displayInvocation?.artifacts.length,
      displayInvocation?.error,
      displayInvocation?.evidence,
      displayInvocation?.result,
      runState.events.length,
      runState.trace,
      runState.transportError,
      t,
    ],
  );

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("interaction");
    }
  }, [activeTab, tabs]);

  useEffect(() => {
    setActiveTab("interaction");
  }, [originalInvocation?.id]);

  useEffect(() => {
    if (!open || !approvalPending) return;
    setActiveTab("interaction");
    requestAnimationFrame(() => approvalFocusRef.current?.focus());
  }, [approvalPending, open]);

  useEffect(() => {
    const handleWindowResize = () => {
      setPaneBodyHeight((height) => clampPaneBodyHeight(height));
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const clientY = Number.isFinite(event.clientY)
        ? event.clientY
        : dragState.startY;
      setPaneBodyHeight(
        clampPaneBodyHeight(
          dragState.startHeight + (dragState.startY - clientY),
        ),
      );
    };

    const finishResize = () => {
      dragStateRef.current = null;
      setIsResizing(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [isResizing]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!open) return;
      event.preventDefault();
      dragStateRef.current = {
        startY: Number.isFinite(event.clientY) ? event.clientY : 0,
        startHeight: paneBodyHeight,
      };
      setIsResizing(true);
    },
    [open, paneBodyHeight],
  );

  const resizeByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }

    event.preventDefault();
    const delta = event.key === "ArrowUp" ? 16 : -16;
    setPaneBodyHeight((height) => clampPaneBodyHeight(height + delta));
  };

  useEffect(() => {
    if (!open || !approvalPending || isResolvingApproval) {
      return;
    }

    const handleApprovalKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "y" && key !== "n") return;

      event.preventDefault();
      void onResolveApproval(key === "y" ? "approved" : "rejected");
    };

    window.addEventListener("keydown", handleApprovalKey);
    return () => window.removeEventListener("keydown", handleApprovalKey);
  }, [approvalPending, isResolvingApproval, onResolveApproval, open]);

  return (
    <section className="relative shrink-0 border-t border-border bg-surface-primary">
      {open ? (
        <div
          role="slider"
          aria-orientation="vertical"
          aria-label={t("settings.development.capabilities.actions.resizeResult")}
          aria-valuemin={MIN_PANE_BODY_HEIGHT}
          aria-valuemax={getMaxPaneBodyHeight()}
          aria-valuenow={paneBodyHeight}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeByKeyboard}
          className="group absolute inset-x-0 top-0 z-20 h-2 -translate-y-1/2 cursor-row-resize touch-none focus-visible:outline-none"
        >
          <div className="mx-auto mt-[3px] h-0.5 w-12 rounded-full bg-border transition-[width,background-color,opacity] duration-150 group-hover:w-16 group-hover:bg-primary/60 group-focus-visible:w-16 group-focus-visible:bg-primary/70" />
        </div>
      ) : null}
      <div className="flex h-11 min-w-0 items-stretch border-b border-border/70">
        <div className="flex shrink-0 items-center gap-2 px-3">
          <SquareTerminal className="h-4 w-4 text-text-secondary" />
          <span className="text-xs font-medium text-text-secondary">
            {t("settings.development.capabilities.result")}
          </span>
        </div>

        <div className="stable-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (!open) onToggle();
              }}
              className={`relative shrink-0 px-3 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/20 ${
                activeTab === tab.id
                  ? "text-text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-3 px-3 font-mono text-[11px]">
          <span className={statusTone[status]}>
            <span aria-hidden="true">● </span>
            <span>{t(`settings.development.capabilities.invocation.${status}`)}</span>
          </span>
          <span className="text-text-tertiary">
            {formatCapabilityDuration(displayInvocation)}
          </span>
          <IconButton
            size="sm"
            ariaLabel={
              open
                ? t("settings.development.capabilities.actions.collapseResult")
                : t("settings.development.capabilities.actions.expandResult")
            }
            onClick={onToggle}
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </IconButton>
        </div>
      </div>

      <div
        style={{
          height: open ? paneBodyHeight : 0,
          opacity: open ? 1 : 0,
        }}
        aria-hidden={!open}
        className={`min-h-0 overflow-hidden ${
          isResizing
            ? ""
            : "transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none"
        }`}
      >
        {open ? (
          <div
            role="region"
            aria-label={t("settings.development.capabilities.consoleTabs.interaction")}
            className="h-full min-h-0"
          >
            <TerminalPanel variant="plain" className="h-full">
              {activeTab === "interaction" ? (
                <InteractionView
                  status={status}
                  selectedTool={selectedTool}
                  originalInvocation={originalInvocation}
                  displayInvocation={displayInvocation}
                  transportError={runState.transportError}
                  isResolvingApproval={isResolvingApproval}
                  approvalFocusRef={approvalFocusRef}
                  onResolveApproval={onResolveApproval}
                />
              ) : activeTab === "artifacts" ? (
                <ArtifactsView invocation={displayInvocation} emptyArtifactLabel={t("settings.development.capabilities.labels.artifactNoPreview")} />
              ) : activeTab === "result" ? (
                <TerminalValue value={displayInvocation?.result} />
              ) : activeTab === "error" ? (
                <TerminalValue
                  value={
                    displayInvocation?.error ??
                    (runState.transportError
                      ? { transportError: runState.transportError }
                      : undefined)
                  }
                />
              ) : activeTab === "evidence" ? (
                <TerminalValue value={displayInvocation?.evidence} />
              ) : activeTab === "trace" ? (
                <TerminalValue value={runState.trace} />
              ) : activeTab === "events" ? (
                <TerminalValue value={runState.events} />
              ) : (
                <TerminalValue value={sourceDetails} />
              )}
            </TerminalPanel>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InteractionView({
  status,
  selectedTool,
  originalInvocation,
  displayInvocation,
  transportError,
  isResolvingApproval,
  approvalFocusRef,
  onResolveApproval,
}: {
  status: ConsoleStatus;
  selectedTool: CapabilityTool;
  originalInvocation: ToolInvocation | null;
  displayInvocation: ToolInvocation | null;
  transportError: string | null;
  isResolvingApproval: boolean;
  approvalFocusRef: RefObject<HTMLButtonElement>;
  onResolveApproval: (decision: "approved" | "rejected") => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const approval = originalInvocation?.approval;
  const approvalPending =
    originalInvocation?.status === "awaiting_approval" &&
    !approval?.resolution;

  return (
    <>
      <ConsoleLine marker="$">
        <span className="text-text-secondary">{t("settings.development.capabilities.console.toolRun")} :: </span>
        <span className="text-info-text">{selectedTool.title}</span>
      </ConsoleLine>

      <ConsoleLine marker="›">
        <span className="text-text-secondary">{t("settings.development.capabilities.console.status")} :: </span>
        <span className={statusTone[status]}>
          {t(`settings.development.capabilities.invocation.${status}`)}
        </span>
      </ConsoleLine>

      {transportError ? (
        <ConsoleLine marker="!" tone="danger">
          {transportError}
        </ConsoleLine>
      ) : null}

      {approval ? (
        <div className="py-2">
          <div className="text-warning">
            <span className="mr-2 text-text-tertiary">?</span>
            {t("settings.development.capabilities.approvalTui.required")}
          </div>
          <div className="pl-4 text-text-primary">{approval.reason}</div>
          {approval.scope ? (
            <div className="pl-4 text-text-tertiary">
              {t("settings.development.capabilities.console.scope")} :: {approval.scope}
            </div>
          ) : null}

          {approval.resolution ? (
            <>
              <div className="pl-4">
                {t("settings.development.capabilities.approvalTui.continue")}{" "}
                <span
                  className={
                    approval.resolution.decision === "approved"
                      ? "text-success"
                      : "text-text-tertiary"
                  }
                >
                  [Y] {t("settings.development.capabilities.approvalTui.approve")}
                </span>{" "}
                /{" "}
                <span
                  className={
                    approval.resolution.decision === "rejected"
                      ? "text-danger"
                      : "text-text-tertiary"
                  }
                >
                  [N] {t("settings.development.capabilities.approvalTui.reject")}
                </span>
              </div>
              <div
                className={`pl-4 ${
                  approval.resolution.decision === "approved"
                    ? "text-success"
                    : "text-danger"
                }`}
              >
                &gt; {approval.resolution.decision === "approved" ? "Y" : "N"}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 pl-4">
              <span>{t("settings.development.capabilities.approvalTui.continue")}</span>
              <button
                ref={approvalFocusRef}
                type="button"
                disabled={!approvalPending || isResolvingApproval}
                onClick={() => void onResolveApproval("approved")}
                className="text-success underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                [Y] {t("settings.development.capabilities.approvalTui.approve")}
              </button>
              <span className="text-text-tertiary">/</span>
              <button
                type="button"
                disabled={!approvalPending || isResolvingApproval}
                onClick={() => void onResolveApproval("rejected")}
                className="text-danger underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                [N] {t("settings.development.capabilities.approvalTui.reject")}
              </button>
              {isResolvingApproval ? (
                <span className="text-warning">
                  {t("settings.development.capabilities.approvalTui.resolving")}
                </span>
              ) : (
                <span className="text-text-tertiary">
                  {t("settings.development.capabilities.approvalTui.keyboardHint")}
                </span>
              )}
            </div>
          )}
        </div>
      ) : null}

      <ConsoleLine
        marker={
          status === "completed"
            ? "✓"
            : status === "failed" || status === "cancelled"
              ? "×"
              : "·"
        }
        tone={
          status === "completed"
            ? "success"
            : status === "failed" || status === "cancelled"
              ? "danger"
              : undefined
        }
      >
        {summarizeCapabilityInvocation(displayInvocation, t)}
      </ConsoleLine>
    </>
  );
}

function ArtifactsView({
  invocation,
  emptyArtifactLabel,
}: {
  invocation: ToolInvocation | null;
  emptyArtifactLabel: string;
}) {
  if (!invocation?.artifacts.length) {
    return <TerminalValue value={undefined} />;
  }

  return (
    <>
      {invocation.artifacts.map((artifact, index) => (
        <div
          key={artifact.id}
          className="border-b border-border/60 py-2 last:border-b-0"
        >
          <div>
            <span className="text-info-text">artifact[{index + 1}]</span>
            <span className="text-text-secondary"> :: </span>
            <span className="text-text-primary">{artifact.title}</span>
            <span className="ml-2 text-text-tertiary">
              &lt;{artifact.kind}&gt;
            </span>
          </div>
          <div className="mt-1 pl-4">
            <TerminalValue
              value={
                artifact.data !== undefined
                  ? artifact.data
                  : artifact.uri ?? emptyArtifactLabel
              }
            />
          </div>
        </div>
      ))}
    </>
  );
}

function ConsoleLine({
  children,
  marker,
  tone,
}: {
  children: ReactNode;
  marker: string;
  tone?: "danger" | "warning" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-text-primary";

  return (
    <div className={`py-1.5 ${toneClass}`}>
      <span className="mr-2 text-text-tertiary">{marker}</span>
      {children}
    </div>
  );
}

function TerminalValue({ value }: { value: unknown }) {
  const source = stringifyCapabilityValue(value);
  const lines = source.split("\n");

  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.7] text-text-primary">
      {lines.map((line, lineIndex) => (
        <span key={`${lineIndex}-${line}`} className="block">
          {highlightJsonLine(line)}
        </span>
      ))}
    </pre>
  );
}

function highlightJsonLine(line: string) {
  const tokenPattern =
    /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\bnull\b/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) {
      nodes.push(line.slice(cursor, match.index));
    }

    const token = match[0];
    const className = match[1]
      ? "text-info-text"
      : match[2]
        ? "text-success"
        : match[3]
          ? "text-warning"
          : match[4]
            ? "text-primary"
            : "text-text-tertiary";

    nodes.push(
      <span key={`${match.index}-${token}`} className={className}>
        {token}
      </span>,
    );
    cursor = match.index + token.length;
  }

  if (cursor < line.length) {
    nodes.push(line.slice(cursor));
  }

  return nodes.length ? nodes : line;
}

