import assert from "node:assert/strict";
import { expect, test } from "vitest";
import type { AgentNodeState } from "../node-runtime";
import { toolCallNormalizeNode } from "../nodes/tool-call-normalize";

class FakeArgs {
  constructor(public path: string) {}
}

const createState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-1",
  threadId: "thread-1",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "answer the user",
    successCriteria: ["answer"],
    constraints: ["safe"],
    riskLevel: "low",
  },
  plan: {
    id: "plan-1",
    goalId: "goal-1",
    version: 1,
    steps: [],
  },
  messages: [
    {
      role: "user",
      content: "Open README.md",
      parts: [{ type: "text", text: "Open README.md" }],
    },
  ],
  toolExposure: {
    exposedTools: [
      "read_open",
      "read_list",
      "web_search",
      "terminal",
      "delete",
    ],
    toolMeta: [
      {
        toolId: "read_open",
        title: "Read Open",
        description: "Open a workspace file",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
          additionalProperties: false,
        },
        domain: "read",
        source: "internal",
        tags: ["read"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["path"],
          },
        },
      },
      {
        toolId: "read_list",
        title: "Read List",
        description: "List a workspace directory",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
          additionalProperties: false,
        },
        domain: "read",
        source: "internal",
        tags: ["read"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["path"],
          },
        },
      },
      {
        toolId: "web_search",
        title: "Web Search",
        description: "Search the public web",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
          },
          additionalProperties: false,
        },
        domain: "web_search",
        source: "internal",
        tags: ["web"],
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
        },
      },
      {
        toolId: "terminal",
        title: "Terminal Session",
        description: "Run a terminal command",
        inputSchema: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string" },
            cwd: { type: "string" },
          },
          additionalProperties: false,
        },
        domain: "terminal",
        source: "internal",
        tags: ["terminal"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["cwd"],
            argTypes: {
              cwd: "directory",
            },
          },
          longRunning: true,
          sandboxRequired: false,
        },
      },
      {
        toolId: "delete",
        title: "Delete",
        description: "Delete a workspace file or directory",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" },
            recursive: { type: "boolean" },
          },
          additionalProperties: false,
        },
        domain: "edit",
        source: "internal",
        tags: ["edit", "delete"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["path"],
          },
        },
      },
    ],
  },
  ...overrides,
});

test("toolCallNormalizeNode freezes a valid planner use_tool action", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Need the file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.equal(patch.pendingToolCall?.toolId, "read_open");
  assert.deepEqual(patch.pendingToolCall?.args, { path: "README.md" });
  assert.equal(patch.pendingToolCall?.reason, "Need the file content.");
  assert.equal(patch.pendingToolCall?.source, "planner");
  assert.equal(patch.pendingToolCall?.status, "frozen");
  assert.equal(patch.pendingToolCall?.toolMeta?.toolId, "read_open");
  assert.match(String(patch.pendingToolCall?.id ?? ""), /^[0-9a-f-]{36}$/i);
  assert.match(String(patch.pendingToolCall?.createdAt ?? ""), /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(patch.pendingToolCall?.inputHash);
});

test("toolCallNormalizeNode normalizes read_list /workspace to workspace root dot", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_list",
        args: { path: "/workspace" },
        reason: "Need the workspace listing.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "." });
});

test("toolCallNormalizeNode normalizes read_list /workspace/ to workspace root dot", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_list",
        args: { path: "/workspace/" },
        reason: "Need the workspace listing.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "." });
});

test("toolCallNormalizeNode preserves POSIX absolute /README.md for downstream boundary checks", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "/README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "/README.md" });
});

test("toolCallNormalizeNode preserves nested POSIX absolute read paths", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "/docs/README.md" },
        reason: "Need nested file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "/docs/README.md" });
});

test("toolCallNormalizeNode preserves normal relative read paths", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "README.md" });
});

test("toolCallNormalizeNode rejects workspace-root-relative traversal attempts", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "/workspace/../outside.txt" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /escaped the workspace root/i);
});

