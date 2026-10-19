import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "../mcp/core/definitions.js";
import { createComputerUseBrowserTools } from "../mcp/tools/browser-tools.tool.js";
import {
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
} from "./capability-view.js";
import {
  materializeCapabilitySchema,
  materializeKnownCapabilitySchema,
  projectCapabilityToolMetadata,
  promoteCapabilitySchema,
} from "./capability-disclosure.js";
import { resolveHarnessToolExposure } from "./exposure.js";
import {
  resolveCapabilitySchemaToolIds,
  resolveHarnessCapabilityProfiles,
} from "./capability-profiles.js";
import {
  buildCapabilityResolutionDocuments,
  resolveCapabilityCascade,
} from "./candidates-core/capability-resolution.js";
import { createCapabilityToolIdResolver } from "./progressive-resolution-state.js";
import {
  createManagedBrowserRuntimeReadinessResolver,
} from "./managed-browser-readiness.js";
import {
  clearHarnessRegistry,
  listToolDefinitions,
  registerTool,
} from "./registry.js";
import type { BrowserRuntimeResolver } from "@/microapps/computer-use/browser/types.js";

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

const unavailableRuntime: BrowserRuntimeResolver = {
  resolveRuntime: () => ({
    status: "not_installed",
    strategy: "download",
    inspectedCandidates: [],
    reason: "No managed Chromium was found.",
  }),
};

const MANAGED_BROWSER_TOOL_IDS = [
  "browser_navigate",
  "browser_wait_for",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_fill",
  "browser_press_key",
  "browser_select_option",
  "browser_scroll",
  "browser_observe",
  "browser_act",
  "browser_assert",
] as const;

const createDefinition = (
  id: string,
  tags: string[],
  requiresApproval = false,
): ToolDefinition => ({
  id,
  title: id,
  description: id,
  domain: "browser_action",
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags,
  capabilities: { sideEffect: "none", requiresApproval },
});

const createWebDefinition = (id: string): ToolDefinition => ({
  id,
  title: id,
  description: id,
  domain: "web_search",
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags: ["web", "search"],
  capabilities: { sideEffect: "network", requiresApproval: false },
});

const registerManagedBrowserTools = (runtime: BrowserRuntimeResolver) => {
  const resolveReadiness = createManagedBrowserRuntimeReadinessResolver(runtime);
  for (const tool of createComputerUseBrowserTools(browser as never)) {
    registerTool(tool, { resolveReadiness });
  }
};

