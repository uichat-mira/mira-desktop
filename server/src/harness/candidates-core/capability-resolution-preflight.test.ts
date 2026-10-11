import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalTool } from "@/mcp/tools/terminal-session.tool.js";
import { clearHarnessRegistry, registerTool } from "../registry.js";
import { resolveHarnessToolCandidatesForTurn } from "./resolver.js";

const createEligibleTool = (
  id: string,
  options: {
    description?: string;
    tags?: string[];
  } = {},
) => ({
  definition: {
    id,
    title: id,
    description: options.description ?? id + " test tool",
    domain: "read" as const,
    source: "internal" as const,
    mode: "sync" as const,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    tags: options.tags ?? [],
    capabilities: {
      sideEffect: "none" as const,
      requiresApproval: false,
    },
  },
  execute() {
    return {};
  },
});

describe("progressive capability resolution in turn resolution", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearHarnessRegistry();
  });

  it("exposes a structurally-clear Tool beyond the historical first 20 without semantic fallback", async () => {
    for (let index = 0; index < 24; index += 1) {
      registerTool(createEligibleTool("noise_tool_" + index));
    }
    registerTool(terminalTool);
    const semanticResolver = vi.fn(async () => "noise_tool_0");

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "run a terminal command",
      source: "agent_intent",
      semanticResolver,
    });

    expect(semanticResolver).not.toHaveBeenCalled();
    expect(result.resolution?.path).toBe("structural");
    expect(result.resolution?.trace.modelCalls).toBe(0);
    expect(result.eligibleToolIds).toHaveLength(25);
    expect(result.toolExposure.exposedToolIds).toContain("terminal");
  });

  it("uses lexical lookup in production to reach a Tool beyond the old first-20 window", async () => {
    for (let index = 0; index < 24; index += 1) {
      registerTool(
        createEligibleTool("noise_tool_" + index, {
          description: "generic capability noise",
          tags: ["noise"],
        }),
      );
    }
    registerTool(
      createEligibleTool("late_lexical_target", {
        description: "Handles the zephyrix ingestion pipeline",
        tags: ["noise"],
      }),
    );
    const semanticResolver = vi.fn(async () => "noise_tool_0");

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "zephyrix",
      source: "agent_intent",
      semanticResolver,
    });

    expect(semanticResolver).not.toHaveBeenCalled();
    expect(result.resolution?.path).toBe("lexical");
    expect(result.resolution?.trace.modelCalls).toBe(0);
    expect(result.toolCandidates[0]?.toolId).toBe("late_lexical_target");
    expect(result.toolExposure.exposedToolIds).toContain("late_lexical_target");
  });

  it("invokes exactly one semantic resolver call only when deterministic evidence is ambiguous", async () => {
    for (let index = 0; index < 19; index += 1) {
      registerTool(
        createEligibleTool("noise_tool_" + index, {
          description: "generic unrelated capability",
        }),
      );
    }
    registerTool(
      createEligibleTool("alpha_tool", {
        description: "zephyrix ambiguous route handler",
      }),
    );
    registerTool(
      createEligibleTool("beta_tool", {
        description: "zephyrix ambiguous route handler",
      }),
    );
    const semanticResolver = vi.fn(async () => "beta_tool");

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "zephyrix ambiguous route",
      source: "agent_intent",
      semanticResolver,
    });

    expect(semanticResolver).toHaveBeenCalledTimes(1);
    expect(result.resolution?.path).toBe("semantic");
    expect(result.resolution?.trace.modelCalls).toBe(1);
    expect(result.resolution?.trace.semanticAttempted).toBe(true);
    expect(result.toolCandidates[0]?.toolId).toBe("beta_tool");
  });

  it("surfaces one bounded semantic runtime failure without fabricating a selection", async () => {
    for (let index = 0; index < 19; index += 1) {
      registerTool(
        createEligibleTool("noise_tool_" + index, {
          description: "generic unrelated capability",
        }),
      );
    }
    registerTool(
      createEligibleTool("alpha_tool", {
        description: "zephyrix ambiguous route handler",
      }),
    );
    registerTool(
      createEligibleTool("beta_tool", {
        description: "zephyrix ambiguous route handler",
      }),
    );
    const semanticResolver = vi.fn(async () => {
      throw new Error("semantic resolver unavailable");
    });

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "zephyrix ambiguous route",
      source: "agent_intent",
      semanticResolver,
    });

    expect(semanticResolver).toHaveBeenCalledTimes(1);
    expect(result.resolution?.path).toBe("ambiguous");
    expect(result.resolution?.trace.modelCalls).toBe(1);
    expect(result.resolution?.trace.semanticAttempted).toBe(true);
    expect(result.resolution?.trace.semanticError).toBe(
      "semantic resolver unavailable",
    );
    expect(result.retrievalError).toBe("semantic resolver unavailable");
    expect(result.toolExposure.exposedToolIds).toHaveLength(20);
  });

  it("keeps no-match transparent and spends no semantic call", async () => {
    for (let index = 0; index < 21; index += 1) {
      registerTool(
        createEligibleTool("noise_tool_" + index, {
          description: "generic capability",
        }),
      );
    }
    const semanticResolver = vi.fn(async () => "noise_tool_0");

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "zzzzqqqq",
      source: "agent_intent",
      semanticResolver,
    });

    expect(semanticResolver).not.toHaveBeenCalled();
    expect(result.resolution?.path).toBe("none");
    expect(result.resolution?.trace.modelCalls).toBe(0);
    expect(result.toolExposure.exposedToolIds).toEqual(
      Array.from({ length: 20 }, (_, index) => "noise_tool_" + index),
    );
  });
});
