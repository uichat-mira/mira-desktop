import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildExecutionObservationView,
  toExecutionObservationFromObservation,
  toExecutionObservationFromPendingApproval,
  toExecutionObservationFromRetrievalResult,
  toExecutionObservationFromToolExecution,
} from "../node-runtime";

test("maps retrieve result into a completed execution observation with preview fields", () => {
  const observation = toExecutionObservationFromRetrievalResult({
    knowledgeBaseId: "kb-1",
    query: "inspect docs",
    chunkCount: 2,
    chunks: [
      {
        chunkId: "c1",
        documentName: "README.md",
        content: "doc one",
      },
      {
        chunkId: "c2",
        documentName: "docs/README.md",
        content: "doc two",
      },
    ],
    createdAt: "2026-07-06T10:00:00.000Z",
  });

  assert.equal(observation.source, "retrieval");
  assert.equal(observation.actionType, "retrieve");
  assert.equal(observation.status, "completed");
  assert.deepEqual(observation.argsPreview, {
    query: "inspect docs",
    knowledgeBaseId: "kb-1",
  });
  assert.deepEqual(observation.resultPreview, {
    query: "inspect docs",
    chunkCount: 2,
    documents: ["README.md", "docs/README.md"],
  });
});

test("maps empty retrieve result into a failed_recoverable execution observation", () => {
  const observation = toExecutionObservationFromRetrievalResult({
    knowledgeBaseId: "kb-1",
    query: "missing target",
    chunkCount: 0,
    chunks: [],
    createdAt: "2026-07-06T10:00:00.000Z",
  });

  assert.equal(observation.actionType, "retrieve");
  assert.equal(observation.status, "failed_recoverable");
  assert.equal(observation.recoverable, true);
  assert.deepEqual(observation.suggestedNextActions, [
    "refine_retrieval_query",
    "switch_to_local_evidence_or_tool",
  ]);
});

test("maps generate observation into a failed_terminal execution observation", () => {
  const observation = toExecutionObservationFromObservation({
    id: "obs-1",
    runId: "run-1",
    stepId: "generate",
    status: "failed",
    facts: ["Agent final answer generation failed."],
    errorMessage: "provider unavailable",
    createdAt: "2026-07-06T10:00:00.000Z",
  });

  assert.equal(observation.source, "observation");
  assert.equal(observation.actionType, "generate");
  assert.equal(observation.status, "failed_terminal");
  assert.equal(observation.errorMessage, "provider unavailable");
  assert.equal(observation.recoverable, false);
});

test("maps completed tool execution into a completed execution observation", () => {
  const observation = toExecutionObservationFromToolExecution({
    toolCallId: "tool-call-1",
    toolId: "read_open",
    inputHash: "hash-read-open",
    args: { path: "README.md" },
    status: "completed",
    summary: {
      source: "tool",
      status: "completed",
      toolId: "read_open",
      inputHash: "hash-read-open",
      actionTaken: "Opened README.md.",
      keyFindings: ["contentLength=120"],
      answerReadiness: {
        canAnswer: true,
        reason: "Opened file content is available for answer generation.",
      },
      data: {
        kind: "read_open",
        path: "README.md",
        contentPreview: "hello",
        contentLength: 5,
        truncated: false,
        canAnswerFileQuestion: true,
      },
    },
    result: { type: "open", path: "README.md" },
    startedAt: "2026-07-06T10:00:00.000Z",
    finishedAt: "2026-07-06T10:00:01.000Z",
  });

  assert.equal(observation.source, "tool_execution");
  assert.equal(observation.actionType, "tool");
  assert.equal(observation.status, "completed");
  assert.equal(observation.toolId, "read_open");
  assert.equal(observation.toolCallId, "tool-call-1");
  assert.equal(observation.inputHash, "hash-read-open");
  assert.deepEqual(observation.argsPreview, { path: "README.md" });
  assert.deepEqual(observation.resultPreview, {
    kind: "read_open",
    path: "README.md",
    contentPreview: "hello",
    contentLength: 5,
    truncated: false,
    canAnswerFileQuestion: true,
  });
});