test("toolCallNormalizeNode preserves non-sentinel absolute mutation path", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "delete",
        args: {
          path: "/ONLY_ALT_WORKSPACE.txt",
        },
        reason: "Delete the workspace file.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, {
    path: "/ONLY_ALT_WORKSPACE.txt",
  });
});

test("toolCallNormalizeNode rejects delete traversal path", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "delete",
        args: {
          operation: "delete",
          path: "..\\outside.txt",
        },
        reason: "Delete the outside file.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /escaped the workspace root/i);
});

test("toolCallNormalizeNode preserves Windows absolute delete path for boundary rejection", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "delete",
        args: {
          path: "D:\\outside.txt",
        },
        reason: "Delete the outside file.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, {
    path: "D:\\outside.txt",
  });
});

test("toolCallNormalizeNode rejects plain relative traversal attempts", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "../outside.txt" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /escaped the workspace root/i);
});

test("toolCallNormalizeNode preserves POSIX absolute /etc/passwd", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "/etc/passwd" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "/etc/passwd" });
});

test("toolCallNormalizeNode preserves POSIX absolute /bin/sh", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "/bin/sh" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "/bin/sh" });
});

test("toolCallNormalizeNode preserves POSIX absolute /usr/bin/env", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "/usr/bin/env" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "/usr/bin/env" });
});

test("toolCallNormalizeNode preserves pseudo-root absolute /C:/Windows/System32", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "/C:/Windows/System32" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "/C:/Windows/System32" });
});

test("toolCallNormalizeNode keeps windows absolute read paths unchanged for downstream workspace checks", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "D:\\testData\\x.txt" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { path: "D:\\testData\\x.txt" });
});

test("toolCallNormalizeNode does not rewrite non-read tool arguments", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "/README.md" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { command: "/README.md" });
});

test("toolCallNormalizeNode accepts terminal without cwd", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { command: "dir" });
});

test("toolCallNormalizeNode accepts terminal.cwd = '.'", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir", cwd: "." },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { command: "dir", cwd: "." });
});

test("toolCallNormalizeNode accepts terminal.cwd = 'server'", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir", cwd: "server" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { command: "dir", cwd: "server" });
});

test("toolCallNormalizeNode preserves terminal.cwd child paths byte-for-byte for host execution", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir", cwd: "server\\src" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, { command: "dir", cwd: "server\\src" });
});

test("toolCallNormalizeNode preserves terminal.cwd Windows absolute paths for downstream approval/runtime checks", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir", cwd: "D:\\workspace\\rag-demo" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, {
    command: "dir",
    cwd: "D:\\workspace\\rag-demo",
  });
});

test("toolCallNormalizeNode preserves terminal.cwd drive-root paths for downstream approval/runtime checks", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir", cwd: "C:\\" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, {
    command: "dir",
    cwd: "C:\\",
  });
});

test("toolCallNormalizeNode preserves terminal.cwd POSIX absolute paths for downstream approval/runtime checks", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir", cwd: "/workspace" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, {
    command: "dir",
    cwd: "/workspace",
  });
});

test("toolCallNormalizeNode preserves terminal.cwd parent traversal for downstream approval/runtime checks", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "terminal",
        args: { command: "dir", cwd: "../outside" },
        reason: "Need terminal output.",
      },
    }),
  );

  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics, undefined);
  assert.deepEqual(patch.pendingToolCall?.args, {
    command: "dir",
    cwd: "../outside",
  });
});

test("toolCallNormalizeNode returns empty result for non-use_tool nextAction", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "answer",
        reason: "Enough evidence.",
        completionProof: [
          { criterion: "answer the user", evidenceRefs: [] },
        ],
        unresolvedGaps: [],
      },
    }),
  );

  assert.deepEqual(patch, {
    pendingToolCall: undefined,
  });
});

test("toolCallNormalizeNode fails when nextAction is missing", async () => {
  const patch = await toolCallNormalizeNode(createState());

  assert.equal(patch.pendingToolCall, undefined);
  assert.equal(patch.errorSourceNodeId, "agent-tool-call-normalize");
  assert.match(patch.errorMessage ?? "", /missing nextAction/i);
});

test("toolCallNormalizeNode fails when toolId is empty", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "   ",
        args: { path: "README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /non-empty toolId/i);
});

