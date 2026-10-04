import { describe, expect, it, beforeEach } from "vitest";
import { clearHarnessRegistry, registerTool } from "@/harness/registry.js";
import { clearHarnessInvocations, executeHarnessInvocation } from "@/harness/invocations.js";
import type { ToolImplementation, ToolDefinition } from "./definitions.js";
import { normalizeToolResult, projectToolEvidence } from "./tool-result.js";

const context = (tool: ToolImplementation) => tool;

describe("ToolResult B-prime normalization", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    clearHarnessInvocations();
  });

  it("uses structuredContent as the stable result and projects explicit content for the model", async () => {
    registerTool({
      definition: {
        id: "test_tool_result_explicit_content",
        title: "Test",
        description: "Test",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: [],
        capabilities: { sideEffect: "none", requiresApproval: false },
      },
      execute: () => ({
        content: [{ type: "text", text: "model-facing answer" }],
        structuredContent: { ok: true },
      }),
    });

    const record = await executeHarnessInvocation({
      toolId: "test_tool_result_explicit_content",
    });

    expect(record.status).toBe("completed");
    expect(record.result).toEqual({ ok: true });
    expect(record.llmContent?.blocks[0]?.text).toContain("model-facing answer");
  });

  it("keeps Tool isError on a completed invocation and projects failed evidence", async () => {
    registerTool({
      definition: {
        id: "test_tool_result_error",
        title: "Test",
        description: "Test",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: [],
        capabilities: { sideEffect: "none", requiresApproval: false },
      },
      execute: () => ({
        structuredContent: { message: "bad input" },
        isError: true,
      }),
    });

    const record = await executeHarnessInvocation({ toolId: "test_tool_result_error" });

    expect(record.status).toBe("completed");
    expect(record.result).toEqual({ message: "bad input" });
    expect(record.evidence?.status).toBe("failed");
  });

  it("keeps thrown runtime errors on the Harness failed path", async () => {
    registerTool({
      definition: {
        id: "test_tool_result_throw",
        title: "Test",
        description: "Test",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: [],
        capabilities: { sideEffect: "none", requiresApproval: false },
      },
      execute: () => {
        throw new Error("runtime failure");
      },
    });

    const record = await executeHarnessInvocation({ toolId: "test_tool_result_throw" });

    expect(record.status).toBe("failed");
    expect(record.error?.message).toBe("runtime failure");
  });

  const definition = (id: string, source: ToolDefinition["source"] = "internal", domain: ToolDefinition["domain"] = "read") => ({
    id,
    source,
    domain,
  });

  it("preserves semantic terminal timeout evidence without changing invocation status", () => {
    const evidence = projectToolEvidence(
      definition("terminal_session", "internal", "terminal"),
      normalizeToolResult({
        structuredContent: {
          command: "pnpm test",
          timedOut: true,
          exitCode: null,
          stdout: "partial output",
          stderr: "",
          stdoutEncoding: "utf8",
          stderrEncoding: "utf8",
          truncated: false,
        },
      }),
    );
    expect(evidence?.status).toBe("timed_out");
    expect(evidence?.data).toMatchObject({
      kind: "terminal_session",
      commandSucceeded: "unknown",
      processCompleted: false,
      timedOut: true,
    });
  });

  it("preserves degraded codebase exploration as partial evidence", () => {
    const evidence = projectToolEvidence(
      definition("codebase_explore"),
      normalizeToolResult({
        structuredContent: {
          verifiedEvidenceInput: { query: "runtime", chunks: [] },
          retrievalEvidence: { query: "runtime", chunkCount: 0, chunks: [] },
          exploreResult: {
            status: "degraded",
            degraded: true,
            fallbackSignal: { reason: "provider unavailable" },
          },
        },
      }),
    );
    expect(evidence?.status).toBe("partial");
    expect(evidence?.facts).toContain("degraded=true");
    expect(evidence?.gaps?.join(" ")).toMatch(/partial/i);
  });

  it("routes External MCP only through the explicit external MCP boundary", () => {
    const remote = projectToolEvidence(
      definition("mcp:docs:tool:search", "external", "external_mcp"),
      normalizeToolResult({
        structuredContent: {
          type: "external_mcp",
          serverId: "docs",
          remoteToolName: "search",
          invocationStatus: "completed",
          result: { matches: 2 },
        },
      }),
    );
    const futureExternal = projectToolEvidence(
      definition("external_future_tool", "external", "read"),
      normalizeToolResult({ structuredContent: { ok: true } }),
    );
    expect(remote?.data).toMatchObject({ kind: "external_mcp", serverId: "docs" });
    expect(futureExternal?.data).toMatchObject({ kind: "generic_structured" });
  });
});
