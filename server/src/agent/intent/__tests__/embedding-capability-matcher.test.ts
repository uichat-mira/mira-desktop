import assert from "node:assert/strict";
import { expect, test, vi } from "vitest";
import * as toolCandidates from "@/harness/tool-candidates";
import { clearHarnessRegistry, registerTool } from "@/harness/registry";
import { resolveAgentEligibleExternalMcpCapabilities } from "@/mcp/external";
import {
  cosineSimilarity,
  matchToolCandidatesByEmbedding,
} from "../embedding-capability-matcher";

vi.mock("@/mcp/external", () => ({
  resolveAgentEligibleExternalMcpCapabilities: vi.fn(() => []),
}));

const eligibleProjectedCapability = {
  definition: {
    id: "mcp:docs-server:tool:search_docs",
    title: "Search product documentation",
    description: "Search the connected documentation server for product guides.",
    domain: "external_mcp" as const,
    source: "external" as const,
    sourceLabel: "Docs Server",
    mode: "sync" as const,
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
      additionalProperties: false,
    },
    tags: ["docs", "search", "product-guides", "docs-server"],
    capabilities: {
      sideEffect: "network" as const,
      requiresApproval: true,
      networkAccess: true,
    },
  },
  execute: vi.fn(),
};

test("cosineSimilarity returns descending similarity as vectors diverge", () => {
  const identical = cosineSimilarity([1, 0], [1, 0]);
  const orthogonal = cosineSimilarity([1, 0], [0, 1]);

  assert.equal(identical, 1);
  assert.equal(orthogonal, 0);
});
test("matchToolCandidatesByEmbedding returns exposed tool candidates without selecting one", async () => {
  const resolveHarnessToolCandidatesForTurnSpy = vi
    .spyOn(toolCandidates, "resolveHarnessToolCandidatesForTurn")
    .mockResolvedValue({
      query: "查一下最新新闻",
      source: "agent_intent",
      toolCandidates: [
        {
          toolId: "web_search",
          title: "Web Search",
          description: "Search the public web for current information",
          domain: "web_search",
          source: "internal",
          tags: ["search", "realtime"],
          score: 0.82,
          embeddingScore: 0.76,
          ruleScore: 0.2,
          rerankScore: 0.88,
          finalScore: 0.82,
        },
        {
          toolId: "read_open",
          title: "Read Open",
          description: "Open and read local workspace files",
          domain: "read",
          source: "internal",
          tags: ["workspace", "file"],
          score: 0.44,
          embeddingScore: 0.31,
          ruleScore: 0.18,
          rerankScore: 0.52,
          finalScore: 0.44,
        },
      ],
      toolExposure: {
        exposedToolIds: ["web_search", "read_open"],
        exposedDefinitions: [
          {
            id: "web_search",
            title: "Web Search",
            description: "Search the public web for current information",
            domain: "web_search",
            source: "internal",
            mode: "sync",
            inputSchema: {},
            tags: ["search", "realtime"],
            capabilities: {
              sideEffect: "network",
              requiresApproval: false,
            },
          },
          {
            id: "read_open",
            title: "Read Open",
            description: "Open and read local workspace files",
            domain: "read",
            source: "internal",
            mode: "sync",
            inputSchema: {},
            tags: ["workspace", "file"],
            capabilities: {
              sideEffect: "none",
              requiresApproval: false,
            },
          },
        ],
        reason: [],
        blockedCapabilityIds: [],
      },
      retrievalModel: undefined,
      rerankModel: {
        model: "test-rerank",
        modelConfigId: "test-rerank-config",
      },
    });

  try {
    const result = await matchToolCandidatesByEmbedding({
      query: "查一下最新新闻",
      config: {
        topK: 2,
      },
    });

    assert.equal(resolveHarnessToolCandidatesForTurnSpy.mock.calls.length, 1);
    assert.equal(resolveHarnessToolCandidatesForTurnSpy.mock.calls[0]?.[0].allowExternal, true);
    assert.deepEqual(
      resolveHarnessToolCandidatesForTurnSpy.mock.calls[0]?.[0].allowedExternalToolIds,
      [],
    );
    assert.equal(result.topCandidates.length, 2);
    assert.deepEqual(
      result.topCandidates.map((candidate) => candidate.toolId),
      ["web_search", "read_open"],
    );
    assert.equal(result.topCandidates[0]?.embeddingScore, 0.76);
    assert.equal(result.topCandidates[0]?.rerankScore, 0.88);
    assert.deepEqual(result.exposureReasons, []);
    assert.equal(result.retrievalModel, undefined);
    assert.deepEqual(result.rerankModel, {
      model: "test-rerank",
      modelConfigId: "test-rerank-config",
    });
  } finally {
    resolveHarnessToolCandidatesForTurnSpy.mockRestore();
  }
});

