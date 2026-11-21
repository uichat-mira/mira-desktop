import { afterEach, describe, expect, it, vi } from "vitest";
import * as harnessRegistry from "@/harness/registry";
import type { CapabilityResolutionResult } from "@/harness/candidates-core/capability-resolution";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";
import type { AgentNodeState } from "../node-runtime.js";
import { prepareContextNode } from "../nodes/prepare-context.js";
import { runProgressiveAcceptanceMatrix } from "./cases.js";
import type { AcceptanceCaseResult, AcceptanceToolSpec } from "./contract.js";
import { buildAcceptanceTool } from "./fixtures.js";
import { buildProjectionCaseResult, projectionCaseSpecs } from "./projection.js";

const byId = (
  cases: readonly AcceptanceCaseResult[],
  caseId: string,
): AcceptanceCaseResult => {
  const found = cases.find((item) => item.caseId === caseId);
  if (!found) throw new Error(`missing case ${caseId}`);
  return found;
};

const definitionFor = (spec: AcceptanceToolSpec) =>
  buildAcceptanceTool(spec).definition;
type ToolDefinition = ReturnType<typeof definitionFor>;

const createState = (query: string): AgentNodeState => ({
  runId: "run-311",
  threadId: "thread-311",
  userId: 1,
  goal: {
    id: "goal-311",
    text: query,
    successCriteria: [query],
    constraints: [],
    riskLevel: "low",
  },
  messages: [
    {
      role: "user",
      content: query,
      parts: [{ type: "text", text: query }],
    },
  ],
});

const resolutionFor = (
  spec: (typeof projectionCaseSpecs)[number],
): CapabilityResolutionResult | undefined => {
  if (spec.gold.selectedCapabilityId === "") return undefined;
  return {
    path: spec.gold.path,
    selectedCapabilityId: spec.gold.selectedCapabilityId,
    candidates: [
      {
        capabilityId: spec.gold.selectedCapabilityId,
        score: 1,
        reason: "stubbed projection resolution",
      },
    ],
    trace: {
      query: spec.query,
      path: spec.gold.path,
      modelCalls: 0,
      semanticAttempted: false,
      ambiguous: false,
      deterministicCandidates: [],
      selectedCapabilityId: spec.gold.selectedCapabilityId,
      domainHint: null,
      selectedDomain: null,
      wrongDomainRecovered: false,
      reason: "stubbed projection resolution",
    },
  };
};

/**
 * Replace the production matcher seam so the real `prepareContextNode`
 * projection can run with a controlled resolution, exactly like the existing
 * `prepare-context-progressive-resolution.test.ts` pattern.
 */
const stubMatcher = (input: {
  exposed: ToolDefinition[];
  eligibleToolIds: string[];
  resolution?: CapabilityResolutionResult;
}) => {
  const spy = vi.spyOn(
    intentMatcherModule,
    "matchToolCandidatesByEmbedding",
  );
  spy.mockResolvedValue({
    query: "stub",
    topCandidates: [],
    toolCandidates: [],
    toolExposure: {
      exposedToolIds: input.exposed.map((definition) => definition.id),
      exposedDefinitions: input.exposed,
      reason: ["stub"],
      blockedCapabilityIds: [],
      blockedCapabilityReasons: {},
    },
    eligibleToolIds: input.eligibleToolIds,
    exposureReasons: ["stub"],
    ...(input.resolution ? { resolution: input.resolution } : {}),
  });
  return spy;
};

