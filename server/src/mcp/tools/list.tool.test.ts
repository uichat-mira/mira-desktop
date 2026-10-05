import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { listTool } from "./list.tool.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "universal-list-tool");

const context = (args: Record<string, unknown>) => ({
  invocationId: "list-test",
  args,
  signal: new AbortController().signal,
  environment: createHarnessEnvironmentSnapshot(),
  pushEvent() {},
  addArtifact(artifact: any) {
    return { id: "artifact-1", ...artifact };
  },
});

describe("list tool", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tempRoot, "docs", "z-dir"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docs", "a-dir"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docs", "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docs", ".git"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "docs", "b.txt"), "b");
    fs.writeFileSync(path.join(tempRoot, "docs", "a.txt"), "a");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("lists only direct children in deterministic order", async () => {
    const result = await listTool.execute(context({ path: "docs" }));
    expect(result.structuredContent).toMatchObject({
      type: "list",
      path: "docs",
      offset: 0,
      returnedCount: 4,
      totalCount: 4,
      hasMore: false,
      truncated: false,
    });
    expect(
      (result.structuredContent as { entries: Array<{ name: string; type: string }> }).entries.map(
        (entry) => [entry.name, entry.type],
      ),
    ).toEqual([
      ["a-dir", "directory"],
      ["z-dir", "directory"],
      ["a.txt", "file"],
      ["b.txt", "file"],
    ]);
  });

  it("paginates instead of permanently capping the directory", async () => {
    const first = await listTool.execute(context({ path: "docs", limit: 2 }));
    expect(first.structuredContent).toMatchObject({
      offset: 0,
      returnedCount: 2,
      totalCount: 4,
      hasMore: true,
      nextOffset: 2,
    });

    const second = await listTool.execute(context({ path: "docs", offset: 2, limit: 2 }));
    expect(second.structuredContent).toMatchObject({
      offset: 2,
      returnedCount: 2,
      totalCount: 4,
      hasMore: false,
    });
  });

  it("lets an explicit request see default-ignored direct children", async () => {
    const result = await listTool.execute(
      context({ path: "docs", includeIgnored: true }),
    );
    const names = (result.structuredContent as { entries: Array<{ name: string }> }).entries.map(
      (entry) => entry.name,
    );
    expect(names).toContain("node_modules");
    expect(names).toContain(".git");
  });

  it("keeps the public contract small and allows workspace root by default", () => {
    expect(listTool.definition.id).toBe("list");
    expect(listTool.definition.description).toContain("direct children");
    expect(listTool.definition.inputSchema.required).toBeUndefined();
    expect(Object.keys(listTool.definition.inputSchema.properties ?? {})).toEqual([
      "path",
      "offset",
      "limit",
      "includeIgnored",
    ]);
  });
});
