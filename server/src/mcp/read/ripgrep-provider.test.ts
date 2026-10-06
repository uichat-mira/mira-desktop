import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { resolveTerminalRuntimeExecutable } from "../terminal/dev-runtime.js";
import { clearWorkspaceSelection, runWithWorkspaceRootOverride } from "../workspace.js";
import { executeGrep } from "./grep.js";
import { probeRipgrepProvider, searchWithRipgrep } from "./ripgrep-provider.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "ripgrep-provider");
const realRipgrepPath = resolveTerminalRuntimeExecutable("ripgrep").executablePath;

const contentEnvironment = () =>
  createHarnessEnvironmentSnapshot({
    read: {
      capabilities: [
        {
          id: "ripgrep-locate",
          kind: "locate",
          provider: "ripgrep",
          available: true,
          priority: 100,
        },
        {
          id: "node-content-scan-locate",
          kind: "locate",
          provider: "node-fs",
          available: true,
          priority: 40,
        },
      ],
    },
  });

beforeEach(() => {
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "ignored"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".gitignore"), "ignored/\n", "utf-8");
  fs.writeFileSync(
    path.join(tempRoot, "src", "alpha.ts"),
    'const Needle = "中文";\nconst needleAgain = true;\n',
    "utf-8",
  );
  fs.writeFileSync(
    path.join(tempRoot, "src", "beta.ts"),
    'const needle = "second";\n',
    "utf-8",
  );
  fs.writeFileSync(path.join(tempRoot, "docs", "alpha.md"), "needle docs\n", "utf-8");
  fs.writeFileSync(path.join(tempRoot, "ignored", "secret.ts"), "needle secret\n", "utf-8");
  process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
  clearWorkspaceSelection();
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.UI_CHAT_WORKSPACE_ROOT;
  clearWorkspaceSelection();
});

describe("shared ripgrep provider", () => {
  it("uses the resolved executable for availability checks", () => {
    const calls: Array<{ executablePath: string; args: string[] }> = [];
    const result = probeRipgrepProvider({
      resolveExecutable: () => ({
        source: "bundled",
        executablePath: "C:\\runtime\\rg.exe",
      }),
      spawn(executablePath, args) {
        calls.push({ executablePath, args });
        return { status: 0, stdout: "ripgrep test" };
      },
    });

    expect(result).toEqual({ available: true, provider: "bundled-ripgrep" });
    expect(calls).toEqual([
      {
        executablePath: "C:\\runtime\\rg.exe",
        args: ["--version"],
      },
    ]);
  });

  it.skipIf(!realRipgrepPath)(
    "executes a real content search through a bundled resolution",
    () => {
      const result = searchWithRipgrep(
        {
          query: "needle",
          workspaceRoot: tempRoot,
          basePath: tempRoot,
          extensions: [".ts"],
          limit: 2,
        },
        {
          resolveExecutable: () => ({
            source: "bundled",
            executablePath: realRipgrepPath,
          }),
        },
      );

      expect(result.status).toBe("success");
      if (result.status !== "success") return;
      expect(result.provider).toBe("bundled-ripgrep");
      expect(result.matches).toHaveLength(2);
      expect(result.matches.every((match) => match.path.endsWith(".ts"))).toBe(true);
      expect(result.matches.some((match) => match.path.startsWith("ignored/"))).toBe(false);
      expect(result.matches[0]).toEqual(
        expect.objectContaining({
          path: expect.stringMatching(/^src\//),
          line: expect.any(Number),
          column: expect.any(Number),
          preview: expect.any(String),
        }),
      );
    },
  );

  it.skipIf(!realRipgrepPath)(
    "executes the system fallback with regex and smart-case behavior",
    () => {
      const result = searchWithRipgrep(
        {
          query: 'Needle\\s*=\\s*"中文"',
          workspaceRoot: tempRoot,
          basePath: tempRoot,
          extensions: [".ts"],
          limit: 10,
        },
        {
          resolveExecutable: () => ({
            source: "system",
            executablePath: realRipgrepPath,
          }),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          status: "success",
          provider: "system-ripgrep",
          matches: [
            expect.objectContaining({
              path: "src/alpha.ts",
              line: 1,
              preview: expect.stringContaining("中文"),
            }),
          ],
        }),
      );
    },
  );

  it("falls back to the Node content scan when ripgrep is unavailable", async () => {
    fs.writeFileSync(path.join(tempRoot, "src", "gamma.ts"), "Alpha 中文\n", "utf-8");
    fs.writeFileSync(path.join(tempRoot, "src", "delta.ts"), "alpha 中文\n", "utf-8");
    fs.writeFileSync(path.join(tempRoot, "ignored", "ignored.ts"), "alpha 中文\n", "utf-8");

    const execution = await runWithWorkspaceRootOverride(tempRoot, async () =>
      executeGrep(
        {
          args: {
            pattern: "alpha\\s+中文",
            path: ".",
            limit: 1,
          },
          environment: contentEnvironment(),
          signal: new AbortController().signal,
        },
        {
          resolveExecutable: () => ({ source: "unavailable" }),
        },
      ),
    );

    expect(execution.contents).toEqual(
      expect.objectContaining({
        provider: "node-content-scan",
        providerAttempts: [
          expect.objectContaining({ status: "unavailable" }),
          expect.objectContaining({
            provider: "node-content-scan",
            status: "success",
          }),
        ],
        returnedCount: 1,
        hasMore: true,
      }),
    );
    expect(execution.contents.matches[0]).toEqual(
      expect.objectContaining({
        path: expect.stringMatching(/^src\//),
        line: 1,
        column: 1,
        preview: expect.stringContaining("中文"),
      }),
    );
    expect(
      execution.contents.matches.some((match) => match.path.startsWith("ignored/")),
    ).toBe(false);
  });

  it("uses Node scan after a resolved ripgrep execution failure", async () => {
    const execution = await runWithWorkspaceRootOverride(tempRoot, async () =>
      executeGrep(
        {
          args: { pattern: "needle", path: ".", limit: 10 },
          environment: contentEnvironment(),
          signal: new AbortController().signal,
        },
        {
          resolveExecutable: () => ({
            source: "bundled",
            executablePath: "C:\\runtime\\rg.exe",
          }),
          runProcess: async () => ({
            status: "completed",
            exitCode: 2,
            stdout: "",
            stderr: "",
          }),
        },
      ),
    );

    expect(execution.contents.provider).toBe("node-content-scan");
    expect(execution.contents.providerAttempts[0]).toEqual({
      provider: "bundled-ripgrep",
      status: "failed",
      reason: "exit-status-2",
    });
    expect(
      execution.contents.matches.some((match) => match.path === "src/alpha.ts"),
    ).toBe(true);
  });
});