test("maps completed terminal_session into a completed execution observation with terminal preview data", () => {
  const observation = toExecutionObservationFromToolExecution({
    toolCallId: "tool-call-terminal-completed",
    toolId: "terminal_session",
    inputHash: "hash-terminal-completed",
    args: { command: "pwd", cwd: "." },
    status: "completed",
    summary: {
      source: "tool",
      status: "completed",
      toolId: "terminal_session",
      inputHash: "hash-terminal-completed",
      actionTaken: 'Executed terminal command "pwd".',
      keyFindings: ["exitCode=0", "stdout=D:\\workspace\\rag-demo"],
      answerReadiness: {
        canAnswer: true,
        reason: "Terminal command output is available for answer generation.",
      },
      data: {
        kind: "terminal_session",
        command: "pwd",
        exitCode: 0,
        processCompleted: true,
        commandSucceeded: "true",
        taskSatisfied: "unknown",
        stdoutPreview: "D:\\workspace\\rag-demo",
        stderrPreview: "",
        stdoutEncoding: "utf16le",
        stderrEncoding: "utf16le",
        timedOut: false,
        truncated: false,
        binaryDetected: false,
        violations: [],
        outputInterpretable: true,
        canAnswerCommandQuestion: true,
      },
    },
    result: {
      command: "pwd",
      stdout: "D:\\workspace\\rag-demo",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    },
    startedAt: "2026-07-06T10:00:00.000Z",
    finishedAt: "2026-07-06T10:00:01.000Z",
  });

  assert.equal(observation.status, "completed");
  assert.equal(observation.toolId, "terminal_session");
  assert.deepEqual(observation.argsPreview, { command: "pwd", cwd: "." });
  assert.deepEqual(observation.resultPreview, {
    kind: "terminal_session",
    command: "pwd",
    exitCode: 0,
    processCompleted: true,
    commandSucceeded: "true",
    taskSatisfied: "unknown",
    stdoutPreview: "D:\\workspace\\rag-demo",
    stderrPreview: "",
    stdoutEncoding: "utf16le",
    stderrEncoding: "utf16le",
    timedOut: false,
    truncated: false,
    binaryDetected: false,
    violations: [],
    outputInterpretable: true,
    canAnswerCommandQuestion: true,
  });
});

test("maps failed recoverable tool execution into a failed_recoverable execution observation", () => {
  const observation = toExecutionObservationFromToolExecution({
    toolCallId: "tool-call-recoverable",
    toolId: "terminal_session",
    inputHash: "hash-terminal",
    args: { command: "pnpm test" },
    status: "failed",
    errorMessage: "missing script: test",
    result: {
      command: "pnpm test",
      exitCode: 1,
      stderr: "missing script: test",
    },
    startedAt: "2026-07-06T10:00:00.000Z",
    finishedAt: "2026-07-06T10:00:01.000Z",
  });

  assert.equal(observation.status, "failed_recoverable");
  assert.equal(observation.recoverable, true);
  assert.equal(observation.errorMessage, "missing script: test");
  assert.deepEqual(observation.suggestedNextActions, [
    "inspect_failure_cause",
    "retry_with_adjustment",
    "switch_action",
  ]);
});

test("maps terminal blocking tool execution into a failed_terminal execution observation", () => {
  const observation = toExecutionObservationFromToolExecution({
    toolCallId: "tool-call-denied",
    toolId: "write",
    inputHash: "hash-write",
    args: { path: "README.md", content: "updated" },
    status: "denied",
    errorMessage: "Policy denied the write.",
    startedAt: "2026-07-06T10:00:00.000Z",
    finishedAt: "2026-07-06T10:00:01.000Z",
  });

  assert.equal(observation.status, "failed_terminal");
  assert.equal(observation.errorMessage, "Policy denied the write.");
  assert.equal(observation.errorCode, "denied");
  assert.equal(observation.recoverable, false);
});

