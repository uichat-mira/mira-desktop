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
const createMcpToolLabBrowserRunMock = vi.fn();
const resetMcpToolLabBrowserRunMock = vi.fn();

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
  createMcpToolLabBrowserRun: (...args: unknown[]) =>
    createMcpToolLabBrowserRunMock(...args),
  resetMcpToolLabBrowserRun: (...args: unknown[]) =>
    resetMcpToolLabBrowserRunMock(...args),
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

const managedBrowserWorkbench = {
  groupId: "browser",
  groupLabel: "智控",
  groupDescription: "Playwright / Managed Browser 浏览器自动化工具。",
  groupOrder: 50,
  icon: "mouse-pointer",
};

const browserSnapshotTool = {
  id: "browser_snapshot",
  title: "Browser Snapshot",
  description: "Read a bounded Managed Browser snapshot.",
  domain: "browser_action",
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: ["browser", "snapshot"],
  workbench: managedBrowserWorkbench,
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
    networkAccess: true,
  },
};

const browserClickTool = {
  id: "browser_click",
  title: "Browser Click",
  description: "Click an observed Managed Browser ref.",
  domain: "browser_action",
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: ["browser", "click"],
  workbench: managedBrowserWorkbench,
  capabilities: {
    sideEffect: "network",
    requiresApproval: true,
    networkAccess: true,
  },
};

