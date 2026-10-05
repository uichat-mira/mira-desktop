import assert from "node:assert/strict";
import { test } from "vitest";

import { buildNextActionPlannerMessages } from "../planner/prompt";
import { refreshCurrentTaskFrameFromEvidence } from "../node-runtime";
import type {
  AgentEvidenceSummary,
  AgentGoal,
  AgentToolExposureState,
  CurrentTaskFrame,
  PlannerObservationContext,
} from "../types";

const goal: AgentGoal = {
  id: "goal-codegraph",
  text: "Explain the Agent loop from source code.",
  successCriteria: ["Explain the implementation from verified source evidence."],
  constraints: [],
  riskLevel: "low",
};

const verifiedSummary: AgentEvidenceSummary = {
  source: "retrieval",
  status: "completed",
  actionTaken:
    "Codebase explore verified workspace source chunks. Verified excerpts below are already source-body evidence re-read from the workspace.",
  keyFindings: [
    "verifiedSource[1] | path=server/src/agent/planner/node.ts | lines=L218-L240 | summary=Planner decides the next action | excerpt=export const nextActionPlannerNode = async (...) => { ... }",
    "verifiedSource[2] | path=server/src/agent/nodes/tool-call-normalize.ts | lines=L20-L48 | summary=Normalize freezes pendingToolCall | excerpt=return { pendingToolCall: ... }",
    "verifiedSource[3] | path=server/src/agent/nodes/policy.ts | lines=L40-L70 | summary=Policy reviews frozen input | excerpt=const pendingToolCall = state.pendingToolCall; ...",
    "verifiedSource[4] | path=server/src/agent/nodes/tool-node.ts | lines=L150-L205 | summary=Tool executes frozen input | excerpt=executeHarnessInvocation(...) ...",
    "verifiedSource[5] | path=server/src/agent/nodes/evidence.ts | lines=L30-L70 | summary=Evidence accumulates results | excerpt=return { evidence: ... }",
    "verifiedChunkCount=5",
  ],
  data: {
    kind: "retrieval",
    query: "Agent loop implementation",
    chunkCount: 5,
    documentsPreview: [
      "server/src/agent/planner/node.ts",
      "server/src/agent/nodes/tool-call-normalize.ts",
      "server/src/agent/nodes/policy.ts",
      "server/src/agent/nodes/tool-node.ts",
      "server/src/agent/nodes/evidence.ts",
    ],
  },
};

const frame: CurrentTaskFrame = {
  currentGoal: goal.text,
  currentSubtask: "Inspect implementation.",
  confirmedObjects: [],
  completionCriteria: [...goal.successCriteria],
};

const observationContext: PlannerObservationContext = {
  currentTaskFrame: frame,
  recentObservations: [],
  latestEvidenceSummary: verifiedSummary,
  recovery: {
    source: "none",
    attemptCount: 0,
    maxAttempts: 2,
    exhausted: false,
  },
};

const toolExposure: AgentToolExposureState = {
  exposedTools: ["codebase_explore", "read"],
  toolMeta: [
    {
      toolId: "codebase_explore",
      title: "Codebase Explore",
      description: "Explore code.",
      domain: "read",
      source: "internal",
      capabilities: {
        sideEffect: "none",
        requiresApproval: false,
        workspaceBound: true,
      },
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string" } },
      },
    },
    {
      toolId: "read",
      title: "Read",
      description: "Open a file.",
      domain: "read",
      source: "internal",
      capabilities: {
        sideEffect: "none",
        requiresApproval: false,
        workspaceBound: true,
      },
      inputSchema: { type: "object" },
    },
  ],
};

test("planner treats CodeGraph verifiedSource packets as source-body evidence", () => {
  const messages = buildNextActionPlannerMessages({
    question: goal.text,
    observationContext,
    toolExposure,
    iteration: 2,
    maxIterations: 0,
  });

  const systemPrompt = messages[0]?.content ?? "";
  assert.match(systemPrompt, /verifiedSource/);
  assert.match(systemPrompt, /不要为了形式验证而逐个 read/);
  assert.match(systemPrompt, /禁止退化成无目标的逐文件 read crawl/);

  const plannerPayload = JSON.parse(messages[1]?.content ?? "{}") as {
    observationContext?: PlannerObservationContext;
    toolExposure?: { toolMeta?: Array<{ toolId?: string; description?: string }> };
  };
  assert.equal(
    plannerPayload.observationContext?.latestEvidenceSummary?.keyFindings[0],
    verifiedSummary.keyFindings[0],
  );
  const codebaseTool = plannerPayload.toolExposure?.toolMeta?.find(
    (tool) => tool.toolId === "codebase_explore",
  );
  assert.match(codebaseTool?.description ?? "", /source-body evidence/);
});

test("verified source findings survive into current task covered progress", () => {
  const refreshed = refreshCurrentTaskFrameFromEvidence({
    frame,
    goal,
    latestQuestion: goal.text,
    latestEvidenceSummary: verifiedSummary,
  });

  assert.ok(refreshed?.coveredProgress?.some((item) => item.includes("verifiedSource[1]")));
  assert.ok(refreshed?.coveredProgress?.some((item) => item.includes("planner/node.ts")));
});