test("maps pending approval into a waiting_approval execution observation", () => {
  const observation = toExecutionObservationFromPendingApproval(
    {
      id: "approval-1",
      runId: "run-1",
      stepId: "approval",
      toolId: "terminal_session",
      toolCallId: "tool-call-3",
      inputHash: "hash-terminal",
      reason: "Needs approval before running.",
      input: { command: "dir" },
      createdAt: "2026-07-06T10:00:02.000Z",
    },
    undefined,
  );

  assert.equal(observation.source, "approval");
  assert.equal(observation.actionType, "approval");
  assert.equal(observation.status, "waiting_approval");
  assert.deepEqual(observation.argsPreview, { command: "dir" });
  assert.deepEqual(observation.suggestedNextActions, [
    "wait_for_approval",
    "resume_after_approval",
  ]);
});

test("maps terminal_session awaiting approval tool execution into a waiting_approval execution observation", () => {
  const observation = toExecutionObservationFromToolExecution({
    toolCallId: "tool-call-terminal-approval",
    toolId: "terminal_session",
    inputHash: "hash-terminal-approval",
    args: { command: "pnpm check", timeoutMs: 2000 },
    status: "awaiting_approval",
    approval: {
      id: "approval-terminal-1",
      runId: "run-1",
      stepId: "tool",
      toolId: "terminal_session",
      toolCallId: "tool-call-terminal-approval",
      inputHash: "hash-terminal-approval",
      reason: "terminal_session requires reviewed approval.",
      input: { command: "pnpm check", timeoutMs: 2000 },
      createdAt: "2026-07-06T10:00:02.000Z",
    },
    startedAt: "2026-07-06T10:00:00.000Z",
    finishedAt: "2026-07-06T10:00:01.000Z",
  });

  assert.equal(observation.status, "waiting_approval");
  assert.equal(observation.recoverable, false);
  assert.equal(observation.reason, "terminal_session requires reviewed approval.");
  assert.deepEqual(observation.suggestedNextActions, [
    "wait_for_approval",
    "resume_after_approval",
  ]);
});

test("buildExecutionObservationView treats evidence structures as fact sources and emits a unified planner view", () => {
  const observations = buildExecutionObservationView({
    evidence: {
      observations: [],
      retrievals: [
        {
          knowledgeBaseId: "kb-1",
          query: "inspect docs",
          chunkCount: 1,
          chunks: [
            {
              chunkId: "c1",
              documentName: "README.md",
              content: "doc one",
            },
          ],
          createdAt: "2026-07-06T10:00:00.000Z",
        },
      ],
      toolExecutions: [
        {
          toolCallId: "tool-call-1",
          toolId: "read_open",
          inputHash: "hash-read-open",
          args: { path: "README.md" },
          status: "completed",
          result: { type: "open", path: "README.md" },
          startedAt: "2026-07-06T10:00:01.000Z",
          finishedAt: "2026-07-06T10:00:02.000Z",
        },
      ],
    },
    pendingApproval: {
      id: "approval-1",
      runId: "run-1",
      stepId: "approval",
      toolId: "terminal_session",
      toolCallId: "tool-call-2",
      inputHash: "hash-terminal",
      reason: "Needs approval before running.",
      createdAt: "2026-07-06T10:00:04.000Z",
    },
  });

  assert.deepEqual(
    observations.map((item) => [item.actionType, item.source, item.status]),
    [
      ["retrieve", "retrieval", "completed"],
      ["tool", "tool_execution", "completed"],
      ["approval", "approval", "waiting_approval"],
    ],
  );
});

test("buildExecutionObservationView does not treat lastToolExecution as a parallel fact source after Evidence", () => {
  const observations = buildExecutionObservationView({
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [],
    },
    pendingApproval: undefined,
  });

  assert.deepEqual(observations, []);
});

test("buildExecutionObservationView ignores observation-only retrieve facts after Evidence", () => {
  const observations = buildExecutionObservationView({
    evidence: {
      observations: [
        {
          id: "obs-retrieve-1",
          runId: "run-1",
          stepId: "retrieve",
          status: "ok",
          facts: ["Found README.md in retrieval fallback."],
          createdAt: "2026-07-06T10:00:00.000Z",
        },
      ],
      retrievals: [],
      toolExecutions: [],
    },
    pendingApproval: undefined,
  });

  assert.deepEqual(observations, []);
});
