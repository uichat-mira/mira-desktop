// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMcpRegisteredToolsMock = vi.fn();
const getMcpToolsMock = vi.fn();
const getMcpManagedToolLabWorkspaceSelectionMock = vi.fn();
const getExternalMcpServersMock = vi.fn();
const executeMcpInvocationStreamMock = vi.fn();
const getMcpInvocationMock = vi.fn();
const getMcpInvocationEventsMock = vi.fn();
const getMcpInvocationTraceMock = vi.fn();
const resetMcpToolLabFixtureMock = vi.fn();
const resolveMcpInvocationApprovalMock = vi.fn();

vi.mock("@/shared/api/tools", () => ({
  getMcpRegisteredTools: () => getMcpRegisteredToolsMock(),
  getMcpTools: () => getMcpToolsMock(),
  getMcpManagedToolLabWorkspaceSelection: () =>
    getMcpManagedToolLabWorkspaceSelectionMock(),
  getExternalMcpServers: () => getExternalMcpServersMock(),
  executeMcpInvocationStream: (...args: unknown[]) =>
    executeMcpInvocationStreamMock(...args),
  getMcpInvocation: (...args: unknown[]) => getMcpInvocationMock(...args),
  getMcpInvocationEvents: (...args: unknown[]) =>
    getMcpInvocationEventsMock(...args),
  getMcpInvocationTrace: (...args: unknown[]) =>
    getMcpInvocationTraceMock(...args),
  resetMcpToolLabFixture: (...args: unknown[]) =>
    resetMcpToolLabFixtureMock(...args),
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
  id: "write_file",
  title: "Write File",
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

async function importHook() {
  const { useToolLab } =
    await vi.importActual<typeof import("./useToolLab")>("./useToolLab");
  return useToolLab;
}

describe("useToolLab", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMcpRegisteredToolsMock.mockResolvedValue([readTool, writeTool]);
    getMcpToolsMock.mockResolvedValue([writeTool]);
    getMcpManagedToolLabWorkspaceSelectionMock.mockResolvedValue({
      rootPath: "/workspace",
      source: "selected",
    });
    getExternalMcpServersMock.mockResolvedValue([]);
    resetMcpToolLabFixtureMock.mockResolvedValue({
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

    const useToolLab = await importHook();
    const { result } = renderHook(() => useToolLab());

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
    expect(resetMcpToolLabFixtureMock).toHaveBeenCalledWith(
      "platform-read-success",
    );
    expect(resetMcpToolLabFixtureMock.mock.invocationCallOrder[0]).toBeLessThan(
      executeMcpInvocationStreamMock.mock.invocationCallOrder[0]!,
    );
    expect(getMcpInvocationMock).toHaveBeenCalledWith("inv-1");
    expect(getMcpInvocationTraceMock).toHaveBeenCalledWith("inv-1");
    expect(result.current.runState.invocation?.status).toBe("completed");

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(resetMcpToolLabFixtureMock).toHaveBeenCalledTimes(2);
    expect(executeMcpInvocationStreamMock).toHaveBeenCalledTimes(2);
  });

  it("prevents overlapping case runs before React state updates can disable the controls", async () => {
    let releaseReset: (() => void) | undefined;
    resetMcpToolLabFixtureMock.mockImplementationOnce(
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

    const useToolLab = await importHook();
    const { result } = renderHook(() => useToolLab());

    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("core-read-success"),
    );

    let firstRun!: Promise<void>;
    let secondRun!: Promise<void>;
    act(() => {
      firstRun = result.current.runSelectedCase();
      secondRun = result.current.runSelectedCase();
    });

    expect(resetMcpToolLabFixtureMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseReset?.();
      await Promise.all([firstRun, secondRun]);
    });

    expect(executeMcpInvocationStreamMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when fixture reset fails before invocation", async () => {
    resetMcpToolLabFixtureMock.mockRejectedValueOnce(
      new Error("fixture reset exploded"),
    );

    const useToolLab = await importHook();
    const { result } = renderHook(() => useToolLab());

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
    const useToolLab = await importHook();
    const { result } = renderHook(() => useToolLab());

    await waitFor(() => expect(result.current.selectedTool?.id).toBe("read"));
    expect(result.current.canOpenManual).toBe(false);

    act(() => {
      result.current.selectTool("write_file");
    });

    await waitFor(() => expect(result.current.selectedTool?.id).toBe("write_file"));
    expect(result.current.canOpenManual).toBe(true);
  });

  it("keeps a registered case visible as Unavailable when its native Tool is missing", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([writeTool]);

    const useToolLab = await importHook();
    const { result } = renderHook(() => useToolLab());

    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("core-read-success"),
    );

    expect(result.current.selectedTool?.id).toBe("read");
    expect(result.current.readiness.state).toBe("unavailable");
    expect(result.current.readiness.settingsPath).toBe("/settings/tools");
  });

  it("does not start an invocation when the Workspace prerequisite is unavailable", async () => {
    getMcpManagedToolLabWorkspaceSelectionMock.mockResolvedValueOnce({
      rootPath: null,
      source: "unset",
    });

    const useToolLab = await importHook();
    const { result } = renderHook(() => useToolLab());

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
          toolId: "write_file",
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
      toolId: "write_file",
      status: "awaiting_approval",
      args: {
        path: ".tool-lab-fixtures/platform-approval-boundary/approval-probe.txt",
        content: "tool-lab-approval-probe",
        dryRun: true,
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
      toolId: "write_file",
      startedAt: "2026-10-05T00:00:00.000Z",
      spans: [],
    });

    const useToolLab = await importHook();
    const { result } = renderHook(() => useToolLab());

    await waitFor(() => expect(result.current.tools).toHaveLength(2));

    act(() => {
      result.current.selectTool("write_file");
    });

    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("core-approval-boundary"),
    );

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(executeMcpInvocationStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "write_file",
        args: expect.objectContaining({ dryRun: true }),
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

    expect(result.current.selectedTool?.id).toBe("write_file");
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
        toolId: "write_file",
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
        toolId: "write_file",
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
        toolId: "write_file",
        args: {
          path: ".tool-lab-fixtures/platform-approval-boundary/approval-probe.txt",
          content: "tool-lab-approval-probe",
          dryRun: true,
        },
      },
    );
    expect(result.current.runState.invocation?.approval?.resolution?.decision).toBe(
      "approved",
    );
    expect(result.current.runState.resolutionInvocation?.id).toBe("inv-resumed");
  });
});
