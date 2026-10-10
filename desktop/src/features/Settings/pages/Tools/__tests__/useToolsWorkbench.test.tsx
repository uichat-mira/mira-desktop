// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMcpToolsMock = vi.fn();
const getMcpWorkspaceSelectionMock = vi.fn();
const getMcpWebSearchConfigMock = vi.fn();
const saveMcpWebSearchConfigMock = vi.fn();
const selectMcpWorkspaceRootMock = vi.fn();
const executeMcpInvocationStreamMock = vi.fn();
const getMcpInvocationTraceMock = vi.fn();
const resolveMcpInvocationApprovalMock = vi.fn();
const resetMcpCapabilityFixtureMock = vi.fn();
function stableT(key: string) {
  return key;
}

vi.mock("@/shared/api/tools", () => ({
  getMcpTools: () => getMcpToolsMock(),
  getMcpRegisteredTools: () => getMcpToolsMock(),
  getMcpWorkspaceSelection: () => getMcpWorkspaceSelectionMock(),
  getMcpWebSearchConfig: () => getMcpWebSearchConfigMock(),
  saveMcpWebSearchConfig: (...args: unknown[]) => saveMcpWebSearchConfigMock(...args),
  selectMcpWorkspaceRoot: (...args: unknown[]) => selectMcpWorkspaceRootMock(...args),
  executeMcpInvocationStream: (...args: unknown[]) => executeMcpInvocationStreamMock(...args),
  getMcpInvocationTrace: (...args: unknown[]) => getMcpInvocationTraceMock(...args),
  resolveMcpInvocationApproval: (...args: unknown[]) =>
    resolveMcpInvocationApprovalMock(...args),
  resetMcpCapabilityFixture: (...args: unknown[]) =>
    resetMcpCapabilityFixtureMock(...args),
}));

vi.mock("@/shared/ui/Message", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}));

async function importHook() {
  const { useToolsWorkbench } = await import("../hooks/useToolsWorkbench");
  return useToolsWorkbench;
}

