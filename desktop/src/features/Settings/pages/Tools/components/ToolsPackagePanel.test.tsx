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
  caseFixtureHint: (fixture: string) => `fixture ${fixture} armed`,
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
          state: "completed",
          continuationId: "continuation-1",
          continuationAvailable: true,
          nextOutputOffset: 12,
          commandCompleted: false,
        }}
        runStatus="awaiting_approval"
        isRunning={false}
        pendingApproval={true}
        activeCase={null}
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
    expect(screen.getByText("state completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "stop" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "持久任务" }));
    await user.click(screen.getByRole("button", { name: "continue" }));
    await user.click(screen.getByRole("button", { name: "status" }));
    await user.click(screen.getByRole("button", { name: "stop" }));
    await user.click(screen.getByRole("button", { name: "approve" }));
    await user.click(screen.getByRole("button", { name: "reject" }));

    expect(onSelectCase).toHaveBeenCalledWith(
      terminalTool.workbench.cases?.[0]?.args,
      { id: "persistent-start", fixture: undefined },
    );
    expect(onTerminalContinue).toHaveBeenCalledOnce();
    expect(onTerminalStatus).toHaveBeenCalledOnce();
    expect(onTerminalStop).toHaveBeenCalledOnce();
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("emits fixture metadata for apply_patch cases and shows the armed fixture hint", async () => {
    const patchText = [
      "*** Begin Patch",
      "*** Update File: .tool-lab-fixtures/file-mutation/overwrite.txt",
      "@@",
      "-before overwrite",
      "+after overwrite",
      "*** End Patch",
      "",
    ].join("\n");
    const applyPatchTool: WorkbenchToolDefinition = {
      id: "apply_patch",
      title: "Apply Patch",
      description: "Apply a patch",
      domain: "edit",
      source: "internal",
      mode: "sync",
      inputSchema: {},
      tags: ["workspace", "edit", "patch", "apply_patch"],
      capabilities: {
        sideEffect: "write",
        requiresApproval: true,
        workspaceBound: true,
      },
      workbench: {
        groupId: "edit",
        groupLabel: "编辑",
        groupDescription: "编辑验收。",
        groupOrder: 20,
        icon: "pencil",
        cases: [
          {
            id: "apply-patch-update",
            title: "更新文件",
            description: "update",
            fixture: "file-mutation",
            args: { patchText },
          },
        ],
      },
    };
    const user = userEvent.setup();
    const onSelectCase = vi.fn();

    render(
      <ToolsPackagePanel
        tools={[applyPatchTool]}
        selectedTool={applyPatchTool}
        terminalSummary={null}
        runStatus="idle"
        isRunning={false}
        pendingApproval={false}
        activeCase={{ id: "apply-patch-update", fixture: "file-mutation" }}
        tracePanel={<div>trace</div>}
        onSelectTool={vi.fn()}
        onOpenArgsModal={vi.fn()}
        onRun={vi.fn()}
        onSelectCase={onSelectCase}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onTerminalContinue={vi.fn()}
        onTerminalStatus={vi.fn()}
        onTerminalStop={vi.fn()}
        labels={labels}
      />,
    );

    expect(screen.getByRole("button", { name: "更新文件" })).toBeInTheDocument();
    expect(screen.getByText("fixture file-mutation armed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "更新文件" }));

    expect(onSelectCase).toHaveBeenCalledWith(
      { patchText },
      { id: "apply-patch-update", fixture: "file-mutation" },
    );
    expect(String(onSelectCase.mock.calls[0]?.[0]?.patchText)).toContain(
      "*** Update File:",
    );
  });
});