describe("Managed Browser `browser` capability disclosure seam", () => {
  beforeEach(() => clearHarnessRegistry());
  afterEach(() => clearHarnessRegistry());

  it("owns every Managed Browser Tool under one first-level capability", () => {
    const profiles = resolveHarnessCapabilityProfiles(
      createComputerUseBrowserTools(browser as never).map(
        (tool) => tool.definition,
      ),
    );

    const managed = profiles.find((profile) => profile.id === "browser");
    expect(managed?.supportingToolIds).toEqual([...MANAGED_BROWSER_TOOL_IDS]);
    expect(managed?.schemaSelection).toBe("concrete");
    expect(managed?.aliases).toContain("browser_computer_use");
  });

  it("resolves only the selected concrete Tool schema, not the whole catalog", async () => {
    const definitions = createComputerUseBrowserTools(browser as never).map(
      (tool) => tool.definition,
    );
    const profiles = resolveHarnessCapabilityProfiles(definitions);

    const screenshot = await resolveCapabilitySchemaToolIds({
      capabilityId: "browser",
      query: "capture a screenshot of the page",
      profiles,
      definitions,
    });
    expect(screenshot).toEqual(["browser_screenshot"]);

    const click = await resolveCapabilitySchemaToolIds({
      capabilityId: "browser",
      query: "click the login button",
      profiles,
      definitions,
    });
    expect(click).toEqual(["browser_click"]);
  });

  it("discloses nothing new when deterministic evidence is ambiguous", async () => {
    const definitions = createComputerUseBrowserTools(browser as never).map(
      (tool) => tool.definition,
    );
    const profiles = resolveHarnessCapabilityProfiles(definitions);

    const resolved = await resolveCapabilitySchemaToolIds({
      capabilityId: "browser",
      query: "tell me a joke",
      profiles,
      definitions,
    });
    expect(resolved).toEqual([]);
  });

  it("reuses the existing cascade for an exact known concrete Tool id", async () => {
    const definitions = createComputerUseBrowserTools(browser as never).map(
      (tool) => tool.definition,
    );
    const profiles = resolveHarnessCapabilityProfiles(definitions);

    const resolved = await resolveCapabilitySchemaToolIds({
      capabilityId: "browser",
      query: "browser_fill",
      profiles,
      definitions,
    });
    expect(resolved).toEqual(["browser_fill"]);
  });

  it("keeps grouped Profiles on the existing expand-all behavior", async () => {
    const definitions = [
      ...createComputerUseBrowserTools(browser as never).map(
        (tool) => tool.definition,
      ),
      createWebDefinition("web_search"),
      createWebDefinition("web_fetch"),
    ];
    const profiles = resolveHarnessCapabilityProfiles(definitions);

    const resolved = await resolveCapabilitySchemaToolIds({
      capabilityId: "web",
      query: "search for recent documentation",
      profiles,
      definitions,
    });
    expect(resolved).toEqual(["web_search", "web_fetch"]);
  });

  it("reconciles the `browser_computer_use` compatibility alias to the same Tools", async () => {
    const definitions = createComputerUseBrowserTools(browser as never).map(
      (tool) => tool.definition,
    );
    const profiles = resolveHarnessCapabilityProfiles(definitions);

    const resolveToolIds = createCapabilityToolIdResolver(profiles);
    expect(resolveToolIds("browser_computer_use")).toEqual([
      ...MANAGED_BROWSER_TOOL_IDS,
    ]);

    const resolution = await resolveCapabilityCascade({
      query: "browser_computer_use",
      capabilities: buildCapabilityResolutionDocuments(profiles),
    });
    expect(resolution.selectedCapabilityId).toBe("browser");
  });

  it("keeps unavailable Managed Browser Tools unavailable despite profile discovery", () => {
    registerManagedBrowserTools(unavailableRuntime);

    const definitions = listToolDefinitions();
    const profiles = resolveHarnessCapabilityProfiles(definitions);
    expect(profiles.find((profile) => profile.id === "browser")).toBeDefined();

    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(
        materializeKnownCapabilitySchema({ capabilityId: toolId, definitions }),
      ).toBeUndefined();
    }

    const view = projectAgentCapabilityView({
      scope: createMainAgentCapabilityScope({ scopeId: "main" }),
      definitions,
    });
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(view.capabilities.get(toolId)?.eligible).toBe(false);
      expect(view.capabilities.get(toolId)?.discoverable).toBe(false);
    }

    const exposure = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "capture a screenshot of the page",
    });
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      expect(exposure.exposedToolIds).not.toContain(toolId);
    }
  });

  it("keeps the whole catalog discoverable as compact metadata with schema on the selected Tool only", () => {
    registerManagedBrowserTools(readyRuntime);

    const definitions = listToolDefinitions();
    const view = projectAgentCapabilityView({
      scope: createMainAgentCapabilityScope({ scopeId: "main" }),
      definitions,
    });

    const metadata = projectCapabilityToolMetadata(view, definitions);
    expect(metadata.map((entry) => entry.capabilityId).sort()).toEqual(
      [...MANAGED_BROWSER_TOOL_IDS].sort(),
    );
    expect(metadata.every((entry) => !("inputSchema" in entry))).toBe(true);

    // Metadata discovery does not leak a full schema; only explicit promotion
    // materializes the selected Tool schema.
    expect(materializeCapabilitySchema(view, "browser_screenshot", definitions)).toBeUndefined();
    const promoted = promoteCapabilitySchema({
      view,
      capabilityId: "browser_screenshot",
      definitions,
    });
    expect(promoted.transition.reason).toBe("promoted");
    expect(
      materializeCapabilitySchema(
        promoted.view,
        "browser_screenshot",
        definitions,
      )?.inputSchema,
    ).toBeDefined();
    expect(
      materializeCapabilitySchema(promoted.view, "browser_navigate", definitions),
    ).toBeUndefined();
  });

  it("does not change Tool execution authority through discovery or disclosure", () => {
    const definitions = createComputerUseBrowserTools(browser as never).map(
      (tool) => tool.definition,
    );
    const requiresApproval = new Map(
      definitions.map((definition) => [
        definition.id,
        definition.capabilities.requiresApproval,
      ]),
    );

    expect(requiresApproval.get("browser_snapshot")).toBe(false);
    expect(requiresApproval.get("browser_screenshot")).toBe(false);
    expect(requiresApproval.get("browser_assert")).toBe(false);
    for (const toolId of [
      "browser_navigate",
      "browser_wait_for",
      "browser_click",
      "browser_fill",
      "browser_press_key",
      "browser_select_option",
      "browser_scroll",
    ]) {
      expect(requiresApproval.get(toolId)).toBe(true);
    }
  });

  it("keeps web and browser_attached capabilities independent of the Browser catalog", () => {
    const definitions = [
      ...createComputerUseBrowserTools(browser as never).map(
        (tool) => tool.definition,
      ),
      createWebDefinition("web_search"),
      createWebDefinition("web_fetch"),
      createDefinition("browser_attached_look", ["attached-browser"]),
      createDefinition("browser_attached_browse", ["attached-browser"]),
      createDefinition("browser_attached_act", ["attached-browser"], true),
      createDefinition("browser_attached_transfer", ["attached-browser"], true),
    ];
    const profiles = resolveHarnessCapabilityProfiles(definitions);

    const managed = profiles.find((profile) => profile.id === "browser");
    const web = profiles.find((profile) => profile.id === "web");
    const attached = profiles.find((profile) => profile.id === "browser_attached");

    expect(web?.supportingToolIds).toEqual(["web_search", "web_fetch"]);
    expect(attached?.supportingToolIds).toEqual([
      "browser_attached_look",
      "browser_attached_browse",
      "browser_attached_act",
      "browser_attached_transfer",
    ]);
    expect(
      managed?.supportingToolIds.some((toolId) =>
        toolId.startsWith("browser_attached_"),
      ),
    ).toBe(false);
    expect(managed?.supportingToolIds).not.toContain("web_search");
    expect(managed?.supportingToolIds).not.toContain("web_fetch");
  });
});
