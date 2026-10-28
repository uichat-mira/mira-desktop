import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  executeHostCommand,
  resolveHostCwd,
  resolveHostEnv,
} from "../host-spawn-runtime.js";

const tempRoots: string[] = [];

const makeTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-host-runtime-"));
  tempRoots.push(root);
  return root;
};

const createShellProfile = () =>
  process.platform === "win32"
    ? {
        shell: "powershell.exe",
        shellFamily: "powershell" as const,
        argsMode: "powershell" as const,
        stdoutEncoding: "utf16le",
        stderrEncoding: "utf16le",
      }
    : {
        shell: "/bin/sh",
        shellFamily: "posix" as const,
        argsMode: "posix" as const,
        stdoutEncoding: "utf8",
        stderrEncoding: "utf8",
      };

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("host spawn cwd", () => {
  it("defaults to the selected workspace", () => {
    const workspaceRoot = makeTempRoot();
    const result = resolveHostCwd({ workspaceRoot });

    expect(result.cwd).toBe(path.resolve(workspaceRoot));
    expect(result.workspaceRelation).toBe("inside");
  });

  it("allows an approved absolute directory outside the workspace", () => {
    const workspaceRoot = makeTempRoot();
    const outsideRoot = makeTempRoot();
    const result = resolveHostCwd({
      workspaceRoot,
      cwd: outsideRoot,
    });

    expect(result.cwd).toBe(path.resolve(outsideRoot));
    expect(result.workspaceRelation).toBe("outside");
  });

  it("allows parent traversal and records the resolved relation", () => {
    const parentRoot = makeTempRoot();
    const workspaceRoot = path.join(parentRoot, "workspace");
    const outsideRoot = path.join(parentRoot, "outside");
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);

    const result = resolveHostCwd({
      workspaceRoot,
      cwd: "../outside",
    });

    expect(result.cwd).toBe(path.resolve(outsideRoot));
    expect(result.workspaceRelation).toBe("outside");
  });

  it("still rejects a cwd that does not exist", () => {
    const workspaceRoot = makeTempRoot();

    expect(() =>
      resolveHostCwd({
        workspaceRoot,
        cwd: "missing-directory",
      }),
    ).toThrow(/does not exist/i);
  });
});

describe("host spawn environment", () => {
  it("inherits the host environment and accepts arbitrary overrides", () => {
    const result = resolveHostEnv({
      MIRA_TEST_CUSTOM_ENV: "available",
    });

    expect(result.MIRA_TEST_CUSTOM_ENV).toBe("available");
    if (process.env.PATH) {
      expect(result.PATH).toBe(process.env.PATH);
    }
  });
});

describe("host spawn execution", () => {
  it("runs a real child process with inherited environment", async () => {
    const workspaceRoot = makeTempRoot();
    const controller = new AbortController();
    const command =
      process.platform === "win32"
        ? "[Console]::WriteLine($env:MIRA_TEST_RUNTIME_VALUE)"
        : "printf '%s' \"$MIRA_TEST_RUNTIME_VALUE\"";

    const result = await executeHostCommand({
      command,
      workspaceRoot,
      timeoutMs: 15_000,
      signal: controller.signal,
      shellProfile: createShellProfile(),
      env: {
        MIRA_TEST_RUNTIME_VALUE: "host-runtime-ok",
      },
    });

    expect(result.runtimeId).toBe("host_spawn");
    expect(result.workspaceRelation).toBe("inside");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("host-runtime-ok");
  }, 25_000);
});
