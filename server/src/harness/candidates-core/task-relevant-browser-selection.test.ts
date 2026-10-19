import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserRuntimeResolver } from "@/microapps/computer-use/browser/types.js";
import type {
  ToolDefinition,
  ToolImplementation,
} from "@/mcp/core/definitions.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import {
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
} from "../capability-view.js";
import {
  describeCapabilityDisclosure,
  materializeCapabilitySchema,
  promoteCapabilitySchema,
} from "../capability-disclosure.js";
import { resolveHarnessCapabilityProfiles } from "../profiles/index.js";
import {
  clearHarnessRegistry,
  listToolDefinitions,
  registerTool,
} from "../registry.js";
import { createManagedBrowserRuntimeReadinessResolver } from "../managed-browser-readiness.js";
import { resolveHarnessToolCandidatesForTurn } from "./resolver.js";
import { resolveTaskRelevantToolSelection } from "./task-relevant-selection.js";

const MANAGED_BROWSER_TOOL_IDS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_screenshot",
  "browser_wait_for",
  "browser_click",
  "browser_fill",
  "browser_press_key",
  "browser_select_option",
  "browser_scroll",
  "browser_observe",
  "browser_act",
  "browser_assert",
] as const;

const browser = {
  observe: () => undefined,
  act: () => undefined,
  assert: () => undefined,
  navigate: () => undefined,
  wait: () => undefined,
};

const managedBrowserDefinitions = () =>
  createComputerUseBrowserTools(browser as never).map(
    (tool) => tool.definition,
  );

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

const projectMainView = () =>
  projectAgentCapabilityView({
    scope: createMainAgentCapabilityScope({ scopeId: "main_agent" }),
    definitions: listToolDefinitions(),
  });

const createStubTool = (input: {
  id: string;
  domain: NonNullable<ToolDefinition["domain"]>;
  tags: string[];
  sideEffect: NonNullable<ToolDefinition["capabilities"]["sideEffect"]>;
  requiresApproval: boolean;
  networkAccess?: boolean;
}): ToolImplementation => ({
  definition: {
    id: input.id,
    title: input.id,
    description: `${input.id} managed browser test tool`,
    domain: input.domain,
    source: "internal",
    mode: "sync",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    tags: input.tags,
    capabilities: {
      sideEffect: input.sideEffect,
      requiresApproval: input.requiresApproval,
      ...(input.networkAccess === undefined
        ? {}
        : { networkAccess: input.networkAccess }),
    },
  },
  execute: async () => ({ result: { ok: true } }),
});