test("toolCallNormalizeNode fails when args is not a plain object", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: [] as never,
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /plain object/i);
});

test("toolCallNormalizeNode rejects Date args even though typeof object", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: new Date("2026-07-03T00:00:00.000Z") as never,
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /plain object/i);
});

test("toolCallNormalizeNode rejects Map args even though typeof object", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: new Map([["path", "README.md"]]) as never,
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /plain object/i);
});

test("toolCallNormalizeNode rejects class instance args", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: new FakeArgs("README.md") as never,
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /plain object/i);
});

test("toolCallNormalizeNode fails when toolId is not exposed", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      toolExposure: {
        exposedTools: ["read_open", "read_list", "web_search", "terminal"],
        toolMeta: [],
      },
      nextAction: {
        type: "use_tool",
        toolId: "delete",
        args: {},
        reason: "Need file changes.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /not exposed/i);
});

test("toolCallNormalizeNode applies the schema guard to a projected MCP capability", async () => {
  const projectedToolId = "mcp:docs-server:tool:search_docs";
  const projectedMeta = {
    toolId: projectedToolId,
    title: "Search product documentation",
    description: "Search the connected documentation server.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
      additionalProperties: false,
    },
    domain: "external_mcp",
    source: "external" as const,
    tags: ["docs", "search"],
    capabilities: {
      sideEffect: "network" as const,
      requiresApproval: true,
    },
  };

  const valid = await toolCallNormalizeNode(
    createState({
      toolExposure: { exposedTools: [projectedToolId], toolMeta: [projectedMeta] },
      nextAction: {
        type: "use_tool",
        toolId: projectedToolId,
        args: { query: "installation guides" },
        reason: "Search docs.",
      },
    }),
  );
  expect(valid.pendingToolCall?.toolId).toBe(projectedToolId);
  expect(valid.pendingToolCall?.args).toEqual({ query: "installation guides" });
});

test("projected MCP capability rejects schema-invalid task model args", async () => {
  const projectedToolId = "mcp:docs-server:tool:search_docs";
  const invalid = await toolCallNormalizeNode(
    createState({
      toolExposure: {
        exposedTools: [projectedToolId],
        toolMeta: [{
          toolId: projectedToolId,
          title: "Search product documentation",
          description: "Search the connected documentation server.",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: { query: { type: "string" } },
            additionalProperties: false,
          },
          domain: "external_mcp",
          source: "external",
          tags: ["docs", "search"],
          capabilities: { sideEffect: "network", requiresApproval: true },
        }],
      },
      nextAction: {
        type: "use_tool",
        toolId: projectedToolId,
        args: { unexpected: "value" },
        reason: "Search docs.",
      },
    }),
  );

  expect(invalid.pendingToolCall).toBeUndefined();
  expect(invalid.schemaReplanDiagnostics?.toolId).toBe(projectedToolId);
  expect(invalid.schemaReplanDiagnostics?.schemaError).toMatch(/required|not allowed/i);
});

test("toolCallNormalizeNode does not treat capability-like ids as valid tool ids unless exposed", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_capability",
        args: { path: "README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.match(patch.errorMessage ?? "", /not exposed/i);
});

test("toolCallNormalizeNode fails when args do not match inputSchema", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { unknown: "README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.errorSourceNodeId, undefined);
  assert.match(patch.schemaReplanDiagnostics?.schemaError ?? "", /required|not allowed/i);
  assert.equal(patch.schemaReplanDiagnostics?.toolId, "read_open");
  assert.equal(patch.schemaReplanDiagnostics?.attemptCount, 1);
});

test("toolCallNormalizeNode increments schema replan attempt count on repeated schema failures", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      schemaReplanDiagnostics: {
        schemaError: "args.limit is not allowed",
        toolId: "read_open",
        invalidAction: {
          type: "use_tool",
          toolId: "read_open",
          args: {
            path: "README.md",
            limit: 1,
          },
          reason: "Need file content.",
        },
        attemptCount: 1,
      },
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { unknown: "README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.equal(patch.errorMessage, undefined);
  assert.equal(patch.schemaReplanDiagnostics?.attemptCount, 2);
});

