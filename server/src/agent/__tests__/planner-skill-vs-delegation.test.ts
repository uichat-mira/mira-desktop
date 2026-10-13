import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import {
  buildPlannerObservationContext,
  type AgentNodeState,
} from "../node-runtime";
import type { AgentToolExposureState } from "../types";
import {
  GENERIC_TASK_DELEGATE_TOOL_ID,
  withGenericTaskDelegationTool,
} from "../delegation/contract";
import { buildNextActionPlannerMessages } from "../planner/prompt";
import { withPlannerTaskPlanContract } from "../planner/task-plan";
import {
  nextActionPlannerNode,
  parseNextActionPlannerOutput,
} from "../nodes/next-action-planner";
import { routeAfterNextAction } from "../graph/routes";

const tabularSkill = {
  skillId: "tabular-planning",
  name: "Tabular planning",
  description: "Plan and build tabular artifacts such as multi-column reports.",
  version: "1.0",
  discoverable: true,
  disclosure: "summary" as const,
  resources: [],
};

const skillVisibility = {
  scopeId: "main_agent",
  scopeKind: "main_agent" as const,
  maxSkillDisclosure: "body" as const,
  maxResourceDisclosure: "content" as const,
  skills: [tabularSkill],
};

const baseToolExposure: AgentToolExposureState = {
  exposedTools: ["read_open", "web_search"],
  toolMeta: [
    {
      toolId: "read_open",
      title: "Read Open",
      description: "Open a workspace file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      domain: "read",
      source: "internal",
      tags: ["read"],
      capabilities: { sideEffect: "none", requiresApproval: false },
    },
    {
      toolId: "web_search",
      title: "Web Search",
      description: "Search the public web",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      domain: "web_search",
      source: "internal",
      tags: ["web"],
      capabilities: { sideEffect: "network", requiresApproval: false },
    },
  ],
};

const createState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-skill-vs-delegation",
  threadId: "thread-skill-vs-delegation",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "build the requested artifact",
    successCriteria: ["build the requested artifact"],
    constraints: ["safe"],
    riskLevel: "low",
  },
  question: "build the requested artifact",
  messages: [
    {
      role: "user",
      content: "build the requested artifact",
      parts: [{ type: "text", text: "build the requested artifact" }],
    },
  ],
  currentTaskFrame: {
    currentGoal: "build the requested artifact",
    currentSubtask: "Determine the next action.",
    confirmedObjects: [],
    completionCriteria: ["build the requested artifact"],
    // Planner-visible summary Skill catalog; body stays undisclosed.
    skillContext: { instruction: "Skill context is guidance only.", resources: [], disclosedResources: [], skillVisibility },
  },
  toolExposure: withGenericTaskDelegationTool(baseToolExposure),
  evidence: { observations: [], retrievals: [], toolExecutions: [] },
  iterationCount: 0,
  maxIterations: 3,
  ...overrides,
} as unknown as AgentNodeState);

const plannerPayload = (state: AgentNodeState) => {
  const messages = buildNextActionPlannerMessages({
    question: state.question ?? state.goal.text,
    messages: state.messages,
    observationContext: buildPlannerObservationContext(state),
    // buildNextActionPlannerMessages expects a non-optional exposure; the shared
    // state builder always sets it via withGenericTaskDelegationTool.
    toolExposure: state.toolExposure ?? baseToolExposure,
    iteration: 0,
    maxIterations: 3,
  });
  return {
    messages,
    payload: JSON.parse(String(messages[1]?.content ?? "{}")) as {
      skillCatalog?: Array<{ skillId: string }>;
      toolExposure?: { exposedTools: string[] };
    },
  };
};

test("Planner contract exposes a specialist Skill summary and delegate_task together", () => {
  const { messages, payload } = plannerPayload(createState());
  const prompt = messages.map((message) => message.content).join("\n");

  assert.deepEqual(payload.skillCatalog?.map((skill) => skill.skillId), [
    "tabular-planning",
  ]);
  assert.ok(payload.toolExposure?.exposedTools.includes(GENERIC_TASK_DELEGATE_TOOL_ID));

  // The contract must explain the relationship, not just list both actions.
  assert.match(prompt, /materially needed/i);
  assert.match(prompt, /activate_skill/);
  assert.match(prompt, /delegate_task/);
  assert.match(prompt, /before delegate_task/i);
  // The canonical action enumeration advertises activate_skill.
  assert.match(prompt, /"type":"activate_skill"/);
  // Activation is defined by material need, not by topic-keyword matching.
  assert.match(prompt, /not merely because the request mentions a related topic/i);
});

test("task plan contract advertises activate_skill and the specialist Skill rule", () => {
  const messages = withPlannerTaskPlanContract([
    {
      role: "system",
      content: "Return one nextAction JSON and do not output extra fields.",
      parts: [],
    },
    {
      role: "user",
      content: JSON.stringify({ currentUserRequest: "build the requested artifact" }),
      parts: [],
    },
  ]);
  const joined = messages.map((message) => message.content).join("\n");

  assert.match(
    joined,
    /answer\/retrieve\/use_tool\/activate_skill\/ask_user\/error/,
  );
  assert.match(joined, /activate_skill/);
  assert.match(joined, /materially needed/i);
});

