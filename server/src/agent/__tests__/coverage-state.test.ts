import assert from "node:assert/strict";
import { test } from "vitest";
import { reduceAgentCoverageState } from "../coverage-state";

test("coverage reducer asks for canonical list when directory evidence is missing", () => {
  const state = reduceAgentCoverageState({
    question: "列出当前目录有哪些文件",
  });

  assert.deepEqual(state.globalPendingActions, ["list"]);
  assert.equal(state.taskCompletable, false);
});

test("coverage reducer completes list task from canonical list evidence", () => {
  const state = reduceAgentCoverageState({
    question: "列出当前目录有哪些文件",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "list",
          args: { path: "." },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "list",
            actionTaken: "Listed current directory.",
            keyFindings: ["entryCount=3"],
            data: {
              kind: "list",
              path: ".",
              entryCount: 3,
              fileCount: 2,
              directoryCount: 1,
              entriesPreview: ["README.md", "AGENTS.md", "docs"],
              truncated: false,
            },
          },
          startedAt: "2026-10-05T00:00:00.000Z",
          finishedAt: "2026-10-05T00:00:01.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, true);
  assert.deepEqual(state.globalPendingActions, []);
});

test("coverage reducer completes list task from read_list evidence", () => {
  const state = reduceAgentCoverageState({
    question: "列出当前目录有哪些文件",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "read_list",
          args: { path: "." },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "read_list",
            actionTaken: "Listed current directory.",
            keyFindings: ["entryCount=3"],
            answerReadiness: {
              canAnswer: true,
              reason: "Directory listing is available.",
            },
            data: {
              kind: "read_list",
              path: ".",
              entryCount: 3,
              fileCount: 2,
              directoryCount: 1,
              entriesPreview: ["README.md", "AGENTS.md", "docs"],
              truncated: false,
              canAnswerDirectoryQuestion: true,
            },
          },
          startedAt: "2026-07-09T00:00:00.000Z",
          finishedAt: "2026-07-09T00:00:01.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, true);
  assert.deepEqual(state.globalPendingActions, []);
});

test("coverage reducer completes locate-only task from canonical glob evidence", () => {
  const state = reduceAgentCoverageState({
    question: "README.md 在哪里？",
    latestSummary: {
      source: "tool",
      status: "completed",
      toolId: "glob",
      actionTaken: "Matched workspace files.",
      keyFindings: ["matchedPath=README.md"],
      data: {
        kind: "glob",
        pattern: "**/README.md",
        root: ".",
        matchCount: 1,
        matchedPaths: ["README.md"],
        matchesPreview: ["README.md"],
        truncated: false,
      },
    },
  });

  assert.equal(state.taskCompletable, true);
  assert.deepEqual(state.globalPendingActions, []);
});

test("coverage reducer completes locate-only task from read_locate evidence", () => {
  const state = reduceAgentCoverageState({
    question: "README.md 在哪里？",
    latestSummary: {
      source: "tool",
      status: "completed",
      toolId: "read_locate",
      actionTaken: "Located README.md.",
      keyFindings: ["matchedPath=README.md"],
      answerReadiness: {
        canAnswer: true,
        reason: "Located target path is available.",
      },
      data: {
        kind: "read_locate",
        scope: ".",
        query: "README.md",
        searchMode: "path",
        matchCount: 1,
        matchedPaths: ["README.md"],
        matchesPreview: ["README.md"],
        truncated: false,
        canAnswerLocateQuestion: true,
      },
    },
  });

  assert.equal(state.taskCompletable, true);
  assert.deepEqual(state.targets[0], {
    target: "readme.md",
    requiredActions: ["locate"],
    completedActions: ["locate"],
    pendingActions: [],
    status: "located",
    blocker: undefined,
  });
});

test("coverage reducer keeps read_content pending after locate-only evidence", () => {
  const state = reduceAgentCoverageState({
    question: "README.md 的内容是什么？",
    latestSummary: {
      source: "tool",
      status: "completed",
      toolId: "read_locate",
      actionTaken: "Located README.md.",
      keyFindings: ["matchedPath=README.md"],
      answerReadiness: {
        canAnswer: true,
        reason: "Located target path is available.",
      },
      data: {
        kind: "read_locate",
        scope: ".",
        query: "README.md",
        searchMode: "path",
        matchCount: 1,
        matchedPaths: ["README.md"],
        matchesPreview: ["README.md"],
        truncated: false,
        canAnswerLocateQuestion: true,
      },
    },
  });

  assert.equal(state.taskCompletable, false);
  assert.deepEqual(state.pendingActions, ["read"]);
  assert.equal(state.targets[0]?.status, "located");
});

test("coverage reducer keeps multi-target read_content incomplete until all targets are opened", () => {
  const state = reduceAgentCoverageState({
    question: "README.md 和 AGENTS.md 的内容分别是什么？",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "read_open",
          args: { path: "README.md" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "read_open",
            actionTaken: "Opened README.md.",
            keyFindings: ["path=README.md"],
            answerReadiness: {
              canAnswer: true,
              reason: "Opened file content is available.",
            },
            data: {
              kind: "read_open",
              path: "README.md",
              contentPreview: "readme",
              contentLength: 6,
              truncated: false,
              keySections: [],
              canAnswerFileQuestion: true,
            },
          },
          startedAt: "2026-07-09T00:00:00.000Z",
          finishedAt: "2026-07-09T00:00:01.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, false);
  assert.deepEqual(state.coveredTargets, ["readme.md"]);
  assert.deepEqual(state.pendingTargets, ["agents.md"]);
});

test("coverage reducer completes multi-target read_content when both targets are opened", () => {
  const state = reduceAgentCoverageState({
    question: "README.md 和 AGENTS.md 的内容分别是什么？",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "read_open",
          args: { path: "README.md" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "read_open",
            actionTaken: "Opened README.md.",
            keyFindings: ["path=README.md"],
            answerReadiness: { canAnswer: true, reason: "Opened." },
            data: {
              kind: "read_open",
              path: "README.md",
              contentPreview: "readme",
              contentLength: 6,
              truncated: false,
              keySections: [],
              canAnswerFileQuestion: true,
            },
          },
          startedAt: "2026-07-09T00:00:00.000Z",
          finishedAt: "2026-07-09T00:00:01.000Z",
        },
        {
          toolId: "read_open",
          args: { path: "AGENTS.md" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "read_open",
            actionTaken: "Opened AGENTS.md.",
            keyFindings: ["path=AGENTS.md"],
            answerReadiness: { canAnswer: true, reason: "Opened." },
            data: {
              kind: "read_open",
              path: "AGENTS.md",
              contentPreview: "agents",
              contentLength: 6,
              truncated: false,
              keySections: [],
              canAnswerFileQuestion: true,
            },
          },
          startedAt: "2026-07-09T00:00:02.000Z",
          finishedAt: "2026-07-09T00:00:03.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, true);
  assert.deepEqual(state.pendingActions, []);
});

test("coverage reducer does not treat locate-only mutation evidence as mutation completion", () => {
  const state = reduceAgentCoverageState({
    question: "删除 notes.txt",
    latestSummary: {
      source: "tool",
      status: "completed",
      toolId: "read_locate",
      actionTaken: "Located notes.txt.",
      keyFindings: ["matchedPath=notes.txt"],
      answerReadiness: { canAnswer: true, reason: "Located." },
      data: {
        kind: "read_locate",
        scope: ".",
        query: "notes.txt",
        searchMode: "path",
        matchCount: 1,
        matchedPaths: ["notes.txt"],
        matchesPreview: ["notes.txt"],
        truncated: false,
        canAnswerLocateQuestion: true,
      },
    },
  });

  assert.equal(state.taskCompletable, false);
  assert.deepEqual(state.pendingActions, ["mutation_execution"]);
  assert.equal(state.targets[0]?.status, "located");
});

test("coverage reducer keeps mutation verification pending until read_open exists", () => {
  const state = reduceAgentCoverageState({
    question: "写入 notes.txt 后验证内容是否正确",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "workspace_mutation",
          args: { operation: "write", targetPath: "notes.txt" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "workspace_mutation",
            actionTaken: "Wrote notes.txt.",
            keyFindings: ["targetPath=notes.txt"],
            answerReadiness: { canAnswer: true, reason: "Mutated." },
            data: {
              kind: "workspace_mutation",
              operation: "overwrite",
              targetPath: "notes.txt",
              dryRun: false,
              changed: true,
              canAnswerMutationQuestion: true,
            },
          },
          startedAt: "2026-07-09T00:00:00.000Z",
          finishedAt: "2026-07-09T00:00:01.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, false);
  assert.deepEqual(state.pendingActions, ["mutation_verification"]);
  assert.deepEqual(state.targets[0]?.completedActions, [
    "locate",
    "mutation_execution",
  ]);
});

test("coverage reducer completes mutation verification after read_open evidence", () => {
  const state = reduceAgentCoverageState({
    question: "写入 notes.txt 后验证内容是否正确",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "workspace_mutation",
          args: { operation: "write", targetPath: "notes.txt" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "workspace_mutation",
            actionTaken: "Wrote notes.txt.",
            keyFindings: ["targetPath=notes.txt"],
            answerReadiness: { canAnswer: true, reason: "Mutated." },
            data: {
              kind: "workspace_mutation",
              operation: "overwrite",
              targetPath: "notes.txt",
              dryRun: false,
              changed: true,
              canAnswerMutationQuestion: true,
            },
          },
          startedAt: "2026-07-09T00:00:00.000Z",
          finishedAt: "2026-07-09T00:00:01.000Z",
        },
        {
          toolId: "read_open",
          args: { path: "notes.txt" },
          status: "completed",
          summary: {
            source: "tool",
            status: "completed",
            toolId: "read_open",
            actionTaken: "Opened notes.txt.",
            keyFindings: ["path=notes.txt"],
            answerReadiness: { canAnswer: true, reason: "Opened." },
            data: {
              kind: "read_open",
              path: "notes.txt",
              contentPreview: "hello",
              contentLength: 5,
              truncated: false,
              keySections: [],
              canAnswerFileQuestion: true,
            },
          },
          startedAt: "2026-07-09T00:00:02.000Z",
          finishedAt: "2026-07-09T00:00:03.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, true);
  assert.deepEqual(state.targets[0]?.completedActions, [
    "locate",
    "read",
    "mutation_execution",
    "mutation_verification",
  ]);
});

test("coverage reducer keeps recoverable read failure incomplete", () => {
  const state = reduceAgentCoverageState({
    question: "打开 README.md 看看内容",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "read_open",
          args: { path: "README.md" },
          status: "failed",
          failureKind: "recoverable",
          errorMessage: "temporary timeout",
          startedAt: "2026-07-09T00:00:00.000Z",
          finishedAt: "2026-07-09T00:00:01.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, false);
  assert.deepEqual(state.pendingActions, ["recoverable_execution"]);
});

test("coverage reducer marks terminal mutation failure as blocked target without pretending it was covered", () => {
  const state = reduceAgentCoverageState({
    question: "删除 notes.txt",
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "workspace_mutation",
          args: { operation: "delete", targetPath: "notes.txt" },
          status: "failed",
          failureKind: "terminal",
          errorMessage: "notes.txt does not exist",
          startedAt: "2026-07-09T00:00:00.000Z",
          finishedAt: "2026-07-09T00:00:01.000Z",
        },
      ],
    },
  });

  assert.equal(state.taskCompletable, true);
  assert.deepEqual(state.coveredTargets, []);
  assert.deepEqual(state.pendingTargets, []);
  assert.equal(state.targets[0]?.status, "blocked");
  assert.equal(state.targets[0]?.blocker, "notes.txt does not exist");
});
