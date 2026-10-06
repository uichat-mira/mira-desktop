import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/request", () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/shared/lib/sessionStorage", () => ({
  getSession: vi.fn(() => ({ token: "token-1", user: { username: "alice" } })),
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  getApiBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

import { get, post, put, patch, del } from "@/shared/lib/request";
import {
  getMcpMarketplaceServers,
  getMcpMarketplaceSyncStatus,
  requestMcpMarketplaceSync,
  getExternalMcpServers,
  createExternalMcpServer,
  connectExternalMcpServer,
  discoverExternalMcpServer,
  deleteExternalMcpServer,
  getExternalMcpServerConfigSchema,
  getExternalMcpServerConfig,
  updateExternalMcpServerConfig,
  getMcpWorkspaceSelection,
  getMcpCapabilityWorkspaceSelection,
  getMcpManagedCapabilityWorkspaceSelection,
  resetMcpCapabilityFixture,
  getMcpWebSearchConfig,
  saveMcpWebSearchConfig,
  selectMcpWorkspaceRoot,
  getMcpTools,
  getMcpRegisteredTools,
  getMcpInvocation,
  getMcpInvocationTrace,
  executeMcpInvocationStream,
  type McpMarketplaceServer,
  type ExternalMcpServerRecord,
  type McpWorkspaceSelection,
  type McpWebSearchConfig,
  type HarnessToolDefinition,
  type ToolInvocation,
  type ToolTrace,
} from "../tools";

const sampleMarketplaceServer: McpMarketplaceServer = {
  id: "srv-1",
  name: "server",
  title: "Server",
  description: "desc",
  version: "1.0.0",
  status: "active",
  isLatest: true,
  publishedAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
  websiteUrl: null,
  repositoryUrl: null,
  transports: [
    {
      kind: "streamable-http",
      packageType: "remote",
      installable: true,
      label: "HTTP",
      url: "https://example.com/sse",
    },
  ],
};

const sampleExternalServer: ExternalMcpServerRecord = {
  id: "ext-1",
  source: "manual",
  displayName: "External",
  transport: { kind: "streamable-http", url: "https://example.com" },
  status: "configured",
  enabled: true,
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
  discoveredTools: [],
};

const sampleWorkspaceSelection: McpWorkspaceSelection = {
  rootPath: "/workspace",
  source: "selected",
};

const sampleWebSearchConfig: McpWebSearchConfig = {
  apiKey: "key",
  baseUrl: "https://search.example.com",
  maxResults: 10,
};

const sampleMcpTool: HarnessToolDefinition = {
  id: "mcp-tool-1",
  title: "Read File",
  description: "read",
  domain: "read",
  source: "internal",
  mode: "sync",
  inputSchema: {},
  outputSchema: {},
  tags: [],
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
  },
};

const sampleTrace: ToolTrace = {
  traceId: "trace-1",
  invocationId: "inv-1",
  toolId: "mcp-tool-1",
  startedAt: "2026-07-06T00:00:00.000Z",
  spans: [],
};

const sampleInvocation: ToolInvocation = {
  id: "inv-1",
  toolId: "mcp-tool-1",
  status: "completed",
  args: {},
  artifacts: [],
  traceId: "trace-1",
  startedAt: "2026-07-06T00:00:00.000Z",
  finishedAt: "2026-07-06T00:00:00.010Z",
};

describe("tools api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("getMcpMarketplaceServers 支持查询参数", async () => {
    vi.mocked(get).mockResolvedValueOnce({
      servers: [sampleMarketplaceServer],
      metadata: { count: 1, nextCursor: null, sourceUrl: "", cache: { hit: false, stale: false, cachedAt: null } },
    });

    const result = await getMcpMarketplaceServers({
      cursor: "c1",
      limit: 10,
      query: "search",
      category: "developer-tools",
      transport: "local",
      installable: true,
    });

    expect(get).toHaveBeenCalledWith(
      "/mcp/marketplace/servers?cursor=c1&limit=10&query=search&category=developer-tools&transport=local&installable=true",
      { signal: undefined, timeout: 300000 },
    );
    expect(result.servers).toEqual([sampleMarketplaceServer]);
  });

  it("reads marketplace sync status and requests an update", async () => {
    const status = {
      sourceUrl: "registry",
      status: "syncing" as const,
      mode: "incremental" as const,
      lastAttemptAt: "2026-07-31T00:00:00.000Z",
      lastSuccessfulSyncAt: null,
      lastFullSyncAt: null,
      updatedCount: 0,
      lastError: null,
      nextAutoSyncAt: null,
    };
    vi.mocked(get).mockResolvedValueOnce(status);
    vi.mocked(post).mockResolvedValueOnce({ started: true, status });

    await expect(getMcpMarketplaceSyncStatus()).resolves.toEqual(status);
    await expect(requestMcpMarketplaceSync()).resolves.toEqual({
      started: true,
      status,
    });
    expect(get).toHaveBeenCalledWith("/mcp/marketplace/sync-status", {
      timeout: 300000,
    });
    expect(post).toHaveBeenCalledWith(
      "/mcp/marketplace/sync",
      undefined,
      { timeout: 300000 },
    );
  });

  it("getExternalMcpServers 返回外部服务器列表", async () => {
    vi.mocked(get).mockResolvedValueOnce([sampleExternalServer]);

    const result = await getExternalMcpServers();

    expect(get).toHaveBeenCalledWith("/mcp/external/servers", {
      timeout: 300000,
    });
    expect(result).toEqual([sampleExternalServer]);
  });

  it("createExternalMcpServer 创建服务器", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleExternalServer);

    const input = {
      displayName: "New",
      transport: { kind: "stdio" as const, command: "node" },
      disclaimerAccepted: false,
    };
    const result = await createExternalMcpServer(input);

    expect(post).toHaveBeenCalledWith("/mcp/external/servers", input, {
      timeout: 300000,
    });
    expect(result).toBe(sampleExternalServer);
  });

  it("connectExternalMcpServer 连接服务器", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleExternalServer);

    const result = await connectExternalMcpServer("ext-1");

    expect(post).toHaveBeenCalledWith(
      "/mcp/external/servers/ext-1/connect",
      undefined,
      { timeout: 300000 },
    );
    expect(result).toBe(sampleExternalServer);
  });

  it("discoverExternalMcpServer 发现工具", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleExternalServer);

    const result = await discoverExternalMcpServer("ext-1");

    expect(post).toHaveBeenCalledWith(
      "/mcp/external/servers/ext-1/discover",
      undefined,
      { timeout: 300000 },
    );
    expect(result).toBe(sampleExternalServer);
  });

  it("deleteExternalMcpServer 删除服务器", async () => {
    vi.mocked(del).mockResolvedValueOnce(sampleExternalServer);

    const result = await deleteExternalMcpServer("ext-1");

    expect(del).toHaveBeenCalledWith("/mcp/external/servers/ext-1", {
      timeout: 300000,
    });
    expect(result).toBe(sampleExternalServer);
  });

  it("getExternalMcpServerConfigSchema 获取配置 schema", async () => {
    vi.mocked(get).mockResolvedValueOnce({
      fields: [],
      completeness: "unknown",
      sources: [],
    });

    const result = await getExternalMcpServerConfigSchema("ext-1");

    expect(get).toHaveBeenCalledWith(
      "/mcp/external/servers/ext-1/config-schema",
      { timeout: 300000 },
    );
    expect(result.fields).toEqual([]);
  });

  it("getExternalMcpServerConfig 获取配置", async () => {
    vi.mocked(get).mockResolvedValueOnce({
      authType: "none",
      timeoutMs: 60000,
      customHeadersJson: "{}",
    });

    const result = await getExternalMcpServerConfig("ext-1");

    expect(get).toHaveBeenCalledWith(
      "/mcp/external/servers/ext-1/config",
      { timeout: 300000 },
    );
    expect(result.authType).toBe("none");
  });

  it("updateExternalMcpServerConfig 更新配置", async () => {
    vi.mocked(patch).mockResolvedValueOnce({
      authType: "bearer",
      timeoutMs: 60000,
      customHeadersJson: "{}",
    });

    const input = { authType: "bearer" as const, timeoutMs: 60000, customHeadersJson: "{}" };
    const result = await updateExternalMcpServerConfig("ext-1", input);

    expect(patch).toHaveBeenCalledWith(
      "/mcp/external/servers/ext-1/config",
      input,
      { timeout: 300000 },
    );
    expect(result.authType).toBe("bearer");
  });

  it("getMcpWorkspaceSelection 获取工作区选择", async () => {
    vi.mocked(get).mockResolvedValueOnce(sampleWorkspaceSelection);

    const result = await getMcpWorkspaceSelection();

    expect(get).toHaveBeenCalledWith("/mcp/workspace");
    expect(result).toBe(sampleWorkspaceSelection);
  });

  it("getMcpCapabilityWorkspaceSelection 获取能力验收有效工作区", async () => {
    vi.mocked(get).mockResolvedValueOnce({
      rootPath: "/managed/tool-lab/workspace",
      source: "managed",
    });

    const result = await getMcpCapabilityWorkspaceSelection();

    expect(get).toHaveBeenCalledWith("/mcp/tool-lab/workspace");
    expect(result).toEqual({
      rootPath: "/managed/tool-lab/workspace",
      source: "managed",
    });
  });

  it("getMcpManagedCapabilityWorkspaceSelection 获取隔离验收工作区", async () => {
    vi.mocked(get).mockResolvedValueOnce({
      rootPath: "/managed/tool-lab/workspace",
      source: "managed",
    });

    const result = await getMcpManagedCapabilityWorkspaceSelection();

    expect(get).toHaveBeenCalledWith("/mcp/tool-lab/workspace/managed");
    expect(result).toEqual({
      rootPath: "/managed/tool-lab/workspace",
      source: "managed",
    });
  });

  it("resetMcpCapabilityFixture 只提交注册 fixture id", async () => {
    const resetResult = {
      fixtureId: "platform-read-success",
      workspace: {
        rootPath: "/managed/tool-lab/workspace",
        source: "managed" as const,
      },
      fixtureRoot:
        "/managed/tool-lab/workspace/.tool-lab-fixtures/platform-read-success",
      resetAt: "2026-10-05T00:00:00.000Z",
    };
    vi.mocked(post).mockResolvedValueOnce(resetResult);

    const result = await resetMcpCapabilityFixture("platform-read-success");

    expect(post).toHaveBeenCalledWith(
      "/mcp/tool-lab/fixtures/platform-read-success/reset",
    );
    expect(result).toEqual(resetResult);
  });

  it("getMcpWebSearchConfig 获取搜索配置", async () => {
    vi.mocked(get).mockResolvedValueOnce(sampleWebSearchConfig);

    const result = await getMcpWebSearchConfig();

    expect(get).toHaveBeenCalledWith("/mcp/web-search/config");
    expect(result).toBe(sampleWebSearchConfig);
  });

  it("saveMcpWebSearchConfig 保存搜索配置", async () => {
    vi.mocked(put).mockResolvedValueOnce(sampleWebSearchConfig);

    const input = { maxResults: 20 };
    const result = await saveMcpWebSearchConfig(input);

    expect(put).toHaveBeenCalledWith("/mcp/web-search/config", input);
    expect(result).toBe(sampleWebSearchConfig);
  });

  it("selectMcpWorkspaceRoot 选择工作区根目录", async () => {
    vi.mocked(post).mockResolvedValueOnce(sampleWorkspaceSelection);

    const result = await selectMcpWorkspaceRoot("/workspace");

    expect(post).toHaveBeenCalledWith("/mcp/workspace/select", {
      rootPath: "/workspace",
    });
    expect(result).toBe(sampleWorkspaceSelection);
  });

  it("getMcpTools 获取 Agent 可见 MCP 工具列表", async () => {
    vi.mocked(get).mockResolvedValueOnce([sampleMcpTool]);

    const result = await getMcpTools();

    expect(get).toHaveBeenCalledWith("/mcp/tools?source=agent_intent");
    expect(result).toEqual([sampleMcpTool]);
  });

  it("getMcpRegisteredTools 获取能力验收使用的已注册内部 Tool", async () => {
    vi.mocked(get).mockResolvedValueOnce([sampleMcpTool]);

    const result = await getMcpRegisteredTools();

    expect(get).toHaveBeenCalledWith("/mcp/tools");
    expect(result).toEqual([sampleMcpTool]);
  });

  it("getMcpInvocation 获取完整调用记录", async () => {
    vi.mocked(get).mockResolvedValueOnce(sampleInvocation);

    const result = await getMcpInvocation("inv-1");

    expect(get).toHaveBeenCalledWith("/mcp/invocations/inv-1");
    expect(result).toBe(sampleInvocation);
  });

  it("getMcpInvocationTrace 获取调用链路", async () => {
    vi.mocked(get).mockResolvedValueOnce(sampleTrace);

    const result = await getMcpInvocationTrace("inv-1");

    expect(get).toHaveBeenCalledWith("/mcp/invocations/inv-1/trace");
    expect(result).toBe(sampleTrace);
  });

  it("executeMcpInvocationStream 处理 SSE 事件流", async () => {
    const encoder = new TextEncoder();
    const event = JSON.stringify({
      type: "invocation:start",
      invocationId: "inv-1",
      toolId: "mcp-tool-1",
      at: "2026-07-06T00:00:00.000Z",
    });
    const doneEvent = JSON.stringify({
      type: "invocation:done",
      invocationId: "inv-1",
    });
    const bytes = encoder.encode(
      `data: ${event}\n\ndata: ${doneEvent}\n\n`,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({ done: false, value: bytes })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      }),
    );

    const events: unknown[] = [];
    await executeMcpInvocationStream(
      { toolId: "mcp-tool-1", workspaceContext: "tool_lab_managed" },
      (event) => {
        events.push(event);
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/mcp/invocations/stream",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          toolId: "mcp-tool-1",
          args: {},
          workspaceContext: "tool_lab_managed",
        }),
      }),
    );
    expect(events).toHaveLength(2);
    expect((events[0] as { type: string }).type).toBe("invocation:start");
    expect((events[1] as { type: string }).type).toBe("invocation:done");
  });
});
