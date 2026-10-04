import { Radar } from "lucide-react";
import Badge from "@/shared/ui/Badge";
import TerminalPanel from "@/shared/ui/TerminalPanel";
import type { ToolArtifact, ToolInvocationEvent, ToolTrace } from "@/shared/api/tools";
import { compactJson } from "../utils";

type ToolsTracePanelProps = {
  activeToolId: string | null;
  artifacts: ToolArtifact[];
  events: ToolInvocationEvent[];
  emptyPlaceholder: string;
  panelTitle: string;
  runError: string | null;
  runStatus: "idle" | "completed" | "failed" | "cancelled" | "awaiting_approval";
  trace: ToolTrace | null;
  terminalSummary?: {
    sessionId?: string;
    streamMode?: "split" | "merged";
    stderrSeparated?: boolean;
  } | null;
};

export default function ToolsTracePanel({
  activeToolId,
  artifacts,
  events,
  emptyPlaceholder,
  panelTitle,
  runError,
  runStatus,
  trace,
  terminalSummary,
}: ToolsTracePanelProps) {
  const eventLines = events.map((event) => {
    if (event.type === "invocation:start") {
      return `${event.at}  start  ${event.toolId}`;
    }
    if (event.type === "invocation:approval_required") {
      return `${event.at}  approval  ${event.message}${event.scope ? `  [${event.scope}]` : ""}`;
    }
    if (event.type === "invocation:progress") {
      return `${event.at}  progress  ${event.message}`;
    }
    if (event.type === "invocation:stdout") {
      return `${event.at}  ${event.stream}  ${event.chunk}`;
    }
    if (event.type === "invocation:artifact") {
      const data =
        typeof event.artifact.data === "string"
          ? event.artifact.data
          : event.artifact.data
            ? compactJson(event.artifact.data)
            : "";
      return `${event.at}  artifact  ${event.artifact.kind}  ${event.artifact.title}${data ? `\n${data}` : ""}`;
    }
    if (event.type === "invocation:result") {
      return `${event.at}  result\n${compactJson(event.result)}`;
    }
    if (event.type === "invocation:error") {
      return `${event.at}  error  ${event.message}`;
    }
    if (event.type === "invocation:finish") {
      return `${event.at}  finish  ${event.status}`;
    }
    return "";
  });

  const traceLines =
    trace?.spans.map((span) => {
      const duration =
        span.finishedAt
          ? `${new Date(span.finishedAt).getTime() - new Date(span.startedAt).getTime()}ms`
          : "running";
      return {
        id: span.id,
        summary: `${span.kind}  ${span.name}  ${span.status}  ${duration}`,
        metadata:
          span.metadata && Object.keys(span.metadata).length > 0
            ? compactJson(span.metadata)
            : "",
      };
    }) ?? [];
  const hasActivity = Boolean(trace) || eventLines.length > 0;
  const runMessageClassName =
    runStatus === "awaiting_approval" ? "text-warning-text" : "text-danger-text";

  return (
    <TerminalPanel
      title={panelTitle}
      badge={
        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
          <Radar className="h-3.5 w-3.5" />
          <span>{artifacts.length} artifacts</span>
        </div>
      }
      meta={
        [
          activeToolId ?? "tool stream",
          runStatus,
          terminalSummary?.sessionId ? `session=${terminalSummary.sessionId}` : null,
          terminalSummary?.streamMode ? `stream=${terminalSummary.streamMode}` : null,
          terminalSummary?.stderrSeparated === false ? "stderr=merged" : null,
        ]
          .filter(Boolean)
          .join("  ")
      }
      className="h-full min-h-0"
      variant="plain"
    >
      {runError || hasActivity ? (
        <div className="space-y-4 whitespace-pre-wrap break-words text-[12px]">
          {runError ? (
            <div className={`text-sm ${runMessageClassName}`}>{runError}</div>
          ) : null}

          {trace ? (
            <div className="space-y-2 rounded-ui-control border border-border bg-surface-secondary/60 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="muted">trace</Badge>
                <span className="text-[11px] text-text-secondary">{trace.traceId}</span>
              </div>
              <div className="space-y-2">
                {traceLines.map((line) => (
                  <div key={line.id} className="space-y-1">
                    <div>{line.summary}</div>
                    {line.metadata ? (
                      <div className="pl-3 text-[11px] text-text-secondary">{line.metadata}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {eventLines.length > 0 ? (
            <div className="space-y-3">
              {eventLines.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-text-secondary">{emptyPlaceholder}</div>
      )}
    </TerminalPanel>
  );
}
