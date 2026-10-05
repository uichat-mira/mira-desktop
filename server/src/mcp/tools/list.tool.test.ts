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
    fs.mkdirSync(tempRoot, { recursive: true });
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

  it("lists one directory level deterministically with shared ignores", async () => {
    const result = await listTool.execute(context({ path: "docs" }));
    expect(result.structuredContent).toMatchObject({
      type: "list",
      path: "docs",
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

  it("bounds results and reports truncation metadata", async () => {
    const result = await listTool.execute(context({ path: "docs", maxResults: 2 }));
    expect(result.structuredContent).toMatchObject({
      returnedCount: 2,
      totalCount: 4,
      hasMore: true,
      truncated: true,
    });
  });

  it("rejects non-directory targets", async () => {
    await expect(listTool.execute(context({ path: "docs/a.txt" }))).rejects.toThrow(
      "list requires a directory path",
    );
  });

  it("has a canonical public contract rather than a read_list alias", () => {
    expect(listTool.definition.id).toBe("list");
    expect(listTool.definition.inputSchema).toMatchObject({
      type: "object",
      required: ["path"],
      additionalProperties: false,
    });
  });
});
