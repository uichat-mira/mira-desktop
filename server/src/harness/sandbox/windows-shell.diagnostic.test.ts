import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { describe, test } from "vitest";

import { createHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import { resolveSandboxEnv } from "@/sandbox/executor.js";

type ProbeResult = {
  label: string;
  timedOut: boolean;
  exitSeen: boolean;
  closeSeen: boolean;
  exitCode: number | null;
  stdoutHex: string;
  stderrHex: string;
  error: string | null;
};

const runAsyncProbe = async (input: {
  label: string;
  shell: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  closeStdin: boolean;
}): Promise<ProbeResult> =>
  new Promise((resolve) => {
    const child = spawn(input.shell, input.args, {
      cwd: process.cwd(),
      env: input.env,
      windowsHide: true,
      shell: false,
      ...(input.closeStdin ? { stdio: ["ignore", "pipe", "pipe"] } : {}),
    });

    let stdoutHex = "";
    let stderrHex = "";
    let exitSeen = false;
    let closeSeen = false;
    let exitCode: number | null = null;
    let settled = false;

    const finish = (partial: Omit<ProbeResult, "label">) => {
      if (settled) return;
      settled = true;
      resolve({ label: input.label, ...partial });
    };

    child.stdout?.on("data", (chunk) => {
      stdoutHex += Buffer.from(chunk).toString("hex");
    });
    child.stderr?.on("data", (chunk) => {
      stderrHex += Buffer.from(chunk).toString("hex");
    });
    child.once("error", (error) => {
      finish({
        timedOut: false,
        exitSeen,
        closeSeen,
        exitCode,
        stdoutHex,
        stderrHex,
        error: error.message,
      });
    });
    child.once("exit", (code) => {
      exitSeen = true;
      exitCode = code;
    });
    child.once("close", (code) => {
      closeSeen = true;
      exitCode = code ?? exitCode;
      clearTimeout(timer);
      finish({
        timedOut: false,
        exitSeen,
        closeSeen,
        exitCode,
        stdoutHex,
        stderrHex,
        error: null,
      });
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // diagnostic cleanup
      }
      if (child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
      finish({
        timedOut: true,
        exitSeen,
        closeSeen,
        exitCode,
        stdoutHex,
        stderrHex,
        error: null,
      });
    }, 2_500);
  });

describe.skipIf(process.platform !== "win32")("Windows sandbox shell diagnostics", () => {
  test("isolates PowerShell env and stdio behavior", async () => {
    const shell = createHarnessEnvironmentSnapshot().terminal.shellProfile.shell;
    const baseArgs = ["-NoProfile", "-Command", "Write-Output 'mira-sandbox-probe'"];
    const fullEnv = { ...process.env };
    const sandboxEnv = resolveSandboxEnv();

    const syncFull = spawnSync(shell, baseArgs, {
      cwd: process.cwd(),
      env: fullEnv,
      windowsHide: true,
      timeout: 2_500,
      encoding: "buffer",
    });
    const syncSandbox = spawnSync(shell, baseArgs, {
      cwd: process.cwd(),
      env: sandboxEnv,
      windowsHide: true,
      timeout: 2_500,
      encoding: "buffer",
    });

    const asyncFull = await runAsyncProbe({
      label: "async-full-env-default-stdio",
      shell,
      args: baseArgs,
      env: fullEnv,
      closeStdin: false,
    });
    const asyncSandbox = await runAsyncProbe({
      label: "async-sandbox-env-default-stdio",
      shell,
      args: baseArgs,
      env: sandboxEnv,
      closeStdin: false,
    });
    const asyncSandboxClosedStdin = await runAsyncProbe({
      label: "async-sandbox-env-closed-stdin",
      shell,
      args: baseArgs,
      env: sandboxEnv,
      closeStdin: true,
    });

    const report = {
      shell,
      sandboxEnvKeys: Object.keys(sandboxEnv).sort(),
      syncFull: {
        status: syncFull.status,
        signal: syncFull.signal,
        error: syncFull.error?.message ?? null,
        stdoutHex: Buffer.isBuffer(syncFull.stdout) ? syncFull.stdout.toString("hex") : syncFull.stdout,
        stderrHex: Buffer.isBuffer(syncFull.stderr) ? syncFull.stderr.toString("hex") : syncFull.stderr,
      },
      syncSandbox: {
        status: syncSandbox.status,
        signal: syncSandbox.signal,
        error: syncSandbox.error?.message ?? null,
        stdoutHex: Buffer.isBuffer(syncSandbox.stdout) ? syncSandbox.stdout.toString("hex") : syncSandbox.stdout,
        stderrHex: Buffer.isBuffer(syncSandbox.stderr) ? syncSandbox.stderr.toString("hex") : syncSandbox.stderr,
      },
      asyncFull,
      asyncSandbox,
      asyncSandboxClosedStdin,
    };

    const passed =
      syncFull.status === 0 &&
      syncSandbox.status === 0 &&
      !asyncFull.timedOut &&
      asyncFull.exitCode === 0 &&
      !asyncSandbox.timedOut &&
      asyncSandbox.exitCode === 0 &&
      !asyncSandboxClosedStdin.timedOut &&
      asyncSandboxClosedStdin.exitCode === 0;

    assert.equal(passed, true, JSON.stringify(report, null, 2));
  }, 20_000);
});
