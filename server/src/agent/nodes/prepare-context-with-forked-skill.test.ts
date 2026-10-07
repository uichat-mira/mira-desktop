import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentNodeState } from "../node-runtime.js";
import type { AgentObservation } from "../types.js";

const mocks = vi.hoisted(() => ({
  basePrepare: vi.fn(),
  forkedSkill: vi.fn(),
  evidence: vi.fn(),
}));

vi.mock("./prepare-context.js", () => ({
  prepareContextNode: mocks.basePrepare,
}));
vi.mock("./forked-skill-agent.js", () => ({
  forkedSkillAgentNode: mocks.forkedSkill,
}));
vi.mock("./evidence.js", () => ({
  evidenceNode: mocks.evidence,
}));

import { prepareContextWithForkedSkillAgentNode } from "./prepare-context-with-forked-skill.js";

const observation = (status: AgentObservation["status"]): AgentObservation => ({
  id: "obs-1",
  runId: "run-1",
  stepId: "skill_agent:docx",
  status,
  facts: ["Skill Agent status"],
  createdAt: "2026-07-24T00:00:00.000Z",
});

const state = {
  runId: "run-1",
  evidence: {
    observations: [],
    toolExecutions: [],
    retrievals: [],
  },
} as AgentNodeState;

describe("prepareContextWithForkedSkillAgentNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.basePrepare.mockResolvedValue({});
    mocks.evidence.mockImplementation(async (input: AgentNodeState) => ({
      evidence: {
        observations: input.pendingEvidenceObservation
          ? [input.pendingEvidenceObservation]
          : [],
        toolExecutions: [],
        retrievals: [],
      },
      pendingEvidenceObservation: undefined,
    }));
  });

  it("freezes completed Skill execution for Parent finalization", async () => {
    mocks.forkedSkill.mockResolvedValue({
      pendingEvidenceObservation: observation("ok"),
    });

    const result = await prepareContextWithForkedSkillAgentNode(state);

    expect(result.nextAction?.type).toBe("answer");
    expect(result.finalizationPacket?.completionProof[0]?.evidenceRefs).toEqual([
      "observation:0",
    ]);
  });

  it("leaves recoverable Skill failure to Parent recovery", async () => {
    mocks.forkedSkill.mockResolvedValue({
      pendingEvidenceObservation: observation("failed"),
    });

    const result = await prepareContextWithForkedSkillAgentNode(state);

    expect(result.nextAction).toBeUndefined();
    expect(result.errorMessage).toBeUndefined();
  });

  it("narrows Parent recovery to the Skill profile read surface", async () => {
    mocks.basePrepare.mockResolvedValue({
      toolExposure: {
        exposedTools: [
          "read",
          "terminal",
          "codebase_explore",
          "edit",
        ],
        toolMeta: [
          { toolId: "read", title: "Read", description: "read" },
          { toolId: "terminal", title: "Terminal", description: "run" },
          { toolId: "codebase_explore", title: "Explore", description: "explore" },
          { toolId: "edit", title: "Edit", description: "edit" },
        ],
      },
    });
    mocks.forkedSkill.mockResolvedValue({
      pendingEvidenceObservation: observation("failed"),
    });

    const result = await prepareContextWithForkedSkillAgentNode(state);

    expect(result.toolExposure?.exposedTools).toEqual(["read"]);
    expect(result.toolExposure?.toolMeta.map((tool) => tool.toolId)).toEqual([
      "read",
    ]);
  });

  it("routes terminal Skill failure into the existing error contract", async () => {
    mocks.forkedSkill.mockResolvedValue({
      pendingEvidenceObservation: {
        ...observation("blocked"),
        errorMessage: "terminal runtime failure",
      },
    });

    const result = await prepareContextWithForkedSkillAgentNode(state);

    expect(result.errorMessage).toBe("terminal runtime failure");
    expect(result.errorSourceNodeId).toBe("agent-forked-skill-agent");
    expect(result.terminalReason).toBe("skill_agent_terminal_failure");
    expect(result.nextAction).toBeUndefined();
  });
});
