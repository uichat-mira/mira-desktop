import { beforeEach, describe, expect, it, vi } from "vitest";
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

      const result = await resolveHarnessToolCandidatesForTurn({
        query: "anything",
        source: "agent_intent",
        topK: 1,
        maxTools: 1,
        minScore: 0.99,
      });

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

  it("uses deterministic lexical resolution above 20 and keeps the full eligibility envelope", async () => {
    for (let index = 0; index < 20; index += 1) {
      registerTool(createEligibleTool("noise_tool_" + index));
    }
    const target = createEligibleTool("tail_target_tool");
    target.definition.description = "Handles the zephyrix ingestion pipeline";
    registerTool(target);
    const semanticResolver = vi.fn(async () => "noise_tool_0");

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "zephyrix",
      source: "agent_intent",
      topK: 1,
      maxTools: 1,
      minScore: 0.99,
      semanticResolver,
    });

    expect(semanticResolver).not.toHaveBeenCalled();
    expect(result.toolCandidates).toHaveLength(20);
    expect(result.toolExposure.exposedToolIds).toHaveLength(20);
    expect(result.eligibleToolIds).toHaveLength(21);
    expect(result.eligibleToolIds).toContain("tail_target_tool");
    expect(result.toolCandidates[0]?.toolId).toBe("tail_target_tool");
    expect(result.toolExposure.exposedToolIds).toContain("tail_target_tool");
    expect(result.resolution?.path).toBe("lexical");
    expect(result.resolution?.trace.modelCalls).toBe(0);
  });

  it("uses one semantic call for a genuinely ambiguous large catalog", async () => {
    for (let index = 0; index < 19; index += 1) {
      registerTool(createEligibleTool("semantic_noise_tool_" + index));
    }
    const alpha = createEligibleTool("alpha_tool");
    alpha.definition.description = "zephyrix ambiguous route handler";
    const beta = createEligibleTool("beta_tool");
    beta.definition.description = "zephyrix ambiguous route handler";
    registerTool(alpha);
    registerTool(beta);
    const semanticResolver = vi.fn(async () => "beta_tool");

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "zephyrix ambiguous route",
      source: "agent_intent",
      semanticResolver,
    });

    expect(semanticResolver).toHaveBeenCalledTimes(1);
    expect(result.resolution?.path).toBe("semantic");
    expect(result.resolution?.trace.modelCalls).toBe(1);
    expect(result.toolCandidates[0]?.toolId).toBe("beta_tool");
  });

  it.each([21, 50])(
    "falls back to exactly 20 deterministic tools on a transparent no-match: %s",
    async (count) => {
      for (let index = 0; index < count; index += 1) {
        registerTool(createEligibleTool("large_set_tool_" + index));
      }
      const semanticResolver = vi.fn(async () => "large_set_tool_0");

      const result = await resolveHarnessToolCandidatesForTurn({
        query: "zzzzqqqq",
        source: "agent_intent",
        semanticResolver,
      });

      expect(semanticResolver).not.toHaveBeenCalled();
      expect(result.toolExposure.exposedToolIds).toHaveLength(20);
      expect(result.toolCandidates).toHaveLength(20);
      expect(result.resolution?.path).toBe("none");
      expect(result.resolution?.trace.modelCalls).toBe(0);
      expect(result.toolExposure.exposedToolIds).toEqual(
        Array.from({ length: 20 }, (_, index) => "large_set_tool_" + index),
      );
    },
  );

  it("does not use caller score thresholds as an authority filter above 20 tools", async () => {
    const count = 21;
    for (let index = 0; index < count; index += 1) {
      registerTool(createEligibleTool("low_score_tool_" + index));
    }

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "zzzzqqqq",
      source: "agent_intent",
      minScore: 0.9999,
      semanticResolver: vi.fn(async () => undefined),
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
