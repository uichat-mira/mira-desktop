import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import { createAgentGoal } from "../nodes/goal-plan";
import { nextActionPlannerNode } from "../planner/node";
import type { AgentNodeState } from "../node-runtime";
import { DEFAULT_AGENT_MAX_ITERATIONS } from "../graph/state";

const compoundRequest =
  "Read README.md, read package.json, compare the install instructions, fix README.md when needed, and verify the result.";

const createState = (): AgentNodeState => {
  const goal = createAgentGoal(compoundRequest);

  return {
    runId: "run-pi-loop",
    threadId: "thread-pi-loop",
    userId: 1,
    goal,
    question: compoundRequest,
    messages: [
      {
        role: "user",
        content: compoundRequest,
        parts: [{ type: "text", text: compoundRequest }],
      },
    ],
    currentTaskFrame: {
      currentGoal: compoundRequest,
      currentSubtask: "Read the first required file.",
      confirmedObjects: [],
      completionCriteria: [...goal.successCriteria],
      coveredProgress: ["Opened file README.md."],
    },
    toolExposure: {
      exposedTools: ["read_open", "edit_file", "terminal"],
      toolMeta: [
        {
          toolId: "read_open",
          title: "Read Open",
          description: "Open a known workspace file.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          domain: "read",
          source: "internal",
          capabilities: {
            sideEffect: "none",
            requiresApproval: false,
            workspaceBound: true,
          },
        },
        {
          toolId: "edit_file",
          title: "Edit File",
          description: "Edit a workspace file.",
          inputSchema: { type: "object", properties: {} },
          domain: "edit",
          source: "internal",
          capabilities: {
            sideEffect: "local-write",
            requiresApproval: false,
            workspaceBound: true,
          },
        },
        {
          toolId: "terminal",
          title: "Terminal Session",
          description: "Run a workspace command.",
          inputSchema: { type: "object", properties: {} },
          domain: "terminal",
          source: "internal",
          capabilities: {
            sideEffect: "process",
            requiresApproval: true,
            workspaceBound: true,
            longRunning: true,
          },
        },
      ],
    },
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolCallId: "read-readme",
          toolId: "read_open",
          inputHash: "hash-readme",
          args: { path: "README.md" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "read_open",
            actionTaken: "Opened file README.md.",
            keyFindings: ["README install command is npm install."],
            facts: ["path=README.md", "install=npm install"],
          },
          startedAt: "2026-07-18T00:00:00.000Z",
          finishedAt: "2026-07-18T00:00:01.000Z",
        },
        {
          toolCallId: "read-package",
          toolId: "read_open",
          inputHash: "hash-package",
          args: { path: "package.json" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "read_open",
            actionTaken: "Opened file package.json.",
            keyFindings: ["package manager is pnpm."],
            facts: ["path=package.json", "packageManager=pnpm"],
          },
          startedAt: "2026-07-18T00:00:02.000Z",
          finishedAt: "2026-07-18T00:00:03.000Z",
        },
      ],
    },
    observations: [],
    iterationCount: 2,
    maxIterations: DEFAULT_AGENT_MAX_ITERATIONS,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("compound goals retain the original request as the completion contract", () => {
  const goal = createAgentGoal(compoundRequest);

  assert.equal(goal.text, compoundRequest);
  assert.equal(goal.successCriteria.some((item) => item.includes(compoundRequest)), true);
  assert.equal(
    goal.successCriteria.some((item) => item.includes("all explicit requirements")),
    true,
  );
  assert.equal(goal.constraints.some((item) => item.includes("MCP tool contracts")), true);
});

test("the default loop budget supports a multi-step read compare edit verify task", () => {
  assert.equal(DEFAULT_AGENT_MAX_ITERATIONS, 8);
});

test("planner receives accumulated execution history and continues after read steps", async () => {
  let capturedMessages: NormalizedChatMessage[] = [];
  vi.spyOn(providerProxyService, "streamTaskChatText").mockImplementation(
    async function* (messages: NormalizedChatMessage[]) {
      capturedMessages = messages;
      yield JSON.stringify({
        type: "use_tool",
        toolId: "edit_file",
        args: {
          operation: "replace_block",
          path: "README.md",
          expectedOldText: "npm install",
          newText: "pnpm install",
        },
        reason:
          "README.md and package.json were read and compared, but the requested fix and verification are still unfinished.",
      });
    },
  );

  const result = await nextActionPlannerNode(createState());

  assert.equal(result.nextAction?.type, "use_tool");
  if (result.nextAction?.type !== "use_tool") {
    throw new Error("Planner did not continue with a tool action.");
  }
  assert.equal(result.nextAction.toolId, "edit_file");

  const payloads = capturedMessages
    .map((message) => {
      try {
        return JSON.parse(message.content) as {
          completionContract?: { originalGoal?: string; completionCriteria?: string[] };
          continuousAgentContextInjected?: boolean;
        };
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
  const completionPayload = payloads.find(
    (candidate) => candidate?.completionContract?.originalGoal,
  );
  const continuousContext = capturedMessages.find((message) =>
    message.content.includes("CONTINUOUS AGENT LOOP CONTEXT"),
  )?.content ?? "";

  assert.equal(completionPayload?.completionContract?.originalGoal, compoundRequest);
  assert.equal(completionPayload?.continuousAgentContextInjected, true);
  assert.match(continuousContext, /TURN 1[\s\S]*read_open[\s\S]*README\.md/);
  assert.match(continuousContext, /TURN 2[\s\S]*read_open[\s\S]*package\.json/);
  assert.match(continuousContext, /Opened file README\.md\./);
  assert.match(continuousContext, /Opened file package\.json\./);
  assert.equal(
    result.currentTaskFrame?.coveredProgress?.includes("Opened file README.md."),
    true,
  );
  assert.equal(
    result.currentTaskFrame?.coveredProgress?.includes("Opened file package.json."),
    true,
  );
});
