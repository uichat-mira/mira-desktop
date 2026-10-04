import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import {
  clearHarnessInvocations,
  executeHarnessInvocation,
  getHarnessInvocationTrace,
  listHarnessInvocationEvents,
} from "../../harness/invocations.js";
import { clearHarnessRegistry, registerCapability } from "../../harness/registry.js";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import type { ToolImplementation } from "./definitions.js";
import { configureInvocationRetention } from "./invocations.js";

const createBoundaryEnvironment = (workspaceRoot = "D:\\CODEX_TEST_FOLDER_ALT") =>
  createHarnessEnvironmentSnapshot({
    workspace: {
      rootPath: workspaceRoot,
      source: "configured",
    },
  });

const registerBlackboxTool = (tool: ToolImplementation) => {
  registerCapability(tool);
  return tool;
};

describe("harness invocation boundary blackbox", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    clearHarnessInvocations();
    configureInvocationRetention({
      maxEntries: 200,
      ttlMs: 1000 * 60 * 30,
    });
  });

  it("H1 blocks unapproved high-risk tools before execute", async () => {
    const execute = vi.fn(() => ({
      result: { ok: true },
    }));

    registerBlackboxTool({
      definition: {
        id: "blackbox_unapproved_write",
        title: "Blackbox Unapproved Write",
        description: "high-risk write tool",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
      execute,
    });

    const record = await executeHarnessInvocation({
      toolId: "blackbox_unapproved_write",
      args: {},
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval).toMatchObject({
      required: true,
      reason: "blackbox_unapproved_write requires explicit approval before execution.",
      scope: "edit",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("H2 executes only after exact toolId + inputHash approval", async () => {
    const execute = vi.fn(() => ({
      result: { ok: true },
    }));

    registerBlackboxTool({
      definition: {
        id: "blackbox_approved_process",
        title: "Blackbox Approved Process",
        description: "approved high-risk process tool",
        domain: "terminal",
        source: "internal",
        mode: "sync",
        inputSchema: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string" },
          },
        },
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      execute,
    });

    const args = { command: "git status" };
    const record = await executeHarnessInvocation({
      toolId: "blackbox_approved_process",
      args,
      approvedInvocations: [
        {
          toolId: "blackbox_approved_process",
          inputHash: createInvocationInputHash(args),
        },
      ],
    });

    expect(record.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("H3 does not reuse approval when the args hash changes", async () => {
    const execute = vi.fn(() => ({
      result: { ok: true },
    }));

    registerBlackboxTool({
      definition: {
        id: "blackbox_hash_guard",
        title: "Blackbox Hash Guard",
        description: "approval hash guard",
        domain: "terminal",
        source: "internal",
        mode: "sync",
        inputSchema: {
          type: "object",
          required: ["command", "attachSessionId"],
          properties: {
            command: { type: "string" },
            attachSessionId: { type: "string" },
          },
        },
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      execute,
    });

    const approvedArgs = {
      command: "pwd",
      attachSessionId: "session-1",
    };
    const nextArgs = {
      command: "git status",
      attachSessionId: "session-1",
    };

    const record = await executeHarnessInvocation({
      toolId: "blackbox_hash_guard",
      args: nextArgs,
      approvedInvocations: [
        {
          toolId: "blackbox_hash_guard",
          inputHash: createInvocationInputHash(approvedArgs),
        },
      ],
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toBe(
      "blackbox_hash_guard requires explicit approval before execution.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("H4 uses workspaceBoundary.argKeys as the only workspace boundary source", async () => {
    const execute = vi.fn(() => ({
      result: { ok: true },
    }));

    registerBlackboxTool({
      definition: {
        id: "blackbox_boundary_keys",
        title: "Blackbox Boundary Keys",
        description: "workspace boundary key source",
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
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: false,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["targetPath"],
          },
        },
      },
      execute,
    });

    const record = await executeHarnessInvocation({
      toolId: "blackbox_boundary_keys",
      args: {
        targetPath: "../outside.txt",
        cwd: ".",
      },
      environment: createBoundaryEnvironment(),
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toBe(
      "blackbox_boundary_keys requests targetPath outside the current workspace root.",
    );
    expect(record.approval?.reason).not.toContain("cwd");
    expect(execute).not.toHaveBeenCalled();
  });

  it("H5 keeps POSIX absolute slash paths visible to the workspace boundary", async () => {
    const execute = vi.fn(() => ({
      result: { ok: true },
    }));

    registerBlackboxTool({
      definition: {
        id: "blackbox_windows_root_relative",
        title: "Blackbox Windows Root Relative",
        description: "root-relative path normalization",
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
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: false,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["targetPath"],
          },
        },
      },
      execute,
    });

    const record = await executeHarnessInvocation({
      toolId: "blackbox_windows_root_relative",
      args: {
        targetPath: "/ONLY_ALT_WORKSPACE.txt",
      },
      environment: createBoundaryEnvironment(),
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toBe(
      "blackbox_windows_root_relative requests targetPath outside the current workspace root.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  // Windows drive-letter and UNC targets are only absolute paths on Windows.
  // On POSIX hosts they are ordinary relative filenames that legitimately
  // resolve inside the workspace root, so the escape contract cannot apply.
  it.each([
    "D:\\outside.txt",
    "C:\\outside.txt",
    "\\\\server\\share\\file.txt",
  ])("H6 blocks external path %s", async (targetPath) => {
    if (process.platform !== "win32") return;
    await assertExternalPathIsBlocked(targetPath);
  });

  it.each([
    "../outside.txt",
    "..\\outside.txt",
  ])("H6 blocks external path %s", async (targetPath) => {
    await assertExternalPathIsBlocked(targetPath);
  });

  async function assertExternalPathIsBlocked(targetPath: string) {
    const execute = vi.fn(() => ({
      result: { ok: true },
    }));

    registerBlackboxTool({
      definition: {
        id: "blackbox_external_path_guard",
        title: "Blackbox External Path Guard",
        description: "blocks external write targets",
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
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: false,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["targetPath"],
          },
        },
      },
      execute,
    });

    const record = await executeHarnessInvocation({
      toolId: "blackbox_external_path_guard",
      args: {
        targetPath,
      },
      environment: createBoundaryEnvironment(),
    });

    expect(record.status).toBe("awaiting_approval");
    expect(record.approval?.reason).toBe(
      "blackbox_external_path_guard requests targetPath outside the current workspace root.",
    );
    expect(execute).not.toHaveBeenCalled();
  }

  it("H7 exposes invocation events, artifacts, result and trace records", async () => {
    registerBlackboxTool({
      definition: {
        id: "blackbox_trace_observable",
        title: "Blackbox Trace Observable",
        description: "observable trace output",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute(context) {
        const span = context.trace.startSpan({
          name: "Select strategy",
          kind: "strategy_selection",
        });
        context.pushEvent({
          type: "invocation:progress",
          message: "running",
        });
        context.addArtifact({
          kind: "text",
          title: "artifact",
          data: "hello",
        });
        span.end();
        return {
          result: { ok: true },
        };
      },
    });

    const record = await executeHarnessInvocation({
      toolId: "blackbox_trace_observable",
      args: {},
    });

    const events = listHarnessInvocationEvents(record.id);
    const trace = getHarnessInvocationTrace(record.id);

    expect(record.status).toBe("completed");
    expect(record.artifacts).toHaveLength(1);
    expect(record.result).toEqual({ ok: true });
    expect(events.map((event) => event.type)).toEqual([
      "invocation:start",
      "invocation:progress",
      "invocation:artifact",
      "invocation:result",
      "invocation:finish",
    ]);
    expect(trace?.invocationId).toBe(record.id);
    expect(trace?.spans.map((span) => span.kind)).toEqual([
      "invocation",
      "strategy_selection",
      "artifact_emit",
      "result_normalization",
    ]);
    expect(trace?.debugView?.spanCount).toBe(4);
  });

  it("H8 rejects capabilityId-style invocation when no concrete tool is registered under that id", async () => {
    registerBlackboxTool({
      definition: {
        id: "read_list",
        title: "Read List",
        description: "concrete tool only",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: ["blackbox"],
        capabilities: {
          sideEffect: "none",
          requiresApproval: false,
        },
      },
      execute() {
        return {
          result: { ok: true },
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
});
