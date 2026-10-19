import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserRuntimeResolver } from "@/microapps/computer-use/browser/types.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import { withWorkbenchMetadata } from "@/mcp/workbench-metadata.js";
import { resolveHarnessCapabilityProfiles } from "./capability-profiles.js";
import { resolveHarnessToolCandidatesForTurn } from "./candidates-core/index.js";
import { resolveHarnessToolExposure } from "./exposure.js";
import { createManagedBrowserRuntimeReadinessResolver } from "./managed-browser-readiness.js";
import { clearHarnessRegistry, listToolDefinitions, registerTool } from "./registry.js";

const MANAGED_BROWSER_TOOL_IDS = [
  "browser_observe",
  "browser_act",
  "browser_assert",
  "browser_navigate",
  "browser_wait_for",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_fill",
  "browser_press_key",
  "browser_select_option",
  "browser_scroll",
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

describe("Managed Browser Capability projection", () => {
  beforeEach(() => clearHarnessRegistry());
  afterEach(() => clearHarnessRegistry());

  it("projects the canonical browser identity, atomic ownership, and compatibility alias", async () => {
    registerManagedBrowserTools(readyRuntime);

    const profiles = resolveHarnessCapabilityProfiles(listToolDefinitions());
    const browserProfile = profiles.find((profile) => profile.id === "browser");

    expect(browserProfile).toBeDefined();
    expect(browserProfile?.title).toBe("Managed Browser");
    expect(browserProfile?.preferredToolId).toBe("browser_observe");
    // Ownership is the full native Managed Browser family.
    expect(browserProfile?.ownedToolIds).toEqual([...MANAGED_BROWSER_TOOL_IDS]);
    // Disclosure is deliberately still the legacy facade set.
    expect(browserProfile?.supportingToolIds).toEqual([
      "browser_observe",
      "browser_act",
      "browser_assert",
    ]);
    // The legacy identity is only an alias, never a second Profile.
    expect(browserProfile?.aliases).toEqual(["browser_computer_use"]);
    expect(profiles.some((profile) => profile.id === "browser_computer_use")).toBe(
      false,
    );

    const resolution = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "please use browser_computer_use",
    });
    expect(resolution.resolution?.selectedCapabilityId).toBe("browser");
  });

  it("keeps per-Tool readiness authoritative even when the browser Profile exists", () => {
    registerManagedBrowserTools(unavailableRuntime);

    // The product surface still groups the whole family...
    const profiles = resolveHarnessCapabilityProfiles(listToolDefinitions());
    expect(profiles.find((profile) => profile.id === "browser")?.ownedToolIds).toContain(
      "browser_navigate",
    );

    // ...but an unavailable Tool is never presented as callable.
    const exposure = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "打开网页读取页面标题并点击登录",
    });
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(exposure.exposedToolIds).not.toContain(toolId);
      expect(exposure.blockedCapabilityReasons[toolId]).toBe(unavailableReason);
    }
  });

  it("does not change approval flags or execution authority through workbench projection", () => {
    registerManagedBrowserTools(readyRuntime);

    const definitions = listToolDefinitions();
    const capabilitiesBefore = new Map(
      definitions.map((definition) => [definition.id, definition.capabilities]),
    );
    const projected = withWorkbenchMetadata(definitions);

    for (const definition of projected) {
      expect(definition.capabilities).toEqual(
        capabilitiesBefore.get(definition.id),
      );
    }

    const byId = new Map(projected.map((definition) => [definition.id, definition]));
    for (const toolId of [
      "browser_navigate",
      "browser_click",
      "browser_fill",
      "browser_press_key",
      "browser_select_option",
      "browser_scroll",
      "browser_wait_for",
    ]) {
      expect(byId.get(toolId)?.capabilities).toMatchObject({
        requiresApproval: true,
      });
    }
    for (const toolId of ["browser_snapshot", "browser_screenshot", "browser_assert"]) {
      expect(byId.get(toolId)?.capabilities).toMatchObject({
        requiresApproval: false,
      });
    }
  });
});
