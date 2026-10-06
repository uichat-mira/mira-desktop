// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ToolsPackagePanel from "./ToolsPackagePanel";
import type { WorkbenchToolDefinition } from "../types";

const terminalTool: WorkbenchToolDefinition = {
  id: "terminal",
  title: "Terminal",
  description: "Run commands",
  domain: "terminal",
  source: "internal",
  mode: "stream",
  inputSchema: {},
  tags: ["terminal"],
  capabilities: {
    sideEffect: "process",
    requiresApproval: true,
    workspaceBound: true,
    longRunning: true,
  },
  workbench: {
    groupId: "terminal",
    groupLabel: "终端",
    groupDescription: "终端验收。",
    groupOrder: 40,
    icon: "terminal",
    cases: [
      {
        id: "persistent-start",
        title: "持久任务",
        description: "start",
        args: {
          command: "node -e \"setInterval(()=>{},250)\"",
          sessionMode: "persistent",
        },
      },
    ],
  },
};

const labels = {
  empty: "empty",
  execute: "run",
  config: "args",
  packageTitle: "package",
  terminalApprovalRequired: "approval required",
  terminalTimeout: "timeout",
  terminalReused: "reused",
  terminalExit: (exitCode: string) => `exit ${exitCode}`,
  terminalStreamMerged: "merged",
  terminalStreamSplit: "split",
  terminalPtyMerged: "PTY merged",
  terminalSession: (sessionId: string) => `session ${sessionId}`,
  terminalCwd: (cwd: string) => `cwd ${cwd}`,
  terminalState: (state: string) => `state ${state}`,
  acceptanceCases: "acceptance cases",
  approve: "approve",
  reject: "reject",
  continueOutput: "continue",
  inspectStatus: "status",
  stop: "stop",
};

describe("ToolsPackagePanel terminal acceptance controls", () => {
  it("shows registered cases and persistent follow-up controls", async () => {
    const user = userEvent.setup();
    const onSelectCase = vi.fn();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onTerminalContinue = vi.fn();
    const onTerminalStatus = vi.fn();
    const onTerminalStop = vi.fn();

    render(
      <ToolsPackagePanel
        tools={[terminalTool]}
        selectedTool={terminalTool}
        terminalSummary={{
          command: "watch",
          cwd: "D:/workspace",
          sessionId: "session-1",
          streamMode: "merged",
          sessionMode: "persistent",
          stderrSeparated: false,
          state: "running",
          continuationId: "continuation-1",
          continuationAvailable: true,
          nextOutputOffset: 12,
          commandCompleted: false,
        }}
        runStatus="awaiting_approval"
        isRunning={false}
        pendingApproval={true}
        tracePanel={<div>trace</div>}
        onSelectTool={vi.fn()}
        onOpenArgsModal={vi.fn()}
        onRun={vi.fn()}
        onSelectCase={onSelectCase}
        onApprove={onApprove}
        onReject={onReject}
        onTerminalContinue={onTerminalContinue}
        onTerminalStatus={onTerminalStatus}
        onTerminalStop={onTerminalStop}
        labels={labels}
      />,
    );

    expect(screen.getByText("acceptance cases")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "持久任务" })).toBeInTheDocument();
    expect(screen.getByText("state running")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "持久任务" }));
    await user.click(screen.getByRole("button", { name: "continue" }));
    await user.click(screen.getByRole("button", { name: "status" }));
    await user.click(screen.getByRole("button", { name: "stop" }));
    await user.click(screen.getByRole("button", { name: "approve" }));
    await user.click(screen.getByRole("button", { name: "reject" }));

    expect(onSelectCase).toHaveBeenCalledWith(
      terminalTool.workbench.cases?.[0]?.args,
    );
    expect(onTerminalContinue).toHaveBeenCalledOnce();
    expect(onTerminalStatus).toHaveBeenCalledOnce();
    expect(onTerminalStop).toHaveBeenCalledOnce();
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });
});
