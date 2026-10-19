import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as harnessRegistry from "@/harness/registry";
import { clearHarnessRegistry } from "@/harness/registry";
import {
  registerToolRuntimeReadiness,
  unregisterToolRuntimeReadiness,
} from "@/harness/runtime-readiness";
import {
  DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
  readCapabilityDisclosure,
} from "@/harness/progressive-resolution-state";
import type { CapabilityResolutionResult } from "@/harness/candidates-core/capability-resolution";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";
import { buildPlannerObservationContext } from "../node-runtime";
import { buildNextActionPlannerMessages } from "../planner/prompt";
import { buildPlannerStructuredOutputJsonSchema } from "../planner/structured-output";
import { prepareContextNode } from "./prepare-context.js";
import type { AgentNodeState } from "../node-runtime.js";

type ToolDomain = "read" | "edit" | "web_search" | "terminal" | "browser_action";

const makeToolDefinition = (
  toolId: string,
  domain: ToolDomain = "read",
) => ({
  id: toolId,
  title: toolId,
  description: `${toolId} description`,
  inputSchema: {
    type: "object",
    properties: { target: { type: "string" } },
    required: ["target"],
    additionalProperties: false,
  },
  domain,
  source: "internal" as const,
  mode: "sync" as const,
  tags: [domain],
  capabilities: { sideEffect: "none" as const, requiresApproval: false },
});

type ToolDefinition = ReturnType<typeof makeToolDefinition>;

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

const makeResolution = (input: {
  selectedCapabilityId: string;
  candidates: string[];
  path?: CapabilityResolutionResult["path"];
}): CapabilityResolutionResult => ({
  path: input.path ?? "structural",
  selectedCapabilityId: input.selectedCapabilityId,
  candidates: input.candidates.map((capabilityId, index) => ({
    capabilityId,
    score: 1 - index * 0.1,
    reason: `${capabilityId} matched`,
  })),
  trace: {
    query: "inspect the workspace files",
    path: input.path ?? "structural",
    modelCalls: 0,
    semanticAttempted: false,
    ambiguous: false,
    deterministicCandidates: [],
    selectedCapabilityId: input.selectedCapabilityId,
    domainHint: null,
    selectedDomain: null,
    wrongDomainRecovered: false,
    reason: "structural test resolution",
  },
});

const buildMatcherResult = (input: {
  exposed: ToolDefinition[];
  eligibleToolIds?: string[];
  resolution?: CapabilityResolutionResult;
  query?: string;
}): Awaited<
  ReturnType<typeof intentMatcherModule.matchToolCandidatesByEmbedding>
> => {
  const exposedToolIds = input.exposed.map((definition) => definition.id);
  return {
    query: input.query ?? "inspect the workspace files",
    topCandidates: [],
    toolCandidates: [],
    toolExposure: {
      exposedToolIds,
      exposedDefinitions: input.exposed,
      reason: ["matched tools"],
      blockedCapabilityIds: [],
      blockedCapabilityReasons: {},
    },
    eligibleToolIds: input.eligibleToolIds ?? exposedToolIds,
    exposureReasons: ["matched tools"],
    ...(input.resolution ? { resolution: input.resolution } : {}),
  };
};

const mockMatcher = (input: {
  exposed: ToolDefinition[];
  eligibleToolIds?: string[];
  resolution?: CapabilityResolutionResult;
  query?: string;
}) => {
  const spy = vi.spyOn(
    intentMatcherModule,
    "matchToolCandidatesByEmbedding",
  );
  spy.mockResolvedValue(buildMatcherResult(input));
  return spy;
};

const schemaExposedToolIds = (state: Partial<AgentNodeState>): string[] =>
  (state.toolExposure?.toolMeta ?? [])
    .filter((tool) => Boolean(tool.inputSchema))
    .map((tool) => tool.toolId);

const workspaceLookupTools = () => [
  makeToolDefinition("glob"),
  makeToolDefinition("grep"),
  makeToolDefinition("list"),
  makeToolDefinition("read"),
];

