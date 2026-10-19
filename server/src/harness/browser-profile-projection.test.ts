import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "../mcp/core/definitions.js";
import { createComputerUseBrowserTools } from "../mcp/tools/browser-tools.tool.js";
import { withWorkbenchMetadata } from "../mcp/workbench-metadata.js";
import {
  buildCapabilityResolutionDocuments,
  resolveCapabilityCascade,
} from "./candidates-core/capability-resolution.js";
import {
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
} from "./capability-view.js";
import { resolveHarnessCapabilityProfiles } from "./profiles/resolver.js";
import {
  clearToolRuntimeReadiness,
  registerToolRuntimeReadiness,
} from "./runtime-readiness.js";

const managedBrowserDefinitions = (): ToolDefinition[] =>
  createComputerUseBrowserTools({} as never).map((tool) => tool.definition);

const createDefinition = (
  id: string,
  domain: ToolDefinition["domain"],
  tags: string[],
): ToolDefinition => ({
  id,
  title: id,
  description: id,
  domain,
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags,
  capabilities: { sideEffect: "none", requiresApproval: false },
});

const webDefinitions = (): ToolDefinition[] => [
  createDefinition("web_search", "web_search", ["web", "search"]),
  createDefinition("web_fetch", "web_search", ["web", "fetch", "url"]),
];

const attachedDefinitions = (): ToolDefinition[] => [
  createDefinition("browser_attached_look", "browser_action", ["browser"]),
  createDefinition("browser_attached_browse", "browser_action", ["browser"]),
  createDefinition("browser_attached_act", "browser_action", ["browser"]),
  createDefinition("browser_attached_transfer", "browser_action", ["browser"]),
];

const allDefinitions = (): ToolDefinition[] => [
  ...managedBrowserDefinitions(),
  ...webDefinitions(),
  ...attachedDefinitions(),
];

describe("browser capability projection", () => {
  afterEach(() => {
    clearToolRuntimeReadiness();
  });

  it("owns every Managed Browser Tool under one canonical profile and workbench group", () => {
    const definitions = allDefinitions();
    const profiles = resolveHarnessCapabilityProfiles(definitions);
    const browser = profiles.find((profile) => profile.id === "browser");

    expect(profiles.some((profile) => profile.id === "browser_computer_use")).toBe(
      false,
    );
    expect(browser?.aliases).toBeUndefined();
    expect(new Set(browser?.supportingToolIds)).toEqual(
      new Set(managedBrowserDefinitions().map((definition) => definition.id)),
    );
    expect(browser?.supportingToolIds).not.toEqual(
      expect.arrayContaining(["web_search", "web_fetch"]),
    );
    expect(browser?.supportingToolIds).not.toEqual(
      expect.arrayContaining(["browser_attached_look"]),
    );

    const projected = withWorkbenchMetadata(definitions);
    for (const toolId of managedBrowserDefinitions().map(
      (definition) => definition.id,
    )) {
      expect(
        projected.find((definition) => definition.id === toolId)?.workbench
          ?.groupId,
      ).toBe("browser");
    }
    for (const toolId of attachedDefinitions().map(
      (definition) => definition.id,
    )) {
      expect(
        projected.find((definition) => definition.id === toolId)?.workbench
          ?.groupId,
      ).toBe("browser_attached");
    }
    expect(
      projected.find((definition) => definition.id === "web_search")?.workbench
        ?.groupId,
    ).toBe("web_search");
  });

  it("keeps the retired profile alias out of Agent capability-search metadata", async () => {
    const definitions = [
      ...allDefinitions(),
      // Unrelated profiles keep the deterministic lexical stage realistic.
      ...Array.from({ length: 12 }, (_, index) =>
        createDefinition(`read_tool_${index}`, "read", ["read", "file"]),
      ),
    ];
    const profiles = resolveHarnessCapabilityProfiles(definitions);
    const documents = buildCapabilityResolutionDocuments(profiles);

    const browserDocument = documents.find(
      (document) => document.capabilityId === "browser",
    );
    expect(browserDocument?.aliases).not.toContain("browser_computer_use");

    for (const query of [
      "browser",
      "打开网页读取页面标题",
      "打开网页点击登录",
    ]) {
      const resolution = await resolveCapabilityCascade({
        query,
        capabilities: documents,
      });
      expect(resolution.selectedCapabilityId).toBe("browser");
    }
  });

  it("keeps readiness per Tool even while the browser profile exists", () => {
    const definitions = managedBrowserDefinitions();
    for (const definition of definitions) {
      registerToolRuntimeReadiness(definition.id, () => ({
        state: "unavailable",
        reason: "Managed Browser runtime is unavailable.",
        code: "browser_runtime_unavailable",
      }));
    }

    const view = projectAgentCapabilityView({
      scope: createMainAgentCapabilityScope({
        scopeId: "main_agent",
        eligibleCapabilityIds: definitions.map((definition) => definition.id),
        discoverableCapabilityIds: definitions.map((definition) => definition.id),
      }),
      definitions,
    });

    expect(resolveHarnessCapabilityProfiles(definitions)[0]?.id).toBe("browser");
    for (const definition of definitions) {
      const entry = view.capabilities.get(definition.id);
      expect(entry?.readiness.state).toBe("unavailable");
      expect(entry?.eligible).toBe(false);
      expect(entry?.discoverable).toBe(false);
      expect(entry?.disclosure).toBe("hidden");
    }

    registerToolRuntimeReadiness("browser_navigate", () => ({
      state: "ready",
      reason: "Managed Browser runtime prerequisites are satisfied.",
    }));
    const partialView = projectAgentCapabilityView({
      scope: createMainAgentCapabilityScope({
        scopeId: "main_agent",
        eligibleCapabilityIds: definitions.map((definition) => definition.id),
        discoverableCapabilityIds: definitions.map((definition) => definition.id),
      }),
      definitions,
    });

    expect(partialView.capabilities.get("browser_navigate")?.discoverable).toBe(
      true,
    );
    expect(partialView.capabilities.get("browser_click")?.discoverable).toBe(
      false,
    );
  });

  it("does not change Tool approval flags when projecting ownership", () => {
    const definitions = allDefinitions();
    const before = new Map(
      definitions.map((definition) => [
        definition.id,
        { ...definition.capabilities },
      ]),
    );

    resolveHarnessCapabilityProfiles(definitions);
    const projected = withWorkbenchMetadata(definitions);

    for (const definition of projected) {
      expect(definition.capabilities).toEqual(before.get(definition.id));
    }
    for (const definition of projected) {
      if (definition.id === "browser_click" || definition.id === "browser_fill") {
        expect(definition.capabilities.requiresApproval).toBe(true);
      }
    }
  });
});
