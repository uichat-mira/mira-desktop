import { beforeEach, describe, expect, it, vi } from "vitest";
import * as embedding from "@/services/internal-capabilities/local-embedding.js";
import * as rerank from "@/services/internal-capabilities/local-rerank.js";
import { clearHarnessRegistry, registerTool } from "./registry.js";
import { resolveHarnessCapabilityDiagnostics } from "./capability-diagnostics.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { listTool } from "../mcp/tools/list.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";
import { terminalTool } from "../mcp/tools/terminal-session.tool.js";
import { resolveAgentEligibleExternalMcpCapabilities } from "@/mcp/external";

vi.mock("@/mcp/external", () => ({
  resolveAgentEligibleExternalMcpCapabilities: vi.fn(() => []),
}));

const externalFakeTool = {
  definition: {
    id: "external_fake_tool",
    title: "External Fake Tool",
    description: "Use an external MCP system.",
    domain: "external_mcp" as const,
    source: "external" as const,
    mode: "sync" as const,
    inputSchema: {},
    tags: ["external", "system", "use"],
    capabilities: {
      sideEffect: "network" as const,
      requiresApproval: false,
    },
  },
  execute() {
    return {};
  },
};

const mockRecallOrder = (preferredCapabilityIds: string[] = []) => {
  vi.spyOn(embedding, "executeLocalEmbedding").mockRejectedValue(
    new Error("LOCAL_MODEL_RAW_ROOT is not set."),
  );
  vi.spyOn(rerank, "executeLocalRerank").mockImplementation(
    async ({ candidates }) => {
      const scored = candidates
        .map((candidate) => {
          const orderIndex = preferredCapabilityIds.indexOf(candidate.id);
          return {
            id: candidate.id,
            text: candidate.text,
            score: orderIndex === -1 ? 0.1 : 1 - orderIndex * 0.1,
            probability:
              orderIndex === -1 ? 0.1 : 0.95 - orderIndex * 0.1,
            rank:
              orderIndex === -1
                ? preferredCapabilityIds.length + 1
                : orderIndex + 1,
          };
        })
        .sort((left, right) => right.probability - left.probability);

      return {
        rerankedCandidates: scored,
        rerankModel: "test-rerank",
        rerankModelConfigId: "test-rerank-config",
      };
    },
  );
};

