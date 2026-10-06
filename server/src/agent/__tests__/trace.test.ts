import assert from "node:assert/strict";
import { test } from "vitest";
import {
  getToolTraceTargetPreview,
  summarizePlannerNextAction,
  summarizeToolExecutionFailure,
  toAgentResumeExecutionNode,
  toAgentApprovalExecutionNode,
  toAgentErrorExecutionNode,
  toAgentExecutionNode,
} from "../trace";

test("toAgentExecutionNode prefixes runId into node details", () => {
  const event = toAgentExecutionNode({
    runId: "run-1",
    nodeId: "agent-generate",
    nodeType: "generate",
    phase: "done",
    label: "生成回答",
    slotKey: "agent-generate",
    attemptKey: "agent-generate#1",
    iteration: 1,
    summary: "ok",
    details: { answerLength: 42 },
  });

  assert.equal(event.nodeId, "agent-generate");
  assert.equal(event.nodeType, "generate");
  assert.equal(event.phase, "done");
  assert.equal(event.traceDomain, "agent");
  assert.equal(event.slotKey, "agent-generate");
  assert.equal(event.attemptKey, "agent-generate#1");
  assert.equal(event.iteration, 1);
  assert.equal(event.summary, "ok");
  assert.deepEqual(event.details, {
    runId: "run-1",
    answerLength: 42,
  });
});

test("toAgentErrorExecutionNode emits error phase", () => {
  const event = toAgentErrorExecutionNode({
    runId: "run-1",
    nodeId: "agent-error",
    label: "错误节点",
    summary: "boom",
  });

  assert.equal(event.nodeType, "error");
  assert.equal(event.phase, "error");
  assert.equal(event.summary, "boom");
});

test("toAgentApprovalExecutionNode emits approval phase", () => {
  const event = toAgentApprovalExecutionNode({
    runId: "run-1",
    nodeId: "agent-approval",
    label: "审批节点",
    summary: "waiting",
  });

  assert.equal(event.nodeType, "approval");
  assert.equal(event.phase, "start");
  assert.equal(event.summary, "waiting");
});

test("summarizePlannerNextAction turns use_tool into a user-visible next step", () => {
  assert.equal(
    summarizePlannerNextAction({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Need the file content.",
      },
      pendingApprovalActive: false,
      recoveryExhausted: false,
    }),
    "下一步改为执行 read_open：README.md",
  );
});

test("summarizeToolExecutionFailure explains recoverable retry intent", () => {
  assert.equal(
    summarizeToolExecutionFailure({
      toolId: "read_open",
      failureKind: "recoverable",
      args: { path: "missing.md" },
    }),
    "read_open 执行失败：missing.md，正在重新判断下一步",
  );
  assert.equal(getToolTraceTargetPreview("terminal", { command: "pnpm check" }), "pnpm check");
  assert.equal(
    getToolTraceTargetPreview("terminal_session", { command: "pnpm check" }),
    "pnpm check",
  );
});

test("toAgentResumeExecutionNode emits a user-visible resume event", () => {
  const event = toAgentResumeExecutionNode({
    runId: "run-1",
    toolId: "terminal",
    toolCallId: "pending-1",
    inputHash: "hash-1",
  });

  assert.equal(event.nodeId, "agent-resume-execution");
  assert.equal(event.nodeType, "approval");
  assert.equal(event.phase, "done");
  assert.equal(event.label, "恢复执行");
  assert.equal(event.summary, "审批已通过，继续恢复 terminal 的执行");
  assert.deepEqual(event.details, {
    runId: "run-1",
    toolId: "terminal",
    toolCallId: "pending-1",
    inputHash: "hash-1",
    resumedFromApproval: true,
  });
});
