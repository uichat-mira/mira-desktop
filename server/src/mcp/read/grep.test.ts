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
    "needle one\nother\nneedle two\n",
    "utf8",
  );
  fs.writeFileSync(path.join(tempRoot, "ignored", "secret.ts"), "needle secret\n", "utf8");
  process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
  clearWorkspaceSelection();
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.UI_CHAT_WORKSPACE_ROOT;
  clearWorkspaceSelection();
});

describe("canonical grep runtime", () => {
  it("uses deterministic async Node fallback when ripgrep is unavailable", async () => {
    const result = await executeGrep(
      {
        args: {
          pattern: "needle",
          root: ".",
          extensions: ["ts"],
          maxResults: 10,
        },
        environment: createHarnessEnvironmentSnapshot(),
        signal: new AbortController().signal,
      },
      {
        resolveExecutable: () => ({ source: "unavailable" }),
      },
    );

    expect(result.contents).toMatchObject({
      type: "grep",
      pattern: "needle",
      root: ".",
      provider: "node-content-scan",
      returnedCount: 2,
      hasMore: false,
      truncated: false,
    });
    expect(result.contents.matches).toEqual([
      expect.objectContaining({ path: "src/alpha.ts", line: 1, column: 1 }),
      expect.objectContaining({ path: "src/alpha.ts", line: 3, column: 1 }),
    ]);
    expect(result.contents.matches.some((match) => match.path.startsWith("ignored/"))).toBe(false);
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
