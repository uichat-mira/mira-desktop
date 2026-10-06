import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createGenericTaskResumeExposure,
  GENERIC_TASK_DELEGATE_TOOL_ID,
  GENERIC_TASK_SUBAGENT_SKILL_ID,
} from "../delegation/contract.js";
import { routeAfterEvidence } from "../graph/routes.js";
import type { AgentToolCallRequest } from "../types.js";

const createGenericPendingToolCall = () =>
  ({
    toolId: "terminal",
    args: { command: "pnpm test" },
    inputHash: "hash-generic-task",
    source: "llm_tool_call",
    origin: "skill_agent",
    skillId: GENERIC_TASK_SUBAGENT_SKILL_ID,
    createdAt: "2026-07-27T00:00:00.000Z",
    skillAgentCheckpoint: {
      version: 1,
      skillContextSnapshot: {
        primary: {
          id: GENERIC_TASK_SUBAGENT_SKILL_ID,
          execution: {
            allowedTools: [
              "read_open",
              "terminal",
              GENERIC_TASK_DELEGATE_TOOL_ID,
            ],
          },
        },
      },
    },
  }) as AgentToolCallRequest;

test("generic approval resume restores the frozen child tool ids", () => {
  const resumed = createGenericTaskResumeExposure({
    currentExposure: {
      exposedTools: ["web_search", GENERIC_TASK_DELEGATE_TOOL_ID],
      toolMeta: [
        {
          toolId: "web_search",
          title: "Web Search",
          description: "Search the web.",
        },
        {
          toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
          title: "Delegate Task",
          description: "Planner protocol tool.",
        },
      ],
    },
    pendingToolCall: createGenericPendingToolCall(),
  });

  assert.deepEqual(resumed.exposedTools, [
    "web_search",
    "read_open",
    "terminal",
  ]);
  assert.equal(
    resumed.exposedTools.includes(GENERIC_TASK_DELEGATE_TOOL_ID),
    false,
  );
  assert.equal(
    resumed.toolMeta.some(
      (tool) => tool.toolId === GENERIC_TASK_DELEGATE_TOOL_ID,
    ),
    false,
  );
});

test("non-generic approvals cannot restore generic task tools", () => {
  const pending = {
    ...createGenericPendingToolCall(),
    skillId: "docx",
  } as AgentToolCallRequest;
  const resumed = createGenericTaskResumeExposure({
    currentExposure: {
      exposedTools: [GENERIC_TASK_DELEGATE_TOOL_ID],
      toolMeta: [],
    },
    pendingToolCall: pending,
  });

  assert.deepEqual(resumed.exposedTools, []);
});

test("delegated approval goes from Evidence directly to Approval", () => {
  const route = routeAfterEvidence({
    pendingApproval: {
      id: "approval-generic-task",
      runId: "run-generic-task",
      stepId: `subagent:${GENERIC_TASK_SUBAGENT_SKILL_ID}`,
      toolId: "terminal",
      reason: "Command execution requires approval.",
      createdAt: "2026-07-27T00:00:00.000Z",
    },
  } as never);

  assert.equal(route, "approval");
});
