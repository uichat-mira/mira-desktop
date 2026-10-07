import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { globTool } from "./glob.tool.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "universal-glob-tool");

const context = (args: Record<string, unknown>) => ({
  invocationId: "glob-test",
  args,
  signal: new AbortController().signal,
  environment: createHarnessEnvironmentSnapshot(),
  pushEvent() {},
  addArtifact(artifact: any) {
    return { id: "artifact-1", ...artifact };
  },
});

describe("glob tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: tempRoot, windowsHide: true });
    fs.mkdirSync(path.join(tempRoot, "src", "nested"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "src", "b.ts"), "b");
    fs.writeFileSync(path.join(tempRoot, "src", "a.ts"), "a");
    fs.writeFileSync(path.join(tempRoot, "src", "nested", "c.ts"), "c");
    fs.writeFileSync(path.join(tempRoot, "src", "nested", "note.md"), "note");
    fs.writeFileSync(path.join(tempRoot, "node_modules", "pkg", "hidden.ts"), "hidden");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("matches arbitrary file-path glob patterns", async () => {
    const result = await globTool.execute(
      context({ pattern: "**/*.ts", path: "src" }),
    );
    expect(result.structuredContent).toMatchObject({
      type: "glob",
      pattern: "**/*.ts",
      path: "src",
      matches: ["src/a.ts", "src/b.ts", "src/nested/c.ts"],
      offset: 0,
      returnedCount: 3,
      totalCount: 3,
      hasMore: false,
    });
  });

  it("paginates path matches with nextOffset", async () => {
    const first = await globTool.execute(
      context({ pattern: "**/*.ts", path: "src", limit: 2 }),
    );
    expect(first.structuredContent).toMatchObject({
      matches: ["src/a.ts", "src/b.ts"],
      offset: 0,
      returnedCount: 2,
      totalCount: 3,
      hasMore: true,
      nextOffset: 2,
    });

    const second = await globTool.execute(
      context({ pattern: "**/*.ts", path: "src", offset: 2, limit: 2 }),
    );
    expect(second.structuredContent).toMatchObject({
      matches: ["src/nested/c.ts"],
      offset: 2,
      returnedCount: 1,
      totalCount: 3,
      hasMore: false,
    });
  });

  it("uses ignore defaults but allows explicit visibility override", async () => {
    const hidden = await globTool.execute(context({ pattern: "**/*.ts" }));
    expect((hidden.structuredContent as { matches: string[] }).matches).not.toContain(
      "node_modules/pkg/hidden.ts",
    );

    const visible = await globTool.execute(
      context({ pattern: "**/*.ts", includeIgnored: true }),
    );
    expect((visible.structuredContent as { matches: string[] }).matches).toContain(
      "node_modules/pkg/hidden.ts",
    );
  });

  it("returns an explicit empty success for no matches", async () => {
    const result = await globTool.execute(context({ pattern: "**/*.tsx", path: "src" }));
    expect(result.structuredContent).toMatchObject({
      matches: [],
      returnedCount: 0,
      totalCount: 0,
      hasMore: false,
    });
  });

  it("has a path-search contract rather than a content-search contract", () => {
    expect(globTool.definition.description).toMatch(/never searches file contents/i);
    expect(Object.keys(globTool.definition.inputSchema.properties ?? {})).toEqual([
      "pattern",
      "path",
      "offset",
      "limit",
      "includeIgnored",
    ]);
  });
});