test("class 1: specialist artifact task selects activate_skill when both routes are visible", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"activate_skill","skillId":"tabular-planning","reason":"The summary Skill guidance is materially needed for the artifact."}';
    });

  try {
    const patch = await nextActionPlannerNode(createState());
    assert.deepEqual(patch.nextAction, {
      type: "activate_skill",
      skillId: "tabular-planning",
      reason: "The summary Skill guidance is materially needed for the artifact.",
    });

    const sent = (streamSpy.mock.calls[0]?.[0] ?? [])
      .map((message) => String(message.content))
      .join("\n");
    assert.match(sent, /tabular-planning/);
    assert.match(sent, /delegate_task/);
  } finally {
    streamSpy.mockRestore();
  }
});

test("class 1: activate_skill routes to the governed Skill node, not tool normalization", () => {
  const route = routeAfterNextAction({
    nextAction: {
      type: "activate_skill",
      skillId: "tabular-planning",
      reason: "Need the Skill body.",
    },
  } as unknown as Parameters<typeof routeAfterNextAction>[0]);

  assert.equal(route, "activateSkill");
});

test("class 2: ordinary multi-step task without a needed Skill uses generic delegation", async () => {
  const question =
    "读取根目录 package.json 和 server/package.json，比较两边的 Node 和测试脚本配置，给出差异和证据。";
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield JSON.stringify({
        type: "use_tool",
        toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
        args: {
          goal: question,
          acceptanceCriteria: ["两个 package.json 已读取", "差异已有证据"],
        },
        reason: "No specialist Skill is materially needed; delegate the bounded package.",
      });
    });

  try {
    const patch = await nextActionPlannerNode(createState({ question }));
    assert.equal(patch.nextAction?.type, "use_tool");
    assert.equal(
      patch.nextAction?.type === "use_tool" ? patch.nextAction.toolId : undefined,
      GENERIC_TASK_DELEGATE_TOOL_ID,
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("class 2: generic delegation routes to the subAgent node", () => {
  const route = routeAfterNextAction({
    nextAction: {
      type: "use_tool",
      toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
      args: { goal: "compare files", acceptanceCriteria: ["compared"] },
      reason: "Delegate the bounded package.",
    },
  } as unknown as Parameters<typeof routeAfterNextAction>[0]);

  assert.equal(route, "genericTaskSubAgent");
});

test("class 3: a simple one-step read stays a direct tool even with both routes visible", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"use_tool","toolId":"read_open","args":{"path":"package.json"},"reason":"Read the requested file."}';
    });

  try {
    const patch = await nextActionPlannerNode(createState({ question: "读取 package.json。" }));
    assert.equal(patch.nextAction?.type, "use_tool");
    assert.equal(
      patch.nextAction?.type === "use_tool" ? patch.nextAction.toolId : undefined,
      "read_open",
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("class 3: a pure answer stays direct even with both routes visible", async () => {
  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield '{"type":"answer","reason":"Return the requested token.","completionProof":[{"criterion":"reply SMOKE_OK","evidenceRefs":[]}],"unresolvedGaps":[]}';
    });

  try {
    const patch = await nextActionPlannerNode(createState({ question: "只回复 SMOKE_OK。" }));
    assert.equal(patch.nextAction?.type, "answer");
  } finally {
    streamSpy.mockRestore();
  }
});

test("class 4: no relevant Skill leaves an empty catalog and keeps delegation available", async () => {
  const state = createState({
    question: "读取 package.json 和 server/package.json，比较配置并给出差异。",
    currentTaskFrame: {
      currentGoal: "compare the two package.json files",
      currentSubtask: "Determine the next action.",
      confirmedObjects: [],
      completionCriteria: ["compare the two package.json files"],
      skillContext: {
        instruction: "Skill context is guidance only.",
        resources: [],
        disclosedResources: [],
        skillVisibility: { ...skillVisibility, skills: [] },
      },
    } as unknown as AgentNodeState["currentTaskFrame"],
  });

  const { messages, payload } = plannerPayload(state);
  assert.deepEqual(payload.skillCatalog, []);
  assert.ok(payload.toolExposure?.exposedTools.includes(GENERIC_TASK_DELEGATE_TOOL_ID));

  const prompt = messages.map((message) => message.content).join("\n");
  assert.match(prompt, /delegate_task/);
  // With no discoverable Skill, the contract must not force Skill activation.
  assert.match(prompt, /Simple one-call tasks and pure answers stay direct/i);

  const streamSpy = vi
    .spyOn(providerProxyService, "streamTaskChatText")
    .mockImplementation(async function* () {
      yield JSON.stringify({
        type: "use_tool",
        toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
        args: {
          goal: "compare the two package.json files",
          acceptanceCriteria: ["both files read", "differences reported"],
        },
        reason: "No specialist Skill is visible; delegate the bounded package.",
      });
    });
  try {
    const patch = await nextActionPlannerNode(state);
    assert.equal(
      patch.nextAction?.type === "use_tool" ? patch.nextAction.toolId : undefined,
      GENERIC_TASK_DELEGATE_TOOL_ID,
    );
  } finally {
    streamSpy.mockRestore();
  }
});

test("activate_skill parser rejects an empty skillId without inventing a route", () => {
  assert.equal(
    parseNextActionPlannerOutput('{"type":"activate_skill","skillId":"  "}'),
    null,
  );
});
