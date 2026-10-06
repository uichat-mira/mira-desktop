import { describe, expect, it, beforeEach } from "vitest";
import { clearHarnessRegistry, registerTool } from "@/harness/registry.js";
import {
  clearHarnessInvocations,
  executeHarnessInvocation,
  getHarnessInvocationModelContent,
} from "@/harness/invocations.js";
import { getHarnessLlmContentText } from "@/harness/llm-content.js";
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
    expect(getHarnessLlmContentText(record.llmContent)).toContain("model-facing answer");
  });

  it("ordinary Harness invocation reads do not expose cached image payloads", async () => {
    registerTool({
      definition: {
        id: "test_tool_result_image_content",
        title: "Test image",
        description: "Test image",
        domain: "read",
        source: "internal",
        mode: "sync",
        inputSchema: { type: "object" },
        tags: [],
        capabilities: { sideEffect: "none", requiresApproval: false },
      },
      execute: () => ({
        content: [
          { type: "text", text: "Read image file: test.png" },
          {
            type: "image",
            data: "SECRET_IMAGE_BASE64",
            mimeType: "image/png",
            filename: "test.png",
          },
        ],
        structuredContent: {
          type: "read",
          path: "test.png",
          mediaType: "image",
          mimeType: "image/png",
          sizeBytes: 10,
        },
      }),
    });

    const executed = await executeHarnessInvocation({
      toolId: "test_tool_result_image_content",
    });
    expect(
      executed.llmContent?.blocks.some((block) => block.type === "image"),
    ).not.toBe(true);
    expect(JSON.stringify(executed)).not.toContain("SECRET_IMAGE_BASE64");

    expect(
      getHarnessInvocationModelContent(executed.id)?.blocks.some(
        (block) => block.type === "image" && block.data === "SECRET_IMAGE_BASE64",
      ),
    ).toBe(true);

    const { getHarnessInvocation } = await import("@/harness/invocations.js");
    const ordinary = getHarnessInvocation(executed.id);
    expect(ordinary).not.toHaveProperty("llmContent");
    expect(JSON.stringify(ordinary)).not.toContain("SECRET_IMAGE_BASE64");
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



  it("marks committed move cleanup failures as partial file-mutation evidence", () => {
    const evidence = projectToolEvidence(
      definition("move", "internal", "edit"),
      normalizeToolResult({
        structuredContent: {
          operation: "move",
          path: "source-dir",
          destinationPath: "destination-dir",
          movedType: "directory",
          overwritten: true,
          changed: true,
          cleanupIncomplete: true,
          cleanupBackupPath: "/workspace/.destination-dir.mira-backup-test",
          cleanupError: "EPERM",
          diffAvailable: false,
        },
      }),
    );

    expect(evidence?.status).toBe("partial");
    expect(evidence?.facts).toContain("cleanupIncomplete=true");
    expect(evidence?.gaps?.join(" ")).toContain("backup cleanup is incomplete");
    expect(evidence?.data).toMatchObject({
      kind: "file_mutation",
      operation: "move",
      changed: true,
      cleanupIncomplete: true,
      cleanupBackupPath: "/workspace/.destination-dir.mira-backup-test",
      cleanupError: "EPERM",
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

  it("restores bounded read and search semantic projections", () => {
    const list = projectToolEvidence(
      definition("list"),
      normalizeToolResult({
        structuredContent: {
          type: "list",
          path: "docs",
          entries: [
            { name: "guides", type: "directory" },
            { name: "README.md", type: "file" },
            { name: "latest", type: "symlink" },
          ],
          returnedCount: 3,
          totalCount: 5,
          hasMore: true,
          truncated: true,
        },
      }),
    );
    expect(list?.data).toMatchObject({
      kind: "list",
      path: "docs",
      fileCount: 1,
      directoryCount: 1,
      symlinkCount: 1,
      entriesPreview: ["[D] guides", "[F] README.md", "[L] latest"],
      truncated: true,
    });

    const glob = projectToolEvidence(
      definition("glob"),
      normalizeToolResult({
        structuredContent: {
          type: "glob",
          pattern: "**/*.ts",
          path: "src",
          matches: ["src/a.ts", "src/b.ts", "src/c.ts"],
          offset: 0,
          returnedCount: 3,
          totalCount: 8,
          hasMore: true,
          truncated: true,
          nextOffset: 3,
        },
      }),
    );
    expect(glob?.status).toBe("truncated");
    expect(glob?.facts).toContain("nextOffset=3");
    expect(glob?.data).toMatchObject({
      kind: "glob",
      pattern: "**/*.ts",
      path: "src",
      matchCount: 8,
      offset: 0,
      nextOffset: 3,
      matchedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      matchesPreview: ["src/a.ts", "src/b.ts", "src/c.ts"],
      truncated: true,
    });

    const grep = projectToolEvidence(
      definition("grep"),
      normalizeToolResult({
        structuredContent: {
          type: "grep",
          pattern: "answerReadiness",
          path: "src",
          offset: 0,
          matches: [
            {
              path: "src/planner.ts",
              line: 12,
              column: 7,
              preview: "const answerReadiness = true;",
            },
          ],
          returnedCount: 1,
          hasMore: false,
          truncated: false,
          provider: "node-content-scan",
          providerAttempts: [
            {
              provider: "system-ripgrep",
              status: "unavailable",
              reason: "runtime-unavailable",
            },
            { provider: "node-content-scan", status: "success" },
          ],
        },
      }),
    );
    expect(grep?.data).toMatchObject({
      kind: "grep",
      pattern: "answerReadiness",
      path: "src",
      matchCount: 1,
      offset: 0,
      matchedPaths: ["src/planner.ts"],
      matchesPreview: [
        "src/planner.ts:12:7: const answerReadiness = true;",
      ],
      provider: "node-content-scan",
      truncated: false,
    });

    const opened = projectToolEvidence(
      definition("read"),
      normalizeToolResult({
        structuredContent: {
          type: "read",
          path: "README.md",
          source: { text: "# Intro\nbody\n## Details\nmore", metadata: {} },
          offset: 0,
          limit: 4,
          returnedCount: 4,
          totalLines: 10,
          startLine: 1,
          endLine: 4,
          hasMore: true,
          truncated: true,
          nextOffset: 4,
        },
      }),
    );
    expect(opened?.status).toBe("truncated");
    expect(opened?.facts).toContain("nextOffset=4");
    expect(opened?.data).toMatchObject({
      kind: "read",
      keySections: ["Intro", "Details"],
      pagination: {
        offset: 0,
        limit: 4,
        returnedCount: 4,
        totalLines: 10,
        startLine: 1,
        endLine: 4,
        nextOffset: 4,
      },
    });

    const officeRouted = projectToolEvidence(
      definition("read"),
      normalizeToolResult({
        structuredContent: {
          type: "unsupported",
          path: "proposal.docx",
          reason: "office_owned",
          fileType: "docx",
          suggestedSkill: "docx",
        },
      }),
    );
    expect(officeRouted?.status).toBe("partial");
    expect(officeRouted?.facts).toContain("suggestedSkill=docx");
    expect(officeRouted?.data).toMatchObject({
      kind: "generic_structured",
      unsupported: true,
      preview: {
        path: "proposal.docx",
        reason: "office_owned",
        suggestedSkill: "docx",
      },
    });

    const search = projectToolEvidence(
      definition("web_search", "internal", "web_search"),
      normalizeToolResult({
        structuredContent: {
          query: "mira",
          provider: "tavily",
          capabilityId: "tavily-search",
          results: [{ title: "Mira", link: "https://example.com", snippet: "A result" }],
        },
      }),
    );
    expect(search?.data).toMatchObject({
      kind: "web_search",
      query: "mira",
      resultCount: 1,
      citationsPreview: [{ title: "Mira", link: "https://example.com" }],
    });
  });

  it("keeps image base64 out of structured Evidence", () => {
    const base64 = "BASE64_SHOULD_NOT_ENTER_EVIDENCE";
    const evidence = projectToolEvidence(
      definition("read"),
      normalizeToolResult({
        content: [
          { type: "text", text: "Read image file: diagram.png" },
          {
            type: "image",
            data: base64,
            mimeType: "image/png",
            filename: "diagram.png",
          },
        ],
        structuredContent: {
          type: "read",
          path: "diagram.png",
          mediaType: "image",
          mimeType: "image/png",
          sizeBytes: 123,
        },
      }),
    );

    expect(evidence?.data).toMatchObject({
      kind: "read",
      path: "diagram.png",
      mediaType: "image",
      mimeType: "image/png",
      sizeBytes: 123,
      truncated: false,
    });
    expect(JSON.stringify(evidence)).not.toContain(base64);
  });

  it("keeps Evidence data bounded and redacted instead of copying structured results", () => {
    const secret = "secret-value";
    const value = {
      title: "large result",
      password: secret,
      items: Array.from({ length: 20 }, (_, index) => ({ index, text: "x".repeat(500) })),
    };
    const evidence = projectToolEvidence(
      definition("future_tool"),
      normalizeToolResult({ structuredContent: value }),
    );
    expect(evidence?.data).toMatchObject({
      kind: "generic_structured",
      truncated: true,
      redacted: true,
    });
    expect(JSON.stringify(evidence?.data)).not.toContain(secret);
    expect(evidence?.data).not.toBe(value);

    const codebase = projectToolEvidence(
      definition("codebase_explore"),
      normalizeToolResult({
        structuredContent: {
          query: "planner",
          verifiedEvidenceInput: {
            query: "planner",
            chunkCount: 1,
            chunks: [{ documentName: "planner.ts", content: "x".repeat(2_000) }],
          },
          retrievalEvidence: {
            query: "planner",
            chunkCount: 1,
            chunks: [{ documentName: "planner.ts", content: "x".repeat(2_000) }],
          },
          exploreResult: { status: "ok", degraded: false, truncated: false },
        },
      }),
    );
    expect(codebase?.data).toMatchObject({
      kind: "codebase_explore",
      query: "planner",
      verifiedChunkCount: 1,
      fallbackRequired: false,
    });
    expect(codebase?.facts).toEqual(expect.arrayContaining([
      "capabilityId=codebase_explore",
      "verifiedChunkCount=1",
    ]));
    expect(JSON.stringify(codebase?.data)).not.toContain("x".repeat(100));
  });
});