const browserNavigateTool = {
  id: "browser_navigate",
  title: "Browser Navigate",
  description: "Navigate the Managed Browser.",
  domain: "browser_action",
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: ["browser", "navigate"],
  workbench: managedBrowserWorkbench,
  capabilities: {
    sideEffect: "network",
    requiresApproval: true,
    networkAccess: true,
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
    createMcpToolLabBrowserRunMock.mockResolvedValue({
      handle: "blrun_test",
      expiresAt: "2026-10-21T00:10:00.000Z",
      activeStep: false,
    });
    resetMcpToolLabBrowserRunMock.mockResolvedValue({
      handle: "blrun_test",
      reset: true,
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

  it("uses Server/Harness readiness for a registered native Tool and blocks execution", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([
      {
        ...readTool,
        runtimeReadiness: {
          state: "unavailable",
          reason: "Required native runtime is unavailable.",
          code: "web_search_provider_unavailable",
        },
      },
      writeTool,
    ]);

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("core-read-success"),
    );

    expect(result.current.selectedTool?.id).toBe("read");
    expect(result.current.readiness).toMatchObject({
      state: "unavailable",
      reason: "Required native runtime is unavailable.",
    });

    await act(async () => {
      await result.current.runSelectedCase();
    });
    expect(executeMcpInvocationStreamMock).not.toHaveBeenCalled();
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

  const browserJourneyUrl =
    "https://www.selenium.dev/selenium/web/web-form.html";
  const browserJourneyTargetUrl =
    "https://www.selenium.dev/selenium/web/submitted-form.html?my-text=";

  const readyBrowserTools = [
    {
      ...browserNavigateTool,
      runtimeReadiness: {
        state: "ready",
        reason: "Managed browser runtime prerequisites are satisfied.",
      },
    },
    {
      ...browserSnapshotTool,
      runtimeReadiness: {
        state: "ready",
        reason: "Managed browser runtime prerequisites are satisfied.",
      },
    },
    {
      ...browserClickTool,
      runtimeReadiness: {
        state: "ready",
        reason: "Managed browser runtime prerequisites are satisfied.",
      },
    },
  ];

  const createBrowserResult = (input: {
    url: string;
    title: string;
    snapshotHash: string;
    snapshot?: string;
    assertion?: { kind: string; passed: boolean };
  }) => ({
    ok: true,
    sessionId: "session-1",
    invocationId: "browser-result",
    page: {
      url: input.url,
      title: input.title,
      snapshotHash: input.snapshotHash,
    },
    ...(input.snapshot
      ? { observation: { snapshot: input.snapshot, truncated: false } }
      : {}),
    ...(input.assertion ? { assertion: input.assertion } : {}),
    artifacts: [],
  });

  it("blocks an unavailable Browser journey before creating any run handle", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([
      readTool,
      writeTool,
      {
        ...browserNavigateTool,
        runtimeReadiness: {
          state: "unavailable",
          reason: "No managed Chromium was found.",
          code: "browser_runtime_unavailable",
        },
      },
    ]);

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.tools.some((tool) => tool.id === "browser_navigate")).toBe(
        true,
      ),
    );

    act(() => {
      result.current.selectCase("browser-approval-journey");
    });

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("browser_navigate");
      expect(result.current.selectedCase?.id).toBe("browser-approval-journey");
    });
    expect(result.current.readiness).toMatchObject({
      state: "unavailable",
      reason: "No managed Chromium was found.",
    });

    await act(async () => {
      await result.current.runSelectedCase();
    });
    expect(createMcpToolLabBrowserRunMock).not.toHaveBeenCalled();
    expect(executeMcpInvocationStreamMock).not.toHaveBeenCalled();
  });

  it("runs Navigate → Snapshot → Click → Snapshot → Assert in one Browser run with real approvals", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([
      readTool,
      writeTool,
      ...readyBrowserTools,
    ]);
    let snapshotCount = 0;
    executeMcpInvocationStreamMock.mockImplementation(
      async (
        input: { toolId: string; args: Record<string, unknown> },
        onEvent: (event: unknown) => void,
      ) => {
        const invocationId =
          input.toolId === "browser_navigate"
            ? "inv-navigate-pending"
            : input.toolId === "browser_click"
              ? "inv-click-pending"
              : input.toolId === "browser_snapshot"
                ? snapshotCount++ === 0
                  ? "inv-snapshot"
                  : "inv-observe"
                : "inv-assert";
        onEvent({
          type: "invocation:start",
          invocationId,
          toolId: input.toolId,
          at: "2026-10-21T00:00:00.000Z",
        });
        if (input.toolId === "browser_navigate" || input.toolId === "browser_click") {
          onEvent({
            type: "invocation:approval_required",
            invocationId,
            message: "Approval required",
            scope: "browser.interaction",
            at: "2026-10-21T00:00:00.001Z",
          });
          onEvent({
            type: "invocation:finish",
            invocationId,
            status: "awaiting_approval",
            at: "2026-10-21T00:00:00.002Z",
          });
          return;
        }
        onEvent({
          type: "invocation:finish",
          invocationId,
          status: "completed",
          at: "2026-10-21T00:00:00.002Z",
        });
      },
    );

    const formSnapshot =
      '- heading "Web form" [level=1] [ref=e6]\n- button "Submit" [ref=e40] [cursor=pointer]';
    getMcpInvocationMock.mockImplementation(async (invocationId: string) => {
      if (invocationId === "inv-navigate-pending") {
        return {
          id: invocationId,
          toolId: "browser_navigate",
          status: "awaiting_approval",
          args: { url: browserJourneyUrl },
          approval: { required: true, reason: "Approval required" },
          artifacts: [],
        };
      }
      if (invocationId === "inv-snapshot") {
        return {
          id: invocationId,
          toolId: "browser_snapshot",
          status: "completed",
          args: {},
          result: createBrowserResult({
            url: browserJourneyUrl,
            title: "Web form",
            snapshotHash: "snapshot-hash",
            snapshot: formSnapshot,
          }),
          artifacts: [],
        };
      }
      if (invocationId === "inv-click-pending") {
        return {
          id: invocationId,
          toolId: "browser_click",
          status: "awaiting_approval",
          args: {
            pageUrl: browserJourneyUrl,
            snapshotHash: "snapshot-hash",
            ref: "e40",
          },
          approval: { required: true, reason: "Approval required" },
          artifacts: [],
        };
      }
      if (invocationId === "inv-observe") {
        return {
          id: invocationId,
          toolId: "browser_snapshot",
          status: "completed",
          args: {},
          result: createBrowserResult({
            url: browserJourneyTargetUrl,
            title: "Web form - target page",
            snapshotHash: "target-snapshot-hash",
            snapshot: '- heading "Form submitted" [level=1] [ref=e6]',
          }),
          artifacts: [],
        };
      }
      return {
        id: invocationId,
        toolId: "browser_assert",
        status: "completed",
        args: {},
        result: createBrowserResult({
          url: browserJourneyTargetUrl,
          title: "Web form - target page",
          snapshotHash: "target-snapshot-hash",
          assertion: { kind: "title", passed: true },
        }),
        artifacts: [],
      };
    });

    resolveMcpInvocationApprovalMock.mockImplementation(
      async (invocationId: string) =>
        invocationId === "inv-navigate-pending"
          ? {
              originalInvocation: {
                id: invocationId,
                toolId: "browser_navigate",
                status: "completed",
                args: { url: browserJourneyUrl },
                approval: {
                  required: true,
                  reason: "Approval required",
                  resolution: {
                    decision: "approved",
                    resolvedAt: "2026-10-21T00:00:01.000Z",
                  },
                },
                artifacts: [],
              },
              resumedInvocation: {
                id: "inv-navigate",
                toolId: "browser_navigate",
                status: "completed",
                args: { url: browserJourneyUrl },
                result: createBrowserResult({
                  url: browserJourneyUrl,
                  title: "Web form",
                  snapshotHash: "navigate-hash",
                }),
                artifacts: [],
              },
            }
          : {
              originalInvocation: {
                id: invocationId,
                toolId: "browser_click",
                status: "completed",
                args: {
                  pageUrl: browserJourneyUrl,
                  snapshotHash: "snapshot-hash",
                  ref: "e40",
                },
                approval: {
                  required: true,
                  reason: "Approval required",
                  resolution: {
                    decision: "approved",
                    resolvedAt: "2026-10-21T00:00:02.000Z",
                  },
                },
                artifacts: [],
              },
              resumedInvocation: {
                id: "inv-click",
                toolId: "browser_click",
                status: "completed",
                args: {},
                result: createBrowserResult({
                  url: browserJourneyTargetUrl,
                  title: "Web form - target page",
                  snapshotHash: "click-hash",
                }),
                artifacts: [],
              },
            },
    );

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.tools.some((tool) => tool.id === "browser_navigate")).toBe(
        true,
      ),
    );

    act(() => {
      result.current.selectCase("browser-approval-journey");
    });
    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("browser-approval-journey"),
    );

    await act(async () => {
      await result.current.runSelectedCase();
    });

    expect(createMcpToolLabBrowserRunMock).toHaveBeenCalledOnce();
    expect(executeMcpInvocationStreamMock).toHaveBeenCalledWith(
      {
        toolId: "browser_navigate",
        args: { url: browserJourneyUrl },
        browserRunHandle: "blrun_test",
      },
      expect.any(Function),
    );
    expect(result.current.runState.invocation?.status).toBe("awaiting_approval");
    expect(result.current.browserJourney.status).toBe("awaiting_approval");
    expect(result.current.browserJourney.handle).toBe("blrun_test");
    expect(result.current.browserJourney.steps[0]).toMatchObject({
      id: "navigate",
      status: "awaiting_approval",
      invocationId: "inv-navigate-pending",
    });

    await act(async () => {
      await result.current.resolveApproval("approved");
    });

    expect(result.current.browserJourney.steps[0]).toMatchObject({
      status: "completed",
      approvalDecision: "approved",
      approvalInvocationId: "inv-navigate-pending",
      invocationId: "inv-navigate",
      resultOk: true,
    });
    expect(result.current.browserJourney.steps[1]).toMatchObject({
      status: "completed",
      invocationId: "inv-snapshot",
      page: { snapshotHash: "snapshot-hash" },
      ref: "e40",
    });
    expect(result.current.browserJourney.status).toBe("awaiting_approval");
    expect(result.current.browserJourney.steps[2]).toMatchObject({
      id: "click",
      status: "awaiting_approval",
      invocationId: "inv-click-pending",
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenNthCalledWith(
      3,
      {
        toolId: "browser_click",
        args: {
          pageUrl: browserJourneyUrl,
          snapshotHash: "snapshot-hash",
          ref: "e40",
        },
        browserRunHandle: "blrun_test",
      },
      expect.any(Function),
    );
    expect(
      executeMcpInvocationStreamMock.mock.calls.every(
        (call) => call[0]?.browserRunHandle === "blrun_test",
      ),
    ).toBe(true);

    await act(async () => {
      await result.current.resolveApproval("approved");
    });

    expect(result.current.browserJourney.status).toBe("completed");
    expect(result.current.browserJourney.steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(result.current.browserJourney.steps[3]).toMatchObject({
      id: "observe-after-click",
      invocationId: "inv-observe",
      page: { snapshotHash: "target-snapshot-hash" },
    });
    expect(result.current.browserJourney.steps[4]).toMatchObject({
      id: "assert",
      invocationId: "inv-assert",
      resultOk: true,
      page: { title: "Web form - target page" },
      assertion: { kind: "title", passed: true },
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenNthCalledWith(
      4,
      {
        toolId: "browser_snapshot",
        args: { includeVisibleText: true, maxSnapshotChars: 4000 },
        browserRunHandle: "blrun_test",
      },
      expect.any(Function),
    );
    expect(executeMcpInvocationStreamMock).toHaveBeenNthCalledWith(
      5,
      {
        toolId: "browser_assert",
        args: {
          assertion: { kind: "title", expected: "Web form - target page" },
        },
        browserRunHandle: "blrun_test",
      },
      expect.any(Function),
    );
    expect(resetMcpToolLabBrowserRunMock).toHaveBeenCalledWith("blrun_test");
    expect(result.current.browserJourney.handle).toBeNull();
  });

  it("keeps a rejected Browser navigate step cancelled and never starts Snapshot", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([
      readTool,
      writeTool,
      ...readyBrowserTools,
    ]);
    executeMcpInvocationStreamMock.mockImplementation(
      async (_input: unknown, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "invocation:start",
          invocationId: "inv-navigate-pending",
          toolId: "browser_navigate",
          at: "2026-10-21T00:00:00.000Z",
        });
        onEvent({
          type: "invocation:approval_required",
          invocationId: "inv-navigate-pending",
          message: "Approval required",
          at: "2026-10-21T00:00:00.001Z",
        });
        onEvent({
          type: "invocation:finish",
          invocationId: "inv-navigate-pending",
          status: "awaiting_approval",
          at: "2026-10-21T00:00:00.002Z",
        });
      },
    );
    getMcpInvocationMock.mockResolvedValue({
      id: "inv-navigate-pending",
      toolId: "browser_navigate",
      status: "awaiting_approval",
      args: { url: browserJourneyUrl },
      approval: { required: true, reason: "Approval required" },
      artifacts: [],
    });
    resolveMcpInvocationApprovalMock.mockResolvedValue({
      originalInvocation: {
        id: "inv-navigate-pending",
        toolId: "browser_navigate",
        status: "cancelled",
        args: { url: browserJourneyUrl },
        approval: {
          required: true,
          reason: "Approval required",
          resolution: {
            decision: "rejected",
            resolvedAt: "2026-10-21T00:00:01.000Z",
          },
        },
        error: {
          message: "Invocation approval was rejected.",
          failureCode: "cancelled",
        },
        artifacts: [],
      },
      resumedInvocation: null,
    });

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.tools.some((tool) => tool.id === "browser_navigate")).toBe(
        true,
      ),
    );
    act(() => {
      result.current.selectCase("browser-approval-journey");
    });
    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("browser-approval-journey"),
    );

    await act(async () => {
      await result.current.runSelectedCase();
    });
    expect(result.current.runState.invocation?.status).toBe("awaiting_approval");

    await act(async () => {
      await result.current.resolveApproval("rejected");
    });

    expect(result.current.runState.invocation?.status).toBe("cancelled");
    expect(result.current.runState.resolutionInvocation).toBeNull();
    expect(result.current.browserJourney.status).toBe("rejected");
    expect(result.current.browserJourney.error?.code).toBe("cancelled");
    expect(result.current.browserJourney.steps[0]).toMatchObject({
      status: "rejected",
      approvalDecision: "rejected",
      resultOk: false,
    });
    expect(result.current.browserJourney.steps[1]).toMatchObject({
      id: "snapshot",
      status: "pending",
      invocationId: null,
    });
    expect(executeMcpInvocationStreamMock).toHaveBeenCalledTimes(1);
    expect(resetMcpToolLabBrowserRunMock).toHaveBeenCalledWith("blrun_test");
  });

  it("stops before Click when an approved Navigate returns ok=false", async () => {
    getMcpRegisteredToolsMock.mockResolvedValueOnce([
      readTool,
      writeTool,
      ...readyBrowserTools,
    ]);
    executeMcpInvocationStreamMock.mockImplementation(
      async (_input: unknown, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "invocation:start",
          invocationId: "inv-navigate-pending",
          toolId: "browser_navigate",
          at: "2026-10-21T00:00:00.000Z",
        });
        onEvent({
          type: "invocation:finish",
          invocationId: "inv-navigate-pending",
          status: "awaiting_approval",
          at: "2026-10-21T00:00:00.002Z",
        });
      },
    );
    getMcpInvocationMock.mockResolvedValue({
      id: "inv-navigate-pending",
      toolId: "browser_navigate",
      status: "awaiting_approval",
      args: { url: "https://blocked.example/" },
      approval: { required: true, reason: "Approval required" },
      artifacts: [],
    });
    resolveMcpInvocationApprovalMock.mockResolvedValue({
      originalInvocation: {
        id: "inv-navigate-pending",
        toolId: "browser_navigate",
        status: "failed",
        args: { url: "https://blocked.example/" },
        approval: {
          required: true,
          reason: "Approval required",
          resolution: {
            decision: "approved",
            resolvedAt: "2026-10-21T00:00:01.000Z",
          },
        },
        artifacts: [],
      },
      resumedInvocation: {
        id: "inv-navigate",
        toolId: "browser_navigate",
        status: "failed",
        args: { url: "https://blocked.example/" },
        result: {
          ok: false,
          sessionId: "",
          invocationId: "inv-navigate",
          page: { url: "", title: "" },
          artifacts: [],
          error: {
            code: "navigation_blocked",
            message: "Navigation domain is not allowed: blocked.example",
            retryable: false,
          },
        },
        error: {
          message: "Navigation domain is not allowed: blocked.example",
          failureCode: "navigation_blocked",
        },
        artifacts: [],
      },
    });

    const useCapabilities = await importHook();
    const { result } = renderHook(() => useCapabilities());

    await waitFor(() =>
      expect(result.current.tools.some((tool) => tool.id === "browser_navigate")).toBe(
        true,
      ),
    );
    act(() => {
      result.current.selectCase("browser-approval-journey");
    });
    await waitFor(() =>
      expect(result.current.selectedCase?.id).toBe("browser-approval-journey"),
    );
    await act(async () => {
      await result.current.runSelectedCase();
    });
    await act(async () => {
      await result.current.resolveApproval("approved");
    });

    expect(result.current.browserJourney.status).toBe("failed");
    expect(result.current.browserJourney.steps[0]).toMatchObject({
      status: "failed",
      resultOk: false,
    });
    expect(result.current.browserJourney.steps[1]).toMatchObject({
      id: "snapshot",
      status: "pending",
    });
    expect(
      executeMcpInvocationStreamMock.mock.calls.some(
        (call) => call[0]?.toolId === "browser_click",
      ),
    ).toBe(false);
    expect(resetMcpToolLabBrowserRunMock).toHaveBeenCalledWith("blrun_test");
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
    expect(result.current.terminalSessionId).toBe("session-1");

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

    getMcpInvocationMock.mockRejectedValueOnce(new Error("status read failed"));
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
    expect(result.current.terminalSessionId).toBe("session-1");
    expect(result.current.terminalSummary).toBeNull();
    expect(result.current.runState.transportError).toContain("status read failed");

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
    expect(result.current.terminalSessionId).toBeNull();
  });
});