test("toolCallNormalizeNode fails when exposed tool metadata is missing", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      toolExposure: {
        exposedTools: ["read_open"],
        toolMeta: [],
      },
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.equal(patch.errorSourceNodeId, "agent-tool-call-normalize");
  assert.match(patch.errorMessage ?? "", /missing exposure metadata/i);
});

test("toolCallNormalizeNode fails when exposed tool inputSchema is missing", async () => {
  const patch = await toolCallNormalizeNode(
    createState({
      toolExposure: {
        exposedTools: ["read_open"],
        toolMeta: [
          {
            toolId: "read_open",
            title: "Read Open",
            description: "Open a workspace file",
            domain: "read",
            source: "internal",
            tags: ["read"],
            capabilities: {
              sideEffect: "none",
              requiresApproval: false,
            },
          },
        ],
      },
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Need file content.",
      },
    }),
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.equal(patch.errorSourceNodeId, "agent-tool-call-normalize");
  assert.match(patch.errorMessage ?? "", /missing inputSchema/i);
});

test("toolCallNormalizeNode emits compact success trace details", async () => {
  const events: Array<Record<string, unknown>> = [];
  await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "web_search",
        args: { query: "latest release notes" },
        reason: "Need current external information.",
      },
    }),
    async (event) => {
      events.push({
        nodeId: event.nodeId,
        phase: event.phase,
        details: event.details,
      });
    },
  );

  const doneEvent = events.find(
    (event) =>
      event.nodeId === "agent-tool-call-normalize" && event.phase === "done",
  );
  assert.ok(doneEvent);
  const details = doneEvent?.details as Record<string, unknown>;
  assert.equal(details.toolId, "web_search");
  assert.equal(details.source, "planner");
  assert.equal(details.status, "frozen");
  assert.deepEqual(details.argKeys, ["query"]);
  assert.equal(typeof details.inputHash, "string");
  assert.equal("args" in details, false);
});

test("toolCallNormalizeNode emits failure trace details without dumping args", async () => {
  const events: Array<Record<string, unknown>> = [];
  await toolCallNormalizeNode(
    createState({
      nextAction: {
        type: "use_tool",
        toolId: "delete",
        args: { command: "dir" },
        reason: "Need file changes.",
      },
    }),
    async (event) => {
      events.push({
        nodeId: event.nodeId,
        phase: event.phase,
        details: event.details,
      });
    },
  );

  const errorEvent = events.find(
    (event) =>
      event.nodeId === "agent-tool-call-normalize" && event.phase === "error",
  );
  assert.ok(errorEvent);
  const details = errorEvent?.details as Record<string, unknown>;
  assert.equal(details.toolId, "delete");
  assert.equal(typeof details.availableToolCount, "number");
  assert.equal("args" in details, false);
});

test("toolCallNormalizeNode failure returns error flow fields and never emits success trace", async () => {
  const events: Array<Record<string, unknown>> = [];
  const patch = await toolCallNormalizeNode(
    createState({
      toolExposure: {
        exposedTools: ["read_open"],
        toolMeta: [],
      },
      nextAction: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "Need file content.",
      },
    }),
    async (event) => {
      events.push({
        nodeId: event.nodeId,
        phase: event.phase,
        details: event.details,
      });
    },
  );

  assert.equal(patch.pendingToolCall, undefined);
  assert.equal(patch.errorSourceNodeId, "agent-tool-call-normalize");
  assert.equal(events.some((event) => event.phase === "done"), false);
  assert.equal(events.some((event) => event.phase === "error"), true);
});

test("toolCallNormalizeNode produces a stable inputHash for the same toolId and args", async () => {
  const state = createState({
    nextAction: {
      type: "use_tool",
      toolId: "web_search",
      args: {
        query: "latest release notes",
        filters: {
          recency: "7d",
          locale: "en-US",
        },
      },
      reason: "Need current external information.",
    },
  });

  const first = await toolCallNormalizeNode(state);
  const second = await toolCallNormalizeNode(state);

  assert.equal(first.pendingToolCall?.inputHash, second.pendingToolCall?.inputHash);
});
