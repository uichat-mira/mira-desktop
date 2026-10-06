import assert from "node:assert/strict";
import { test } from "vitest";
import {
  applyAgentRuntimeCheckpoint,
  getAgentRuntimeCheckpoint,
  persistAgentRuntimeCheckpoint,
} from "../runtime-checkpoint";
import { createAgentGoal } from "../nodes/goal-plan";
import type {
  AgentGraphInput,
  AgentGraphOutput,
  AgentRun,
} from "../types";

const goalText = "Read two files, compare them, edit one file, and verify.";

const runtimeInput: NonNullable<AgentRun["runtimeInput"]> = {
  messages: [
    {
      role: "user",
      content: goalText,
      parts: [{ type: "text", text: goalText }],
    },
  ],
  requestContextMessages: [],
  params: { temperature: 0 },
  knowledgeBaseId: null,
  workspaceRoot: "D:/workspace/mira",
};

const graphInput: AgentGraphInput = {
  runId: "run-checkpoint",
  threadId: "thread-checkpoint",
  userId: 1,
  goal: createAgentGoal(goalText),
  messages: runtimeInput.messages,
  requestContextMessages: runtimeInput.requestContextMessages,
  params: runtimeInput.params,
  knowledgeBaseId: runtimeInput.knowledgeBaseId,
  workspaceRoot: runtimeInput.workspaceRoot,
  approvedInvocations: [],
  pendingToolCall: {
    id: "pending-edit",
    toolId: "edit",
    args: {
      path: "README.md",
      edits: [{ oldText: "npm install", newText: "pnpm install" }],
    },
    inputHash: "hash-edit",
    source: "planner",
    status: "frozen",
    createdAt: "2026-07-18T00:00:00.000Z",
  },
};

const output = {
  answer: "",
  observations: [
    {
      id: "observation-readme",
      runId: "run-checkpoint",
      stepId: "tool",
      status: "ok",
      facts: ["README.md was opened."],
      createdAt: "2026-07-18T00:00:01.000Z",
    },
  ],
  evidence: {
    observations: [],
    retrievals: [],
    toolExecutions: [
      {
        toolCallId: "read-readme",
        toolId: "read_open",
        args: { path: "README.md" },
        inputHash: "hash-readme",
        status: "completed",
        result: { text: "npm install" },
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_open",
          actionTaken: "Opened README.md.",
          keyFindings: ["install=npm install"],
        },
        startedAt: "2026-07-18T00:00:00.000Z",
        finishedAt: "2026-07-18T00:00:01.000Z",
      },
    ],
  },
  retrievedChunks: [],
  currentTaskFrame: {
    currentGoal: goalText,
    currentSubtask: "Edit README.md.",
    confirmedObjects: [],
    completionCriteria: [goalText],
    coveredProgress: ["Opened README.md.", "Opened package.json."],
    remainingWork: ["Edit README.md.", "Verify the result."],
  },
  lastToolExecution: {
    toolCallId: "read-package",
    toolId: "read_open",
    args: { path: "package.json" },
    inputHash: "hash-package",
    status: "completed",
    result: { text: "pnpm" },
    startedAt: "2026-07-18T00:00:02.000Z",
    finishedAt: "2026-07-18T00:00:03.000Z",
  },
  pendingApproval: {
    id: "approval-edit",
    runId: "run-checkpoint",
    stepId: "approval",
    toolId: "edit",
    toolCallId: "pending-edit",
    reason: "Workspace write requires approval.",
    input: {
      path: "README.md",
      edits: [{ oldText: "npm install", newText: "pnpm install" }],
    },
    inputHash: "hash-edit",
    createdAt: "2026-07-18T00:00:04.000Z",
  },
  pendingToolCall: graphInput.pendingToolCall,
  approvedInvocations: [],
  blockedReason: "waiting approval",
  terminalReason: "waiting_approval",
  status: "waiting_approval",
  iterationCount: 2,
} satisfies AgentGraphOutput & { iterationCount: number };

test("runtime checkpoint survives persistence and restores planner state", () => {
  const persistedRuntimeInput = persistAgentRuntimeCheckpoint(
    runtimeInput,
    output,
  );
  const checkpoint = getAgentRuntimeCheckpoint(persistedRuntimeInput);
  const restoredInput = applyAgentRuntimeCheckpoint(graphInput, checkpoint);

  assert.equal(checkpoint?.iterationCount, 2);
  assert.equal(checkpoint?.evidence?.toolExecutions.length, 1);
  assert.deepEqual(checkpoint?.currentTaskFrame?.coveredProgress, [
    "Opened README.md.",
    "Opened package.json.",
  ]);
  assert.equal(restoredInput.iterationCount, 2);
  assert.equal(restoredInput.evidence?.toolExecutions[0]?.toolId, "read_open");
  assert.equal(
    restoredInput.currentTaskFrame?.remainingWork?.includes("Verify the result."),
    true,
  );
  assert.equal(restoredInput.pendingToolCall?.toolId, "edit");
});

test("runtime checkpoint is cleared after the run leaves approval state", () => {
  const withCheckpoint = persistAgentRuntimeCheckpoint(runtimeInput, output);
  const completedOutput: AgentGraphOutput = {
    ...output,
    answer: "README.md was fixed and verified.",
    pendingApproval: undefined,
    pendingToolCall: undefined,
    blockedReason: undefined,
    terminalReason: "completed",
    status: "completed",
  };

  const clearedRuntimeInput = persistAgentRuntimeCheckpoint(
    withCheckpoint,
    completedOutput,
  );

  assert.equal(getAgentRuntimeCheckpoint(clearedRuntimeInput), undefined);
  assert.equal(clearedRuntimeInput.messages, runtimeInput.messages);
  assert.equal(clearedRuntimeInput.workspaceRoot, runtimeInput.workspaceRoot);
});