describe("resolveHarnessCapabilityDiagnostics", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    vi.restoreAllMocks();
  });

  it("returns grouped tool diagnostics without selecting tools", async () => {
    registerTool(listTool);
    registerTool({
      definition: {
        id: "read",
        title: "Read",
        description: "open workspace files",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["workspace", "open"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute() {
        return {};
      },
    });

    vi.spyOn(embedding, "executeLocalEmbedding").mockResolvedValue({
      embeddingModel: "Xenova/multilingual-e5-small",
      embeddingModelConfigId: "local:multilingual-e5-small",
      embeddings: [
        [1, 0, 0],
        [0.95, 0.05, 0],
      ],
    });
    vi.spyOn(rerank, "executeLocalRerank").mockResolvedValue({
      rerankedCandidates: [
        {
          id: "workspace_lookup",
          text: "Workspace Lookup",
          score: 1.2,
          probability: 0.73,
          rank: 1,
        },
      ],
      rerankModel: "Xenova/ms-marco-MiniLM-L-6-v2",
      rerankModelConfigId: "local:ms-marco-MiniLM-L-6-v2",
    });

    const result = await resolveHarnessCapabilityDiagnostics({
      query: "帮我找一下文件",
      source: "agent_intent",
    });

    expect(result).not.toHaveProperty("selectedToolIds");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolId: "list" }),
        expect.objectContaining({ toolId: "read" }),
      ]),
    );
    expect(result.toolCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolId: "list" }),
        expect.objectContaining({ toolId: "read" }),
      ]),
    );
    expect(result.retrievalModel).toBeUndefined();
    expect(result.rerankModel).toBeUndefined();
  });

  it("keeps eligible workspace candidates when local embedding is unavailable", async () => {
    registerTool(readTool);
    registerTool(listTool);

    vi.spyOn(embedding, "executeLocalEmbedding").mockRejectedValue(
      new Error("LOCAL_MODEL_RAW_ROOT is not set."),
    );
    const rerankSpy = vi
      .spyOn(rerank, "executeLocalRerank")
      .mockResolvedValue({
        rerankedCandidates: [],
        rerankModel: "test-rerank",
        rerankModelConfigId: "test-rerank-config",
      });

    const result = await resolveHarnessCapabilityDiagnostics({
      query: "帮我看看文件夹下有啥",
      source: "agent_intent",
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.toolExposure.exposedToolIds).toEqual([
      "read",
      "list",
    ]);
    expect(result.retrievalError).toBeUndefined();
    expect(result.exposureReasons).toContain(
      "All public tools are exposed because the tool set is at most 20 tools.",
    );
    expect(rerankSpy).not.toHaveBeenCalled();
  });

  it("returns action profile metadata for terminal capability diagnostics", async () => {
    registerTool(terminalTool);

    vi.spyOn(embedding, "executeLocalEmbedding").mockResolvedValue({
      embeddingModel: "test",
      embeddingModelConfigId: "test-config",
      embeddings: [
        [1, 0, 0],
        [0.9, 0.1, 0],
      ],
    });
    vi.spyOn(rerank, "executeLocalRerank").mockResolvedValue({
      rerankedCandidates: [
        {
          id: "terminal_execution",
          text: "Terminal Execution",
          score: 1,
          probability: 0.8,
          rank: 1,
        },
      ],
      rerankModel: "test-rerank",
      rerankModelConfigId: "test-rerank-config",
    });

    const result = await resolveHarnessCapabilityDiagnostics({
      query: "run pnpm check",
      source: "agent_intent",
      sandboxProfiles: { command: false },
    });

    expect(result.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "terminal_execution",
          actionProfileId: "terminal_execute_command",
          preferredToolId: "terminal",
        }),
      ]),
    );
    expect(result.candidates[0]).toMatchObject({
      toolId: "terminal",
      actionProfileId: "terminal_execute_command",
    });
    expect(result.toolExposure.exposedToolIds).toContain("terminal");
  });

  it("keeps exposure reasons and candidate facts for workspace diagnostics", async () => {
    registerTool(readTool);
    registerTool(webSearchTool);

    vi.spyOn(embedding, "executeLocalEmbedding").mockResolvedValue({
      embeddingModel: "test",
      embeddingModelConfigId: "test-config",
      embeddings: [
        [1, 0],
        [1, 0],
      ],
    });
    vi.spyOn(rerank, "executeLocalRerank").mockResolvedValue({
      rerankedCandidates: [
        {
          id: "workspace_lookup",
          text: "Workspace Lookup",
          score: 1,
          probability: 0.88,
          rank: 1,
        },
      ],
      rerankModel: "test-rerank",
      rerankModelConfigId: "test-rerank-config",
    });

    const result = await resolveHarnessCapabilityDiagnostics({
      query: "请打开 README.md 看看 Runtime 部分",
      source: "agent_intent",
    });

    expect(result.toolExposure.exposedToolIds).toEqual([
      "read",
      "web_search",
    ]);
    expect(result.blockedCapabilityIds).not.toContain("web_search");
    expect(result.exposureReasons).toContain(
      "All public tools are exposed because the tool set is at most 20 tools.",
    );
    expect(result.toolCandidates[0]).toMatchObject({ toolId: "read" });
  });

  it.each([
    {
      label: "workspace-local README query keeps all eligible tools visible",
      query: "请打开 README.md 看看 Runtime 部分",
      source: "agent_intent" as const,
      tools: [readTool, webSearchTool, externalFakeTool],
      rerankOrder: ["read"],
      expectedExposedToolIds: ["read", "web_search"],
      expectedBlockedCapabilityIds: ["external_fake_tool"],
      expectedReason:
      "All public tools are exposed because the tool set is at most 20 tools.",
      expectedTopToolId: "read",
    },
    {
      label: "chat surface keeps safe built-in domains only",
      query: "今天最新新闻是什么",
      source: "chat_surface" as const,
      tools: [readTool, webSearchTool, terminalTool, externalFakeTool],
      rerankOrder: ["web", "read"],
      expectedExposedToolIds: ["read", "web_search", "terminal"],
      expectedBlockedCapabilityIds: ["external_fake_tool"],
      expectedReason:
        "All public tools are exposed because the tool set is at most 20 tools.",
      expectedTopToolId: "read",
    },
    {
      label: "non-command turn keeps terminal visible in diagnostics",
      query: "帮我总结 README.md",
      source: "agent_intent" as const,
      tools: [terminalTool, externalFakeTool],
      rerankOrder: [],
      expectedExposedToolIds: ["terminal"],
      expectedBlockedCapabilityIds: ["external_fake_tool"],
      expectedReason:
        "All public tools are exposed because the tool set is at most 20 tools.",
      expectedTopToolId: "terminal",
    },
    {
      label: "allowExternal propagates to diagnostics",
      query: "use external system",
      source: "agent_intent" as const,
      tools: [externalFakeTool],
      allowExternal: true,
      allowedExternalToolIds: ["external_fake_tool"],
      rerankOrder: ["external_fake_tool"],
      expectedExposedToolIds: ["external_fake_tool"],
      expectedBlockedCapabilityIds: [],
      expectedReason: undefined,
      expectedTopToolId: "external_fake_tool",
    },
    {
      label: "sandbox-unavailable profile does not block host terminal",
      query: "run pnpm check",
      source: "agent_intent" as const,
      tools: [terminalTool, externalFakeTool],
      sandboxProfiles: { command: false },
      rerankOrder: ["terminal_execution"],
      expectedExposedToolIds: ["terminal"],
      expectedBlockedCapabilityIds: ["external_fake_tool"],
      expectedReason:
        "All public tools are exposed because the tool set is at most 20 tools.",
      expectedTopToolId: "terminal",
    },
  ])(
    "mirrors the exposure regression pack in diagnostics: $label",
    async ({
      query,
      source,
      tools,
      allowExternal,
      allowedExternalToolIds,
      sandboxProfiles,
      rerankOrder,
      expectedExposedToolIds,
      expectedBlockedCapabilityIds,
      expectedReason,
      expectedTopToolId,
    }) => {
      for (const tool of tools) {
        registerTool(tool);
      }
      mockRecallOrder(rerankOrder);

      const result = await resolveHarnessCapabilityDiagnostics({
        query,
        source,
        allowExternal,
        allowedExternalToolIds,
        sandboxProfiles,
      });

      expect(result.toolExposure.exposedToolIds).toEqual(
        expectedExposedToolIds,
      );
      expect(result.blockedCapabilityIds).toEqual(
        expect.arrayContaining(expectedBlockedCapabilityIds),
      );
      if (expectedReason) {
        expect(result.exposureReasons).toContain(expectedReason);
      }
      expect(result.toolCandidates[0]?.toolId).toBe(expectedTopToolId);
      expect(
        result.toolCandidates.every(
          (candidate) => !("preferredForQuery" in candidate),
        ),
      ).toBe(true);
    },
  );

  it("reports eligible, blocked, exposed, and candidate external states without secrets", async () => {
    const eligibleTools = Array.from({ length: 21 }, (_, index) => ({
      definition: {
        id: `mcp:diagnostics-server:tool:search_${index}`,
        title: `Documentation search ${index}`,
        description: "Search product documentation.",
        domain: "external_mcp" as const,
        source: "external" as const,
        sourceLabel: "Diagnostics Server",
        mode: "sync" as const,
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
        tags: ["docs", "search"],
        capabilities: {
          sideEffect: "network" as const,
          requiresApproval: true,
        },
      },
      execute() {
        return {};
      },
    }));
    const blockedTool = {
      definition: {
        id: "mcp:blocked-server:tool:restricted_lookup",
        title: "Blocked lookup",
        description: "Should remain outside the eligible allowlist.",
        domain: "external_mcp" as const,
        source: "external" as const,
        mode: "sync" as const,
        inputSchema: { type: "object" },
        tags: ["blocked"],
        capabilities: {
          sideEffect: "network" as const,
          requiresApproval: true,
        },
      },
      execute() {
        return {};
      },
    };
    [...eligibleTools, blockedTool].forEach(registerTool);
    vi.mocked(resolveAgentEligibleExternalMcpCapabilities).mockReturnValue(
      eligibleTools.map((tool) => tool.definition),
    );
    vi.spyOn(embedding, "executeLocalEmbedding").mockResolvedValue({
      embeddingModel: "test-embedding",
      embeddingModelConfigId: "test-embedding-config",
      embeddings: Array.from({ length: eligibleTools.length + 2 }, () => [1, 0]),
    });
    vi.spyOn(rerank, "executeLocalRerank").mockResolvedValue({
      rerankedCandidates: [
        {
          id: eligibleTools[0]!.definition.id,
          text: eligibleTools[0]!.definition.title,
          score: 1,
          probability: 0.99,
          rank: 1,
        },
      ],
      rerankModel: "test-rerank",
      rerankModelConfigId: "test-rerank-config",
    });

    const allowedExternalToolIds = eligibleTools.map(
      (tool) => tool.definition.id,
    );
    const result = await resolveHarnessCapabilityDiagnostics({
      query: "search product documentation",
      source: "agent_intent",
      allowExternal: true,
      allowedExternalToolIds,
      topK: 1,
    });

    expect(result.eligibleExternalCapabilityIds).toEqual(
      allowedExternalToolIds,
    );
    expect(
      result.externalExposure.find((item) => item.status === "candidate")?.id,
    ).toBe(eligibleTools[0]!.definition.id);
    expect(
      result.externalExposure.some((item) => item.status === "exposed"),
    ).toBe(true);
    expect(
      result.externalExposure.find((item) => item.status === "blocked")?.id,
    ).toBe(blockedTool.definition.id);
    expect(result.registeredBlockedExternalCapabilityIds).toContain(
      blockedTool.definition.id,
    );
    expect(result.resolution).toBeDefined();
    expect(result.resolution?.trace.query).toBe("search product documentation");
    expect(result.resolution?.trace.modelCalls).toBeLessThanOrEqual(1);
    expect(JSON.stringify(result)).not.toMatch(
      /bearerToken|customHeaders|envJson|top-secret-token/i,
    );
  });
});
