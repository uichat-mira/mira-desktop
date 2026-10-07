import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test, vi } from "vitest";
import * as harnessInvocations from "@/harness/invocations";
import { getWorkspaceRoot } from "@/mcp/workspace";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { createInvocationInputHash } from "../approval-fingerprint";
import { toolNode } from "../nodes/tool-node";
import type { AgentNodeState } from "../node-runtime";

const createBaseState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-1",
  threadId: "thread-1",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "inspect docs",
    successCriteria: ["inspect docs"],
    constraints: [],
    riskLevel: "low",
  },
  plan: {
    id: "plan-1",
    goalId: "goal-1",
    version: 1,
    steps: [],
  },
  messages: [],
  ...overrides,
});

test("toolNode executes the frozen pendingToolCall without rebuilding args", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-1",
      toolId: "web_search",
      status: "completed",
      result: { ok: true },
      llmContent: {
        version: 1,
        source: "harness_result",
        blocks: [{ type: "text", text: "explicit harness content" }],
        truncated: false,
        originalCharCount: 24,
        includedCharCount: 24,
        omittedArrayItems: 0,
        omittedObjectKeys: 0,
      },
      startedAt: "2026-06-30T00:00:00.000Z",
      finishedAt: "2026-06-30T00:00:01.000Z",
    });

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "web_search",
          inputHash: "hash-frozen-query",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-1",
          toolId: "web_search",
          args: { query: "frozen query" },
          inputHash: "hash-frozen-query",
          source: "planner",
          status: "frozen",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.deepEqual(executeHarnessInvocationSpy.mock.calls[0]?.[0], {
      toolId: "web_search",
      args: { query: "frozen query" },
      userId: 1,
      threadId: "thread-1",
      approvedInvocations: undefined,
    });
    assert.equal(result.lastToolExecution?.status, "completed");
    assert.equal(result.lastToolExecution?.toolCallId, "pending-1");
    assert.equal(result.lastToolExecution?.inputHash, "hash-frozen-query");
    assert.deepEqual(result.lastToolExecution?.args, { query: "frozen query" });
    assert.equal(result.lastToolExecution?.toolId, "web_search");
    const llmContent = (result.lastToolExecution as typeof result.lastToolExecution & {
      llmContent?: { blocks: Array<{ text: string }> };
    })?.llmContent;
    assert.equal(llmContent?.blocks[0]?.text, "explicit harness content");
    assert.equal(result.errorMessage, undefined);
    assert.equal(result.pendingToolCall, undefined);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode remaps approvedInvocations to Harness arg hashes before execution", async () => {
  const frozenArgs = {
    command: "dir",
    cwd: "D:\\workspace\\rag-demo",
  };
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-approved-terminal-1",
      toolId: "terminal",
      status: "completed",
      result: { command: "dir", stdout: "ok", stderr: "", exitCode: 0, timedOut: false },
      startedAt: "2026-07-04T00:00:00.000Z",
      finishedAt: "2026-07-04T00:00:01.000Z",
    });

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "terminal",
          inputHash: "agent-frozen-hash",
          reason: "Allowed in test.",
        },
        approvedInvocations: [
          {
            toolId: "terminal",
            input: frozenArgs,
            inputHash: "agent-frozen-hash",
            approvedAt: "2026-07-04T00:00:00.000Z",
            approvalId: "approval-1",
          },
        ],
        pendingToolCall: {
          id: "pending-approved-terminal-1",
          toolId: "terminal",
          args: frozenArgs,
          inputHash: "agent-frozen-hash",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-04T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.deepEqual(executeHarnessInvocationSpy.mock.calls[0]?.[0].approvedInvocations, [
      {
        toolId: "terminal",
        inputHash: createInvocationInputHash(frozenArgs),
      },
    ]);
    assert.deepEqual(result.approvedInvocations, []);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode passes workspaceRoot through to the invocation environment", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-workspace-1",
      toolId: "read_list",
      status: "completed",
      result: { entries: [] },
      startedAt: "2026-07-04T00:00:00.000Z",
      finishedAt: "2026-07-04T00:00:01.000Z",
    });

  try {
    await toolNode(
      createBaseState({
        workspaceRoot: "D:\\testData",
        policyDecision: {
          type: "allow",
          toolId: "read_list",
          inputHash: "hash-read-list",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-workspace-1",
          toolId: "read_list",
          args: { path: "." },
          inputHash: "hash-read-list",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-04T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(
      executeHarnessInvocationSpy.mock.calls[0]?.[0].environment?.workspace.rootPath,
      "D:\\testData",
    );
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode applies workspaceRoot as the active workspace during invocation execution", async () => {
  const workspaceRoot = createTimestampedTestArtifactPath(
    "workspace",
    "rag-demo-tool-node-workspace",
  );
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockImplementation(async () => ({
      id: "invocation-workspace-override-1",
      toolId: "read_list",
      status: "completed",
      result: { activeWorkspaceRoot: getWorkspaceRoot() },
      startedAt: "2026-07-04T00:00:00.000Z",
      finishedAt: "2026-07-04T00:00:01.000Z",
    }));

  try {
    const result = await toolNode(
      createBaseState({
        workspaceRoot,
        policyDecision: {
          type: "allow",
          toolId: "read_list",
          inputHash: "hash-read-list-override",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-workspace-override-1",
          toolId: "read_list",
          args: { path: "." },
          inputHash: "hash-read-list-override",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-04T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(
      result.lastToolExecution?.result &&
        typeof result.lastToolExecution.result === "object" &&
        "activeWorkspaceRoot" in result.lastToolExecution.result
        ? result.lastToolExecution.result.activeWorkspaceRoot
        : null,
      workspaceRoot,
    );
  } finally {
    executeHarnessInvocationSpy.mockRestore();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("toolNode blocks execution when pendingToolCall is missing", async () => {
  const executeHarnessInvocationSpy = vi.spyOn(
    harnessInvocations,
    "executeHarnessInvocation",
  );

  try {
    const result = await toolNode(
      createBaseState({
        selectedToolId: "terminal",
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 0);
    assert.equal(result.pendingToolCall, undefined);
    assert.match(result.errorMessage ?? "", /No pendingToolCall available/i);
    assert.equal(result.errorSourceNodeId, "agent-tool");
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode ignores selectedToolId drift and only executes the frozen pendingToolCall", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-2",
      toolId: "web_search",
      status: "completed",
      result: { ok: true },
      startedAt: "2026-06-30T00:00:00.000Z",
      finishedAt: "2026-06-30T00:00:01.000Z",
    });

  try {
    const result = await toolNode(
      createBaseState({
        selectedToolId: "terminal",
        policyDecision: {
          type: "allow",
          toolId: "web_search",
          inputHash: "hash-frozen-query",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-2",
          toolId: "web_search",
          args: { query: "frozen query" },
          inputHash: "hash-frozen-query",
          source: "planner",
          status: "frozen",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.lastToolExecution?.toolId, "web_search");
    assert.equal(result.pendingToolCall, undefined);
    assert.equal(result.errorMessage, undefined);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode reports a Harness approval request without creating Policy approval state", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-awaiting-approval-1",
      toolId: "terminal",
      status: "awaiting_approval",
      approval: {
        reason: "terminal requires reviewed approval.",
      },
      startedAt: "2026-07-04T00:00:00.000Z",
    } as never);

  const pendingToolCall = {
    id: "pending-approval-1",
    toolId: "terminal",
    args: {
      command: "dir",
      cwd: "D:\\workspace\\rag-demo",
    },
    inputHash: "hash-terminal-dir",
    source: "planner" as const,
    status: "frozen" as const,
    createdAt: "2026-07-04T00:00:00.000Z",
  };

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: pendingToolCall.toolId,
          inputHash: pendingToolCall.inputHash,
          reason: "Allowed in test.",
        },
        pendingToolCall,
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.pendingApproval, undefined);
    assert.equal(result.policyDecision, undefined);
    assert.deepEqual(result.pendingToolCall, pendingToolCall);
    assert.equal(result.lastToolExecution?.status, "awaiting_approval");
    assert.equal(result.lastToolExecution?.toolCallId, pendingToolCall.id);
    assert.match(result.errorMessage ?? "", /Policy must create pendingApproval/i);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode records recoverable Harness failure without promoting it to a global tool-node error", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-read-open-failed",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "File not found",
      },
      startedAt: "2026-07-06T00:00:00.000Z",
      finishedAt: "2026-07-06T00:00:01.000Z",
    } as never);

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open-missing",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-read-open-failed",
          toolId: "read_open",
          args: { path: "missing.md" },
          inputHash: "hash-read-open-missing",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-06T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.errorMessage, undefined);
    assert.equal(result.errorSourceNodeId, undefined);
    assert.equal(result.pendingToolCall, undefined);
    assert.equal(result.pendingApproval, undefined);
    assert.equal(result.lastToolExecution?.status, "failed");
    assert.equal(result.lastToolExecution?.failureKind, "recoverable");
    assert.equal(result.lastToolExecution?.failureCode, undefined);
    assert.equal(result.lastToolExecution?.recoveryAttemptCount, 1);
    assert.equal(result.evidence, undefined);
    assert.equal(result.pendingToolExecution?.status, "failed");
    assert.deepEqual(result.observations?.at(-1)?.facts, [
      "read_open failed during Harness execution but can be retried.",
    ]);
    assert.equal(result.observations?.at(-1)?.status, "failed");
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode prioritizes structured failureCode over terminal-looking message patterns", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-failurecode-priority",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "Tool protocol mismatch: result payload is invalid",
        failureCode: "tool_runtime_failed",
      },
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:00:01.000Z",
    } as never);

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open-priority",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-read-open-priority",
          toolId: "read_open",
          args: { path: "README.md" },
          inputHash: "hash-read-open-priority",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-07T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.lastToolExecution?.failureCode, "tool_runtime_failed");
    assert.equal(result.lastToolExecution?.failureKind, "recoverable");
    assert.equal(result.errorMessage, undefined);
    assert.match(
      result.pendingToolExecution?.failureCode ?? "",
      /^tool_runtime_failed$/,
    );
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode treats schema_invalid failureCode as terminal even without schema-like message text", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-schema-invalid-terminal",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "The tool returned a malformed payload.",
        failureCode: "schema_invalid",
      },
      startedAt: "2026-07-08T00:00:00.000Z",
      finishedAt: "2026-07-08T00:00:01.000Z",
    } as never);

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open-schema-invalid",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-read-open-schema-invalid",
          toolId: "read_open",
          args: { path: "README.md" },
          inputHash: "hash-read-open-schema-invalid",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-08T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.lastToolExecution?.failureCode, "schema_invalid");
    assert.equal(result.lastToolExecution?.failureKind, "terminal");
    assert.match(
      result.pendingToolExecution?.failureCode ?? "",
      /^schema_invalid$/,
    );
    assert.match(result.errorMessage ?? "", /malformed payload/i);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode keeps terminal Harness failure on the global error path", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-terminal-failed",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "Tool protocol mismatch: result payload is invalid",
      },
      startedAt: "2026-07-06T00:00:00.000Z",
      finishedAt: "2026-07-06T00:00:01.000Z",
    } as never);

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open-terminal",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-read-open-terminal",
          toolId: "read_open",
          args: { path: "README.md" },
          inputHash: "hash-read-open-terminal",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-06T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.lastToolExecution?.status, "failed");
    assert.equal(result.lastToolExecution?.failureKind, "terminal");
    assert.equal(result.lastToolExecution?.recoveryAttemptCount, undefined);
    assert.match(result.errorMessage ?? "", /protocol mismatch/i);
    assert.equal(result.errorSourceNodeId, "agent-tool");
    assert.match(result.terminalReason ?? "", /protocol mismatch/i);
    assert.match(result.blockedReason ?? "", /protocol mismatch/i);
    assert.equal(result.observations?.at(-1)?.status, "blocked");
    assert.equal(result.evidence, undefined);
    assert.equal(result.pendingToolExecution?.status, "failed");
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode treats workspace_escape failureCode as terminal and exposes it in evidence", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-workspace-escape",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "File not found",
        failureCode: "workspace_escape",
      },
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:00:01.000Z",
    } as never);

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open-workspace-escape",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-read-open-workspace-escape",
          toolId: "read_open",
          args: { path: "../README.md" },
          inputHash: "hash-read-open-workspace-escape",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-07T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.lastToolExecution?.failureCode, "workspace_escape");
    assert.equal(result.lastToolExecution?.failureKind, "terminal");
    assert.match(
      result.pendingToolExecution?.failureCode ?? "",
      /^workspace_escape$/,
    );
    assert.match(result.errorMessage ?? "", /File not found/);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode treats timeout failureCode as recoverable even when the message matches terminal fallback patterns", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-timeout-recoverable",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "Outside workspace guard timed out before a stable result was produced.",
        failureCode: "timeout",
      },
      startedAt: "2026-07-08T00:00:00.000Z",
      finishedAt: "2026-07-08T00:00:01.000Z",
    } as never);

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open-timeout",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-read-open-timeout",
          toolId: "read_open",
          args: { path: "README.md" },
          inputHash: "hash-read-open-timeout",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-08T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.lastToolExecution?.failureCode, "timeout");
    assert.equal(result.lastToolExecution?.failureKind, "recoverable");
    assert.equal(result.errorMessage, undefined);
    assert.match(
      result.pendingToolExecution?.failureCode ?? "",
      /^timeout$/,
    );
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode falls back to legacy terminal message patterns when failureCode is absent", async () => {
  const executeHarnessInvocationSpy = vi
    .spyOn(harnessInvocations, "executeHarnessInvocation")
    .mockResolvedValue({
      id: "invocation-legacy-fallback-terminal",
      toolId: "read_open",
      status: "failed",
      error: {
        message: "Approval mismatch while replaying the frozen invocation.",
      },
      startedAt: "2026-07-08T00:00:00.000Z",
      finishedAt: "2026-07-08T00:00:01.000Z",
    } as never);

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "read_open",
          inputHash: "hash-read-open-legacy-fallback",
          reason: "Allowed in test.",
        },
        pendingToolCall: {
          id: "pending-read-open-legacy-fallback",
          toolId: "read_open",
          args: { path: "README.md" },
          inputHash: "hash-read-open-legacy-fallback",
          source: "planner",
          status: "frozen",
          createdAt: "2026-07-08T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 1);
    assert.equal(result.lastToolExecution?.failureCode, undefined);
    assert.equal(result.lastToolExecution?.failureKind, "terminal");
    assert.equal(result.evidence, undefined);
    assert.match(result.errorMessage ?? "", /approval mismatch/i);
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode blocks execution when policy has not explicitly allowed the frozen call", async () => {
  const executeHarnessInvocationSpy = vi.spyOn(
    harnessInvocations,
    "executeHarnessInvocation",
  );

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "require_approval",
          toolId: "web_search",
          inputHash: "hash-frozen-query",
          reason: "Still pending approval.",
        },
        pendingToolCall: {
          id: "pending-3",
          toolId: "web_search",
          args: { query: "frozen query" },
          inputHash: "hash-frozen-query",
          source: "planner",
          status: "frozen",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 0);
    assert.equal(result.pendingToolCall, undefined);
    assert.match(result.errorMessage ?? "", /Policy decision does not allow|No policy allow decision/i);
    assert.equal(result.errorSourceNodeId, "agent-tool");
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});

test("toolNode blocks execution when policy inputHash does not match the frozen call", async () => {
  const executeHarnessInvocationSpy = vi.spyOn(
    harnessInvocations,
    "executeHarnessInvocation",
  );

  try {
    const result = await toolNode(
      createBaseState({
        policyDecision: {
          type: "allow",
          toolId: "web_search",
          inputHash: "different-hash",
          reason: "Mismatched approval.",
        },
        pendingToolCall: {
          id: "pending-4",
          toolId: "web_search",
          args: { query: "frozen query" },
          inputHash: "hash-frozen-query",
          source: "planner",
          status: "frozen",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      }),
    );

    assert.equal(executeHarnessInvocationSpy.mock.calls.length, 0);
    assert.equal(result.pendingToolCall, undefined);
    assert.match(
      result.errorMessage ?? "",
      /Policy decision does not allow this frozen pendingToolCall/i,
    );
    assert.equal(result.errorSourceNodeId, "agent-tool");
  } finally {
    executeHarnessInvocationSpy.mockRestore();
  }
});