test("matchToolCandidatesByEmbedding carries a T001-eligible projected capability into real candidates", async () => {
  clearHarnessRegistry();
  registerTool(eligibleProjectedCapability);
  vi.mocked(resolveAgentEligibleExternalMcpCapabilities).mockReturnValue([
    eligibleProjectedCapability.definition,
  ]);

  try {
    const result = await matchToolCandidatesByEmbedding({
      query: "Search product documentation for installation guides",
    });

    assert.deepEqual(result.topCandidates.map((candidate) => candidate.toolId), [
      "mcp:docs-server:tool:search_docs",
    ]);
    assert.equal(result.topCandidates[0]?.source, "external");
    assert.equal(result.topCandidates[0]?.title, "Search product documentation");
    assert.equal(result.toolExposure.exposedDefinitions[0]?.sourceLabel, "Docs Server");
    assert.deepEqual(result.toolExposure.exposedDefinitions[0]?.inputSchema, {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
      additionalProperties: false,
    });
  } finally {
    vi.mocked(resolveAgentEligibleExternalMcpCapabilities).mockReturnValue([]);
    clearHarnessRegistry();
  }
});

test("matchToolCandidatesByEmbedding excludes unauthorized, disabled, stale, and absent-allowlist projections", async () => {
  clearHarnessRegistry();
  const blockedDefinitions = [
    "mcp:unauthorized-server:tool:search",
    "mcp:disabled-server:tool:search",
    "mcp:stale-server:tool:search",
  ].map((id) => ({
    ...eligibleProjectedCapability,
    definition: { ...eligibleProjectedCapability.definition, id },
  }));
  registerTool(eligibleProjectedCapability);
  blockedDefinitions.forEach(registerTool);
  vi.mocked(resolveAgentEligibleExternalMcpCapabilities).mockReturnValue([
    eligibleProjectedCapability.definition,
  ]);

  try {
    const result = await matchToolCandidatesByEmbedding({ query: "search product docs" });
    const candidateIds = result.toolCandidates.map((candidate) => candidate.toolId);

    assert.deepEqual(candidateIds, [eligibleProjectedCapability.definition.id]);
    for (const blocked of blockedDefinitions) {
      assert.equal(candidateIds.includes(blocked.definition.id), false);
    }
    assert.equal(
      result.toolExposure.blockedCapabilityIds.includes("mcp:unauthorized-server:tool:search"),
      true,
    );
  } finally {
    vi.mocked(resolveAgentEligibleExternalMcpCapabilities).mockReturnValue([]);
    clearHarnessRegistry();
  }
});

test("matchToolCandidatesByEmbedding short-circuits low-intent greeting queries through harness exposure policy", async () => {
  const resolveHarnessToolCandidatesForTurnSpy = vi
    .spyOn(toolCandidates, "resolveHarnessToolCandidatesForTurn")
    .mockResolvedValue({
      query: "Hi",
      source: "agent_intent",
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: [],
        exposedDefinitions: [],
        reason: ["Greeting or low-intent input should stay in pure conversation mode."],
        blockedCapabilityIds: ["read_open", "web_search"],
      },
    });

  try {
    const result = await matchToolCandidatesByEmbedding({
      query: "Hi",
    });

    assert.deepEqual(result.topCandidates, []);
    assert.deepEqual(result.exposureReasons, [
      "Greeting or low-intent input should stay in pure conversation mode.",
    ]);
    assert.equal(resolveHarnessToolCandidatesForTurnSpy.mock.calls.length, 1);
  } finally {
    resolveHarnessToolCandidatesForTurnSpy.mockRestore();
  }
});

test("matchToolCandidatesByEmbedding respects topK while keeping selection empty for downstream task selection", async () => {
  const resolveHarnessToolCandidatesForTurnSpy = vi
    .spyOn(toolCandidates, "resolveHarnessToolCandidatesForTurn")
    .mockResolvedValue({
      query: "帮我看看文件夹下有啥",
      source: "agent_intent",
      toolCandidates: [
        {
          toolId: "read_list",
          title: "Read List",
          description: "List workspace files",
          domain: "read",
          source: "internal",
          tags: ["workspace", "list"],
          score: 0.66,
          embeddingScore: 0.52,
          ruleScore: 0.3,
          rerankScore: 0.71,
          finalScore: 0.66,
        },
        {
          toolId: "edit",
          title: "Edit",
          description: "Modify workspace files through managed editing",
          domain: "edit",
          source: "internal",
          tags: ["workspace", "edit"],
          score: 0.31,
          embeddingScore: 0.2,
          ruleScore: 0.18,
          rerankScore: 0.4,
          finalScore: 0.31,
        },
      ],
      toolExposure: {
        exposedToolIds: ["read_list"],
        exposedDefinitions: [
          {
            id: "read_list",
            title: "Read List",
            description: "List workspace files",
            domain: "read",
            source: "internal",
            mode: "sync",
            inputSchema: {},
            tags: ["workspace", "list"],
            capabilities: {
              sideEffect: "none",
              requiresApproval: false,
            },
          },
        ],
        reason: [],
        blockedCapabilityIds: [],
      },
    });

  try {
    const result = await matchToolCandidatesByEmbedding({
      query: "帮我看看文件夹下有啥",
      config: {
        topK: 1,
      },
    });

    assert.deepEqual(
      result.topCandidates.map((candidate) => candidate.toolId),
      ["read_list"],
    );
  } finally {
    resolveHarnessToolCandidatesForTurnSpy.mockRestore();
  }
});
