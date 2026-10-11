import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as harnessRegistry from "@/harness/registry";
import { clearHarnessRegistry } from "@/harness/registry";
import { resolveHarnessCapabilityProfiles } from "@/harness/profiles";
import {
  createCapabilityToolIdResolver,
  DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
  readCapabilityDisclosure,
  reconcileProgressiveResolutionState,
} from "@/harness/progressive-resolution-state";
import type { CapabilityResolutionResult } from "@/harness/candidates-core/capability-resolution";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";
import { prepareContextNode } from "./prepare-context.js";
import type { AgentNodeState } from "../node-runtime.js";

const makeToolDefinition = (toolId: string) => ({
  id: toolId,
  title: toolId,
  description: toolId,
  inputSchema: { type: "object", properties: {} },
  domain: "read" as const,
  source: "internal" as const,
  mode: "sync" as const,
  tags: ["read"],
  capabilities: { sideEffect: "none" as const, requiresApproval: false },
});

const createState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-1",
  threadId: "thread-1",
  userId: 1,
  goal: {
    id: "goal-1",
    text: "inspect the workspace files",
    successCriteria: ["inspect the workspace files"],
    constraints: [],
    riskLevel: "low",
  },
  messages: [
    {
      role: "user",
      content: "inspect the workspace files",
      parts: [{ type: "text", text: "inspect the workspace files" }],
    },
  ],
  ...overrides,
});

const mockToolSurface = (
  toolCount: number,
): Array<ReturnType<typeof makeToolDefinition>> => {
  const definitions = Array.from({ length: toolCount }, (_, index) =>
    makeToolDefinition(`tool_${index + 1}`),
  );
  const toolIds = definitions.map((definition) => definition.id);
  vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
  vi.spyOn(
    intentMatcherModule,
    "matchToolCandidatesByEmbedding",
  ).mockResolvedValue({
    query: "inspect the workspace files",
    topCandidates: [],
    toolCandidates: [],
    toolExposure: {
      exposedToolIds: toolIds,
      exposedDefinitions: definitions,
      reason: ["matched tools"],
    },
    eligibleToolIds: toolIds,
    exposureReasons: ["matched tools"],
  });
  return definitions;
};

describe("prepareContextNode Progressive Resolution budget gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearHarnessRegistry();
  });

  it("stops exposing new Tool schemas after budget exhaustion while keeping already-disclosed ones", async () => {
    const budget = DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET;
    const definitions = mockToolSurface(budget + 3);
    const toolIds = definitions.map((definition) => definition.id);

    const patch = await prepareContextNode(createState());

    // Every eligible Tool stays Planner-callable; only budget-many carry a full
    // schema. The rest stay compact metadata.
    assert.deepEqual(patch.toolExposure?.exposedTools, toolIds);
    const schemaExposedToolIds = (patch.toolExposure?.toolMeta ?? [])
      .filter((tool) => Boolean(tool.inputSchema))
      .map((tool) => tool.toolId);
    assert.deepEqual(schemaExposedToolIds, toolIds.slice(0, budget));
    assert.deepEqual(
      (patch.toolExposure?.toolMeta ?? [])
        .filter((tool) => !tool.inputSchema)
        .map((tool) => tool.toolId),
      toolIds.slice(budget),
    );

    assert.deepEqual(patch.progressiveResolution?.budget, {
      limit: budget,
      consumed: budget,
    });
    assert.equal(patch.progressiveResolution?.exhausted, true);
    assert.match(
      patch.progressiveResolution?.unresolvedCapabilityGap ?? "",
      /budget/,
    );
    // Exhaustion is a bounded disclosure state, not task completion.
    assert.equal("status" in patch, false);
  });

  it("does not re-charge the budget on ordinary continuation and keeps prior disclosure", async () => {
    const budget = DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET;
    const definitions = mockToolSurface(budget + 2);
    const toolIds = definitions.map((definition) => definition.id);

    const first = await prepareContextNode(createState());
    assert.equal(first.progressiveResolution?.budget.consumed, budget);

    // Ordinary continuation (and approval/resume) restores the durable state and
    // must not silently reset or re-charge already-disclosed capabilities.
    const second = await prepareContextNode(
      createState({ progressiveResolution: first.progressiveResolution }),
    );
    assert.equal(second.progressiveResolution?.budget.consumed, budget);
    assert.equal(
      readCapabilityDisclosure(second.progressiveResolution!, toolIds[0]!),
      "schema",
    );
    assert.equal(
      readCapabilityDisclosure(second.progressiveResolution!, toolIds[budget]!),
      "hidden",
    );
  });

  it("keeps full schema disclosure while the tool surface fits within the budget", async () => {
    const definitions = mockToolSurface(2);
    const toolIds = definitions.map((definition) => definition.id);

    const patch = await prepareContextNode(createState());
    expect(patch.progressiveResolution?.budget).toEqual({ limit: 8, consumed: 2 });
    expect(patch.progressiveResolution?.exhausted).toBe(false);
    expect(
      (patch.toolExposure?.toolMeta ?? []).map((tool) => tool.toolId),
    ).toEqual(toolIds);
    expect(
      (patch.toolExposure?.toolMeta ?? []).every((tool) => Boolean(tool.inputSchema)),
    ).toBe(true);
  });

  it("stores resolver capability disclosure under canonical Tool ids that survive reconcile", async () => {
    const definitions = [
      makeToolDefinition("read_open"),
      makeToolDefinition("read_list"),
    ];
    const toolIds = definitions.map((definition) => definition.id);
    const resolution: CapabilityResolutionResult = {
      path: "structural",
      selectedCapabilityId: "workspace_lookup",
      candidates: [
        {
          capabilityId: "workspace_lookup",
          score: 2,
          reason: "structural read match",
        },
      ],
      trace: {
        query: "inspect the workspace",
        path: "structural",
        modelCalls: 0,
        semanticAttempted: false,
        ambiguous: false,
        deterministicCandidates: [],
        selectedCapabilityId: "workspace_lookup",
        domainHint: "read",
        selectedDomain: "read",
        wrongDomainRecovered: false,
        reason: "structural read match",
      },
    };
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    vi.spyOn(
      intentMatcherModule,
      "matchToolCandidatesByEmbedding",
    ).mockResolvedValue({
      query: "inspect the workspace",
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: toolIds,
        exposedDefinitions: definitions,
        reason: ["matched tools"],
      },
      eligibleToolIds: toolIds,
      exposureReasons: ["matched tools"],
      resolution,
    });

    const patch = await prepareContextNode(createState());

    // Disclosure and budget are keyed by concrete Tool ids even though the
    // resolver reported a grouped capability-profile id. The resolved capability
    // id is still recorded in the trace for observability.
    expect(
      Object.keys(patch.progressiveResolution?.disclosure ?? {}).sort(),
    ).toEqual(["read_list", "read_open"]);
    expect(
      patch.progressiveResolution?.trace.some(
        (event) =>
          event.stage === "selected" &&
          event.capabilityId === "workspace_lookup",
      ),
    ).toBe(true);

    // Resume reconciliation through the authoritative Profile -> Tool mapping
    // keeps the tool-keyed disclosure and the budget it already spent.
    const profiles = resolveHarnessCapabilityProfiles(definitions);
    const reconciled = reconcileProgressiveResolutionState({
      state: patch.progressiveResolution!,
      definitions,
      eligibleCapabilityIds: toolIds,
      resolveToolIds: createCapabilityToolIdResolver(profiles),
    });
    expect(readCapabilityDisclosure(reconciled, "read_open")).toBe("schema");
    expect(reconciled.budget.consumed).toBe(2);
  });
});
