// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMcpRegisteredToolsMock = vi.fn();
const getMcpToolsMock = vi.fn();
const getMcpManagedCapabilityWorkspaceSelectionMock = vi.fn();
const getExternalMcpServersMock = vi.fn();
const executeMcpInvocationStreamMock = vi.fn();
const getMcpInvocationMock = vi.fn();
const getMcpInvocationEventsMock = vi.fn();
const getMcpInvocationTraceMock = vi.fn();
const resetMcpCapabilityFixtureMock = vi.fn();
const resolveMcpInvocationApprovalMock = vi.fn();

vi.mock("@/shared/api/tools", () => ({
  getMcpRegisteredTools: () => getMcpRegisteredToolsMock(),
  getMcpTools: () => getMcpToolsMock(),
  getMcpManagedCapabilityWorkspaceSelection: () =>
    getMcpManagedCapabilityWorkspaceSelectionMock(),
  getExternalMcpServers: () => getExternalMcpServersMock(),
  executeMcpInvocationStream: (...args: unknown[]) =>
    executeMcpInvocationStreamMock(...args),
  getMcpInvocation: (...args: unknown[]) => getMcpInvocationMock(...args),
  getMcpInvocationEvents: (...args: unknown[]) =>
    getMcpInvocationEventsMock(...args),
  getMcpInvocationTrace: (...args: unknown[]) =>
    getMcpInvocationTraceMock(...args),
  resetMcpCapabilityFixture: (...args: unknown[]) =>
    resetMcpCapabilityFixtureMock(...args),
  resolveMcpInvocationApproval: (...args: unknown[]) =>
    resolveMcpInvocationApprovalMock(...args),
}));

const readTool = {
  id: "read",
  title: "Read",
  description: "Read",
  domain: "read",
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: [],
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
    workspaceBound: true,
  },
};

const writeTool = {
  id: "write",
  title: "Write",
  description: "Write",
  domain: "edit",
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: [],
  capabilities: {
    sideEffect: "local-write",
    requiresApproval: true,
    workspaceBound: true,
  },
};

const terminalTool = {
  id: "terminal",
  title: "Terminal",
  description: "Run governed terminal commands.",
  domain: "terminal",
  source: "internal",
  mode: "stream",
  inputSchema: { type: "object" },
  tags: ["terminal"],
  capabilities: {
    sideEffect: "process",
    requiresApproval: true,
    workspaceBound: true,
    longRunning: true,
  },
};


async function importHook() {
  const { useCapabilities } =
    await vi.importActual<typeof import("./useCapabilities")>("./useCapabilities");
  return useCapabilities;
}