const workspaceEditTools = () => [
  makeToolDefinition("write", "edit"),
  makeToolDefinition("edit", "edit"),
  makeToolDefinition("delete", "edit"),
  makeToolDefinition("move", "edit"),
  makeToolDefinition("apply_patch", "edit"),
];

describe("prepareContextNode Progressive Resolution budget gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearHarnessRegistry();
  });

  it("treats a <=20 catalog as metadata only and materializes exactly the selected capability", async () => {
    const selected = workspaceLookupTools();
    const filler = Array.from({ length: 16 }, (_, index) =>
      makeToolDefinition(`tool_${index + 1}`),
    );
    const definitions = [...selected, ...filler];
    const toolIds = definitions.map((definition) => definition.id);
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    mockMatcher({
      exposed: definitions,
      eligibleToolIds: toolIds,
      resolution: makeResolution({
        selectedCapabilityId: "workspace_lookup",
        candidates: ["workspace_lookup"],
      }),
    });

    const patch = await prepareContextNode(createState());

    // A 20-Tool catalog is cheap to discover, not automatically selected: only
    // the selected capability's Tools reach the Planner with a real schema.
    assert.deepEqual(patch.toolExposure?.exposedTools, [
      "glob",
      "grep",
      "list",
      "read",
    ]);
    assert.deepEqual(schemaExposedToolIds(patch), [
      "glob",
      "grep",
      "list",
      "read",
    ]);
    for (const fillerDefinition of filler) {
      assert.equal(
        patch.toolExposure?.exposedTools?.includes(fillerDefinition.id),
        false,
      );
      assert.equal(
        (patch.toolExposure?.toolMeta ?? []).some(
          (tool) => tool.toolId === fillerDefinition.id,
        ),
        false,
      );
    }

    // New schema detail spends one budget step per Tool; the catalog itself does
    // not spend the resolution budget.
    assert.deepEqual(patch.progressiveResolution?.budget, {
      limit: DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
      consumed: 4,
    });
    assert.equal(patch.progressiveResolution?.exhausted, false);
  });

  it("does not eager-materialize the surface when no capability is selected", async () => {
    const definitions = Array.from({ length: 20 }, (_, index) =>
      makeToolDefinition(`tool_${index + 1}`),
    );
    const toolIds = definitions.map((definition) => definition.id);
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    // The resolver short-circuits without a confident selection (empty query or
    // no matching capability). The surface stays metadata only instead of being
    // materialized for free.
    mockMatcher({ exposed: definitions, eligibleToolIds: toolIds });

    const patch = await prepareContextNode(createState());

    assert.deepEqual(patch.toolExposure?.exposedTools, []);
    assert.deepEqual(schemaExposedToolIds(patch), []);
    assert.deepEqual(patch.progressiveResolution?.budget, {
      limit: DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
      consumed: 0,
    });
  });

  it("does not disclose new schema when the resolver reports ambiguity without a selection", async () => {
    const definitions = [...workspaceLookupTools(), ...workspaceEditTools()];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    mockMatcher({
      exposed: definitions,
      eligibleToolIds: definitions.map((definition) => definition.id),
      // Genuine ambiguity whose bounded semantic fallback returned no usable
      // capability: candidates stay trace/metadata, nothing is selected.
      resolution: {
        path: "ambiguous",
        selectedCapabilityId: null,
        candidates: [
          { capabilityId: "workspace_lookup", score: 0.6, reason: "ambiguous" },
          { capabilityId: "workspace_edit", score: 0.5, reason: "ambiguous" },
        ],
        trace: {
          query: "inspect the workspace files",
          path: "ambiguous",
          modelCalls: 1,
          semanticAttempted: true,
          ambiguous: true,
          deterministicCandidates: [],
          selectedCapabilityId: null,
          domainHint: null,
          selectedDomain: null,
          wrongDomainRecovered: false,
          reason: "semantic returned no usable capability",
        },
      },
    });

    const patch = await prepareContextNode(createState());

    assert.deepEqual(patch.toolExposure?.exposedTools, []);
    assert.deepEqual(schemaExposedToolIds(patch), []);
    assert.deepEqual(patch.progressiveResolution?.budget, {
      limit: DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
      consumed: 0,
    });
    assert.equal(
      (patch.progressiveResolution?.trace ?? []).some(
        (event) => event.stage === "selected",
      ),
      false,
    );
  });

  it("spends one step per newly disclosed Tool when the resolver selects a capability", async () => {
    const definitions = [...workspaceLookupTools(), ...workspaceEditTools()];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    mockMatcher({
      exposed: definitions,
      eligibleToolIds: definitions.map((definition) => definition.id),
      resolution: makeResolution({
        selectedCapabilityId: "workspace_lookup",
        candidates: ["workspace_lookup"],
      }),
    });

    const patch = await prepareContextNode(createState());

    assert.deepEqual(patch.toolExposure?.exposedTools, [
      "glob",
      "grep",
      "list",
      "read",
    ]);
    assert.equal(patch.toolExposure?.exposedTools?.includes("write"), false);
    assert.deepEqual(patch.progressiveResolution?.budget, {
      limit: DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
      consumed: 4,
    });
    assert.equal(patch.progressiveResolution?.exhausted, false);
  });

  it("discloses only the selected capability when ranked candidates are also returned", async () => {
    const definitions = [
      ...workspaceLookupTools(),
      makeToolDefinition("web_search", "web_search"),
      makeToolDefinition("web_fetch", "web_search"),
      ...workspaceEditTools(),
    ];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    mockMatcher({
      exposed: definitions,
      eligibleToolIds: definitions.map((definition) => definition.id),
      // A deterministic structural result names one selection but keeps the
      // ranked candidate list. Candidates are trace/metadata only and must not
      // be materialized or charged as if they were selected.
      resolution: makeResolution({
        selectedCapabilityId: "workspace_edit",
        candidates: ["workspace_edit", "web", "workspace_lookup"],
      }),
    });

    const patch = await prepareContextNode(createState());

    assert.deepEqual(patch.toolExposure?.exposedTools, [
      "write",
      "edit",
      "delete",
      "move",
      "apply_patch",
    ]);
    assert.deepEqual(schemaExposedToolIds(patch), [
      "write",
      "edit",
      "delete",
      "move",
      "apply_patch",
    ]);
    // Budget is charged for the selected capability's Tools only; the ranked
    // web / workspace_lookup candidates are neither disclosed nor charged.
    assert.deepEqual(patch.progressiveResolution?.budget, {
      limit: DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
      consumed: 5,
    });
    assert.equal(patch.progressiveResolution?.disclosure.glob, undefined);
    assert.equal(patch.progressiveResolution?.disclosure.web_search, undefined);
    const selectedEvents = (patch.progressiveResolution?.trace ?? []).filter(
      (event) => event.stage === "selected",
    );
    assert.deepEqual(
      selectedEvents.map((event) => event.capabilityId),
      ["workspace_edit"],
    );
  });

  it("promotes a second capability on a later turn within the budget without re-charging prior disclosure", async () => {
    const definitions = [
      ...workspaceLookupTools(),
      makeToolDefinition("web_search", "web_search"),
      makeToolDefinition("web_fetch", "web_search"),
      ...Array.from({ length: 16 }, (_, index) =>
        makeToolDefinition(`tool_${index + 1}`),
      ),
    ];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);

    const matcherSpy = mockMatcher({
      exposed: definitions.slice(0, 20),
      eligibleToolIds: definitions.map((definition) => definition.id),
      resolution: makeResolution({
        selectedCapabilityId: "workspace_lookup",
        candidates: ["workspace_lookup"],
      }),
    });
    const first = await prepareContextNode(createState());
    assert.equal(first.progressiveResolution?.budget.consumed, 4);

    matcherSpy.mockResolvedValue(
      buildMatcherResult({
        exposed: definitions.slice(0, 20),
        eligibleToolIds: definitions.map((definition) => definition.id),
        resolution: makeResolution({
          selectedCapabilityId: "web",
          candidates: ["web"],
        }),
      }),
    );
    const second = await prepareContextNode(
      createState({ progressiveResolution: first.progressiveResolution }),
    );

    // Cross-turn on-demand promotion: the first capability is not re-charged and
    // the second capability expands within the remaining budget.
    assert.equal(second.progressiveResolution?.budget.consumed, 6);
    assert.equal(second.progressiveResolution?.exhausted, false);
    assert.equal(
      readCapabilityDisclosure(second.progressiveResolution!, "glob"),
      "schema",
    );
    assert.equal(
      readCapabilityDisclosure(second.progressiveResolution!, "web_search"),
      "schema",
    );
    assert.deepEqual(second.toolExposure?.exposedTools, [
      "glob",
      "grep",
      "list",
      "read",
      "web_search",
      "web_fetch",
    ]);
  });

  it("does not re-charge the budget on ordinary continuation", async () => {
    const definitions = [
      ...workspaceLookupTools(),
      ...Array.from({ length: 16 }, (_, index) =>
        makeToolDefinition(`tool_${index + 1}`),
      ),
    ];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    mockMatcher({
      exposed: definitions.slice(0, 20),
      eligibleToolIds: definitions.map((definition) => definition.id),
      resolution: makeResolution({
        selectedCapabilityId: "workspace_lookup",
        candidates: ["workspace_lookup"],
      }),
    });

    const first = await prepareContextNode(createState());
    const second = await prepareContextNode(
      createState({ progressiveResolution: first.progressiveResolution }),
    );

    assert.equal(second.progressiveResolution?.budget.consumed, 4);
    assert.deepEqual(second.toolExposure?.exposedTools, [
      "glob",
      "grep",
      "list",
      "read",
    ]);
  });

  it("exhausts bounded and transparently while keeping already-disclosed detail", async () => {
    const definitions = [...workspaceLookupTools(), ...workspaceEditTools()];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    const matcherSpy = mockMatcher({
      exposed: definitions,
      eligibleToolIds: definitions.map((definition) => definition.id),
      resolution: makeResolution({
        selectedCapabilityId: "workspace_lookup",
        candidates: ["workspace_lookup"],
      }),
    });

    const first = await prepareContextNode(createState());
    assert.equal(first.progressiveResolution?.budget.consumed, 4);

    matcherSpy.mockResolvedValue(
      buildMatcherResult({
        exposed: definitions,
        eligibleToolIds: definitions.map((definition) => definition.id),
        resolution: makeResolution({
          selectedCapabilityId: "workspace_edit",
          candidates: ["workspace_edit"],
        }),
      }),
    );
    const second = await prepareContextNode(
      createState({ progressiveResolution: first.progressiveResolution }),
    );

    const budget = DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET;
    assert.deepEqual(second.progressiveResolution?.budget, {
      limit: budget,
      consumed: budget,
    });
    assert.equal(second.progressiveResolution?.exhausted, true);
    assert.match(
      second.progressiveResolution?.unresolvedCapabilityGap ?? "",
      /budget/,
    );
    assert.match(
      second.progressiveResolution?.unresolvedCapabilityGap ?? "",
      /apply_patch/,
    );

    // The refused Tool stays undisclosed and is not exposed with an empty schema.
    assert.equal(
      readCapabilityDisclosure(second.progressiveResolution!, "apply_patch"),
      "hidden",
    );
    assert.equal(
      second.toolExposure?.exposedTools?.includes("apply_patch"),
      false,
    );
    assert.equal(second.toolExposure?.exposedTools?.length, budget);
    for (const toolId of second.toolExposure?.exposedTools ?? []) {
      assert.ok(
        second.toolExposure?.toolMeta.find((tool) => tool.toolId === toolId)
          ?.inputSchema,
        `missing schema for ${toolId}`,
      );
    }

    // Exhaustion is a bounded disclosure state, not task completion.
    assert.equal("status" in second, false);
  });

  it("survives resume and yields to registry revocation and readiness loss", async () => {
    const baseTools = workspaceLookupTools();
    const filler = Array.from({ length: 16 }, (_, index) =>
      makeToolDefinition(`tool_${index + 1}`),
    );
    const definitions = [...baseTools, ...filler];
    const registrySpy = vi
      .spyOn(harnessRegistry, "listToolDefinitions")
      .mockReturnValue(definitions);
    const resolution = makeResolution({
      selectedCapabilityId: "workspace_lookup",
      candidates: ["workspace_lookup"],
    });
    const matcherSpy = mockMatcher({
      exposed: definitions.slice(0, 20),
      eligibleToolIds: definitions.map((definition) => definition.id),
      resolution,
    });

    const first = await prepareContextNode(createState());
    assert.equal(first.progressiveResolution?.budget.consumed, 4);

    // Resume keeps the durable disclosure and budget.
    const resumed = await prepareContextNode(
      createState({ progressiveResolution: first.progressiveResolution }),
    );
    assert.equal(resumed.progressiveResolution?.budget.consumed, 4);
    expect(resumed.progressiveResolution?.disclosure).toEqual({
      glob: "schema",
      grep: "schema",
      list: "schema",
      read: "schema",
    });

    // Registry revocation (unregistered Tool) wins over stale persisted visibility.
    const revokedDefinitions = definitions.filter(
      (definition) => definition.id !== "read",
    );
    registrySpy.mockReturnValue(revokedDefinitions);
    matcherSpy.mockResolvedValue(
      buildMatcherResult({
        exposed: revokedDefinitions.slice(0, 20),
        eligibleToolIds: revokedDefinitions.map((definition) => definition.id),
        resolution,
      }),
    );
    const revoked = await prepareContextNode(
      createState({ progressiveResolution: resumed.progressiveResolution }),
    );
    assert.equal(
      readCapabilityDisclosure(revoked.progressiveResolution!, "read"),
      "hidden",
    );
    assert.equal(revoked.toolExposure?.exposedTools?.includes("read"), false);
    assert.equal(revoked.progressiveResolution?.budget.consumed, 4);

    // Readiness loss for the whole capability group drops the stale disclosure
    // and prevents any promotion from leaking a stale schema.
    for (const toolId of ["glob", "grep", "list", "read"]) {
      registerToolRuntimeReadiness(toolId, () => ({
        state: "unavailable",
        reason: "runtime prerequisite missing",
        code: "test_runtime_unavailable",
      }));
    }
    try {
      registrySpy.mockReturnValue(definitions);
      const unready = await prepareContextNode(
        createState({ progressiveResolution: first.progressiveResolution }),
      );
      expect(unready.progressiveResolution?.disclosure).toEqual({});
      assert.deepEqual(unready.toolExposure?.exposedTools, []);
      // Reconciliation is not a fresh resolution pass: prior spend is preserved.
      assert.equal(unready.progressiveResolution?.budget.consumed, 4);
    } finally {
      for (const toolId of ["glob", "grep", "list", "read"]) {
        unregisterToolRuntimeReadiness(toolId);
      }
    }
  });

  it("keeps the production Planner link callable with legal schema args and no empty-schema dead path", async () => {
    const resolvedTools = workspaceLookupTools();
    const definitions = [
      ...resolvedTools,
      ...Array.from({ length: 18 }, (_, index) =>
        makeToolDefinition(`tool_${index + 1}`),
      ),
    ];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    mockMatcher({
      exposed: definitions.slice(0, 20),
      eligibleToolIds: definitions.map((definition) => definition.id),
      resolution: makeResolution({
        selectedCapabilityId: "workspace_lookup",
        candidates: ["workspace_lookup"],
      }),
    });

    const patch = await prepareContextNode(createState());
    const exposure = patch.toolExposure!;

    // Every Planner-callable Tool carries the canonical schema, so the structured
    // output never constrains an exposed Tool with an empty parameter object.
    for (const toolId of exposure.exposedTools) {
      const meta = exposure.toolMeta.find((tool) => tool.toolId === toolId);
      assert.ok(meta?.inputSchema, `missing schema for ${toolId}`);
    }

    const structured = buildPlannerStructuredOutputJsonSchema(exposure);
    const properties = structured.properties as Record<string, unknown>;
    const argsVariants = (
      properties.args as { anyOf: Array<Record<string, unknown>> }
    ).anyOf;
    // One variant per exposed Tool plus the trailing null variant.
    assert.equal(argsVariants.length, exposure.exposedTools.length + 1);
    for (const variant of argsVariants.slice(0, exposure.exposedTools.length)) {
      const variantProperties = variant.properties as Record<string, unknown>;
      assert.ok(Object.keys(variantProperties).length > 0);
    }

    const plannerMessages = buildNextActionPlannerMessages({
      question: "inspect the workspace files",
      messages: [],
      observationContext: buildPlannerObservationContext(createState({ ...patch })),
      toolExposure: exposure,
      iteration: 0,
      maxIterations: 3,
    });
    const payload = JSON.parse(String(plannerMessages[1]?.content ?? "{}")) as {
      toolExposure: { exposedTools: string[] };
    };
    assert.deepEqual(payload.toolExposure.exposedTools, [
      "glob",
      "grep",
      "list",
      "read",
    ]);
    assert.equal(payload.toolExposure.exposedTools.includes("tool_1"), false);
  });

  it("narrows the first-level browser capability to the selected concrete Tool schema", async () => {
    const browserTools = [
      makeToolDefinition("browser_observe", "browser_action"),
      makeToolDefinition("browser_navigate", "browser_action"),
      makeToolDefinition("browser_click", "browser_action"),
    ];
    const filler = Array.from({ length: 16 }, (_, index) =>
      makeToolDefinition(`tool_${index + 1}`),
    );
    const definitions = [...browserTools, ...filler];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    mockMatcher({
      exposed: definitions,
      eligibleToolIds: definitions.map((definition) => definition.id),
      query: "browser_navigate",
      resolution: makeResolution({
        selectedCapabilityId: "browser",
        candidates: ["browser"],
      }),
    });

    const patch = await prepareContextNode(createState());

    // Product ownership stays grouped, but the group does not eagerly promote
    // its whole catalog: only the concrete Tool selected for this turn reaches
    // the Planner with a schema.
    assert.deepEqual(patch.toolExposure?.exposedTools, ["browser_navigate"]);
    assert.deepEqual(schemaExposedToolIds(patch), ["browser_navigate"]);
    assert.deepEqual(patch.progressiveResolution?.budget, {
      limit: DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
      consumed: 1,
    });
    assert.equal(
      readCapabilityDisclosure(patch.progressiveResolution!, "browser_observe"),
      "hidden",
    );
    assert.equal(
      readCapabilityDisclosure(patch.progressiveResolution!, "browser_click"),
      "hidden",
    );
  });

  it("does not disclose an unavailable browser Tool even when the browser capability is selected", async () => {
    const browserTools = [
      makeToolDefinition("browser_observe", "browser_action"),
      makeToolDefinition("browser_navigate", "browser_action"),
      makeToolDefinition("browser_click", "browser_action"),
    ];
    const filler = Array.from({ length: 16 }, (_, index) =>
      makeToolDefinition(`tool_${index + 1}`),
    );
    const definitions = [...browserTools, ...filler];
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    registerToolRuntimeReadiness("browser_click", () => ({
      state: "unavailable",
      reason: "managed browser runtime missing",
      code: "browser_runtime_unavailable",
    }));
    try {
      mockMatcher({
        exposed: definitions,
        eligibleToolIds: definitions.map((definition) => definition.id),
        query: "browser_click",
        resolution: makeResolution({
          selectedCapabilityId: "browser",
          candidates: ["browser"],
        }),
      });

      const patch = await prepareContextNode(createState());

      // Discovery/profile selection never makes an unavailable Tool ready or
      // callable: no schema is materialized and no budget is spent.
      assert.deepEqual(patch.toolExposure?.exposedTools, []);
      assert.deepEqual(schemaExposedToolIds(patch), []);
      assert.equal(
        readCapabilityDisclosure(patch.progressiveResolution!, "browser_click"),
        "hidden",
      );
      assert.deepEqual(patch.progressiveResolution?.budget, {
        limit: DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
        consumed: 0,
      });
    } finally {
      unregisterToolRuntimeReadiness("browser_click");
    }
  });
});