describe("#311 Progressive Resolution acceptance matrix", () => {
  afterEach(() => {
    harnessRegistry.clearHarnessRegistry();
  });

  it("covers the full #311 matrix with a passing gold-oracle comparison", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    // 16 required #311 surfaces plus the explicit ambiguous-semantic fallback.
    expect(report.cases).toHaveLength(17);
    expect(report.summary.skipped).toBe(0);
    expect(
      report.cases
        .filter((item) => item.status !== "passed")
        .map((item) => ({
          caseId: item.caseId,
          failed: item.assertions.filter((assertion) => !assertion.ok),
        })),
    ).toEqual([]);
  });

  it("is explicit that direct #243 cost/reachability parity is NOT COMPARABLE", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(report.corpus.fixtureSource).toBe("311-matrix-analogous");
    expect(report.comparison.directParity).toBe("not_comparable");
    expect(report.comparison.reference.modelCalls).toBe(86);
    expect(report.comparison.reference.tokens).toBe(209148);
    // The exact #243 corpus reference is recorded but never silently rebuilt.
    expect(report.comparison.reference.caseIds).toHaveLength(16);
    expect(report.evidenceScope.governedExecutionObserved).toBe(false);
  });

  it("keeps exact and structural cases free of Tool Search and semantic model calls", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    for (const caseId of ["exact-known-tool", "structural-domain", "main-agent"]) {
      const result = byId(report.cases, caseId);
      expect(result.metrics.modelCalls).toBe(0);
      expect(result.metrics.semanticAttempted).toBe(false);
      expect(result.metrics.searchUsed).toBe(false);
    }
  });

  it("reaches a Tool beyond the old first-20 window and in a noisy large catalog without claiming selection", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    for (const caseId of ["beyond-first20", "noisy-large-catalog"]) {
      const result = byId(report.cases, caseId);
      expect(result.metrics.modelCalls).toBe(0);
      expect(result.metrics.searchUsed).toBe(true);
      expect(
        result.assertions.find((a) => a.name === "gold_tool_in_authority_envelope")?.ok,
      ).toBe(true);
      // Ranking membership is trace evidence, not a Planner selection.
      expect(
        result.assertions.find((a) => a.name === "gold_tool_in_candidate_ranking")?.ok,
      ).toBe(true);
      expect(result.observed.invokedToolId).toBeNull();
    }
  });

  it("keeps no-match transparent and authority violations at zero across the matrix", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(byId(report.cases, "no-match").metrics.modelCalls).toBe(0);
    for (const result of report.cases) {
      expect(result.metrics.authorityViolations).toBe(0);
      expect(
        result.assertions.find(
          (a) => a.name === "planner_exposure_within_authority_envelope",
        )?.ok ?? true,
      ).toBe(true);
    }
  });

  it("keeps resolution budget independent from recovery and reconciles revocation/readiness", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(byId(report.cases, "resolution-budget-exhaustion").status).toBe("passed");
    expect(byId(report.cases, "approval-resume").status).toBe("passed");
    expect(byId(report.cases, "readiness-revocation-after-checkpoint").status).toBe(
      "passed",
    );
  });

  it("keeps Main, Generic Child and Skill Child scoped views independent", async () => {
    const report = await runProgressiveAcceptanceMatrix();

    expect(byId(report.cases, "generic-child").status).toBe("passed");
    expect(byId(report.cases, "unauthorized-capability").status).toBe("passed");
    expect(byId(report.cases, "skill-child-scope").status).toBe("passed");
  });
});

describe("#311 real prepareContextNode projection (Planner-callable boundary)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    harnessRegistry.clearHarnessRegistry();
  });

  for (const spec of projectionCaseSpecs) {
    it(`drives ${spec.caseId} through the production projection`, async () => {
      const definitions = spec.tools.map(definitionFor);
      vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
      const resolution = resolutionFor(spec);
      stubMatcher({
        exposed: definitions,
        eligibleToolIds: definitions.map((definition) => definition.id),
        ...(resolution ? { resolution } : {}),
      });

      const startedAt = Date.now();
      const patch = await prepareContextNode(createState(spec.query));
      const result = buildProjectionCaseResult(spec, {
        resolution,
        patch,
        latencyMs: Date.now() - startedAt,
      });

      expect(
        result.assertions.filter((assertion) => !assertion.ok),
        JSON.stringify(result.assertions, null, 2),
      ).toEqual([]);
      expect(result.status).toBe("passed");
      expect(result.evidenceLevel).toBe("planner-projection");
      // No governed execution happened, so invocation stays NOT_VERIFIED.
      expect(result.observed.invokedToolId).toBeNull();
    });
  }

  it("keeps the concrete gold Tool Planner-callable beyond the old first20 window", async () => {
    const spec = projectionCaseSpecs.find(
      (item) => item.caseId === "projection-beyond-first20",
    )!;
    const definitions = spec.tools.map(definitionFor);
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    const resolution = resolutionFor(spec);
    stubMatcher({
      exposed: definitions,
      eligibleToolIds: definitions.map((definition) => definition.id),
      ...(resolution ? { resolution } : {}),
    });

    const patch = await prepareContextNode(createState(spec.query));
    const result = buildProjectionCaseResult(spec, { resolution, patch });

    expect(spec.tools.findIndex((tool) => tool.id === "late_lexical_target")).toBeGreaterThan(
      20,
    );
    expect(result.observed.schemaDisclosedToolIds as string[]).toContain(
      "late_lexical_target",
    );
    expect(result.observed.plannerCallableToolIds as string[]).toContain(
      "late_lexical_target",
    );
    expect(result.observed.eligibleToolIds as string[]).toContain(
      "late_lexical_target",
    );
  });

  it("does not materialize schema when the projection resolved no capability", async () => {
    const spec = projectionCaseSpecs.find(
      (item) => item.caseId === "projection-no-selection",
    )!;
    const definitions = spec.tools.map(definitionFor);
    vi.spyOn(harnessRegistry, "listToolDefinitions").mockReturnValue(definitions);
    stubMatcher({
      exposed: definitions,
      eligibleToolIds: definitions.map((definition) => definition.id),
    });

    const patch = await prepareContextNode(createState(spec.query));
    const result = buildProjectionCaseResult(spec, {
      resolution: undefined,
      patch,
    });

    expect(result.status).toBe("passed");
    expect(result.observed.schemaDisclosedToolIds).toEqual([]);
    expect(result.observed.plannerCallableToolIds).toEqual([]);
  });
});
