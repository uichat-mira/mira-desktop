import { describe, expect, it, vi } from "vitest";
import * as harnessRegistry from "@/harness/registry";
import type { SkillContext } from "@/skills/context/index.js";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";
import { prepareContextNode } from "./prepare-context.js";
import type { AgentNodeState } from "../node-runtime.js";

const prepareSkillContextMock = vi.hoisted(() => vi.fn());

vi.mock("@/skills/context/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/skills/context/index.js")>();
  return { ...actual, prepareSkillContext: prepareSkillContextMock };
});

const DCF_URI = "skill://xlsx/reference/DCF_SKILL.md";

const makeToolDefinition = (toolId: string) => ({
  id: toolId,
  title: toolId,
  description: toolId,
  inputSchema: { type: "object", properties: {} },
  domain: "read",
  source: "internal" as const,
  mode: "sync" as const,
  tags: ["read"],
  capabilities: { sideEffect: "none" as const, requiresApproval: false },
});

const skillContext: SkillContext = {
  instruction: "test instruction",
  primary: { id: "xlsx", version: "1.0.0", name: "Excel 处理", body: "body" },
  resources: [
    { uri: DCF_URI, skillId: "xlsx", name: "DCF", kind: "reference" },
  ],
  disclosedResources: [{ uri: DCF_URI, content: "DCF rules" }],
  skillVisibility: {
    scopeId: "main_agent",
    scopeKind: "main_agent",
    maxSkillDisclosure: "body",
    maxResourceDisclosure: "content",
    skills: [
      {
        skillId: "xlsx",
        name: "Excel 处理",
        description: "spreadsheet",
        version: "1.0.0",
        discoverable: true,
        disclosure: "body",
        resources: [
          {
            uri: DCF_URI,
            skillId: "xlsx",
            name: "DCF",
            kind: "reference",
            discoverable: true,
            disclosure: "content",
          },
        ],
      },
      {
        skillId: "docx",
        name: "Word 文档处理",
        description: "document",
        version: "1.0.0",
        discoverable: true,
        disclosure: "summary",
        resources: [],
      },
    ],
  },
  match: {
    source: "explicit",
    reason: "explicit",
    score: 1,
    secondarySkillIds: [],
  },
};

const createState = (): AgentNodeState => ({
  runId: "run-1",
  threadId: "thread-1",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "make a DCF model",
    successCriteria: ["make a DCF model"],
    constraints: [],
    riskLevel: "low",
  },
  messages: [{ role: "user", content: "$xlsx make a DCF model" }],
});

describe("prepareContextNode scoped Skill visibility", () => {
  it("emits the scoped summary/body disclosure stages without broadening Tool authority", async () => {
    prepareSkillContextMock.mockResolvedValue(skillContext);
    const readOpen = makeToolDefinition("read_open");
    const registrySpy = vi
      .spyOn(harnessRegistry, "listToolDefinitions")
      .mockReturnValue([readOpen]);
    const matcherSpy = vi
      .spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding")
      .mockResolvedValue({
        query: "$xlsx make a DCF model",
        topCandidates: [],
        toolCandidates: [],
        toolExposure: {
          exposedToolIds: ["read_open"],
          exposedDefinitions: [readOpen],
          reason: ["matched read_open"],
        },
        exposureReasons: ["matched read_open"],
        resolution: {
          path: "structural",
          selectedCapabilityId: "read_open",
          candidates: [
            { capabilityId: "read_open", score: 1, reason: "read_open matched" },
          ],
          trace: {
            query: "$xlsx make a DCF model",
            path: "structural",
            modelCalls: 0,
            semanticAttempted: false,
            ambiguous: false,
            deterministicCandidates: [],
            selectedCapabilityId: "read_open",
            domainHint: null,
            selectedDomain: null,
            wrongDomainRecovered: false,
            reason: "structural test resolution",
          },
        },
      });
    const events: Array<{ nodeId: string; phase: string; details?: Record<string, unknown> }> =
      [];

    try {
      const patch = await prepareContextNode(createState(), async (event) => {
        events.push({
          nodeId: event.nodeId,
          phase: event.phase,
          details: event.details,
        });
      });

      const prepareDetails = events.find(
        (event) =>
          event.nodeId === "agent-prepare-context" && event.phase === "done",
      )?.details;
      expect(prepareDetails?.skillVisibilityScopeKind).toBe("main_agent");
      expect(prepareDetails?.skillSummaryDisclosedCount).toBe(2);
      expect(prepareDetails?.skillBodyDisclosedCount).toBe(1);
      expect(prepareDetails?.skillResourceMetadataDisclosedCount).toBe(1);
      expect(prepareDetails?.skillResourceContentDisclosedCount).toBe(1);
      expect(prepareDetails?.skillToolExposureMutation).toBe(false);

      const skillDetails = events.find(
        (event) =>
          event.nodeId === "agent-skill-context" && event.phase === "done",
      )?.details;
      const trace = skillDetails?.skillContext as {
        disclosure: { skillBodyLoaded: boolean };
        skillVisibility: {
          bodyDisclosedSkillIds: string[];
          summaryDisclosedSkillIds: string[];
        };
      };
      expect(trace.disclosure.skillBodyLoaded).toBe(true);
      expect(trace.skillVisibility.summaryDisclosedSkillIds.sort()).toEqual([
        "docx",
        "xlsx",
      ]);
      expect(trace.skillVisibility.bodyDisclosedSkillIds).toEqual(["xlsx"]);

      // Skill selection only changes model-visible context. The Planner-callable
      // Tool authority remains exactly the Harness exposure.
      expect(patch.toolExposure?.exposedTools).toEqual(["read_open"]);
    } finally {
      matcherSpy.mockRestore();
      registrySpy.mockRestore();
      prepareSkillContextMock.mockReset();
    }
  });
});
