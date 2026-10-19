import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimInvocationApproval,
  clearInvocations,
  executeInvocation,
} from "@/mcp/core/invocations.js";
import type { ToolImplementation } from "@/mcp/core/definitions.js";
import {
  browserAttachedActTool,
  browserAttachedBrowseTool,
  browserAttachedLookTool,
  browserAttachedTransferTool,
} from "@/mcp/tools/browser-attached.tool.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import { webFetchTool } from "@/mcp/tools/web-fetch.tool.js";
import { webSearchTool } from "@/mcp/tools/web-search.tool.js";
import {
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
} from "./capability-view.js";
import { promoteCapabilitySchema } from "./capability-disclosure.js";
import { resolveCapabilitySchemaToolIds } from "./capability-tool-selection.js";
import { resolveHarnessToolCandidatesForTurn } from "./candidates-core/resolver.js";
import { resolveHarnessCapabilityProfiles } from "./profiles/index.js";
import { createCapabilityToolIdResolver } from "./progressive-resolution-state.js";
import { clearHarnessRegistry, registerTool } from "./registry.js";
import {
  registerToolRuntimeReadiness,
  unregisterToolRuntimeReadiness,
} from "./runtime-readiness.js";

const browser = { observe: vi.fn(), act: vi.fn(), assert: vi.fn() };

const browserDefinitions = () =>
  createComputerUseBrowserTools(browser as never).map(
    (tool) => tool.definition,
  );

const fillerTool = (id: string): ToolImplementation => ({
  definition: {
    id,
    title: id,
    description: `${id} unrelated local tool`,
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: { type: "object" },
    tags: ["read"],
    capabilities: { sideEffect: "none", requiresApproval: false },
  },
  execute: async () => ({ result: { ok: true } }),
});

const MANAGED_BROWSER_TOOL_IDS = [
  "browser_observe",
  "browser_navigate",
  "browser_wait_for",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_fill",
  "browser_press_key",
  "browser_select_option",
  "browser_scroll",
  "browser_act",
  "browser_assert",
];

