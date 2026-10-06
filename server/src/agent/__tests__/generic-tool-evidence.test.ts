import { describe, expect, it, vi } from "vitest";
import { createMailCenterService } from "@/microapps/mail-center/index.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import { normalizeToolResult, projectToolEvidence } from "@/mcp/core/tool-result.js";
import { createToolExecutionEvidenceSummary } from "../evidence";

vi.mock("@/microapps/mail-center/index.js", () => ({
  createMailCenterService: vi.fn(),
}));

describe("generic MCP tool evidence", () => {
  it("passes standardized evidence through without knowing the tool id", () => {
    const summary = createToolExecutionEvidenceSummary({
      evidenceIndex: 0,
      execution: {
        toolId: "any-tool",
        args: {},
        status: "completed",
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
        evidence: {
          actionTaken: "Observed a page.",
          facts: ["title=Example Domain", "url=https://example.com"],
          data: { kind: "opaque-tool-data", title: "Example Domain" },
        },
      },
    });

    expect(summary.actionTaken).toBe("Observed a page.");
    expect(summary.keyFindings).toEqual(["title=Example Domain", "url=https://example.com"]);
    expect(summary.data).toEqual({ kind: "opaque-tool-data", title: "Example Domain" });
  });

  it("projects partial apply_patch evidence without hiding the committed prefix", () => {
    const evidence = projectToolEvidence(
      {
        id: "apply_patch",
        source: "internal",
        domain: "edit",
      },
      normalizeToolResult({
        structuredContent: {
          operation: "apply_patch",
          status: "partial",
          changed: true,
          hunkCount: 3,
          committed: [
            {
              hunkIndex: 0,
              hunkType: "add",
              path: "a.txt",
              mutation: { operation: "write", path: "a.txt", changed: true },
            },
          ],
          failed: {
            hunkIndex: 1,
            hunkType: "update",
            path: "b.txt",
            stage: "update",
            message: "simulated write failure",
          },
          unapplied: [
            {
              hunkIndex: 2,
              hunkType: "delete",
              path: "c.txt",
            },
          ],
          committedDeltaExact: false,
          artifactId: "artifact-patch",
        },
        isError: true,
      }),
    );

    expect(evidence).toMatchObject({
      status: "partial",
      actionTaken: "Patch stopped after 1 definitely committed mutation(s).",
      data: {
        kind: "file_mutation_patch",
        status: "partial",
        committedMutationCount: 1,
        unappliedHunkCount: 1,
        committedDeltaExact: false,
        artifactId: "artifact-patch",
      },
    });
    expect(evidence?.facts).toContain("failedHunkIndex=1");
    expect(evidence?.gaps?.join(" ")).toMatch(/commit point/i);
  });

  it("preserves a bounded generic list result without turning it into an empty result", () => {
    const summary = createToolExecutionEvidenceSummary({
      evidenceIndex: 0,
      execution: {
        toolId: "generic-list",
        args: {},
        status: "completed",
        result: { items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }], total: 20, nextCursor: "cursor-2" },
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
      },
    });

    expect(summary.data?.kind).toBe("generic_structured");
    expect(summary.data?.itemCount).toBe(6);
    expect(summary.data?.total).toBe(20);
    expect(summary.data?.hasNextCursor).toBe(true);
    expect(summary.status).toBe("partial");
    expect(summary.gaps?.join(" ")).toMatch(/truncated/i);
    expect(summary.facts).toContain("total=20");
  });

  it("converts the real mail_query adapter result into non-empty Evidence", async () => {
    vi.mocked(createMailCenterService).mockReturnValue({
      queryMail: vi.fn().mockResolvedValue({
        sync: { requested: "none", performed: false, status: "skipped", syncedCount: 0, lastSyncedAt: null, error: null },
        items: [{
          id: "message-1",
          accountId: "account-1",
          subject: "Quarterly report",
          from: { name: "Sender", address: "sender@example.com" },
          to: [],
          previewText: "The report is ready.",
          sentAt: null,
          receivedAt: "2026-07-15T00:00:00.000Z",
          isRead: false,
          isFlagged: false,
          hasAttachments: false,
        }],
        total: 1,
        nextCursor: null,
      }),
    } as never);
    const adapterOutput = await (await import("@/mcp/tools/mail-query.tool.js")).mailQueryTool.execute({
      invocationId: "mail-evidence-test",
      args: {},
      userId: 42,
      approval: { inputHash: "hash", granted: false },
      pushEvent: vi.fn(),
      addArtifact: vi.fn(),
      trace: { startSpan: vi.fn(() => ({ end: vi.fn() })) },
      signal: new AbortController().signal,
    } as never);
    const summary = createToolExecutionEvidenceSummary({
      evidenceIndex: 0,
      execution: {
        toolId: "mail_query",
        args: {},
        status: "completed",
        result: adapterOutput.structuredContent,
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
      },
    });

    expect(["completed", "partial"]).toContain(summary.status);
    expect(summary.data?.kind).toBe("generic_structured");
    expect(summary.data?.itemCount).toBe(1);
    expect(summary.facts).toContain("total=1");
    expect(summary.gaps ?? []).not.toContain("The structured result contains no items.");
    expect(JSON.stringify(summary.data?.preview)).toContain("Quarterly report");
  });

  it("passes the real browser_observe evidence fields into the unified summary", async () => {
    const tools = createComputerUseBrowserTools({
      observe: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: "browser-session-1",
        invocationId: "browser-observe-1",
        page: { url: "https://example.com", title: "Example Domain", snapshotHash: "snapshot-1" },
        observation: { snapshot: "button ref=e1", visibleText: "Example Domain content" },
        artifacts: [],
      }),
      act: vi.fn(),
      assert: vi.fn(),
    } as never, {
      sessionManager: {
        create: vi.fn().mockResolvedValue({ id: "browser-session-1", status: "ready" }),
        get: vi.fn().mockReturnValue({ info: { status: "ready" } }),
      } as never,
    });
    const adapterOutput = await tools.find((tool) => tool.definition.id === "browser_observe")!.execute({
      invocationId: "browser-observe-1",
      args: { url: "https://example.com" },
      threadId: "thread-evidence-test",
      pushEvent: vi.fn(),
      addArtifact: vi.fn(),
      trace: { startSpan: vi.fn(() => ({ end: vi.fn() })) },
      signal: new AbortController().signal,
    } as never);
    const summary = createToolExecutionEvidenceSummary({
      evidenceIndex: 0,
      execution: {
        toolId: "browser_observe",
        args: { url: "https://example.com" },
        status: "completed",
        result: adapterOutput.structuredContent,
        evidence: projectToolEvidence(
          tools.find((tool) => tool.definition.id === "browser_observe")!.definition,
          normalizeToolResult(adapterOutput),
        ),
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
      },
    });

    expect(summary.data).toMatchObject({
      kind: "computer_use_browser",
      operation: "observe",
      page: { title: "Example Domain" },
      observation: { visibleText: "Example Domain content" },
    });
    expect(summary.facts).toContain("visibleText=Example Domain content");
  });

  it("keeps bounded observation fields available to planner evidence", () => {
    const summary = createToolExecutionEvidenceSummary({
      evidenceIndex: 0,
      execution: {
        toolId: "generic-observe",
        args: {},
        status: "completed",
        result: { title: "Example Domain", url: "https://example.com", visibleText: "Content", actions: ["click"] },
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
      },
    });

    expect(summary.data).toMatchObject({
      kind: "generic_structured",
      preview: { title: "Example Domain", url: "https://example.com", visibleText: "Content", actions: ["click"] },
    });
    expect(summary.facts).toContain("resultKeys=title,url,visibleText,actions");
  });

  it("distinguishes an empty structured list from an execution failure", () => {
    const summary = createToolExecutionEvidenceSummary({
      evidenceIndex: 0,
      execution: {
        toolId: "generic-empty-list",
        args: {},
        status: "completed",
        result: { items: [], total: 0 },
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
      },
    });

    expect(summary.status).toBe("partial");
    expect(summary.error).toBeUndefined();
    expect(summary.gaps).toContain("The structured result contains no items.");
    expect(summary.data?.kind).toBe("generic_structured");
  });

  it("bounds nested oversized data and removes sensitive fields", () => {
    const summary = createToolExecutionEvidenceSummary({
      evidenceIndex: 0,
      execution: {
        toolId: "generic-nested",
        args: {},
        status: "completed",
        result: {
          token: "do-not-expose",
          nested: { level1: { level2: { level3: { level4: "too deep" } } } },
          text: "x".repeat(1_000),
          items: Array.from({ length: 20 }, (_, index) => ({ index })),
        },
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
      },
    });

    expect(summary.data?.kind).toBe("generic_structured");
    expect(summary.data?.redacted).toBe(true);
    expect(summary.data?.truncated).toBe(true);
    expect(JSON.stringify(summary.data?.preview)).not.toContain("do-not-expose");
    expect(JSON.stringify(summary.data?.preview).length).toBeLessThan(4_500);
  });
});
