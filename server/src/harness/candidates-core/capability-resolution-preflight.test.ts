import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as embedding from "@/services/internal-capabilities/local-embedding.js";
import { terminalTool } from "@/mcp/tools/terminal-session.tool.js";
import { clearHarnessRegistry, registerTool } from "../registry.js";
import { resolveHarnessToolCandidatesForTurn } from "./resolver.js";

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

describe("deterministic capability preflight in turn resolution", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearHarnessRegistry();
  });

  it("exposes a structurally-clear Tool beyond the historical first 20 without ranking", async () => {
    for (let index = 0; index < 24; index += 1) {
      registerTool(createEligibleTool(`noise_tool_${index}`));
    }
    // Registered last so the old deterministic first-20 fallback would omit it.
    registerTool(terminalTool);

    const embeddingSpy = vi
      .spyOn(embedding, "executeLocalEmbedding")
      .mockRejectedValue(new Error("ranking must not run"));

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "run a terminal command",
      source: "agent_intent",
    });

    expect(embeddingSpy).not.toHaveBeenCalled();
    expect(result.resolution?.path).toBe("structural");
    expect(result.resolution?.trace.modelCalls).toBe(0);
    expect(result.eligibleToolIds).toHaveLength(25);
    expect(result.toolExposure.exposedToolIds).toContain("terminal");
  });

  it("still falls back to ranking for a genuinely ambiguous large catalog", async () => {
    for (let index = 0; index < 21; index += 1) {
      registerTool(createEligibleTool(`noise_tool_${index}`));
    }

    const embeddingSpy = vi
      .spyOn(embedding, "executeLocalEmbedding")
      .mockRejectedValue(new Error("ranking unavailable"));

    const result = await resolveHarnessToolCandidatesForTurn({
      query: "please handle this request",
      source: "agent_intent",
    });

    expect(embeddingSpy).toHaveBeenCalledTimes(1);
    expect(result.resolution?.path).toBe("semantic");
    expect(result.toolExposure.exposedToolIds).toHaveLength(20);
    expect(result.retrievalError).toBe("ranking unavailable");
  });
});
