import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { agentGraph } from "../graph";
import { scheduleApprovedAgentRunResume } from "../resume";
import { agentRunStore } from "../run-store";
import { ConversationWorkdirError, conversationWorkdirService } from "@/services/conversation-workdir.service.js";
import { createInvocationInputHash } from "../approval-fingerprint";
import { createAgentGoal } from "../nodes";
import * as messagePersistenceModule from "@/routes/proxy-provider/message-persistence";
import { threadService } from "@/services/thread.service";

const waitForMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("scheduled approval resume returns running and persists incremental trace", async () => {
  const approvedInput = { query: "hello" };
  const inputHash = createInvocationInputHash(approvedInput);
  const run = agentRunStore.create({
    threadId: "thread-1",
    userId: 1,
    goal: createAgentGoal("answer the user"),
    assistantMessageId: "assistant-1",
    assistantParentId: "user-1",
    runtimeInput: {
      messages: [
        {
          role: "user",
          content: "hello",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
      params: {},
    },
  });
  agentRunStore.update(run.id, {
    status: "waiting_approval",
    pendingApproval: {
      id: "approval-1",
      runId: run.id,
      stepId: "approval",
      toolId: "web_search",
      toolCallId: "pending-1",
      reason: "needs approval",
      input: approvedInput,
      inputHash,
      createdAt: "2026-07-18T00:00:00.000Z",
    },
    pendingToolCall: {
      id: "pending-1",
      toolId: "web_search",
      args: approvedInput,
      inputHash,
      source: "planner",
      status: "frozen",
      createdAt: "2026-07-18T00:00:00.000Z",
    },
  });

  let resolveGraph!: (value: unknown) => void;
  const graphPromise = new Promise((resolve) => {
    resolveGraph = resolve;
  });
  let emitExecutionNode:
    | ((event: {
        nodeId: string;
        nodeType: string;
        phase: "start" | "done" | "error";
        label: string;
        summary?: string;
      }) => void | Promise<void>)
    | undefined;
  const runSpy = vi.spyOn(agentGraph, "run").mockImplementation(async (input) => {
    emitExecutionNode = input.onExecutionNode;
    return (await graphPromise) as never;
  });
  const persistSpy = vi
    .spyOn(messagePersistenceModule, "persistAssistantMessage")
    .mockImplementation(() => {});
  const getMessageSpy = vi.spyOn(threadService, "getMessageById").mockReturnValue({
    id: "assistant-1",
    threadId: "thread-1",
    role: "assistant",
    content: "等待审批",
    parts: [{ type: "text", text: "等待审批" }],
    metadata: {},
    createdAt: "2026-07-18T00:00:00.000Z",
  });

  try {
    const runningRun = scheduleApprovedAgentRunResume(run.id);

    assert.equal(runningRun.status, "running");
    assert.equal(runningRun.pendingApproval, undefined);
    assert.equal(agentRunStore.get(run.id)?.status, "running");
    assert.equal(runSpy.mock.calls.length, 0);
    assert.equal(persistSpy.mock.calls.length, 1);
    assert.equal(
      (persistSpy.mock.calls[0]?.[0].metadata as { agent?: { status?: string } })
        .agent?.status,
      "running",
    );

    await waitForMicrotasks();
    assert.equal(runSpy.mock.calls.length, 1);

    await emitExecutionNode?.({
      nodeId: "agent-tool",
      nodeType: "tool",
      phase: "start",
      label: "工具执行",
      summary: "开始执行 web_search",
    });
    assert.equal(persistSpy.mock.calls.length, 2);
    assert.equal(
      (persistSpy.mock.calls[1]?.[0].metadata as { agent?: { status?: string } })
        .agent?.status,
      "running",
    );

    resolveGraph({
      answer: "done",
      observations: [],
      evidence: {
        observations: [],
        toolExecutions: [],
        retrievals: [],
      },
      retrievedChunks: [],
      status: "completed",
    });
    await waitForMicrotasks();

    assert.equal(agentRunStore.get(run.id)?.status, "completed");
    assert.equal(
      (persistSpy.mock.calls.at(-1)?.[0].metadata as {
        agent?: { status?: string };
      }).agent?.status,
      "completed",
    );
  } finally {
    runSpy.mockRestore();
    persistSpy.mockRestore();
    getMessageSpy.mockRestore();
    agentRunStore.clear();
  }
});

test("scheduled approval resume keeps approval state when workdir reopen fails", () => {
  const inputHash = createInvocationInputHash({ query: "hello" });
  const run = agentRunStore.create({
    threadId: "thread-workdir-reopen-failure",
    userId: 1,
    goal: createAgentGoal("answer the user"),
    assistantMessageId: "assistant-workdir-reopen-failure",
    assistantParentId: "user-workdir-reopen-failure",
    runtimeInput: {
      messages: [],
      conversationWorkdir: {
        id: "workdir-1",
        threadId: "thread-workdir-reopen-failure",
        rootPath: "/missing/workdir",
      },
    },
  });
  agentRunStore.update(run.id, {
    status: "waiting_approval",
    pendingApproval: {
      id: "approval-workdir-1",
      runId: run.id,
      stepId: "approval",
      toolId: "web_search",
      reason: "needs approval",
      input: { query: "hello" },
      inputHash,
      createdAt: "2026-07-18T00:00:00.000Z",
    },
    pendingToolCall: {
      id: "pending-workdir-1",
      toolId: "web_search",
      args: { query: "hello" },
      inputHash,
      source: "planner",
      status: "frozen",
      createdAt: "2026-07-18T00:00:00.000Z",
    },
  });
  const reopenSpy = vi.spyOn(conversationWorkdirService, "reopen").mockImplementation(() => {
    throw new ConversationWorkdirError("missing", "Conversation workdir is missing");
  });
  const persistSpy = vi
    .spyOn(messagePersistenceModule, "persistAssistantMessage")
    .mockImplementation(() => {});
  const getMessageSpy = vi.spyOn(threadService, "getMessageById").mockReturnValue({
    id: "assistant-workdir-reopen-failure",
    threadId: "thread-workdir-reopen-failure",
    role: "assistant",
    content: "等待审批",
    parts: [{ type: "text", text: "等待审批" }],
    metadata: {},
    createdAt: "2026-07-18T00:00:00.000Z",
  });

  try {
    assert.throws(
      () => scheduleApprovedAgentRunResume(run.id),
      (error) => error instanceof ConversationWorkdirError && error.code === "missing",
    );
    const persisted = agentRunStore.get(run.id);
    assert.equal(persisted?.status, "waiting_approval");
    assert.equal(persisted?.pendingApproval?.id, "approval-workdir-1");
    assert.equal(persisted?.pendingToolCall?.id, "pending-workdir-1");
    const persistedMessage = persistSpy.mock.calls[0]?.[0];
    assert.equal(
      (persistedMessage?.metadata as { agent?: { status?: string } }).agent?.status,
      "waiting_approval",
    );
    assert.equal(
      (persistedMessage?.parts.find((part) => part.type === "data")?.value as {
        details?: { code?: string };
      }).details?.code,
      "missing",
    );
  } finally {
    reopenSpy.mockRestore();
    persistSpy.mockRestore();
    getMessageSpy.mockRestore();
  }
});