describe("browser first-level capability seam", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearHarnessRegistry();
    clearInvocations();
  });

  it("owns the Managed Browser atomic Tools under one first-level browser capability", () => {
    const profiles = resolveHarnessCapabilityProfiles(browserDefinitions());
    const browserProfile = profiles.find((profile) => profile.id === "browser");

    expect(profiles.some((profile) => profile.id === "browser_computer_use")).toBe(
      false,
    );
    expect(browserProfile).toBeDefined();
    expect(browserProfile?.schemaDisclosure).toBe("task_relevant");
    expect(browserProfile?.preferredToolId).toBe("browser_observe");
    expect(browserProfile?.supportingToolIds).toEqual(
      expect.arrayContaining(MANAGED_BROWSER_TOOL_IDS),
    );
  });

  it("resolves an interactive website request to the first-level browser capability", async () => {
    for (const tool of createComputerUseBrowserTools(browser as never)) {
      registerTool(tool);
    }
    // Keep the catalog at the small-catalog path while giving the deterministic
    // lexical stage enough document frequency to be confident.
    for (let index = 0; index < 8; index += 1) {
      registerTool(fillerTool(`unrelated_${index}`));
    }

    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "打开网页读取页面标题",
      // Deterministic-only in tests: a genuinely ambiguous request must not
      // reach a real provider route.
      semanticResolver: async () => undefined,
    });

    expect(result.resolution?.selectedCapabilityId).toBe("browser");
  });

  it("maps a pre-cutover browser_computer_use snapshot key to the canonical browser tools", () => {
    const definitions = browserDefinitions();
    const profiles = resolveHarnessCapabilityProfiles(definitions);
    const resolveToolIds = createCapabilityToolIdResolver(profiles);

    // A resumed pre-#365 snapshot may still key disclosure by the legacy profile
    // id. Reconcile must resolve it through the same single Tool family instead
    // of silently dropping the in-flight capability.
    expect([...resolveToolIds("browser_computer_use")]).toEqual(
      expect.arrayContaining(MANAGED_BROWSER_TOOL_IDS),
    );
    expect([...resolveToolIds("browser")]).toEqual([
      ...resolveToolIds("browser_computer_use"),
    ]);
  });

  it("narrows task_relevant schema selection and preserves group behavior for non-opt-in capabilities", async () => {
    const definitions = [
      ...browserDefinitions(),
      webSearchTool.definition,
      webFetchTool.definition,
      browserAttachedLookTool.definition,
      browserAttachedBrowseTool.definition,
      browserAttachedActTool.definition,
      browserAttachedTransferTool.definition,
    ];
    const profiles = resolveHarnessCapabilityProfiles(definitions);

    // Only the concrete Tool named/nominated for this turn is selected from the
    // grouped first-level browser capability.
    await expect(
      resolveCapabilitySchemaToolIds({
        capabilityId: "browser",
        query: "browser_navigate",
        profiles,
        definitions,
      }),
    ).resolves.toEqual(["browser_navigate"]);

    // A grouped capability that did not opt in keeps its historical expansion.
    await expect(
      resolveCapabilitySchemaToolIds({
        capabilityId: "web",
        query: "search public web",
        profiles,
        definitions,
      }),
    ).resolves.toEqual(["web_search", "web_fetch"]);

    // Attached Browser stays a separate Managed family and is never folded into
    // the Managed Playwright capability.
    await expect(
      resolveCapabilitySchemaToolIds({
        capabilityId: "browser_attached",
        query: "browser attached look",
        profiles,
        definitions,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        "browser_attached_look",
        "browser_attached_browse",
        "browser_attached_act",
        "browser_attached_transfer",
      ]),
    );
    const browserProfile = profiles.find((profile) => profile.id === "browser");
    expect(browserProfile?.supportingToolIds).not.toEqual(
      expect.arrayContaining(["browser_attached_look"]),
    );
  });

  it("does not materialize a schema for a runtime-unavailable browser Tool", () => {
    const definitions = browserDefinitions();
    registerToolRuntimeReadiness("browser_click", () => ({
      state: "unavailable",
      reason: "managed browser runtime missing",
      code: "browser_runtime_unavailable",
    }));
    try {
      const view = projectAgentCapabilityView({
        scope: createMainAgentCapabilityScope({ scopeId: "main" }),
        definitions,
      });

      expect(view.capabilities.get("browser_click")?.eligible).toBe(false);
      expect(view.capabilities.get("browser_click")?.discoverable).toBe(false);

      const promoted = promoteCapabilitySchema({
        view,
        capabilityId: "browser_click",
        definitions,
      });
      expect(promoted.transition.schemaMaterialized).toBe(false);
      expect(promoted.transition.reason).toBe("blocked-unavailable");
      expect(promoted.schema).toBeUndefined();
    } finally {
      unregisterToolRuntimeReadiness("browser_click");
    }
  });

  it("keeps browser execution authority in approval and never grants it through schema disclosure", async () => {
    const browserClick = createComputerUseBrowserTools(browser as never).find(
      (tool) => tool.definition.id === "browser_click",
    )!;
    registerTool(browserClick);

    const args = {
      pageUrl: "https://example.com",
      snapshotHash: "hash-1",
      ref: "e1",
    };
    const pending = await executeInvocation({ toolId: "browser_click", args });
    expect(pending.status).toBe("awaiting_approval");

    // Selection/schema disclosure is read-only projection; the exact invocation
    // still requires the normal approval claim before it can resume.
    const claimed = claimInvocationApproval({
      invocationId: pending.id,
      reason: "approved after disclosure",
    });
    expect(claimed.status).toBe("running");
    expect(claimed.approval?.resolution?.decision).toBe("approved");
  });
});
