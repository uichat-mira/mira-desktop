import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHarnessInvocations,
  executeHarnessInvocation,
  getHarnessInvocationTrace,
  listHarnessInvocationEvents,
  resolveHarnessInvocationApproval,
} from "../../harness/invocations.js";
import { clearHarnessRegistry, registerTool } from "../../harness/registry.js";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { ToolApprovalRequiredError } from "./errors.js";
import { getHarnessLlmContentText } from "../../harness/llm-content.js";
import type { ToolImplementation } from "./definitions.js";
import {
  configureInvocationRetention,
  executeInvocation,
  getInvocationWorkspaceSnapshot,
  resolveInvocationApproval,
  sweepStoredInvocations,
} from "./invocations.js";

describe("mcp invocations", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    clearHarnessInvocations();
    configureInvocationRetention({
      maxEntries: 200,
      ttlMs: 1000 * 60 * 30,
    });
  });

  it("preserves explicit model content and marks Tool-level errors without failing the invocation", async () => {
    registerTool({
      definition: {
        id: "tool_result_error_content",
        title: "Tool result error content",
        description: "returns an error outcome without a Harness failure",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute: () => ({
        content: [{ type: "text", text: "bad input: choose another query" }],
        structuredContent: { ok: false, reason: "bad input" },
        isError: true,
      }),
    });

    const record = await executeHarnessInvocation({
      toolId: "tool_result_error_content",
      args: {},
    });

    expect(record.status).toBe("completed");
    expect(record.evidence?.status).toBe("failed");
    const text = getHarnessLlmContentText(record.llmContent);
    expect(text).toContain("toolOutcome=error");
    expect(text).toContain("bad input: choose another query");
    expect(text).not.toContain('"bad input: choose another query"');
  });

  it("marks Tool-level errors even when the Tool provides only structured content", async () => {
    registerTool({
      definition: {
        id: "tool_result_structured_error",
        title: "Tool result structured error",
        description: "returns a structured error outcome",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute: () => ({
        structuredContent: { ok: false, error: { message: "boom" } },
        isError: true,
      }),
    });

    const record = await executeHarnessInvocation({
      toolId: "tool_result_structured_error",
      args: {},
    });

    expect(record.status).toBe("completed");
    const text = getHarnessLlmContentText(record.llmContent);
    expect(text).toContain("toolOutcome=error");
    expect(text).toContain("boom");
  });

  it("still exposes a Tool error marker when an error result has no payload", async () => {
    registerTool({
      definition: {
        id: "tool_result_empty_error",
        title: "Tool result empty error",
        description: "returns only an error outcome",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: { sideEffect: "none", requiresApproval: false },
      },
      execute: () => ({ isError: true }),
    });

    const record = await executeHarnessInvocation({
      toolId: "tool_result_empty_error",
      args: {},
    });

    expect(record.status).toBe("completed");
    expect(getHarnessLlmContentText(record.llmContent)).toContain("toolOutcome=error");
  });

  it("records result, artifact and events", async () => {
    const tool: ToolImplementation = {
      definition: {
        id: "test_tool",
        title: "Test Tool",
        description: "test",
        domain: "read",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute(context) {
        context.pushEvent({
          type: "invocation:progress",
          message: "running",
        });
        context.addArtifact({
          kind: "text",
          title: "artifact",
          data: "hello",
        });
        return {
          structuredContent: { ok: true },
        };
      },
    };

    registerTool(tool);

    const record = await executeHarnessInvocation({
      toolId: "test_tool",
      args: { a: 1 },
    });

    expect(record.status).toBe("completed");
    expect(record.result).toEqual({ ok: true });
    expect(record.artifacts).toHaveLength(1);

    const events = listHarnessInvocationEvents(record.id);
    expect(events.map((event) => event.type)).toEqual([
      "invocation:start",
      "invocation:progress",
      "invocation:artifact",
      "invocation:result",
      "invocation:finish",
    ]);

    const trace = getHarnessInvocationTrace(record.id);
    expect(trace?.invocationId).toBe(record.id);
    expect(trace?.toolId).toBe("test_tool");
    expect(trace?.debugView).toMatchObject({
      invocationId: record.id,
      toolId: "test_tool",
      traceId: trace?.traceId,
      spanCount: 3,
      runningSpanCount: 0,
      kinds: ["invocation", "artifact_emit", "result_normalization"],
    });
    expect(trace?.spans.map((span) => span.kind)).toEqual([
      "invocation",
      "artifact_emit",
      "result_normalization",
    ]);
  });

  it("records awaiting_approval when preflight approval gating stops execution", async () => {
    const tool: ToolImplementation = {
      definition: {
        id: "approval_tool",
        title: "Approval Tool",
        description: "approval",
        domain: "terminal",
        mode: "stream",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      execute() {
        throw new ToolApprovalRequiredError("Need explicit approval", {
          scope: "command",
        });
      },
    };

    registerTool(tool);

    const record = await executeHarnessInvocation({
      toolId: "approval_tool",
      args: {},
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval).toEqual({
      required: true,
      reason: "approval_tool requires explicit approval before execution.",
      scope: "terminal",
    });

    const events = listHarnessInvocationEvents(record.id);
    expect(events.map((event) => event.type)).toEqual([
      "invocation:start",
      "invocation:approval_required",
      "invocation:finish",
    ]);

    const trace = getHarnessInvocationTrace(record.id);
    expect(trace?.spans).toHaveLength(1);
    expect(trace?.debugView).toMatchObject({
      invocationId: record.id,
      toolId: "approval_tool",
      traceId: trace?.traceId,
      spanCount: 1,
      runningSpanCount: 0,
      kinds: ["invocation"],
    });
    expect(trace?.spans[0]).toMatchObject({
      kind: "invocation",
      status: "completed",
    });
  });

  it("records structured failureCode for schema validation failures thrown by tools", async () => {
    registerTool({
      definition: {
        id: "tool_schema_failure",
        title: "Tool Schema Failure",
        description: "schema failure",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute() {
        throw new Error("schema mismatch: invalid result payload");
      },
    });

    const record = await executeHarnessInvocation({
      toolId: "tool_schema_failure",
      args: {},
    });

    expect(record.status).toBe("failed");
    expect(record.error).toEqual({
      message: "schema mismatch: invalid result payload",
      failureCode: "schema_invalid",
    });
  });

  it("requires approval at preflight when capability metadata marks the tool as approval-gated", async () => {
    let executed = false;

    const tool: ToolImplementation = {
      definition: {
        id: "preflight_approval_tool",
        title: "Preflight Approval Tool",
        description: "approval before execution",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
          workspaceBound: true,
        },
      },
      execute() {
        executed = true;
        return {
          structuredContent: { ok: true },
        };
      },
    };

    registerTool(tool);

    const record = await executeHarnessInvocation({
      toolId: "preflight_approval_tool",
      args: {
        path: "notes.txt",
      },
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toContain("requires explicit approval");
    expect(executed).toBe(false);
  });

  it("fails closed when an approval replay has lost its frozen workspace snapshot", async () => {
    let executed = false;

    registerTool({
      definition: {
        id: "missing_workspace_snapshot_tool",
        title: "Missing Workspace Snapshot Tool",
        description: "approval replay requires the frozen workspace",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
      execute() {
        executed = true;
        return {
          structuredContent: { ok: true },
        };
      },
    });

    const record = await executeInvocation({
      toolId: "missing_workspace_snapshot_tool",
      args: {},
    });

    expect(record.status).toBe("awaiting_approval");
    expect(getInvocationWorkspaceSnapshot(record.id)).toBeUndefined();

    await expect(
      resolveHarnessInvocationApproval({
        invocationId: record.id,
        decision: "approved",
        toolId: "missing_workspace_snapshot_tool",
        args: {},
      }),
    ).rejects.toThrow("workspace snapshot is unavailable");

    expect(record.status).toBe("awaiting_approval");
    expect(executed).toBe(false);
  });

  it("allows preflight approval-gated tool execution when the exact invocation is already approved", async () => {
    let executed = false;

    const tool: ToolImplementation = {
      definition: {
        id: "approved_tool",
        title: "Approved Tool",
        description: "already approved",
        domain: "terminal",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
          workspaceBound: true,
        },
      },
      execute() {
        executed = true;
        return {
          structuredContent: { ok: true },
        };
      },
    };

    registerTool(tool);

    const record = await executeHarnessInvocation({
      toolId: "approved_tool",
      args: {
        cwd: ".",
      },
      approvedInvocations: [
        {
          toolId: "approved_tool",
          inputHash: createInvocationInputHash({
            cwd: ".",
          }),
        },
      ],
    });

    expect(record.status).toBe("completed");
    expect(executed).toBe(true);
  });

  it("requires approval again when a reused terminal session changes command input", async () => {
    let executed = false;

    const tool: ToolImplementation = {
      definition: {
        id: "terminal",
        title: "Terminal Session",
        description: "terminal",
        domain: "terminal",
        source: "internal",
        mode: "sync",
        inputSchema: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string" },
            attachSessionId: { type: "string" },
          },
        },
        tags: ["test"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      execute() {
        executed = true;
        return {
          structuredContent: { ok: true },
        };
      },
    };

    registerTool(tool);

    const approvedArgs = {
      command: "pwd",
      attachSessionId: "session-1",
    };
    const nextArgs = {
      command: "git status",
      attachSessionId: "session-1",
    };

    const record = await executeHarnessInvocation({
      toolId: "terminal",
      args: nextArgs,
      approvedInvocations: [
        {
          toolId: "terminal",
          inputHash: createInvocationInputHash(approvedArgs),
        },
      ],
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toContain("requires explicit approval");
    expect(executed).toBe(false);
  });

  it("passes thread context through harness invocation into tool execution", async () => {
    let receivedThreadId: string | undefined;
    let receivedTurnId: string | undefined;

    const tool: ToolImplementation = {
      definition: {
        id: "thread_context_tool",
        title: "Thread Context Tool",
        description: "thread context",
        domain: "browser_action",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute(context) {
        receivedThreadId = context.threadId;
        receivedTurnId = context.turnId;
        return {
          structuredContent: {
            ok: true,
          },
        };
      },
    };

    registerTool(tool);

    const record = await executeHarnessInvocation({
      toolId: "thread_context_tool",
      args: {},
      threadId: "thread-ctx-1",
      turnId: "turn-ctx-1",
    });

    expect(record.status).toBe("completed");
    expect(receivedThreadId).toBe("thread-ctx-1");
    expect(receivedTurnId).toBe("turn-ctx-1");
  });

  it("rejects invocation args that do not satisfy the declared input schema", async () => {
    let executed = false;

    registerTool({
      definition: {
        id: "schema_tool",
        title: "Schema Tool",
        description: "schema",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
        },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute() {
        executed = true;
        return {
          structuredContent: {
            ok: true,
          },
        };
      },
    });

    await expect(
      executeHarnessInvocation({
        toolId: "schema_tool",
        args: {},
      }),
    ).rejects.toThrow("args.path is required");
    expect(executed).toBe(false);
  });

  it("accepts only a concrete toolId and rejects an unregistered capabilityId", async () => {
    registerTool({
      definition: {
        id: "read_list",
        title: "Read List",
        description: "list files",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["workspace", "list"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute() {
        return {
          structuredContent: { ok: true },
        };
      },
    });

    await expect(
      executeHarnessInvocation({
        toolId: "workspace_lookup",
        args: {},
      }),
    ).rejects.toThrow("Tool not found: workspace_lookup");
  });

  it("uses definition-declared workspace boundary keys instead of implicit path/cwd guessing", async () => {
    let executed = false;

    registerTool({
      definition: {
        id: "boundary_tool",
        title: "Boundary Tool",
        description: "boundary",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: {
          type: "object",
          required: ["targetPath", "cwd"],
          properties: {
            targetPath: { type: "string" },
            cwd: { type: "string" },
          },
        },
        tags: ["test"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: false,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["targetPath"],
          },
        },
      },
      execute() {
        executed = true;
        return {
          structuredContent: {
            ok: true,
          },
        };
      },
    });

    const record = await executeHarnessInvocation({
      toolId: "boundary_tool",
      args: {
        targetPath: "../outside.txt",
        cwd: ".",
      },
      environment: {
        source: "harness",
        workspace: {
          rootPath: process.cwd(),
          source: "configured",
        },
        approvals: {
          outsideWorkspace: "prompt",
          persistence: "thread",
        },
        trace: {
          streamEvents: true,
        },
        read: {
          capabilities: [],
        },
        edit: {
          capabilities: [],
        },
        web_search: {
          capabilities: [],
        },
        terminal: {
          capabilities: [],
          shellProfile: {
            shell: "powershell.exe",
            shellFamily: "powershell",
            argsMode: "powershell",
            stdoutEncoding: "utf16le",
            stderrEncoding: "utf16le",
          },
        },
      },
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toContain("targetPath outside the current workspace root");
    expect(executed).toBe(false);
  });

  it("keeps POSIX absolute paths visible to the workspace boundary on Windows-style roots", async () => {
    let executed = false;

    registerTool({
      definition: {
        id: "boundary_tool_root_relative",
        title: "Boundary Tool Root Relative",
        description: "boundary",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: {
          type: "object",
          required: ["targetPath"],
          properties: {
            targetPath: { type: "string" },
          },
        },
        tags: ["test"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: false,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["targetPath"],
          },
        },
      },
      execute() {
        executed = true;
        return {
          structuredContent: {
            ok: true,
          },
        };
      },
    });

    const record = await executeHarnessInvocation({
      toolId: "boundary_tool_root_relative",
      args: {
        targetPath: "/ONLY_ALT_WORKSPACE.txt",
      },
      environment: {
        source: "harness",
        workspace: {
          rootPath: "D:\\CODEX_TEST_FOLDER_ALT",
          source: "configured",
        },
        approvals: {
          outsideWorkspace: "prompt",
          persistence: "thread",
        },
        trace: {
          streamEvents: true,
        },
        read: {
          capabilities: [],
        },
        edit: {
          capabilities: [],
        },
        web_search: {
          capabilities: [],
        },
        terminal: {
          capabilities: [],
          shellProfile: {
            shell: "powershell.exe",
            shellFamily: "powershell",
            argsMode: "powershell",
            stdoutEncoding: "utf16le",
            stderrEncoding: "utf16le",
          },
        },
      },
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toContain("targetPath outside the current workspace root");
    expect(executed).toBe(false);
  });

  it("sweeps finished invocations beyond retention limit", async () => {
    const tool: ToolImplementation = {
      definition: {
        id: "retention_tool",
        title: "Retention Tool",
        description: "retention",
        domain: "read",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute() {
        return {
          structuredContent: { ok: true },
        };
      },
    };

    registerTool(tool);
    configureInvocationRetention({
      maxEntries: 1,
      ttlMs: 1000 * 60 * 30,
    });

    const first = await executeHarnessInvocation({
      toolId: "retention_tool",
      args: {},
    });
    const second = await executeHarnessInvocation({
      toolId: "retention_tool",
      args: {},
    });

    sweepStoredInvocations();

    expect(listHarnessInvocationEvents(first.id)).toEqual([]);
    expect(getHarnessInvocationTrace(first.id)).toBeUndefined();
    expect(listHarnessInvocationEvents(second.id).length).toBeGreaterThan(0);
  });

  it("retains a pending approval workspace snapshot until the approval resolves", async () => {
    registerTool({
      definition: {
        id: "retention_approval_tool",
        title: "Retention Approval Tool",
        description: "retention approval",
        domain: "edit",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
      execute() {
        return {
          structuredContent: { ok: true },
        };
      },
    });
    registerTool({
      definition: {
        id: "retention_completed_tool",
        title: "Retention Completed Tool",
        description: "retention completed",
        domain: "read",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["test"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute() {
        return {
          structuredContent: { ok: true },
        };
      },
    });
    configureInvocationRetention({
      maxEntries: 1,
      ttlMs: 1000 * 60 * 30,
    });

    const pending = await executeHarnessInvocation({
      toolId: "retention_approval_tool",
      args: {},
    });
    await executeHarnessInvocation({
      toolId: "retention_completed_tool",
      args: {},
    });

    expect(pending.status).toBe("awaiting_approval");
    expect(getInvocationWorkspaceSnapshot(pending.id)).toBeDefined();

    sweepStoredInvocations();

    expect(getInvocationWorkspaceSnapshot(pending.id)).toBeDefined();

    resolveInvocationApproval({
      invocationId: pending.id,
      decision: "rejected",
    });
    expect(getInvocationWorkspaceSnapshot(pending.id)).toBeUndefined();
  });
});