describe("task-relevant Managed Browser concrete Tool selection", () => {
  beforeEach(() => clearHarnessRegistry());
  afterEach(() => {
    vi.restoreAllMocks();
    clearHarnessRegistry();
  });

  it("selects the concrete atomic Tool deterministically without a model roundtrip", async () => {
    const definitions = managedBrowserDefinitions();
    const profile = resolveHarnessCapabilityProfiles(definitions).find(
      (candidate) => candidate.id === "browser",
    );
    expect(profile).toBeDefined();
    expect(profile?.supportingToolIds).toEqual(
      expect.arrayContaining([...MANAGED_BROWSER_TOOL_IDS]),
    );

    await expect(
      resolveTaskRelevantToolSelection({
        query: "打开网页读取页面标题",
        profile: profile!,
        definitions,
      }),
    ).resolves.toEqual(["browser_navigate"]);

    // The selection follows ordinary user language, so it is not a constant
    // default: a click request must reach browser_click, not browser_navigate.
    await expect(
      resolveTaskRelevantToolSelection({
        query: "点击结算按钮",
        profile: profile!,
        definitions,
      }),
    ).resolves.toEqual(["browser_click"]);

    await expect(
      resolveTaskRelevantToolSelection({
        query: "把搜索框填写成 Apple",
        profile: profile!,
        definitions,
      }),
    ).resolves.toEqual(["browser_fill"]);
  });

  it("resolves first-level `browser` then materializes only the selected atomic schema", async () => {
    registerManagedBrowserTools(readyRuntime);
    const definitions = listToolDefinitions();
    const semanticResolver = vi.fn(async () => "browser");

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "打开网页读取页面标题",
      semanticResolver,
    });

    expect(result.resolution?.selectedCapabilityId).toBe("browser");
    expect(result.resolution?.selectedToolIds).toEqual(["browser_navigate"]);
    // The deterministic nested seam must not add a second model roundtrip: the
    // existing capability cascade may spend at most its one bounded call.
    expect(result.resolution?.trace.modelCalls).toBeLessThanOrEqual(1);
    expect(semanticResolver.mock.calls.length).toBeLessThanOrEqual(1);

    let view = projectMainView();
    for (const toolId of result.resolution?.selectedToolIds ?? []) {
      view = promoteCapabilitySchema({ view, capabilityId: toolId, definitions })
        .view;
    }

    expect(
      materializeCapabilitySchema(view, "browser_navigate", definitions)
        ?.inputSchema,
    ).toBeDefined();
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      if (toolId === "browser_navigate") continue;
      expect(materializeCapabilitySchema(view, toolId, definitions)).toBeUndefined();
    }
    const trace = describeCapabilityDisclosure(view);
    // Every Managed Browser Tool is discoverable as compact metadata, but only
    // the task-relevant concrete Tool reached the full schema stage.
    expect(trace.metadataDisclosedCount).toBe(MANAGED_BROWSER_TOOL_IDS.length);
    expect(trace.schemaDisclosedCount).toBe(1);
  });

  it("keeps unavailable Managed Browser tools unavailable despite `browser` discovery", async () => {
    registerManagedBrowserTools(unavailableRuntime);
    const definitions = listToolDefinitions();
    const semanticResolver = vi.fn(async () => "browser");

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "打开网页读取页面标题",
      semanticResolver,
    });

    expect(result.eligibleToolIds).toEqual([]);
    expect(result.toolExposure.exposedToolIds).toEqual([]);
    expect(result.resolution?.selectedToolIds).toBeUndefined();

    const view = projectMainView();
    for (const toolId of MANAGED_BROWSER_TOOL_IDS) {
      const entry = view.capabilities.get(toolId);
      expect(entry?.eligible).toBe(false);
      expect(entry?.discoverable).toBe(false);
      expect(entry?.disclosure).toBe("hidden");
      expect(
        promoteCapabilitySchema({ view, capabilityId: toolId, definitions })
          .transition.reason,
      ).toBe("blocked-unavailable");
    }
  });

  it("does not let schema disclosure grant execution authority for a high-risk atomic Tool", async () => {
    registerManagedBrowserTools(readyRuntime);
    const definitions = listToolDefinitions();
    const semanticResolver = vi.fn(async () => "browser");

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      // A browser task with a concrete click intent: the capability resolves to
      // `browser`, and the nested deterministic selection must reach
      // browser_click, not the default browser_navigate.
      query: "点击网页上的结算按钮",
      semanticResolver,
    });

    expect(result.resolution?.selectedCapabilityId).toBe("browser");
    expect(result.resolution?.selectedToolIds).toEqual(["browser_click"]);

    const click = definitions.find(
      (definition) => definition.id === "browser_click",
    );
    expect(click?.capabilities).toMatchObject({
      sideEffect: "network",
      requiresApproval: true,
    });

    const view = projectMainView();
    const promoted = promoteCapabilitySchema({
      view,
      capabilityId: "browser_click",
      definitions,
    });
    expect(promoted.transition.schemaMaterialized).toBe(true);
    // Disclosure materializes a schema; it never mutates Policy / Approval.
    expect(
      definitions.find((definition) => definition.id === "browser_click")
        ?.capabilities.requiresApproval,
    ).toBe(true);
  });

  it("keeps the legacy browser_computer_use id resolvable to the `browser` capability", async () => {
    registerManagedBrowserTools(readyRuntime);

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "browser_computer_use",
      knownCapabilityId: "browser_computer_use",
    });

    expect(result.resolution?.path).toBe("exact");
    expect(result.resolution?.selectedCapabilityId).toBe("browser");
    expect(result.eligibleToolIds).toEqual(
      expect.arrayContaining([...MANAGED_BROWSER_TOOL_IDS]),
    );
  });

  it("keeps browser, browser_attached and web_search/web_fetch independent", async () => {
    registerManagedBrowserTools(readyRuntime);
    for (const [id, tags] of [
      ["browser_attached_look", ["browser", "attached-browser", "current-browser", "已登录"]],
      ["browser_attached_browse", ["browser", "attached-browser", "current-browser", "已登录"]],
      ["browser_attached_act", ["browser", "attached-browser", "current-browser", "已登录"]],
      ["browser_attached_transfer", ["browser", "attached-browser", "current-browser", "已登录"]],
    ] as const) {
      registerTool(
        createStubTool({
          id,
          domain: "browser_action",
          tags: [...tags],
          sideEffect: id === "browser_attached_look" ? "none" : "network",
          requiresApproval: id !== "browser_attached_look",
          networkAccess: true,
        }),
      );
    }
    for (const id of ["web_search", "web_fetch"]) {
      registerTool(
        createStubTool({
          id,
          domain: "web_search",
          tags: ["web", "search"],
          sideEffect: "network",
          requiresApproval: false,
          networkAccess: true,
        }),
      );
    }

    const semanticResolver = vi.fn(async ({ query }: { query: string }) =>
      query.includes("已登录")
        ? "browser_attached"
        : query.includes("search")
          ? "web"
          : "browser",
    );

    const managed = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "打开网页读取页面标题",
      semanticResolver,
    });
    expect(managed.resolution?.selectedCapabilityId).toBe("browser");
    expect(managed.resolution?.selectedToolIds).toEqual(["browser_navigate"]);
    expect(managed.resolution?.selectedToolIds).not.toEqual(
      expect.arrayContaining(["browser_attached_look"]),
    );

    const attached = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "读取我当前已登录后台的数据",
      semanticResolver,
    });
    expect(attached.resolution?.selectedCapabilityId).toBe("browser_attached");
    expect(attached.resolution?.selectedToolIds).toBeUndefined();

    const web = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "search the web for the latest news",
      semanticResolver,
    });
    expect(web.resolution?.selectedCapabilityId).toBe("web");
    expect(web.resolution?.selectedToolIds).toBeUndefined();
  });
});
