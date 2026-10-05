import fs from "node:fs";
import path from "node:path";
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

  it("uses true glob semantics with deterministic workspace-relative results", async () => {
    const result = await globTool.execute(
      context({ pattern: "**/*.ts", root: "src" }),
    );

    expect(result.structuredContent).toMatchObject({
      type: "glob",
      pattern: "**/*.ts",
      root: "src",
      matches: ["src/a.ts", "src/b.ts", "src/nested/c.ts"],
      returnedCount: 3,
      totalCount: 3,
      hasMore: false,
      truncated: false,
    });
  });

  it("applies shared ignore policy", async () => {
    const result = await globTool.execute(context({ pattern: "**/*.ts", root: "." }));
    const matches = (result.structuredContent as { matches: string[] }).matches;
    expect(matches).not.toContain("node_modules/pkg/hidden.ts");
  });

  it("returns an explicit empty success for no matches", async () => {
    const result = await globTool.execute(context({ pattern: "**/*.tsx", root: "src" }));
    expect(result.structuredContent).toMatchObject({
      matches: [],
      returnedCount: 0,
      totalCount: 0,
      hasMore: false,
      truncated: false,
    });
  });

  it("bounds results and exposes truncation metadata", async () => {
    const result = await globTool.execute(
      context({ pattern: "**/*.ts", root: "src", maxResults: 2 }),
    );
    expect(result.structuredContent).toMatchObject({
      matches: ["src/a.ts", "src/b.ts"],
      returnedCount: 2,
      totalCount: 3,
      hasMore: true,
      truncated: true,
    });
  });

  it("rejects patterns that escape the selected root", async () => {
    await expect(
      globTool.execute(context({ pattern: "../**/*.ts", root: "src" })),
    ).rejects.toThrow("pattern must stay inside the selected root");
  });
});