describe("useCapabilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMcpRegisteredToolsMock.mockResolvedValue([readTool, writeTool]);
    getMcpToolsMock.mockResolvedValue([writeTool]);
    getMcpManagedCapabilityWorkspaceSelectionMock.mockResolvedValue({
      rootPath: "/workspace",
      source: "selected",
    });
    getExternalMcpServersMock.mockResolvedValue([]);
    resetMcpCapabilityFixtureMock.mockResolvedValue({
      fixtureId: "fixture",
      workspace: {
        rootPath: "/managed/tool-lab/workspace",
        source: "managed",
      },
      fixtureRoot: "/managed/tool-lab/workspace/.tool-lab-fixtures/fixture",
      resetAt: "2026-10-05T00:00:00.000Z",
    });
    getMcpInvocationEventsMock.mockResolvedValue([]);
    getMcpInvocationTraceMock.mockResolvedValue({
      traceId: "trace-1",
      invocationId: "inv-1",
      toolId: "read",
      startedAt: "2026-10-05T00:00:00.000Z",
      spans: [],
    });
  });

  it("runs the selected fixed case through the real invocation client", async () => {
    executeMcpInvocationStreamMock.mockImplementation(
      async (_input: unknown, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "invocation:start",
          invocationId: "inv-1",
          toolId: "read",
          at: "2026-10-05T00:00:00.000Z",
        });
        onEvent({
          type: "invocation:finish",
          invocationId: "inv-1",
          status: "completed",
          at: "2026-10-05T00:00:00.010Z",
        });
      },
    );
    getMcpInvocationMock.mockResolvedValue({
      id: "inv-1",
      toolId: "read",
      status: "completed",
      args: { path: "README.md" },
      result: { type: "open" },
      artifacts: [],
      traceId: "trace-1",
      startedAt: "2026-10-05T00:00:00.000Z",
      finishedAt: "2026-10-05T00:00:00.010Z",
    });

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() => expect(result.current.selectedCase?.id).toBe("core-read-success"));

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(executeMcpInvocationStreamMock).toHaveBeenCalledWith(
      {
        toolId: "read",
        args: {
          path: ".tool-lab-fixtures/platform-read-success/input.txt",
        },
        workspaceContext: "tool_lab_managed",
      },
      expect.any(Function),
    );
    expect(resetMcpCapabilityFixtureMock).toHaveBeenCalledWith(
      "platform-read-success",
    );
    expect(resetMcpCapabilityFixtureMock.mock.invocationCallOrder[0]).toBeLessThan(
      executeMcpInvocationStreamMock.mock.invocationCallOrder[0]!,
    );
    expect(getMcpInvocationMock).toHaveBeenCalledWith("inv-1");
    expect(getMcpInvocationTraceMock).toHaveBeenCalledWith("inv-1");
    expect(result.current.runState.invocation?.status).toBe("completed");

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(resetMcpCapabilityFixtureMock).toHaveBeenCalledTimes(2);
    expect(executeMcpInvocationStreamMock).toHaveBeenCalledTimes(2);
  });

  it("prevents overlapping case runs before React state updates can disable the controls", async () => {
    let releaseReset: (() => void) | undefined;
    resetMcpCapabilityFixtureMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseReset = () =>
            resolve({
              fixtureId: "platform-read-success",
              workspace: {
                rootPath: "/managed/tool-lab/workspace",
                source: "managed",
              },
              fixtureRoot:
                "/managed/tool-lab/workspace/.tool-lab-fixtures/platform-read-success",
              resetAt: "2026-10-05T00:00:00.000Z",
            });
        }),
    );
    executeMcpInvocationStreamMock.mockImplementation(
      async (_input: unknown, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "invocation:start",
          invocationId: "inv-concurrent",
          toolId: "read",
          at: "2026-10-05T00:00:00.000Z",
        });
        onEvent({
          type: "invocation:finish",
          invocationId: "inv-concurrent",
          status: "completed",
          at: "2026-10-05T00:00:00.010Z",
        });
      },
    );
    getMcpInvocationMock.mockResolvedValue({
      id: "inv-concurrent",
      toolId: "read",
      status: "completed",
      args: {
        path: ".tool-lab-fixtures/platform-read-success/input.txt",
      },
      artifacts: [],
    });

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("core-read-success"),
    );

    let firstRun!: Promise<void>;
    let secondRun!: Promise<void>;
    act(() => {
      firstRun = result.current.runSelectedCase();
      secondRun = result.current.runSelectedCase();
    });

    expect(resetMcpCapabilityFixtureMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseReset?.();
      await Promise.all([firstRun, secondRun]);
    });

    expect(executeMcpInvocationStreamMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when fixture reset fails before invocation", async () => {
    resetMcpCapabilityFixtureMock.mockRejectedValueOnce(
      new Error("fixture reset exploded"),
    );

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("core-read-success"),
    );

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(executeMcpInvocationStreamMock).not.toHaveBeenCalled();
    expect(result.current.runState.invocation).toBeNull();
    expect(result.current.runState.transportError).toContain(
      "Fixture preparation failed: fixture reset exploded",
    );
  });

  it("only offers manual handoff when the selected Tool exists in the current Tools workbench", async () => {
    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() => expect(result.current.selectedTool?.id).toBe("read"));
    expect(result.current.canOpenManual).toBe(false);

    act(() => {
      result.current.selectTool("write");
    });

    await waitFor(() => expect(result.current.selectedTool?.id).toBe("write"));
    expect(result.current.canOpenManual).toBe(true);
  });

  it("keeps a registered case visible as Unavailable when its native Tool is missing", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([writeTool]);

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("core-read-success"),
    );

    expect(result.current.selectedTool?.id).toBe("read");
    expect(result.current.readiness.state).toBe("unavailable");
    expect(result.current.readiness.settingsPath).toBe("/settings/tools");
  });

  it("does not start an invocation when the Workspace prerequisite is unavailable", async () => {
    getMcpManagedCapabilityWorkspaceSelectionMock.mockResolvedValueOnce({
      rootPath: null,
      source: "unset",
    });

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() => expect(result.current.selectedCase).not.toBeNull());

    expect(result.current.readiness.state).toBe("unavailable");

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(executeMcpInvocationStreamMock).not.toHaveBeenCalled();
  });

  it("surfaces the real Awaiting Approval record without resolving approval", async () => {
    executeMcpInvocationStreamMock.mockImplementation(
      async (_input: unknown, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "invocation:start",
          invocationId: "inv-approval",
          toolId: "write",
          at: "2026-10-05T00:00:00.000Z",
        });
        onEvent({
          type: "invocation:approval_required",
          invocationId: "inv-approval",
          message: "Approval required",
          scope: "workspace.write",
          at: "2026-10-05T00:00:00.005Z",
        });
        onEvent({
          type: "invocation:finish",
          invocationId: "inv-approval",
          status: "awaiting_approval",
          at: "2026-10-05T00:00:00.006Z",
        });
      },
    );
    getMcpInvocationMock.mockResolvedValue({
      id: "inv-approval",
      toolId: "write",
      status: "awaiting_approval",
      args: {
        path: ".tool-lab-fixtures/platform-approval-boundary/approval-probe.txt",
        content: "capabilities-approval-probe",
      },
      approval: {
        required: true,
        reason: "Approval required",
        scope: "workspace.write",
      },
      artifacts: [],
    });
    getMcpInvocationTraceMock.mockResolvedValue({
      traceId: "trace-approval",
      invocationId: "inv-approval",
      toolId: "write",
      startedAt: "2026-10-05T00:00:00.000Z",
      spans: [],
    });

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() => {
      expect(result.current.tools.some((tool) => tool.id === "read")).toBe(true);
      expect(result.current.tools.some((tool) => tool.id === "write")).toBe(true);
    });

    act(() => {
      result.current.selectCase("core-approval-boundary");
    });

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("write");
      expect(result.current.selectedCase?.id).toBe("core-approval-boundary");
    });

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(executeMcpInvocationStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "write",
        args: expect.objectContaining({
          path: ".tool-lab-fixtures/platform-approval-boundary/approval-probe.txt",
          content: "capabilities-approval-probe",
        }),
      }),
      expect.any(Function),
    );
    expect(result.current.runState.invocation?.status).toBe("awaiting_approval");
    expect(result.current.runState.invocation?.approval?.scope).toBe(
      "workspace.write",
    );
    expect(result.current.isSelectionLocked).toBe(true);

    act(() => {
      result.current.selectTool("read");
      result.current.selectCase("core-read-success");
    });

    expect(result.current.selectedTool?.id).toBe("write");
    expect(result.current.selectedCase?.id).toBe("core-approval-boundary");
    expect(result.current.runState.invocation?.id).toBe("inv-approval");

    const invocationCallCount = executeMcpInvocationStreamMock.mock.calls.length;
    await act(async () => {
      await result.current.runCase("core-read-success");
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenCalledTimes(
      invocationCallCount,
    );

    resolveMcpInvocationApprovalMock.mockResolvedValue({
      originalInvocation: {
        id: "inv-approval",
        toolId: "write",
        status: "completed",
        args: {},
        approval: {
          required: true,
          reason: "Approval required",
          scope: "workspace.write",
          resolution: {
            decision: "approved",
            resolvedAt: "2026-10-05T00:00:01.000Z",
            resolutionInvocationId: "inv-resumed",
          },
        },
        artifacts: [],
      },
      resumedInvocation: {
        id: "inv-resumed",
        toolId: "write",
        status: "completed",
        args: {},
        result: { ok: true },
        artifacts: [],
      },
    });
    getMcpInvocationEventsMock.mockResolvedValue([
      {
        type: "invocation:finish",
        invocationId: "inv-resumed",
        status: "completed",
        at: "2026-10-05T00:00:01.000Z",
      },
    ]);

    await act(async () => {
      await result.current.resolveApproval("approved");
    });

    expect(resolveMcpInvocationApprovalMock).toHaveBeenCalledWith(
      "inv-approval",
      {
        decision: "approved",
        toolId: "write",
        args: {
          path: ".tool-lab-fixtures/platform-approval-boundary/approval-probe.txt",
          content: "capabilities-approval-probe",
        },
      },
    );
    expect(result.current.runState.invocation?.approval?.resolution?.decision).toBe(
      "approved",
    );
    expect(result.current.runState.resolutionInvocation?.id).toBe("inv-resumed");
  });

  it("runs Terminal continuation, status, and stop from the Capability Lab without replaying the command", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([
      readTool,
      writeTool,
      terminalTool,
    ]);
    getMcpToolsMock.mockResolvedValueOnce([writeTool, terminalTool]);

    const persistentArgs = {
      command:
        "node -e \"let i=0; setInterval(()=>console.log('MIRA_TICK:'+ ++i),250)\"",
      sessionMode: "persistent",
      timeoutMs: 700,
      outputLimitBytes: 4096,
    };

    executeMcpInvocationStreamMock.mockImplementation(
      async (
        input: { toolId: string; args: Record<string, unknown> },
        onEvent: (event: unknown) => void,
      ) => {
        const invocationId =
          input.args.operation === "status"
            ? "inv-status"
            : input.args.operation === "stop"
              ? "inv-stop"
              : "continuationId" in input.args
                ? "inv-continue"
                : "inv-start";

        onEvent({
          type: "invocation:start",
          invocationId,
          toolId: "terminal",
          at: "2026-10-06T00:00:00.000Z",
        });

        if (invocationId === "inv-start") {
          onEvent({
            type: "invocation:approval_required",
            invocationId,
            message: "Approval required",
            scope: "process.execute",
            at: "2026-10-06T00:00:00.001Z",
          });
          onEvent({
            type: "invocation:finish",
            invocationId,
            status: "awaiting_approval",
            at: "2026-10-06T00:00:00.002Z",
          });
          return;
        }

        onEvent({
          type: "invocation:finish",
          invocationId,
          status: "completed",
          at: "2026-10-06T00:00:00.002Z",
        });
      },
    );

    getMcpInvocationMock.mockImplementation(async (invocationId: string) => {
      if (invocationId === "inv-start") {
        return {
          id: invocationId,
          toolId: "terminal",
          status: "awaiting_approval",
          args: persistentArgs,
          approval: {
            required: true,
            reason: "Approval required",
            scope: "process.execute",
          },
          artifacts: [],
        };
      }
      if (invocationId === "inv-continue") {
        return {
          id: invocationId,
          toolId: "terminal",
          status: "completed",
          args: {
            continuationId: "continuation-1",
            outputOffset: 12,
            outputLimitBytes: 4096,
          },
          result: {
            command: persistentArgs.command,
            cwd: "/managed/tool-lab/workspace",
            sessionId: "session-1",
            streamMode: "merged",
            sessionMode: "persistent",
            state: "running",
            continuationId: "continuation-1",
            continuationAvailable: true,
            nextOutputOffset: 24,
            outputBytesAvailable: 24,
            outputLimitBytes: 4096,
            commandCompleted: false,
          },
          artifacts: [],
        };
      }
      if (invocationId === "inv-status") {
        return {
          id: invocationId,
          toolId: "terminal",
          status: "completed",
          args: { operation: "status", sessionId: "session-1" },
          result: {
            command: persistentArgs.command,
            cwd: "/managed/tool-lab/workspace",
            sessionId: "session-1",
            streamMode: "merged",
            sessionMode: "persistent",
            state: "running",
            continuationId: "continuation-1",
            continuationAvailable: true,
            outputBytesAvailable: 24,
            commandCompleted: false,
          },
          artifacts: [],
        };
      }
      return {
        id: invocationId,
        toolId: "terminal",
        status: "completed",
        args: { operation: "stop", sessionId: "session-1" },
        result: {
          command: persistentArgs.command,
          cwd: "/managed/tool-lab/workspace",
          sessionId: "session-1",
          streamMode: "merged",
          sessionMode: "persistent",
          state: "cancelled",
          continuationId: "continuation-1",
          continuationAvailable: false,
          commandCompleted: true,
          cleanupCompleted: true,
        },
        artifacts: [],
      };
    });

    resolveMcpInvocationApprovalMock.mockResolvedValue({
      originalInvocation: {
        id: "inv-start",
        toolId: "terminal",
        status: "completed",
        args: persistentArgs,
        approval: {
          required: true,
          reason: "Approval required",
          scope: "process.execute",
          resolution: {
            decision: "approved",
            resolvedAt: "2026-10-06T00:00:00.010Z",
            resolutionInvocationId: "inv-resumed",
          },
        },
        artifacts: [],
      },
      resumedInvocation: {
        id: "inv-resumed",
        toolId: "terminal",
        status: "completed",
        args: persistentArgs,
        result: {
          command: persistentArgs.command,
          cwd: "/managed/tool-lab/workspace",
          sessionId: "session-1",
          streamMode: "merged",
          sessionMode: "persistent",
          state: "running",
          continuationId: "continuation-1",
          continuationAvailable: true,
          nextOutputOffset: 12,
          outputLimitBytes: 4096,
          commandCompleted: false,
        },
        artifacts: [],
      },
    });

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.tools.some((tool) => tool.id === "terminal")).toBe(true),
    );

    act(() => {
      result.current.selectCase("terminal-persistent-start");
    });
    expect(result.current.selectedTool?.id).toBe("terminal");

    await act(async () => {
      await result.current.runSelectedCase();
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenLastCalledWith(
      {
        toolId: "terminal",
        args: persistentArgs,
        workspaceContext: "tool_lab_managed",
      },
      expect.any(Function),
    );
    expect(result.current.runState.invocation?.status).toBe("awaiting_approval");

    await act(async () => {
      await result.current.resolveApproval("approved");
    });
    expect(result.current.terminalSummary).toMatchObject({
      sessionId: "session-1",
      state: "running",
      nextOutputOffset: 12,
    });
    expect(result.current.terminalContinuation).toEqual({
      continuationId: "continuation-1",
      nextOutputOffset: 12,
      outputLimitBytes: 4096,
    });

    await act(async () => {
      await result.current.runTerminalContinuation();
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenLastCalledWith(
      {
        toolId: "terminal",
        args: {
          continuationId: "continuation-1",
          outputOffset: 12,
          outputLimitBytes: 4096,
        },
        workspaceContext: "tool_lab_managed",
      },
      expect.any(Function),
    );
    expect(
      executeMcpInvocationStreamMock.mock.calls.at(-1)?.[0]?.args,
    ).not.toHaveProperty("command");
    expect(result.current.terminalSummary).toMatchObject({
      sessionId: "session-1",
      state: "running",
      nextOutputOffset: 24,
    });

    await act(async () => {
      await result.current.runTerminalStatus();
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenLastCalledWith(
      {
        toolId: "terminal",
        args: {
          operation: "status",
          sessionId: "session-1",
        },
        workspaceContext: "tool_lab_managed",
      },
      expect.any(Function),
    );
    expect(
      executeMcpInvocationStreamMock.mock.calls.at(-1)?.[0]?.args,
    ).not.toHaveProperty("command");
    expect(result.current.terminalContinuation?.nextOutputOffset).toBe(24);

    await act(async () => {
      await result.current.runTerminalStop();
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenLastCalledWith(
      {
        toolId: "terminal",
        args: {
          operation: "stop",
          sessionId: "session-1",
        },
        workspaceContext: "tool_lab_managed",
      },
      expect.any(Function),
    );
    expect(
      executeMcpInvocationStreamMock.mock.calls.at(-1)?.[0]?.args,
    ).not.toHaveProperty("command");
    expect(result.current.terminalSummary).toMatchObject({
      sessionId: "session-1",
      state: "cancelled",
      cleanupCompleted: true,
    });
    expect(result.current.terminalContinuation).toBeNull();
  });
});
