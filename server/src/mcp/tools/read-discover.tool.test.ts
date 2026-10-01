import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { hasRipgrep } from "@/test-support/external-tooling.js";
import { readDiscoverTool } from "./read-discover.tool.js";
import { createToolExecutionEvidenceSummary } from "../../agent/evidence.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-read-discover-tool");

const context = (args: Record<string, unknown>) => ({
  invocationId: "read-discover-test",
  args,
  signal: new AbortController().signal,
  environment: createHarnessEnvironmentSnapshot(),
  pushEvent() {},
  addArtifact(artifact: any) { return { id: "artifact-1", ...artifact }; },
});

describe("read_discover tool", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tempRoot, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "docs", "guide.md"), "guide contents");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("mechanically dispatches list without returning file contents", async () => {
    const result = await readDiscoverTool.execute(context({ mode: "list", path: "docs" }));
    expect(result.result).toMatchObject({ type: "discover", mode: "list", operation: "list" });
    expect(JSON.stringify(result.result)).not.toContain("guide contents");
    expect(result.result).toMatchObject({ returnedCount: 1, totalCount: 1, hasMore: false, truncated: false });
  });

  it("mechanically dispatches locate and returns candidates only", async () => {
    const result = await readDiscoverTool.execute(context({ mode: "locate", query: "guide" }));
    expect(result.result).toMatchObject({ type: "discover", mode: "locate", operation: "locate" });
    expect(result.result).not.toHaveProperty("source");
    const matches = (result.result as { matches: Array<{ preview?: string }> }).matches;
    expect(matches.every((match) => (match.preview?.length ?? 0) <= 120)).toBe(true);
    expect(result.result).toMatchObject({ hasMore: false, truncated: false });
    // The full candidate count depends on ripgrep being resolvable; without it
    // locate degrades and the count is not the product contract under test.
    if (hasRipgrep()) {
      expect(result.result).toMatchObject({ returnedCount: 2 });
    }
  });

  it("reports truncation when list results exceed maxResults", async () => {
    fs.writeFileSync(path.join(tempRoot, "docs", "second.md"), "second contents");
    const result = await readDiscoverTool.execute(context({ mode: "list", path: "docs", maxResults: 1 }));
    expect(result.result).toMatchObject({ returnedCount: 1, totalCount: 2, hasMore: true, truncated: true });
  });

  it("keeps discover facts usable by Evidence without opening a file", () => {
    const summary = createToolExecutionEvidenceSummary({
      execution: {
        toolId: "read_discover",
        args: { mode: "list", path: "docs", maxResults: 6 },
        status: "completed",
        inputHash: "discover-evidence-test",
        result: {
          type: "discover",
          mode: "list",
          operation: "list",
          path: "docs",
          entries: [
            { name: "guide-1.md", type: "file" },
            { name: "guide-2.md", type: "file" },
            { name: "guide-3.md", type: "file" },
            { name: "guide-4.md", type: "file" },
            { name: "guide-5.md", type: "file" },
            { name: "guide-6.md", type: "file" },
          ],
          returnedCount: 6,
          totalCount: 7,
          hasMore: true,
          truncated: true,
        },
      },
      evidenceIndex: 0,
    });
    expect(summary.data).toMatchObject({
      kind: "read_discover",
      operation: "list",
      path: "docs",
      candidatePaths: [
        "guide-1.md",
        "guide-2.md",
        "guide-3.md",
        "guide-4.md",
        "guide-5.md",
      ],
      candidateCount: 6,
      returnedCount: 6,
      totalCount: 7,
      hasMore: true,
      truncated: true,
    });
    expect(summary.facts).toContain("path=docs");
    expect(summary.facts).toContain("returnedCount=6");
    expect(summary.facts).toContain("totalCount=7");
    expect(summary.facts.some((fact) => fact.includes("guide-6.md"))).toBe(false);
    expect(summary.toolId).toBe("read_discover");
  });
});
