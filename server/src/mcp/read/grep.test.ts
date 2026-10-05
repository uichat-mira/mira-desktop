import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { executeGrep, runBoundedProcess } from "./grep.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "canonical-grep-runtime");

beforeEach(() => {
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "ignored"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".gitignore"), "ignored/\n", "utf8");
  fs.writeFileSync(
    path.join(tempRoot, "src", "alpha.ts"),
    "before\nNeedle one\nneedle two\nafter\n",
    "utf8",
  );
  fs.writeFileSync(path.join(tempRoot, "src", "note.md"), "needle markdown\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "ignored", "secret.ts"), "needle secret\n", "utf8");
  process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
  clearWorkspaceSelection();
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.UI_CHAT_WORKSPACE_ROOT;
  clearWorkspaceSelection();
});

const executeNode = (args: Record<string, unknown>) =>
  executeGrep(
    {
      args,
      environment: createHarnessEnvironmentSnapshot(),
      signal: new AbortController().signal,
    },
    {
      resolveExecutable: () => ({ source: "unavailable" }),
    },
  );

describe("canonical grep runtime", () => {
  it("supports include glob, smart case and bounded context", async () => {
    const result = await executeNode({
      pattern: "Needle",
      path: "src",
      include: "**/*.ts",
      context: 1,
    });

    expect(result.contents).toMatchObject({
      provider: "node-content-scan",
      returnedCount: 1,
      matches: [
        {
          path: "src/alpha.ts",
          line: 2,
          column: 1,
          before: ["before"],
          after: ["needle two"],
        },
      ],
    });
  });

  it("supports literal text and explicit case sensitivity", async () => {
    const insensitive = await executeNode({
      pattern: "needle one",
      path: "src",
      literal: true,
      caseSensitive: false,
    });
    expect(insensitive.contents.returnedCount).toBe(1);

    const sensitive = await executeNode({
      pattern: "needle one",
      path: "src",
      literal: true,
      caseSensitive: true,
    });
    expect(sensitive.contents.returnedCount).toBe(0);
  });

  it("paginates matches instead of treating limit as a permanent ceiling", async () => {
    const first = await executeNode({
      pattern: "needle",
      path: "src",
      include: "**/*.ts",
      caseSensitive: false,
      limit: 1,
    });
    expect(first.contents).toMatchObject({
      offset: 0,
      returnedCount: 1,
      hasMore: true,
      nextOffset: 1,
    });

    const second = await executeNode({
      pattern: "needle",
      path: "src",
      include: "**/*.ts",
      caseSensitive: false,
      offset: 1,
      limit: 1,
    });
    expect(second.contents).toMatchObject({
      offset: 1,
      returnedCount: 1,
      hasMore: false,
    });
  });

  it("uses ignore defaults but allows explicit ignored-content search", async () => {
    const hidden = await executeNode({ pattern: "secret", literal: true });
    expect(hidden.contents.returnedCount).toBe(0);

    const visible = await executeNode({
      pattern: "secret",
      literal: true,
      includeIgnored: true,
    });
    expect(visible.contents.matches).toEqual([
      expect.objectContaining({ path: "ignored/secret.ts" }),
    ]);
  });

  it("cancels a spawned process through AbortSignal", async () => {
    const controller = new AbortController();
    const pending = runBoundedProcess({
      executablePath: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd: tempRoot,
      signal: controller.signal,
      timeoutMs: 5_000,
      maxBufferBytes: 1024 * 1024,
    });

    setTimeout(() => controller.abort(), 20);
    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
  });

  it("terminates a spawned process on the runtime timeout", async () => {
    const result = await runBoundedProcess({
      executablePath: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd: tempRoot,
      signal: new AbortController().signal,
      timeoutMs: 20,
      maxBufferBytes: 1024 * 1024,
    });

    expect(result).toMatchObject({ status: "timed_out" });
  });
});
