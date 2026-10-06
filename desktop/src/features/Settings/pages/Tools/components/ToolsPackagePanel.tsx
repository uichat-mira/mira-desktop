import { LoaderCircle, Play, Settings2 } from "lucide-react";
import SegmentedTabs from "@/shared/ui/SegmentedTabs";
import Badge from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import type { ReactNode } from "react";
import type { WorkbenchToolDefinition } from "../types";
import type { TerminalResultSummary } from "../utils";

type ToolsPackagePanelProps = {
  tools: WorkbenchToolDefinition[];
  selectedTool: WorkbenchToolDefinition | null;
  terminalSummary: TerminalResultSummary | null;
  runStatus: "idle" | "completed" | "failed" | "cancelled" | "awaiting_approval";
  isRunning: boolean;
  tracePanel: ReactNode;
  onSelectTool: (tool: WorkbenchToolDefinition) => void;
  onOpenArgsModal: () => void;
  onRun: () => void;
  labels: {
    empty: string;
    execute: string;
    config: string;
    packageTitle: string;
    terminalApprovalRequired: string;
    terminalTimeout: string;
    terminalReused: string;
    terminalExit: (exitCode: string) => string;
    terminalStreamMerged: string;
    terminalStreamSplit: string;
    terminalPtyMerged: string;
    terminalSession: (sessionId: string) => string;
    terminalCwd: (cwd: string) => string;
  };
};

export default function ToolsPackagePanel({
  tools,
  selectedTool,
  terminalSummary,
  runStatus,
  isRunning,
  tracePanel,
  onSelectTool,
  onOpenArgsModal,
  onRun,
  labels,
}: ToolsPackagePanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-ui-panel border border-border bg-surface-primary">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">{labels.packageTitle}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenArgsModal}
              disabled={!selectedTool}
            >
              <Settings2 className="h-4 w-4" />
              {labels.config}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onRun}
              disabled={isRunning || !selectedTool}
            >
              {isRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {labels.execute}
            </Button>
          </div>
        </div>
      </div>

      <div className="border-b border-border px-4 py-3">
        {tools.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <SegmentedTabs
                items={tools.map((tool) => ({
                  value: tool.id,
                  label: tool.title,
                }))}
                value={selectedTool?.id ?? tools[0].id}
                onChange={(value) => {
                  const nextTool = tools.find((tool) => tool.id === value);
                  if (nextTool) {
                    onSelectTool(nextTool);
                  }
                }}
                className="min-w-0"
                size="sm"
              />
            </div>

            {selectedTool?.id === "terminal" && terminalSummary ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                <Badge variant="muted">
                  {terminalSummary.streamMode === "merged"
                    ? labels.terminalStreamMerged
                    : labels.terminalStreamSplit}
                </Badge>
                <Badge variant="muted">{terminalSummary.sessionMode ?? "unknown mode"}</Badge>
                <Badge variant={terminalSummary.stderrSeparated === false ? "warning" : "muted"}>
                  {terminalSummary.stderrSeparated === false
                    ? labels.terminalPtyMerged
                    : labels.terminalStreamSplit}
                </Badge>
                {terminalSummary.sessionId ? (
                  <Badge variant="muted">
                    {labels.terminalSession(terminalSummary.sessionId)}
                  </Badge>
                ) : null}
                {terminalSummary.cwd ? (
                  <Badge variant="muted">{labels.terminalCwd(terminalSummary.cwd)}</Badge>
                ) : null}
                {terminalSummary.exitCode !== undefined ? (
                  <Badge variant="muted">
                    {labels.terminalExit(String(terminalSummary.exitCode))}
                  </Badge>
                ) : null}
                {terminalSummary.timedOut ? (
                  <Badge variant="warning">{labels.terminalTimeout}</Badge>
                ) : null}
                {terminalSummary.reusedSession ? (
                  <Badge variant="muted">{labels.terminalReused}</Badge>
                ) : null}
                {runStatus === "awaiting_approval" ? (
                  <Badge variant="warning">{labels.terminalApprovalRequired}</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-text-secondary">{labels.empty}</div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">{tracePanel}</div>
      </div>
    </div>
  );
}
