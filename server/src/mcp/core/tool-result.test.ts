import { describe, expect, it, beforeEach } from "vitest";
import { clearHarnessRegistry, registerTool } from "@/harness/registry.js";
import { clearHarnessInvocations, executeHarnessInvocation } from "@/harness/invocations.js";
import type { ToolImplementation } from "./definitions.js";

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
});
