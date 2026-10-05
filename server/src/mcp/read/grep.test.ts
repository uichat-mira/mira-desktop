import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { executeGrep, runBoundedProcess } from "./grep.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "canonical-grep-runtime");

beforeEach(() => {
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: tempRoot, windowsHide: true });
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

  it("builds a deterministic ripgrep request without letting include reopen default ignores", async () => {
    let receivedArgs: string[] = [];
    const result = await executeGrep(
      {
        args: {
          pattern: "needle",
          include: "**/*.ts",
          literal: true,
          limit: 1,
        },
        environment: createHarnessEnvironmentSnapshot(),
        signal: new AbortController().signal,
      },
      {
        resolveExecutable: () => ({
          source: "system",
          executablePath: "rg",
        }),
        runProcess: async (input) => {
          receivedArgs = input.args;
          return {
            status: "completed" as const,
            exitCode: 0,
            stdout: [
              JSON.stringify({
                type: "match",
                data: {
                  path: { text: "src/alpha.ts" },
                  lines: { text: "Needle one\\n" },
                  line_number: 2,
                  submatches: [{ start: 0 }],
                },
              }),
              JSON.stringify({
                type: "match",
                data: {
                  path: { text: "src/beta.ts" },
                  lines: { text: "Needle two\\n" },
                  line_number: 1,
                  submatches: [{ start: 0 }],
                },
              }),
            ].join("\n"),
            stderr: "",
          };
        },
      },
    );

    expect(receivedArgs).toEqual(
      expect.arrayContaining(["--sort", "path", "--fixed-strings"]),
    );
    const includeIndex = receivedArgs.indexOf("**/*.ts");
    const defaultExcludeIndex = receivedArgs.lastIndexOf("!**/node_modules/**");
    expect(includeIndex).toBeGreaterThan(-1);
    expect(defaultExcludeIndex).toBeGreaterThan(includeIndex);
    expect(result.contents).toMatchObject({
      provider: "system-ripgrep",
      returnedCount: 1,
      hasMore: true,
      nextOffset: 1,
      matches: [expect.objectContaining({ path: "src/alpha.ts" })],
    });
  });

  it("treats a deliberate stdout paging stop as a successful complete JSONL result", async () => {
    const completeLine = JSON.stringify({ type: "match", data: { value: 1 } });
    const partialLine = '{"type":"match"';
    const script = `process.stdout.write(${JSON.stringify(
      `${completeLine}\\n${partialLine}`,
    )}); setTimeout(() => {}, 5000);`;
    let seen = "";

    const result = await runBoundedProcess({
      executablePath: process.execPath,
      args: ["-e", script],
      cwd: tempRoot,
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      maxBufferBytes: 1024 * 1024,
      shouldStopAfterStdoutChunk(chunk) {
        seen += chunk;
        return seen.includes("\n");
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
      stoppedByLimit: true,
      stdout: `${completeLine}\n`,
    });
    expect(() =>
      result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => JSON.parse(line)),
    ).not.toThrow();
  });

  it("bounds large files in the Node fallback instead of reading them into memory", async () => {
    const target = path.join(tempRoot, "src", "huge.txt");
    const handle = fs.openSync(target, "w");
    fs.ftruncateSync(handle, 8 * 1024 * 1024 + 1);
    fs.closeSync(handle);

    const result = await executeNode({
      pattern: "needle",
      literal: true,
      caseSensitive: false,
    });

    expect(result.contents.skippedLargeFiles).toContain("src/huge.txt");
  });

  it("reports invalid fallback regexes without executing them on the main thread", async () => {
    await expect(executeNode({ pattern: "(" })).rejects.toThrow(
      "Invalid grep regular expression",
    );
  });

  it("terminates a pathological Node-fallback regex at the grep deadline", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "src", "redos.txt"),
      `${"a".repeat(200_000)}!\n`,
      "utf8",
    );

    await expect(
      executeGrep(
        {
          args: {
            pattern: "(a+)+$",
            include: "**/*.txt",
            includeIgnored: true,
          },
          environment: createHarnessEnvironmentSnapshot(),
          signal: new AbortController().signal,
        },
        {
          resolveExecutable: () => ({ source: "unavailable" }),
          timeoutMs: 50,
        },
      ),
    ).rejects.toThrow("grep timed out after 50ms");
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
