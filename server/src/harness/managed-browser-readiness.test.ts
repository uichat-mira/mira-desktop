import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserRuntimeResolver } from "@/microapps/computer-use/browser/types.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import {
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
} from "./capability-view.js";
import { resolveHarnessToolExposure } from "./exposure.js";
import {
  createManagedBrowserRuntimeReadinessResolver,
  resolveManagedBrowserHarnessRuntimeReadiness,
} from "./managed-browser-readiness.js";
import {
  clearHarnessRegistry,
  listToolDefinitions,
  registerTool,
} from "./registry.js";
import { resolveToolRuntimeReadiness } from "./runtime-readiness.js";

const MANAGED_BROWSER_TOOL_IDS = [
  "browser_observe",
  "browser_act",
  "browser_assert",
] as const;

const browser = {
  observe: () => undefined,
  act: () => undefined,
  assert: () => undefined,
};

const readyRuntime: BrowserRuntimeResolver = {
  resolveRuntime: () => ({
    status: "ready",
    strategy: "managed",
    runtime: {
      source: "managed",
      channel: "chromium",
      executablePath: "C:/managed/chromium/chrome.exe",
      version: "152.0.7948.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    },
    inspectedCandidates: [],
  }),
};

const unavailableReason =
  "No managed Chromium or supported system browser was found. Install managed Chromium before execution.";
const unavailableRuntime: BrowserRuntimeResolver = {
  resolveRuntime: () => ({
    status: "not_installed",
    strategy: "download",
    inspectedCandidates: [],
    reason: unavailableReason,
  }),
};

const registerManagedBrowserTools = (runtime: BrowserRuntimeResolver) => {
  const resolveReadiness = createManagedBrowserRuntimeReadinessResolver(runtime);
  for (const tool of createComputerUseBrowserTools(browser as never)) {
    registerTool(tool, { resolveReadiness });
  }
};

describe("Managed Browser Harness runtime readiness", () => {
  beforeEach(() => clearHarnessRegistry());
  afterEach(() => clearHarnessRegistry());

  it("projects ready for all browser tools when the managed runtime is ready", () => {
    registerManagedBrowserTools(readyRuntime);

    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(resolveToolRuntimeReadiness(toolId)).toEqual({
        state: "ready",
        reason: "Managed browser runtime prerequisites are satisfied.",
      });
    }

    const exposure = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "请打开网页读取页面标题",
    });
    expect(exposure.exposedToolIds).toEqual(
      expect.arrayContaining([...MANAGED_BROWSER_TOOL_IDS]),
    );

    const view = projectAgentCapabilityView({
      scope: createMainAgentCapabilityScope({ scopeId: "main" }),
      definitions: listToolDefinitions(),
    });
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(view.capabilities.get(toolId)?.eligible).toBe(true);
      expect(view.capabilities.get(toolId)?.discoverable).toBe(true);
    }
  });

  it("applies the exact Managed Browser Runtime gate to both new atomic read-only tools", () => {
    for (const [runtime, state, code] of [
      [readyRuntime, "ready", undefined],
      [unavailableRuntime, "unavailable", "browser_runtime_unavailable"],
      [{ resolveRuntime: () => { throw new Error("secret path must not leak"); } }, "unavailable", "readiness_check_failed"],
    ] as const) {
      clearHarnessRegistry();
      registerManagedBrowserTools(runtime);
      for (const toolId of ["browser_snapshot", "browser_screenshot"]) {
        const definition = listToolDefinitions().find((tool) => tool.id === toolId);
        expect(definition).toBeDefined();
        expect(definition?.capabilities).toMatchObject({ sideEffect: "none", requiresApproval: false });
        expect(resolveToolRuntimeReadiness(toolId)).toMatchObject({ state, ...(code ? { code } : {}) });
      }
    }
  });

  it("applies the exact Managed Browser Runtime gate to navigation and wait facades", () => {
    const expected = [
      ["browser_navigate", { sideEffect: "network", requiresApproval: true }],
      ["browser_wait_for", { sideEffect: "none", requiresApproval: true }],
    ] as const;
    for (const [runtime, state, code] of [
      [readyRuntime, "ready", undefined],
      [unavailableRuntime, "unavailable", "browser_runtime_unavailable"],
    ] as const) {
      clearHarnessRegistry();
      registerManagedBrowserTools(runtime);
      for (const [toolId, capabilities] of expected) {
        const definition = listToolDefinitions().find((tool) => tool.id === toolId);
        expect(definition).toBeDefined();
        expect(definition?.capabilities).toMatchObject(capabilities);
        expect(resolveToolRuntimeReadiness(toolId)).toMatchObject({ state, ...(code ? { code } : {}) });
      }
    }
  });

  it("applies the exact Managed Browser Runtime gate to the click and fill facades", () => {
    const expected = [
      ["browser_click", { sideEffect: "network", requiresApproval: true }],
      ["browser_fill", { sideEffect: "network", requiresApproval: true }],
    ] as const;
    for (const [runtime, state, code] of [
      [readyRuntime, "ready", undefined],
      [unavailableRuntime, "unavailable", "browser_runtime_unavailable"],
    ] as const) {
      clearHarnessRegistry();
      registerManagedBrowserTools(runtime);
      for (const [toolId, capabilities] of expected) {
        const definition = listToolDefinitions().find((tool) => tool.id === toolId);
        expect(definition).toBeDefined();
        expect(definition?.capabilities).toMatchObject(capabilities);
        expect(resolveToolRuntimeReadiness(toolId)).toMatchObject({ state, ...(code ? { code } : {}) });
      }
    }
  });

  it("projects unavailable and blocks exposure for every browser tool when the runtime is not installed", () => {
    registerManagedBrowserTools(unavailableRuntime);

    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(resolveToolRuntimeReadiness(toolId)).toEqual({
        state: "unavailable",
        reason: unavailableReason,
        code: "browser_runtime_unavailable",
      });
    }

    const exposure = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "请打开网页读取页面标题",
    });
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(exposure.exposedToolIds).not.toContain(toolId);
      expect(exposure.blockedCapabilityReasons[toolId]).toBe(unavailableReason);
    }

    const view = projectAgentCapabilityView({
      scope: createMainAgentCapabilityScope({ scopeId: "main" }),
      definitions: listToolDefinitions(),
    });
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(view.capabilities.get(toolId)?.eligible).toBe(false);
      expect(view.capabilities.get(toolId)?.discoverable).toBe(false);
    }
  });

  it("fails closed without leaking runtime details when readiness probing throws", () => {
    const secretExecutable = "C:/users/tester/secret/chrome.exe";
    const throwingRuntime: BrowserRuntimeResolver = {
      resolveRuntime: () => {
        throw new Error(`runtime inspection failed for ${secretExecutable}`);
      },
    };
    registerManagedBrowserTools(throwingRuntime);

    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      const readiness = resolveToolRuntimeReadiness(toolId);
      expect(readiness).toEqual({
        state: "unavailable",
        reason: "Runtime readiness could not be verified.",
        code: "readiness_check_failed",
      });
      expect(JSON.stringify(readiness)).not.toContain(secretExecutable);
    }
  });

  it("re-resolves the current runtime state instead of caching a readiness snapshot", () => {
    let installed = false;
    registerManagedBrowserTools({
      resolveRuntime: () =>
        installed
          ? readyRuntime.resolveRuntime()
          : unavailableRuntime.resolveRuntime(),
    });

    expect(resolveToolRuntimeReadiness("browser_observe").state).toBe(
      "unavailable",
    );

    installed = true;
    expect(resolveToolRuntimeReadiness("browser_observe").state).toBe("ready");
  });

  it("maps the manager resolver directly for non-ready states", () => {
    expect(
      resolveManagedBrowserHarnessRuntimeReadiness(unavailableRuntime),
    ).toEqual({
      state: "unavailable",
      reason: unavailableReason,
      code: "browser_runtime_unavailable",
    });
  });
});
