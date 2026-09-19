import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCodeGraphStudioService,
  setActiveCodeGraphStudioService,
} from "../index.js";
import { reconcileCodeGraphHarnessCapability } from "@/harness/codegraph-capability.js";
import {
  clearHarnessRegistry,
  listCapabilityDefinitions,
} from "@/harness/registry.js";
import { initializeHarnessRuntime, resetHarnessRuntime } from "@/harness/runtime.js";
import { getTestArtifactDir } from "@/test-support/artifacts.js";

const fixturePath = path.resolve(
  "src/mcp/managed-codegraph/__tests__/fixtures/fake-codegraph-provider.mjs",
);
const workspaceRoot = path.resolve(process.cwd());
const storageRoot = getTestArtifactDir("codegraph-studio-service");
const appDataRoot = getTestArtifactDir("codegraph-studio-appdata");
const isolatedWorkspaceRoot = getTestArtifactDir("codegraph-studio-workspace");

const originalEnv = {
  UI_CHAT_CODEGRAPH_APP_DATA_ROOT: process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT,
  UI_CHAT_CODEGRAPH_COMMAND: process.env.UI_CHAT_CODEGRAPH_COMMAND,
  UI_CHAT_CODEGRAPH_START_ARGS: process.env.UI_CHAT_CODEGRAPH_START_ARGS,
  UI_CHAT_CODEGRAPH_VERSION_ARGS: process.env.UI_CHAT_CODEGRAPH_VERSION_ARGS,
  UI_CHAT_CODEGRAPH_TELEMETRY_ARGS: process.env.UI_CHAT_CODEGRAPH_TELEMETRY_ARGS,
};

const resetCodeGraphEnv = () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

