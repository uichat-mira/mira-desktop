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
function stableT(key: string) {
  return key;
}

vi.mock("@/shared/api/tools", () => ({
  getMcpTools: () => getMcpToolsMock(),
  getMcpWorkspaceSelection: () => getMcpWorkspaceSelectionMock(),
  getMcpWebSearchConfig: () => getMcpWebSearchConfigMock(),
  saveMcpWebSearchConfig: (...args: unknown[]) => saveMcpWebSearchConfigMock(...args),
  selectMcpWorkspaceRoot: (...args: unknown[]) => selectMcpWorkspaceRootMock(...args),
  executeMcpInvocationStream: (...args: unknown[]) => executeMcpInvocationStreamMock(...args),
  getMcpInvocationTrace: (...args: unknown[]) => getMcpInvocationTraceMock(...args),
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

  it("opens a Tool Lab handoff as an editable copy without changing normal workbench defaults", async () => {
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
        id: "read_open",
        title: "Read Open",
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
    const { result } = renderHook(() =>
      useToolsWorkbench({
        toolId: "read_open",
        args: { path: "README.md" },
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedTool?.id).toBe("read_open");
    });

    expect(result.current.activeGroupId).toBe("read");
    expect(result.current.argsDraft).toBe(
      JSON.stringify({ path: "README.md" }, null, 2),
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
      createTool("read_open", "Read Open", "read", "阅读", 10),
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
    expect(result.current.selectedTool?.id).toBe("read_open");
    expect(result.current.filteredTools.map((tool) => tool.id)).toEqual(["read_open"]);
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
