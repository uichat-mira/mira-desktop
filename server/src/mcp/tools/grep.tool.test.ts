import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { grepTool } from "./grep.tool.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "grep-tool");

const context = (args: Record<string, unknown>) => ({
  invocationId: "grep-test",
  args,
  signal: new AbortController().signal,
  environment: createHarnessEnvironmentSnapshot(),
  pushEvent() {},
  addArtifact(artifact: any) {
    return { id: "artifact-1", ...artifact };
  },
});

describe("grep tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: tempRoot, windowsHide: true });
    fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "src", "planner.ts"),
      "before\nconst answerReadiness = true;\nafter\n",
    );
    fs.writeFileSync(path.join(tempRoot, "src", "notes.md"), "answerReadiness notes\n");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("searches content with include filtering and context", async () => {
    const result = await grepTool.execute(
      context({
        pattern: "answerReadiness",
        path: "src",
        include: "**/*.ts",
        literal: true,
        context: 1,
        limit: 10,
      }),
    );

    expect(result.structuredContent).toMatchObject({
      type: "grep",
      pattern: "answerReadiness",
      path: "src",
      returnedCount: 1,
      offset: 0,
      hasMore: false,
      matches: [
        {
          path: "src/planner.ts",
          line: 2,
          column: 7,
          before: ["before"],
          after: ["after"],
        },
      ],
    });
  });

  it("uses a compact but capable search contract", () => {
    expect(grepTool.definition.description).toContain("regex or literal text");
    expect(Object.keys(grepTool.definition.inputSchema.properties ?? {})).toEqual([
      "pattern",
      "path",
      "include",
      "literal",
      "caseSensitive",
      "context",
      "offset",
      "limit",
      "includeIgnored",
    ]);
  });

  it("rejects a missing pattern", async () => {
    await expect(grepTool.execute(context({}))).rejects.toThrow("pattern is required");
  });
});