describe("CodeGraph Studio service", () => {
  beforeEach(() => {
    resetCodeGraphEnv();
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(appDataRoot, { recursive: true, force: true });
    fs.rmSync(isolatedWorkspaceRoot, { recursive: true, force: true });
    fs.mkdirSync(storageRoot, { recursive: true });
    fs.mkdirSync(appDataRoot, { recursive: true });
    fs.mkdirSync(isolatedWorkspaceRoot, { recursive: true });
    delete process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT;
    delete process.env.UI_CHAT_CODEGRAPH_COMMAND;
    delete process.env.UI_CHAT_CODEGRAPH_START_ARGS;
    delete process.env.UI_CHAT_CODEGRAPH_VERSION_ARGS;
    delete process.env.UI_CHAT_CODEGRAPH_TELEMETRY_ARGS;
  });

  afterEach(() => {
    resetCodeGraphEnv();
    setActiveCodeGraphStudioService(null);
    clearHarnessRegistry();
    resetHarnessRuntime();
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(appDataRoot, { recursive: true, force: true });
    fs.rmSync(isolatedWorkspaceRoot, { recursive: true, force: true });
  });

  it("reports the real provider as blocked when external index root is unsupported", async () => {
    const service = createCodeGraphStudioService({
      workspaceRoot: isolatedWorkspaceRoot,
      storageRoot,
    });

    const report = await service.getReport();

    expect(report.status).toBe("blocked");
    expect(report.config.command).toBe("codegraph");
    expect(report.config.agentCapabilityEnabled).toBe(false);
    expect(report.config.capabilityRegistered).toBe(false);
    expect(
      report.blockedReasons.map((reason) => reason.code),
    ).toContain("external_index_root_unsupported");
  });

  it("reports blocked when appDataRoot cannot be resolved", async () => {
    process.env.UI_CHAT_CODEGRAPH_COMMAND = process.execPath;
    const service = createCodeGraphStudioService({
      workspaceRoot,
      storageRoot,
    });

    const report = await service.getReport();

    expect(report.status).toBe("blocked");
    expect(
      report.blockedReasons.map((reason) => reason.code),
    ).toContain("app_data_root_unavailable");
  });

  it("preserves repo-root .codegraph and reports repo pollution risk", async () => {
    process.env.UI_CHAT_CODEGRAPH_COMMAND = process.execPath;
    process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT = appDataRoot;
    process.env.UI_CHAT_CODEGRAPH_START_ARGS = JSON.stringify([fixturePath, "--mcp"]);
    process.env.UI_CHAT_CODEGRAPH_VERSION_ARGS = JSON.stringify([fixturePath, "--version"]);
    process.env.UI_CHAT_CODEGRAPH_TELEMETRY_ARGS = JSON.stringify([
      fixturePath,
      "--telemetry-status",
    ]);
    const repoCodeGraphDir = path.join(workspaceRoot, ".codegraph");
    const sentinelPath = path.join(repoCodeGraphDir, "studio-sentinel.txt");
    fs.mkdirSync(repoCodeGraphDir, { recursive: true });
    fs.writeFileSync(sentinelPath, "user-owned", "utf8");

    try {
      const service = createCodeGraphStudioService({
        workspaceRoot,
        storageRoot,
      });
      const report = await service.getReport();

      expect(report.status).toBe("blocked");
      expect(report.pollutionGuard.exists).toBe(true);
      expect(
        report.blockedReasons.map((reason) => reason.code),
      ).toContain("repo_pollution_risk");
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe("user-owned");
    } finally {
      fs.rmSync(repoCodeGraphDir, { recursive: true, force: true });
    }
  });

  it("saves config and uses the fake provider for ready smoke query while keeping capability registration opt-in", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `ready-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });
    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
    });

    await service.saveConfig({
      agentCapabilityEnabled: true,
      command: process.execPath,
      startArgs: [fixturePath, "--mcp"],
      versionProbeArgs: [fixturePath, "--version"],
      telemetryProbeArgs: [fixturePath, "--telemetry-status"],
      appDataRoot: caseAppDataRoot,
      timeoutMs: 1500,
      maxResults: 7,
      queryLimit: 4,
    });

    const started = await service.start();
    const healthy = await service.health();
    const smoke = await service.smokeQuery("microapps architecture flow overview");

    expect(started.report.status).toBe("ready");
    expect(healthy.report.status).toBe("ready");
    expect(smoke.ok).toBe(true);
    expect(smoke.kind).toBe("query");
    expect(smoke.report.config.command).toBe(process.execPath);
    expect(smoke.report.config.queryLimit).toBe(4);
    expect(smoke.report.config.maxResults).toBe(7);
    expect(smoke.report.capability.available).toBe(true);
    expect(smoke.report.config.capabilityRegistered).toBe(false);
  });

  it("rejects appDataRoot when it is the workspace root", async () => {
    const service = createCodeGraphStudioService({
      workspaceRoot: isolatedWorkspaceRoot,
      storageRoot,
    });

    await expect(
      service.saveConfig({
        appDataRoot: isolatedWorkspaceRoot,
      }),
    ).rejects.toThrowError("App Data Root cannot be the workspace root.");
    expect(fs.existsSync(service.getStoragePath())).toBe(false);
  });

  it("rejects appDataRoot when it is inside the workspace root", async () => {
    const service = createCodeGraphStudioService({
      workspaceRoot: isolatedWorkspaceRoot,
      storageRoot,
    });
    const nestedRoot = path.join(isolatedWorkspaceRoot, "tmp", "codegraph");

    await expect(
      service.saveConfig({
        appDataRoot: nestedRoot,
      }),
    ).rejects.toThrowError("App Data Root must stay outside the workspace root.");
    expect(fs.existsSync(service.getStoragePath())).toBe(false);
  });

  it("saves appDataRoot when it is outside the workspace root", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `outside-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });
    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
    });

    await service.saveConfig({
      appDataRoot: caseAppDataRoot,
    });

    expect(service.getDraft().appDataRoot).toBe(path.resolve(caseAppDataRoot));
    expect(fs.existsSync(service.getStoragePath())).toBe(true);
  });

  it("does not persist invalid appDataRoot or start the provider after validation failure", async () => {
    const service = createCodeGraphStudioService({
      workspaceRoot: isolatedWorkspaceRoot,
      storageRoot,
    });
    const invalidRoot = path.join(isolatedWorkspaceRoot, ".codegraph", "appdata");

    await expect(
      service.saveConfig({
        appDataRoot: invalidRoot,
      }),
    ).rejects.toThrowError(
      "App Data Root cannot point to repo-root `.codegraph` or any path inside it.",
    );

    const started = await service.start();
    expect(started.report.status).toBe("blocked");
    expect(started.report.runtime.processAlive).toBe(false);
    expect(fs.existsSync(service.getStoragePath())).toBe(false);
  });

  it("keeps a ready manager live across auth-only config changes and updates capability registration immediately", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `auth-only-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });

    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
      getCapabilityRegistrationState: () =>
        listCapabilityDefinitions().some((item) => item.id === "codebase_explore"),
      onStateChanged: () => {
        reconcileCodeGraphHarnessCapability();
      },
    });
    setActiveCodeGraphStudioService(service);
    initializeHarnessRuntime();

    await service.saveConfig({
      microAppEnabled: true,
      agentCapabilityEnabled: false,
      command: process.execPath,
      startArgs: [fixturePath, "--mcp"],
      versionProbeArgs: [fixturePath, "--version"],
      telemetryProbeArgs: [fixturePath, "--telemetry-status"],
      appDataRoot: caseAppDataRoot,
    });

    const started = await service.start();
    const healthy = await service.health();

    expect(started.report.runtime.processAlive).toBe(true);
    expect(healthy.report.status).toBe("ready");
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");

    await service.saveConfig({
      agentCapabilityEnabled: true,
    });

    const enabledReport = await service.getReport();
    expect(enabledReport.status).toBe("ready");
    expect(enabledReport.runtime.processAlive).toBe(true);
    expect(enabledReport.capability.available).toBe(true);
    expect(enabledReport.capability.registered).toBe(true);
    expect(enabledReport.config.capabilityRegistered).toBe(true);
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");

    await service.saveConfig({
      agentCapabilityEnabled: false,
    });

    const disabledReport = await service.getReport();
    expect(disabledReport.status).toBe("ready");
    expect(disabledReport.runtime.processAlive).toBe(true);
    expect(disabledReport.capability.available).toBe(false);
    expect(disabledReport.capability.registered).toBe(false);
    expect(disabledReport.config.capabilityRegistered).toBe(true);
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");
  });

  it("stops the old manager on runtime config changes and keeps capability unavailable until an explicit restart", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `runtime-change-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });

    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
      getCapabilityRegistrationState: () =>
        listCapabilityDefinitions().some((item) => item.id === "codebase_explore"),
      onStateChanged: () => {
        reconcileCodeGraphHarnessCapability();
      },
    });
    setActiveCodeGraphStudioService(service);
    initializeHarnessRuntime();

    await service.saveConfig({
      microAppEnabled: true,
      agentCapabilityEnabled: true,
      command: process.execPath,
      startArgs: [fixturePath, "--mcp"],
      versionProbeArgs: [fixturePath, "--version"],
      telemetryProbeArgs: [fixturePath, "--telemetry-status"],
      appDataRoot: caseAppDataRoot,
    });

    const started = await service.start();
    expect(started.report.status).toBe("ready");
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");

    const previousContext = service.getManagedCapabilityContext(caseWorkspaceRoot);
    expect(previousContext.ok).toBe(true);

    await service.saveConfig({
      startArgs: [fixturePath, "--mcp", "--session-id", `case-${Date.now()}`],
    });

    const changedReport = await service.getReport();
    expect(["stopped", "unavailable"]).toContain(changedReport.status);
    expect(changedReport.runtime.processAlive).toBe(false);
    expect(changedReport.capability.available).toBe(false);
    expect(changedReport.capability.registered).toBe(false);
    expect(changedReport.config.capabilityRegistered).toBe(true);
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");

    const currentContext = service.getManagedCapabilityContext(caseWorkspaceRoot);
    expect(currentContext.ok).toBe(false);
  });

  it("keeps capability unavailable during runtime reconfiguration and starts with the new startArgs only after an explicit restart", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `runtime-transition-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    const startupArgsLogPath = path.join(caseRoot, "provider-startup-args.log");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });

    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
      getCapabilityRegistrationState: () =>
        listCapabilityDefinitions().some((item) => item.id === "codebase_explore"),
      onStateChanged: () => {
        reconcileCodeGraphHarnessCapability();
      },
    });
    setActiveCodeGraphStudioService(service);
    initializeHarnessRuntime();

    process.env.FAKE_STARTUP_ARGS_LOG_PATH = startupArgsLogPath;
    await service.saveConfig({
      microAppEnabled: true,
      agentCapabilityEnabled: true,
      command: process.execPath,
      startArgs: [fixturePath, "--mcp"],
      versionProbeArgs: [fixturePath, "--version"],
      telemetryProbeArgs: [fixturePath, "--telemetry-status"],
      appDataRoot: caseAppDataRoot,
      timeoutMs: 1500,
    });

    await service.start();
    await service.health();
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");

    process.env.FAKE_SHUTDOWN_DELAY_MS = "250";
    const nextStartArgs = [fixturePath, "--mcp", "--session-id", `new-${Date.now()}`];
    const savePromise = service.saveConfig({
      startArgs: nextStartArgs,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");
    expect(service.getManagedCapabilityContext(caseWorkspaceRoot).ok).toBe(false);

    await savePromise;

    const afterSaveReport = await service.getReport();
    expect(afterSaveReport.runtime.processAlive).toBe(false);
    expect(afterSaveReport.capability.registered).toBe(false);
    expect(afterSaveReport.config.capabilityRegistered).toBe(true);

    const beforeRestartStartupCount = fs.existsSync(startupArgsLogPath)
      ? fs
          .readFileSync(startupArgsLogPath, "utf8")
          .split(/\r?\n/)
          .filter(Boolean).length
      : 0;

    await service.start();
    await service.health();

    const startupEntries = fs
      .readFileSync(startupArgsLogPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { argv: string[] });
    const latestStartupEntry = startupEntries.at(-1);

    expect(latestStartupEntry?.argv).toEqual(nextStartArgs.slice(1));
    expect(
      startupEntries.length,
    ).toBeGreaterThan(beforeRestartStartupCount);
  });

  it("does not reuse the old manager when command changes", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `command-change-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });

    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
      getCapabilityRegistrationState: () =>
        listCapabilityDefinitions().some((item) => item.id === "codebase_explore"),
      onStateChanged: () => {
        reconcileCodeGraphHarnessCapability();
      },
    });
    setActiveCodeGraphStudioService(service);
    initializeHarnessRuntime();

    await service.saveConfig({
      microAppEnabled: true,
      agentCapabilityEnabled: true,
      command: process.execPath,
      startArgs: [fixturePath, "--mcp"],
      versionProbeArgs: [fixturePath, "--version"],
      telemetryProbeArgs: [fixturePath, "--telemetry-status"],
      appDataRoot: caseAppDataRoot,
      timeoutMs: 1500,
    });

    await service.start();
    await service.health();
    const beforeChangeContext = service.getManagedCapabilityContext(caseWorkspaceRoot);
    expect(beforeChangeContext.ok).toBe(true);
    const previousFingerprint = beforeChangeContext.ok
      ? beforeChangeContext.manager.getRuntimeFingerprint()
      : null;

    await service.saveConfig({
      command: "node",
    });

    expect(service.getManagedCapabilityContext(caseWorkspaceRoot).ok).toBe(false);
    await service.start();
    await service.health();

    const afterRestartContext = service.getManagedCapabilityContext(caseWorkspaceRoot);
    expect(afterRestartContext.ok).toBe(true);
    if (afterRestartContext.ok) {
      expect(afterRestartContext.manager.getRuntimeFingerprint()).not.toBe(previousFingerprint);
    }
  });

  it("makes capability unavailable for the whole explicit stop window", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `stop-window-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });

    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
      getCapabilityRegistrationState: () =>
        listCapabilityDefinitions().some((item) => item.id === "codebase_explore"),
      onStateChanged: () => {
        reconcileCodeGraphHarnessCapability();
      },
    });
    setActiveCodeGraphStudioService(service);
    initializeHarnessRuntime();

    process.env.FAKE_SHUTDOWN_DELAY_MS = "300";
    await service.saveConfig({
      microAppEnabled: true,
      agentCapabilityEnabled: true,
      command: process.execPath,
      startArgs: [fixturePath, "--mcp"],
      versionProbeArgs: [fixturePath, "--version"],
      telemetryProbeArgs: [fixturePath, "--telemetry-status"],
      appDataRoot: caseAppDataRoot,
      timeoutMs: 1000,
    });

    await service.start();
    await service.health();
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");

    const stopPromise = service.stop();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");
    expect(service.getManagedCapabilityContext(caseWorkspaceRoot).ok).toBe(false);

    const stopResult = await stopPromise;
    expect(stopResult.report.capability.registered).toBe(false);
    expect(stopResult.report.config.capabilityRegistered).toBe(true);
    expect(stopResult.report.runtime.processAlive).toBe(false);
  });

  it("keeps ready runtime on report refresh and clears capability after provider exit", async () => {
    const caseRoot = path.join(
      getTestArtifactDir("codegraph-studio-cases"),
      `report-refresh-${Date.now()}`,
    );
    const caseStorageRoot = path.join(caseRoot, "storage");
    const caseAppDataRoot = path.join(caseRoot, "appdata");
    const caseWorkspaceRoot = path.join(caseRoot, "workspace");
    fs.mkdirSync(caseStorageRoot, { recursive: true });
    fs.mkdirSync(caseAppDataRoot, { recursive: true });
    fs.mkdirSync(caseWorkspaceRoot, { recursive: true });

    const service = createCodeGraphStudioService({
      workspaceRoot: caseWorkspaceRoot,
      storageRoot: caseStorageRoot,
      getCapabilityRegistrationState: () =>
        listCapabilityDefinitions().some((item) => item.id === "codebase_explore"),
      onStateChanged: () => {
        reconcileCodeGraphHarnessCapability();
      },
    });
    setActiveCodeGraphStudioService(service);
    initializeHarnessRuntime();

    await service.saveConfig({
      microAppEnabled: true,
      agentCapabilityEnabled: true,
      command: process.execPath,
      startArgs: [fixturePath, "--mcp"],
      versionProbeArgs: [fixturePath, "--version"],
      telemetryProbeArgs: [fixturePath, "--telemetry-status"],
      appDataRoot: caseAppDataRoot,
      timeoutMs: 1500,
    });

    await service.start();
    await service.health();

    const refreshedReport = await service.getReport();
    expect(refreshedReport.status).toBe("ready");
    expect(refreshedReport.runtime.processAlive).toBe(true);
    expect(refreshedReport.capability.registered).toBe(true);
    expect(refreshedReport.config.capabilityRegistered).toBe(true);

    const activeContext = service.getManagedCapabilityContext(caseWorkspaceRoot);
    expect(activeContext.ok).toBe(true);

    const stopped = await service.stop();
    expect(["stopped", "degraded", "blocked"]).toContain(stopped.report.status);

    const afterExitReport = await service.getReport();
    expect(afterExitReport.runtime.processAlive).toBe(false);
    expect(afterExitReport.capability.registered).toBe(false);
    expect(afterExitReport.config.capabilityRegistered).toBe(true);
    expect(listCapabilityDefinitions().map((item) => item.id)).toContain("codebase_explore");

    const afterExitContext = service.getManagedCapabilityContext(caseWorkspaceRoot);
    expect(afterExitContext.ok).toBe(false);
  });
});
