import { afterEach, describe, expect, it } from "vitest";
import {
  clearHarnessRegistry,
  listToolDefinitions,
  registerTool,
} from "./registry.js";
import {
  DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
  createCapabilityDisclosureToolIdResolver,
  createCapabilityToolIdResolver,
  createProgressiveResolutionState,
  isProgressiveResolutionBudgetExhausted,
  readCapabilityDisclosure,
  recordProgressiveResolutionSearch,
  recordProgressiveResolutionSelection,
  reconcileProgressiveResolutionState,
  remainingProgressiveResolutionBudget,
  resolveAndDiscloseCapability,
  type ProgressiveResolutionState,
} from "./progressive-resolution-state.js";
import { resolveHarnessCapabilityProfiles } from "./profiles/resolver.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { writeTool } from "../mcp/tools/write.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";

const unavailableReadiness = () => ({
  state: "unavailable" as const,
  reason: "Runtime prerequisite is missing.",
  code: "test_runtime_unavailable",
});

const expand = (
  state: ProgressiveResolutionState,
  capabilityId: string,
  target: "metadata" | "schema",
) =>
  resolveAndDiscloseCapability(state, {
    capabilityId,
    target,
    detail: "test",
  });

describe("progressive resolution durable state", () => {
  afterEach(() => {
    clearHarnessRegistry();
  });

  it("defaults to a budget of 8 capability detail steps", () => {
    const state = createProgressiveResolutionState();
    expect(DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET).toBe(8);
    expect(state.budget).toEqual({ limit: 8, consumed: 0 });
    expect(state.disclosure).toEqual({});
    expect(state.trace).toEqual([]);
    expect(state.exhausted).toBe(false);
    expect(remainingProgressiveResolutionBudget(state)).toBe(8);
  });

  it("consumes the budget only when capability detail expands", () => {
    let state = createProgressiveResolutionState();

    const first = expand(state, "read", "metadata");
    state = first.state;
    expect(first.applied).toBe(true);
    expect(state.budget.consumed).toBe(1);
    expect(readCapabilityDisclosure(state, "read")).toBe("metadata");

    const promoted = expand(state, "read", "schema");
    state = promoted.state;
    expect(promoted.applied).toBe(true);
    expect(state.budget.consumed).toBe(2);
    expect(readCapabilityDisclosure(state, "read")).toBe("schema");

    // Re-recording an already-disclosed level is idempotent and free, which is
    // what keeps ordinary continuation and approval/resume from re-charging.
    const idempotent = expand(state, "read", "schema");
    state = idempotent.state;
    expect(idempotent.applied).toBe(true);
    expect(state.budget.consumed).toBe(2);
  });

  it("distinguishes searched, resolved, disclosed_metadata, disclosed_schema and selected trace stages", () => {
    let state = createProgressiveResolutionState();
    state = recordProgressiveResolutionSearch(state, {
      path: "lexical",
      modelCalls: 0,
    });
    state = recordProgressiveResolutionSelection(state, {
      capabilityId: "read",
    });
    state = expand(state, "read", "metadata").state;
    state = expand(state, "read", "schema").state;

    expect(state.trace.map((event) => event.stage)).toEqual([
      "searched",
      "selected",
      "resolved",
      "disclosed_metadata",
      "resolved",
      "disclosed_schema",
    ]);
  });

  it("exhausts bounded and transparently while keeping already-disclosed detail", () => {
    let state = createProgressiveResolutionState(1);

    state = expand(state, "read", "metadata").state;
    expect(state.budget.consumed).toBe(1);
    expect(isProgressiveResolutionBudgetExhausted(state)).toBe(true);

    const refused = expand(state, "write", "schema");
    state = refused.state;
    expect(refused.applied).toBe(false);
    // The exhausted capability is not silently fabricated and authority is not
    // granted: it stays hidden and the unresolved capability gap is surfaced.
    expect(readCapabilityDisclosure(state, "write")).toBe("hidden");
    expect(state.exhausted).toBe(true);
    expect(state.unresolvedCapabilityGap).toContain("write");
    // Already-disclosed detail remains usable.
    expect(readCapabilityDisclosure(state, "read")).toBe("metadata");
  });

  it("reconciles persisted visibility against the current registry and drops unregistered capabilities", () => {
    registerTool(readTool);

    let state = createProgressiveResolutionState();
    state = expand(state, "read", "schema").state;
    state = expand(state, "write", "metadata").state;

    const reconciled = reconcileProgressiveResolutionState({
      state,
      definitions: listToolDefinitions(),
    });

    expect(readCapabilityDisclosure(reconciled, "read")).toBe("schema");
    expect(readCapabilityDisclosure(reconciled, "write")).toBe("hidden");
    // Reconciliation is not a fresh resolution pass: budget usage is preserved.
    expect(reconciled.budget.consumed).toBe(state.budget.consumed);
  });

  it("lets authority revocation override stale persisted visibility", () => {
    registerTool(readTool);
    registerTool(writeTool);

    let state = createProgressiveResolutionState();
    state = expand(state, "read", "schema").state;
    state = expand(state, "write", "schema").state;

    const reconciled = reconcileProgressiveResolutionState({
      state,
      definitions: listToolDefinitions(),
      eligibleCapabilityIds: ["read"],
    });

    expect(readCapabilityDisclosure(reconciled, "read")).toBe("schema");
    expect(readCapabilityDisclosure(reconciled, "write")).toBe("hidden");
  });

  it("lets readiness loss override stale persisted visibility", () => {
    registerTool(readTool);
    registerTool(webSearchTool, { resolveReadiness: unavailableReadiness });

    let state = createProgressiveResolutionState();
    state = expand(state, "read", "schema").state;
    state = expand(state, "web_search", "schema").state;
    expect(readCapabilityDisclosure(state, "web_search")).toBe("schema");

    const reconciled = reconcileProgressiveResolutionState({
      state,
      definitions: listToolDefinitions(),
    });

    expect(readCapabilityDisclosure(reconciled, "read")).toBe("schema");
    expect(readCapabilityDisclosure(reconciled, "web_search")).toBe("hidden");
  });

  it("resolves declared profile aliases without creating a second capability", () => {
    const browserDefinition = (id: string) => ({
      id,
      title: id,
      description: id,
      domain: "browser_action" as const,
      source: "internal" as const,
      mode: "sync" as const,
      inputSchema: {},
      tags: ["browser"],
      capabilities: { sideEffect: "none" as const, requiresApproval: false },
    });
    const profiles = resolveHarnessCapabilityProfiles([
      browserDefinition("browser_navigate"),
      browserDefinition("browser_click"),
    ]);

    const resolveOwnership = createCapabilityToolIdResolver(profiles);
    const resolveDisclosure = createCapabilityDisclosureToolIdResolver(profiles);

    expect(profiles.filter((profile) => profile.id === "browser")).toHaveLength(1);
    expect(resolveOwnership("browser")).toEqual([
      "browser_navigate",
      "browser_click",
    ]);
    // A legacy grouped snapshot keyed by the old profile identity reconciles to
    // the same canonical Tools instead of being dropped.
    expect(resolveOwnership("browser_computer_use")).toEqual([
      "browser_navigate",
      "browser_click",
    ]);
    // Ownership is complete, but grouped selection must not broaden initial
    // schema disclosure.
    expect(resolveDisclosure("browser")).toEqual([]);
    expect(resolveDisclosure("browser_computer_use")).toEqual([]);
    expect(resolveOwnership("unregistered_tool")).toEqual(["unregistered_tool"]);
  });

  it("keeps an alias-keyed legacy browser snapshot across reconciliation", () => {
    const browserDefinition = (id: string) => ({
      id,
      title: id,
      description: id,
      domain: "browser_action" as const,
      source: "internal" as const,
      mode: "sync" as const,
      inputSchema: {},
      tags: ["browser"],
      capabilities: { sideEffect: "none" as const, requiresApproval: false },
    });
    const definitions = [
      browserDefinition("browser_navigate"),
      browserDefinition("browser_click"),
    ];
    const profiles = resolveHarnessCapabilityProfiles(definitions);
    const resolveOwnership = createCapabilityToolIdResolver(profiles);

    const profileKeyed = resolveAndDiscloseCapability(
      createProgressiveResolutionState(),
      { capabilityId: "browser_computer_use", target: "schema" },
    ).state;
    const reconciled = reconcileProgressiveResolutionState({
      state: profileKeyed,
      definitions,
      eligibleCapabilityIds: definitions.map((definition) => definition.id),
      resolveToolIds: resolveOwnership,
    });

    expect(readCapabilityDisclosure(reconciled, "browser_computer_use")).toBe(
      "schema",
    );
  });
});
