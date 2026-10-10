import { beforeEach, describe, expect, it, vi } from "vitest";
import * as embedding from "@/services/internal-capabilities/local-embedding.js";
import * as rerank from "@/services/internal-capabilities/local-rerank.js";
import { clearHarnessRegistry, registerTool } from "./registry.js";
import { resolveHarnessToolCandidatesForTurn } from "./tool-candidates.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";
import { terminalTool } from "../mcp/tools/terminal-session.tool.js";

const createEligibleTool = (id: string) => ({
  definition: {
    id,
    title: id,
    description: `${id} test tool`,
    domain: "read" as const,
    source: "internal" as const,
    mode: "sync" as const,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    tags: [] as string[],
    capabilities: {
      sideEffect: "none" as const,
      requiresApproval: false,
    },
  },
  execute() {
    return {};
  },
});

const externalFakeTool = {
  definition: {
    id: "external_fake_tool",
    title: "External Fake Tool",
    description: "Use an external MCP system.",
    domain: "external_mcp" as const,
    source: "external" as const,
    mode: "sync" as const,
    inputSchema: {},
    tags: ["external", "mcp"],
    capabilities: {
      sideEffect: "network" as const,
      requiresApproval: true,
    },
  },
  execute() {
    return {};
  },
};

describe("resolveHarnessToolCandidatesForTurn", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    vi.restoreAllMocks();
  });

  it.each([0, 1, 20])(
    "exposes every public tool and skips ranking when the set has %s tools",
    async (count) => {
      for (let index = 0; index < count; index += 1) {
        registerTool(createEligibleTool(`eligible_tool_${index}`));
      }

      const embeddingSpy = vi
        .spyOn(embedding, "executeLocalEmbedding")
        .mockRejectedValue(new Error("ranking must not run"));

      const result = await resolveHarnessToolCandidatesForTurn({
        query: "anything",
        source: "agent_intent",
        topK: 1,
        maxTools: 1,
        minScore: 0.99,
      });

      expect(embeddingSpy).not.toHaveBeenCalled();
      expect(result.toolExposure.exposedToolIds).toHaveLength(count);
      expect(result.toolCandidates).toHaveLength(count);
    },
  );

  it("does not let caller topK/maxTools/minScore shrink a <=20 public tool set", async () => {
    registerTool(readTool);
    registerTool(webSearchTool);
    registerTool(terminalTool);

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "README",
      source: "agent_intent",
      topK: 1,
      maxTools: 1,
      minScore: 0.99,
    });

    expect(result.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining(["read", "web_search", "terminal"]),
    );
    expect(result.toolCandidates).toHaveLength(3);
  });

  it("ranks only when the public tool set exceeds 20 and exposes exactly the top 20", async () => {
    for (let index = 0; index < 20; index += 1) {
      registerTool(createEligibleTool(`noise_tool_${index}`));
    }
    registerTool(createEligibleTool("tail_target_tool"));

    vi.spyOn(embedding, "executeLocalEmbedding").mockResolvedValue({
      embeddingModel: "test-embedding",
      embeddingModelConfigId: "test-embedding-config",
      embeddings: [
        [1, 0],
        ...Array.from({ length: 20 }, () => [1, 0]),
        [0, 1],
      ],
    });
    const rerankSpy = vi
      .spyOn(rerank, "executeLocalRerank")
      .mockImplementation(async ({ candidates }) => ({
        rerankedCandidates: candidates
          .map((candidate) => ({
            id: candidate.id,
            text: candidate.text,
            score: candidate.id === "tail_target_tool" ? 1 : 0.1,
            probability: candidate.id === "tail_target_tool" ? 0.99 : 0.1,
            rank: candidate.id === "tail_target_tool" ? 1 : 2,
          }))
          .sort((left, right) => right.probability - left.probability),
        rerankModel: "test-rerank",
        rerankModelConfigId: "test-rerank-config",
      }));

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "target",
      source: "agent_intent",
      topK: 1,
      maxTools: 1,
      minScore: 0.99,
    });

    expect(result.toolCandidates).toHaveLength(20);
    expect(result.toolExposure.exposedToolIds).toHaveLength(20);
    expect(rerankSpy.mock.calls[0]?.[0].candidates).toHaveLength(21);
    expect(result.toolCandidates[0]?.toolId).toBe("tail_target_tool");
    expect(result.toolCandidates[0]?.finalScore).toBe(0.99);
    expect(result.toolExposure.exposedToolIds).toContain("tail_target_tool");
    expect(result.toolExposure.reason).toContain(
      "Eligible public tool set exceeds 20; Harness ranks the runtime-ready tools for this turn and exposes the top 20. Ranking adds no semantic policy filter.",
    );
  });

  it("uses embedding score only to break equal rerank scores", async () => {
    for (let index = 0; index < 20; index += 1) {
      registerTool(createEligibleTool(`tie_noise_tool_${index}`));
    }
    registerTool(createEligibleTool("embedding_tiebreak_tool"));

    vi.spyOn(embedding, "executeLocalEmbedding").mockResolvedValue({
      embeddingModel: "test-embedding",
      embeddingModelConfigId: "test-embedding-config",
      embeddings: [
        [1, 0],
        ...Array.from({ length: 20 }, () => [0, 1]),
        [1, 0],
      ],
    });
    vi.spyOn(rerank, "executeLocalRerank").mockImplementation(async ({ candidates }) => ({
      rerankedCandidates: candidates.map((candidate, index) => ({
        id: candidate.id,
        text: candidate.text,
        score: 0,
        probability: 0.5,
        rank: index + 1,
      })),
      rerankModel: "test-rerank",
      rerankModelConfigId: "test-rerank-config",
    }));

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "embedding tiebreak",
      source: "agent_intent",
    });

    expect(result.toolCandidates[0]?.toolId).toBe("embedding_tiebreak_tool");
    expect(result.toolCandidates[0]?.rerankScore).toBe(0.5);
    expect(result.toolCandidates[0]?.embeddingScore).toBe(1);
  });

  it.each([21, 50])(
    "falls back to exactly 20 deterministic tools when ranking is unavailable: %s",
    async (count) => {
      for (let index = 0; index < count; index += 1) {
        registerTool(createEligibleTool(`large_set_tool_${index}`));
      }

      vi.spyOn(embedding, "executeLocalEmbedding").mockRejectedValue(
        new Error("embedding unavailable"),
      );

      const result = await resolveHarnessToolCandidatesForTurn({
        query: "anything",
        source: "agent_intent",
      });

      expect(result.toolExposure.exposedToolIds).toHaveLength(20);
      expect(result.toolCandidates).toHaveLength(20);
      expect(result.retrievalError).toBe("embedding unavailable");
      expect(result.toolExposure.exposedToolIds).toEqual(
        Array.from({ length: 20 }, (_, index) => `large_set_tool_${index}`),
      );
    },
  );

  it("does not use score thresholds as an additional blocking rule above 20 tools", async () => {
    const count = 21;
    for (let index = 0; index < count; index += 1) {
      registerTool(createEligibleTool(`low_score_tool_${index}`));
    }

    vi.spyOn(embedding, "executeLocalEmbedding").mockResolvedValue({
      embeddingModel: "test-embedding",
      embeddingModelConfigId: "test-embedding-config",
      embeddings: Array.from({ length: count + 1 }, () => [1, 0]),
    });
    vi.spyOn(rerank, "executeLocalRerank").mockResolvedValue({
      rerankedCandidates: [],
      rerankModel: "test-rerank",
      rerankModelConfigId: "test-rerank-config",
    });

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "no strong semantic match",
      source: "agent_intent",
      minScore: 0.9999,
    });

    expect(result.toolExposure.exposedToolIds).toHaveLength(20);
    expect(result.toolCandidates).toHaveLength(20);
  });

  it("keeps Browser/Edit/Terminal-style multi-step capability freedom when the set is small", async () => {
    const browserObserve = {
      ...createEligibleTool("browser_observe"),
      definition: {
        ...createEligibleTool("browser_observe").definition,
        domain: "browser_action" as const,
        tags: ["browser", "computer-use"],
        capabilities: {
          sideEffect: "network" as const,
          requiresApproval: false,
          networkAccess: true,
        },
      },
    };
    const writeFile = {
      ...createEligibleTool("write"),
      definition: {
        ...createEligibleTool("write").definition,
        domain: "edit" as const,
        capabilities: {
          sideEffect: "local-write" as const,
          requiresApproval: true,
        },
      },
    };

    registerTool(browserObserve);
    registerTool(writeFile);
    registerTool(terminalTool);

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "打开公众号网页，整理成 HTML，保存到工作区，必要时运行终端脚本",
      source: "agent_intent",
    });

    expect(result.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining(["browser_observe", "write", "terminal"]),
    );
  });

  it("uses explicit Agent Access as the only external-MCP availability gate", async () => {
    registerTool(externalFakeTool);
    registerTool(readTool);

    const hidden = await resolveHarnessToolCandidatesForTurn({
      query: "use external system",
      source: "agent_intent",
    });
    expect(hidden.toolExposure.exposedToolIds).toEqual(["read"]);

    const visible = await resolveHarnessToolCandidatesForTurn({
      query: "use external system",
      source: "agent_intent",
      allowExternal: true,
      allowedExternalToolIds: ["external_fake_tool"],
    });
    expect(visible.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining(["read", "external_fake_tool"]),
    );
  });
});
