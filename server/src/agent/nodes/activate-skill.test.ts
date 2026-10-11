import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareSkillContext } from "@/skills/context/index.js";
import { forkedSkillAgentNode } from "./forked-skill-agent.js";
import { activateSkillNode } from "./activate-skill.js";
import type { AgentNodeState } from "../node-runtime.js";
import { parseNextActionPlannerOutput } from "../planner/text-json-codec.js";

vi.mock("@/skills/context/index.js", () => ({
  prepareSkillContext: vi.fn(),
}));
vi.mock("./forked-skill-agent.js", () => ({
  forkedSkillAgentNode: vi.fn(),
}));

const skillVisibility = {
  scopeId: "main_agent",
  scopeKind: "main_agent" as const,
  maxSkillDisclosure: "body" as const,
  maxResourceDisclosure: "content" as const,
  skills: [{
    skillId: "xlsx",
    name: "Spreadsheet models",
    description: "Financial models and workbooks",
    version: "1.0",
    discoverable: true,
    disclosure: "summary" as const,
    resources: [],
  }],
};
const toolExposure = { exposedTools: ["read"], toolMeta: [] };

const makeState = (skillId = "xlsx") => ({
  runId: "run-309",
  goal: { text: "Build a valuation model" },
  messages: [{ role: "user", content: "Build a valuation model" }],
  currentTaskFrame: {
    globalGoal: "Build a valuation model",
    skillContext: {
      instruction: "Skill context is guidance only.",
      resources: [],
      disclosedResources: [],
      skillVisibility,
    },
  },
  toolExposure,
  nextAction: {
    type: "activate_skill",
    skillId,
    reason: "Model selected the spreadsheet Skill from the summary catalog",
  },
} as unknown as AgentNodeState);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("#309 Main Planner summary -> Skill Child activation", () => {
  it("parses model selection as a Skill activation, not an arbitrary Tool call", () => {
    expect(parseNextActionPlannerOutput(
      '{"type":"activate_skill","skillId":"xlsx","reason":"need spreadsheet"}',
    )).toEqual({
      type: "activate_skill",
      skillId: "xlsx",
      reason: "need spreadsheet",
    });
  });

  it("expands only an in-scope summary Skill, then uses the existing governed Child", async () => {
    const selectedContext = {
      instruction: "Domain guidance, not authority",
      primary: {
        id: "xlsx",
        name: "Spreadsheet models",
        version: "1.0",
        body: "Do the financial model",
      },
      resources: [],
      disclosedResources: [],
      skillVisibility: {
        ...skillVisibility,
        skills: skillVisibility.skills.map(item => ({
          ...item,
          disclosure: "body" as const,
        })),
      },
    };
    vi.mocked(prepareSkillContext).mockResolvedValue(selectedContext);
    vi.mocked(forkedSkillAgentNode).mockResolvedValue({
      pendingEvidenceObservation: {
        id: "obs-skill",
        status: "ok",
        summary: { source: "observation", status: "completed", actionTaken: "Skill delegated", keyFindings: [] },
      },
    } as unknown as Awaited<ReturnType<typeof forkedSkillAgentNode>>);
    const state = makeState();
    const patch = await activateSkillNode(state);

    expect(prepareSkillContext).toHaveBeenCalledWith({
      query: "$xlsx Build a valuation model",
      messages: state.messages,
    });
    expect(forkedSkillAgentNode).toHaveBeenCalledTimes(1);
    const delegated = vi.mocked(forkedSkillAgentNode).mock.calls[0]![0];
    expect((delegated.currentTaskFrame as {skillContext?: {primary?: {body?: string}}})?.skillContext?.primary?.body)
      .toBe("Do the financial model");
    expect(delegated.toolExposure).toBe(toolExposure);
    expect(patch.pendingEvidenceObservation).toBeDefined();
    expect((state.currentTaskFrame as {skillContext?: {primary?: unknown}})?.skillContext?.primary)
      .toBeUndefined();
  });

  it("rejects an out-of-scope model-selected Skill without loading or invoking it", async () => {
    const result = await activateSkillNode(makeState("secret-skill"));
    expect(result.errorSourceNodeId).toBe("agent-activate-skill");
    expect(prepareSkillContext).not.toHaveBeenCalled();
    expect(forkedSkillAgentNode).not.toHaveBeenCalled();
  });

  it("rejects activation when the provider no longer resolves the selected Skill", async () => {
    vi.mocked(prepareSkillContext).mockResolvedValue(undefined);
    const result = await activateSkillNode(makeState());
    expect(result.errorSourceNodeId).toBe("agent-activate-skill");
    expect(forkedSkillAgentNode).not.toHaveBeenCalled();
  });
});