describe("useToolsWorkbench", () => {
  beforeEach(() => {
    getMcpToolsMock.mockReset();
    getMcpWorkspaceSelectionMock.mockReset();
    getMcpWebSearchConfigMock.mockReset();
    saveMcpWebSearchConfigMock.mockReset();
    selectMcpWorkspaceRootMock.mockReset();
    executeMcpInvocationStreamMock.mockReset();
    getMcpInvocationTraceMock.mockReset();
    resolveMcpInvocationApprovalMock.mockReset();
    resetMcpCapabilityFixtureMock.mockReset();

    getMcpToolsMock.mockResolvedValue([
      {
        id: "web_search",
        title: "Web Search",
        description: "",
        domain: "web_search",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: [],
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
          networkAccess: true,
        },
        workbench: {
          groupId: "web_search",
          groupLabel: "网络搜索",
          groupDescription: "网络搜索工具。",
          groupOrder: 30,
          icon: "globe",
        },
      },
    ]);
    getMcpWorkspaceSelectionMock.mockResolvedValue({
      rootPath: "D:/workspace/rag-demo",
      source: "selected",
    });
    getMcpWebSearchConfigMock.mockResolvedValue({
      apiKey: "saved-key",
      baseUrl: "http://localhost:8080",
      maxResults: 4,
    });
    saveMcpWebSearchConfigMock.mockImplementation(async (payload: unknown) => payload);
    getMcpInvocationTraceMock.mockResolvedValue({
      traceId: "trace-1",
      invocationId: "inv-1",
      toolId: "web_search",
      startedAt: "2026-01-01T00:00:00.000Z",
      spans: [],
    });
    executeMcpInvocationStreamMock.mockImplementation(async () => {});
    resetMcpCapabilityFixtureMock.mockResolvedValue({
      fixtureId: "file-mutation",
      workspace: "tool_lab_managed",
      fixtureRoot: ".tool-lab-fixtures/file-mutation",
      resetAt: "2026-10-06T00:00:00.000Z",
    });
  });

  it("persists web search settings while keeping provider config out of runtime tool args", async () => {
    const useToolsWorkbench = await importHook();
    const { result } = renderHook(() => useToolsWorkbench());

    await waitFor(() => {
      expect(result.current.tools).toHaveLength(1);
    }, { timeout: 3000 });

    expect(result.current.webSearchConfig).toEqual({
      apiKey: "saved-key",
      baseUrl: "http://localhost:8080",
      maxResults: 4,
    });

    await act(async () => {
      await result.current.saveWebSearchConfig();
    });

    expect(saveMcpWebSearchConfigMock).toHaveBeenCalledWith({
      apiKey: "saved-key",
      baseUrl: "http://localhost:8080",
      maxResults: 4,
    });

    act(() => {
      result.current.setArgsDraft(JSON.stringify({ query: "codex" }));
    });

    await act(async () => {
      await result.current.runSelectedTool();
    });

    expect(executeMcpInvocationStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "web_search",
        args: {
          query: "codex",
          maxResults: 4,
        },
      }),
      expect.any(Function),
    );
  });

  it("runs the terminal persistent acceptance flow through approval and continuation", async () => {
    const persistentArgs = {
      command:
        "node -e \"let i=0; setInterval(()=>console.log('MIRA_TICK:'+ ++i),250)\"",
      sessionMode: "persistent",
      timeoutMs: 700,
      outputLimitBytes: 4096,
    };
    getMcpToolsMock.mockResolvedValueOnce([
      {
        id: "terminal",
        title: "Terminal",
        description: "",
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
              args: persistentArgs,
            },
          ],
        },
      },
    ]);

    executeMcpInvocationStreamMock.mockImplementation(
      async (
        input: { toolId: string; args: Record<string, unknown> },
        onEvent: (event: Record<string, unknown>) => Promise<void>,
      ) => {
        if (input.args.operation === "status") {
          await onEvent({
            type: "invocation:start",
            invocationId: "inv-status",
            toolId: "terminal",
            at: "2026-10-06T00:00:02.500Z",
          });
          await onEvent({
            type: "invocation:result",
            invocationId: "inv-status",
            result: {
              command: persistentArgs.command,
              cwd: "D:/workspace/rag-demo",
              sessionId: "session-1",
              streamMode: "merged",
              sessionMode: "persistent",
              state: "running",
              continuationId: "continuation-1",
              continuationAvailable: true,
              outputBytesAvailable: 24,
              commandCompleted: false,
            },
            at: "2026-10-06T00:00:02.750Z",
          });
          await onEvent({
            type: "invocation:finish",
            invocationId: "inv-status",
            status: "completed",
            at: "2026-10-06T00:00:02.900Z",
          });
          return;
        }

        if ("continuationId" in input.args) {
          await onEvent({
            type: "invocation:start",
            invocationId: "inv-continue",
            toolId: "terminal",
            at: "2026-10-06T00:00:03.000Z",
          });
          await onEvent({
            type: "invocation:result",
            invocationId: "inv-continue",
            result: {
              command: persistentArgs.command,
              cwd: "D:/workspace/rag-demo",
              sessionId: "session-1",
              streamMode: "merged",
              sessionMode: "persistent",
              state: "running",
              continuationId: "continuation-1",
              continuationAvailable: true,
              nextOutputOffset: 24,
              outputLimitBytes: 4096,
              commandCompleted: false,
            },
            at: "2026-10-06T00:00:04.000Z",
          });
          await onEvent({
            type: "invocation:finish",
            invocationId: "inv-continue",
            status: "completed",
            at: "2026-10-06T00:00:05.000Z",
          });
          return;
        }

        await onEvent({
          type: "invocation:start",
          invocationId: "inv-start",
          toolId: "terminal",
          at: "2026-10-06T00:00:00.000Z",
        });
        await onEvent({
          type: "invocation:approval_required",
          invocationId: "inv-start",
          message: "approval required",
          at: "2026-10-06T00:00:01.000Z",
        });
        await onEvent({
          type: "invocation:finish",
          invocationId: "inv-start",
          status: "awaiting_approval",
          at: "2026-10-06T00:00:02.000Z",
        });
      },
    );

    resolveMcpInvocationApprovalMock.mockResolvedValue({
      originalInvocation: {
        id: "inv-start",
        toolId: "terminal",
        status: "awaiting_approval",
        args: persistentArgs,
        artifacts: [],
      },
      resumedInvocation: {
        id: "inv-resumed",
        toolId: "terminal",
        status: "completed",
        args: persistentArgs,
        artifacts: [],
        result: {
          command: persistentArgs.command,
          cwd: "D:/workspace/rag-demo",
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
      },
    });
    getMcpInvocationTraceMock.mockResolvedValue({
      traceId: "trace-terminal",
      invocationId: "inv-resumed",
      toolId: "terminal",
      startedAt: "2026-10-06T00:00:00.000Z",
      spans: [],
    });

    const useToolsWorkbench = await importHook();
    const { result } = renderHook(() => useToolsWorkbench());

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("terminal");
    });

    act(() => {
      result.current.selectCase(persistentArgs);
    });
    expect(result.current.argsDraft).toBe(JSON.stringify(persistentArgs, null, 2));

    await act(async () => {
      await result.current.runSelectedTool();
    });
    expect(result.current.runStatus).toBe("awaiting_approval");
    expect(result.current.pendingApproval).toMatchObject({
      invocationId: "inv-start",
      toolId: "terminal",
      args: persistentArgs,
    });

    await act(async () => {
      await result.current.resolvePendingApproval("approved");
    });
    expect(resolveMcpInvocationApprovalMock).toHaveBeenCalledWith(
      "inv-start",
      {
        decision: "approved",
        toolId: "terminal",
        args: persistentArgs,
      },
    );
    expect(result.current.terminalSummary).toMatchObject({
      sessionId: "session-1",
      state: "running",
      continuationId: "continuation-1",
      nextOutputOffset: 12,
    });

    await act(async () => {
      await result.current.runTerminalStatus();
    });
    expect(result.current.terminalSummary).toMatchObject({
      state: "running",
      continuationId: "continuation-1",
      outputBytesAvailable: 24,
    });
    expect(result.current.terminalSummary?.nextOutputOffset).toBeUndefined();

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
      },
      expect.any(Function),
    );
    expect(result.current.terminalSummary).toMatchObject({
      state: "running",
      nextOutputOffset: 24,
    });
  });

  it("arms an apply_patch acceptance case, resets its fixture, and runs in the managed workspace", async () => {
    const patchText = [
      "*** Begin Patch",
      "*** Update File: .tool-lab-fixtures/file-mutation/overwrite.txt",
      "@@",
      "-before overwrite",
      "+after overwrite",
      "*** End Patch",
      "",
    ].join("\n");
    getMcpToolsMock.mockResolvedValueOnce([
      {
        id: "apply_patch",
        title: "Apply Patch",
        description: "",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
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
      },
    ]);
    getMcpWorkspaceSelectionMock.mockResolvedValueOnce({
      rootPath: null,
      source: "unset",
    });
    executeMcpInvocationStreamMock.mockImplementation(
      async (
        _input: unknown,
        onEvent: (event: Record<string, unknown>) => Promise<void>,
      ) => {
        await onEvent({
          type: "invocation:start",
          invocationId: "inv-patch",
          toolId: "apply_patch",
          at: "2026-10-06T00:00:00.000Z",
        });
        await onEvent({
          type: "invocation:finish",
          invocationId: "inv-patch",
          status: "completed",
          at: "2026-10-06T00:00:01.000Z",
        });
      },
    );

    const useToolsWorkbench = await importHook();
    const { result } = renderHook(() => useToolsWorkbench());

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("apply_patch");
    });

    const acceptanceCase = result.current.selectedTool?.workbench.cases?.[0];
    expect(acceptanceCase?.fixture).toBe("file-mutation");

    act(() => {
      result.current.selectCase(acceptanceCase!.args, {
        id: acceptanceCase!.id,
        fixture: acceptanceCase!.fixture,
      });
    });

    expect(result.current.activeCase).toEqual({
      id: "apply-patch-update",
      fixture: "file-mutation",
    });
    expect(result.current.argsDraft).toBe(
      JSON.stringify({ patchText }, null, 2),
    );
    expect(result.current.argsDraft).toContain("*** Begin Patch");
    expect(result.current.argsDraft).toContain("*** Update File:");

    await act(async () => {
      await result.current.runSelectedTool();
    });

    expect(resetMcpCapabilityFixtureMock).toHaveBeenCalledWith("file-mutation");
    expect(executeMcpInvocationStreamMock).toHaveBeenCalledWith(
      {
        toolId: "apply_patch",
        args: { patchText },
        workspaceContext: "tool_lab_managed",
      },
      expect.any(Function),
    );
  });

  it("does not require workspace when running web_search", async () => {
    getMcpWorkspaceSelectionMock.mockResolvedValueOnce({
      rootPath: null,
      source: "unset",
    });

    const useToolsWorkbench = await importHook();
    const { result } = renderHook(() => useToolsWorkbench());

    await waitFor(() => {
      expect(result.current.tools).toHaveLength(1);
    }, { timeout: 3000 });

    expect(result.current.requiresWorkspace).toBe(false);
    act(() => {
      result.current.selectTool(result.current.tools[0]!);
    });
    await act(async () => {
      await result.current.runSelectedTool();
    });

    expect(executeMcpInvocationStreamMock).toHaveBeenCalled();
    expect(executeMcpInvocationStreamMock.mock.calls[0]?.[0]).toMatchObject({
      toolId: "web_search",
    });
  });

  it("opens a Capability handoff as an editable copy without changing normal workbench defaults", async () => {
    getMcpToolsMock.mockResolvedValueOnce([
      {
        id: "web_search",
        title: "Web Search",
        description: "",
        domain: "web_search",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: [],
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
          networkAccess: true,
        },
        workbench: {
          groupId: "web_search",
          groupLabel: "网络搜索",
          groupDescription: "网络搜索工具。",
          groupOrder: 30,
          icon: "globe",
        },
      },
      {
        id: "read",
        title: "Read",
        description: "",
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
        workbench: {
          groupId: "read",
          groupLabel: "阅读",
          groupDescription: "读取工具。",
          groupOrder: 10,
          icon: "file-search",
        },
      },
    ]);

    const useToolsWorkbench = await importHook();
    const handoff = {
      toolId: "read",
      args: { path: "README.md" },
    };
    const { result } = renderHook(() =>
      useToolsWorkbench(handoff),
    );

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("read");
    });

    expect(result.current.activeGroupId).toBe("read");
    expect(result.current.argsDraft).toBe(
      JSON.stringify({ path: "README.md" }, null, 2),
    );
  });

  it("applies a new Capability handoff when the mounted route receives new navigation state", async () => {
    const createTool = (
      id: string,
      title: string,
      groupId: string,
      workspaceBound = false,
    ) => ({
      id,
      title,
      description: "",
      domain: groupId,
      source: "internal",
      mode: "sync",
      inputSchema: { type: "object" },
      tags: [],
      capabilities: {
        sideEffect: "none",
        requiresApproval: false,
        ...(workspaceBound ? { workspaceBound: true } : {}),
      },
      workbench: {
        groupId,
        groupLabel: title,
        groupDescription: title,
        groupOrder: groupId === "read" ? 10 : 30,
        icon: "wrench",
      },
    });
    getMcpToolsMock.mockResolvedValue([
      createTool("web_search", "Web Search", "web_search"),
      createTool("read", "Read", "read", true),
    ]);

    const useToolsWorkbench = await importHook();
    const { result, rerender } = renderHook(
      ({ handoff, handoffKey }: {
        handoff: { toolId: string; args: Record<string, unknown> } | null;
        handoffKey: string;
      }) => useToolsWorkbench(handoff, handoffKey),
      { initialProps: { handoff: null, handoffKey: "first" } },
    );

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("read");
    });

    rerender({
      handoff: { toolId: "web_search", args: { queries: ["capabilities"] } },
      handoffKey: "second",
    });

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("web_search");
    });
    expect(result.current.activeGroupId).toBe("web_search");
    expect(result.current.argsDraft).toBe(
      JSON.stringify({ queries: ["capabilities"] }, null, 2),
    );
  });

  it("selects the first displayed group instead of the alphabetically first tool", async () => {
    const createTool = (
      id: string,
      title: string,
      groupId: string,
      groupLabel: string,
      groupOrder: number,
    ) => ({
      id,
      title,
      description: "",
      domain: groupId,
      source: "internal",
      mode: "sync",
      inputSchema: {},
      tags: [],
      capabilities: {
        sideEffect: "none",
        requiresApproval: false,
      },
      workbench: {
        groupId,
        groupLabel,
        groupDescription: groupLabel,
        groupOrder,
        icon: "wrench",
      },
    });
    getMcpToolsMock.mockResolvedValueOnce([
      createTool("ask_external_expert", "Ask External Expert", "external_expert", "问策", 70),
      createTool("read", "Read", "read", "阅读", 10),
    ]);

    const useToolsWorkbench = await importHook();
    const { result } = renderHook(() => useToolsWorkbench());

    await waitFor(() => {
      expect(result.current.tools).toHaveLength(2);
    }, { timeout: 3000 });

    expect(result.current.groupSummaries.map((group) => group.id)).toEqual([
      "read",
      "external_expert",
    ]);
    expect(result.current.activeGroupId).toBe("read");
    expect(result.current.selectedTool?.id).toBe("read");
    expect(result.current.filteredTools.map((tool) => tool.id)).toEqual(["read"]);
  });

  it("groups and filters tools by capability ownership instead of runtime domain", async () => {
    const createBrowserTool = (
      id: string,
      groupId: string,
      groupLabel: string,
      groupOrder: number,
    ) => ({
      id,
      title: id,
      description: "",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {},
      tags: [],
      capabilities: {
        sideEffect: "none",
        requiresApproval: false,
      },
      workbench: {
        groupId,
        groupLabel,
        groupDescription: groupLabel,
        groupOrder,
        icon: "mouse-pointer",
      },
    });
    getMcpToolsMock.mockResolvedValueOnce([
      createBrowserTool("browser_observe", "browser_computer_use", "智控", 50),
      createBrowserTool("browser_act", "browser_computer_use", "智控", 50),
      createBrowserTool("browser_assert", "browser_computer_use", "智控", 50),
      createBrowserTool("browser_attached_look", "browser_attached", "触界", 60),
      createBrowserTool("browser_attached_browse", "browser_attached", "触界", 60),
      createBrowserTool("browser_attached_act", "browser_attached", "触界", 60),
      createBrowserTool("browser_attached_transfer", "browser_attached", "触界", 60),
    ]);

    const useToolsWorkbench = await importHook();
    const { result } = renderHook(() => useToolsWorkbench());

    await waitFor(() => {
      expect(result.current.tools).toHaveLength(7);
    }, { timeout: 3000 });

    expect(result.current.groupSummaries).toEqual([
      expect.objectContaining({ id: "browser_computer_use", label: "智控", count: 3 }),
      expect.objectContaining({ id: "browser_attached", label: "触界", count: 4 }),
    ]);
    expect(result.current.filteredTools.map((tool) => tool.id).sort()).toEqual([
      "browser_act",
      "browser_assert",
      "browser_observe",
    ]);

    act(() => {
      result.current.selectGroup("browser_attached");
    });

    expect(result.current.activeGroupId).toBe("browser_attached");
    expect(result.current.filteredTools.map((tool) => tool.id).sort()).toEqual([
      "browser_attached_act",
      "browser_attached_browse",
      "browser_attached_look",
      "browser_attached_transfer",
    ]);
  });
});
