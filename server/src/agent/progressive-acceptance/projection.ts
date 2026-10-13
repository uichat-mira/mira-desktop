import type { AgentNodeState } from "@/agent/node-runtime.js";
import type { CapabilityResolutionResult } from "@/harness/candidates-core/capability-resolution.js";
import type {
  AcceptanceAssertion,
  AcceptanceCaseResult,
  ProjectionCaseSpec,
} from "./contract.js";
import { noiseTools, workspaceLookupTools } from "./fixtures.js";

/**
 * Real `prepareContextNode` projection cases (test-only).
 *
 * These cases are the authoritative boundary the first #311 report got wrong:
 * the ranked `toolCandidates` list is not a Planner selection. Only the
 * production `prepareContextNode` decides which concrete Tools reach schema
 * disclosure and therefore `toolExposure.exposedTools` (the Planner-callable
 * set). This module maps a real `prepareContextNode` patch into an acceptance
 * case result; the vitest harness in `cases.test.ts` provides the patch by
 * calling the production node with the registry and matcher seams stubbed.
 *
 * `invokedToolId` stays `null`: this test-only matrix never executes a governed
 * Tool call, so actual invocation is recorded as NOT_VERIFIED rather than
 * inferred.
 */

export interface ProjectionCaseObservation {
  readonly resolution: CapabilityResolutionResult | undefined;
  readonly patch: Pick<
    Partial<AgentNodeState>,
    "toolExposure" | "progressiveResolution"
  >;
  readonly latencyMs?: number | null;
}

const ok = (
  name: string,
  condition: boolean,
  detail?: string,
): AcceptanceAssertion => ({
  name,
  ok: condition,
  ...(detail ? { detail } : {}),
});

const statusOf = (
  assertions: readonly AcceptanceAssertion[],
): AcceptanceCaseResult["status"] =>
  assertions.every((assertion) => assertion.ok) ? "passed" : "failed";

export const projectionCaseSpecs: readonly ProjectionCaseSpec[] = [
  {
    caseId: "projection-main-agent",
    surface: "main_agent",
    category: "reachability",
    query: "search the workspace files for a pattern",
    tools: [...workspaceLookupTools(), ...noiseTools(16)],
    gold: {
      path: "structural",
      selectedCapabilityId: "workspace_lookup",
      plannerCallableToolId: "grep",
      expectSemanticSearch: false,
    },
  },
  {
    caseId: "projection-beyond-first20",
    surface: "main_agent",
    category: "reachability",
    query: "zephyrix",
    tools: [
      ...noiseTools(24),
      {
        id: "late_lexical_target",
        description: "Handles the zephyrix ingestion pipeline",
        tags: ["noise"],
      },
    ],
    gold: {
      path: "lexical",
      selectedCapabilityId: "late_lexical_target",
      plannerCallableToolId: "late_lexical_target",
      expectSemanticSearch: true,
    },
  },
  {
    caseId: "projection-no-selection",
    surface: "main_agent",
    category: "efficiency",
    query: "zzzzqqqq",
    tools: [...workspaceLookupTools(), ...noiseTools(4)],
    gold: {
      path: "none",
      selectedCapabilityId: "",
      plannerCallableToolId: "",
      expectSemanticSearch: false,
    },
  },
];

export const buildProjectionCaseResult = (
  spec: ProjectionCaseSpec,
  observation: ProjectionCaseObservation,
): AcceptanceCaseResult => {
  const exposure = observation.patch.toolExposure;
  const toolMeta = exposure?.toolMeta ?? [];
  const plannerCallableToolIds = exposure?.exposedTools ?? [];
  const schemaDisclosedToolIds = toolMeta
    .filter((tool) => Boolean(tool.inputSchema))
    .map((tool) => tool.toolId);
  const eligibleToolIds = exposure?.eligibleTools ?? [];

  const resolution = observation.resolution;
  const resolvedCapabilityId = resolution?.selectedCapabilityId ?? null;
  const path = resolution?.path ?? "none";
  const modelCalls = resolution?.trace.modelCalls ?? 0;
  const searchUsed = path === "lexical" || path === "semantic";
  const budget = observation.patch.progressiveResolution?.budget;
  const disclosure = observation.patch.progressiveResolution?.disclosure ?? {};

  // A capability that resolved to a real capability must expose exactly its
  // supporting Tools; a no-selection turn must not materialize anything. The
  // empty gold capability id encodes the explicit "nothing selected" case.
  const expectsSelection = spec.gold.selectedCapabilityId !== "";

  const plannerExposureWithinEnvelope = plannerCallableToolIds.every((toolId) =>
    eligibleToolIds.includes(toolId),
  );
  const authorityViolations = plannerCallableToolIds.filter(
    (toolId) => !eligibleToolIds.includes(toolId),
  ).length;

  const assertions: AcceptanceAssertion[] = [
    ok(
      "gold_resolution_path",
      path === spec.gold.path,
      `expected=${spec.gold.path} observed=${path}`,
    ),
    ok(
      "gold_resolved_capability",
      expectsSelection
        ? resolvedCapabilityId === spec.gold.selectedCapabilityId
        : resolvedCapabilityId === null,
      `expected=${expectsSelection ? spec.gold.selectedCapabilityId : "none"} observed=${resolvedCapabilityId}`,
    ),
    ok(
      "planner_exposure_within_authority_envelope",
      plannerExposureWithinEnvelope,
      `plannerCallable=${plannerCallableToolIds.join(",") || "none"} eligible=${eligibleToolIds.join(",") || "none"}`,
    ),
    ok(
      "schema_disclosed_is_planner_callable",
      schemaDisclosedToolIds.every((toolId) =>
        plannerCallableToolIds.includes(toolId),
      ) && plannerCallableToolIds.every((toolId) =>
        schemaDisclosedToolIds.includes(toolId),
      ),
      `schema=${schemaDisclosedToolIds.join(",") || "none"} plannerCallable=${plannerCallableToolIds.join(",") || "none"}`,
    ),
    ok(
      "semantic_search_expectation",
      searchUsed === spec.gold.expectSemanticSearch,
      `expectedSearch=${spec.gold.expectSemanticSearch} observedSearch=${searchUsed} modelCalls=${modelCalls}`,
    ),
  ];

  if (expectsSelection) {
    assertions.push(
      ok(
        "gold_tool_planner_callable",
        schemaDisclosedToolIds.includes(spec.gold.plannerCallableToolId) &&
          plannerCallableToolIds.includes(spec.gold.plannerCallableToolId),
        `gold=${spec.gold.plannerCallableToolId} schema=${schemaDisclosedToolIds.join(",") || "none"} plannerCallable=${plannerCallableToolIds.join(",") || "none"}`,
      ),
    );
  } else {
    assertions.push(
      ok(
        "no_selection_materializes_nothing",
        plannerCallableToolIds.length === 0 && schemaDisclosedToolIds.length === 0,
        `plannerCallable=${plannerCallableToolIds.join(",") || "none"}`,
      ),
    );
  }

  assertions.push(
    ok(
      "authority_violations_zero",
      authorityViolations === 0,
      `authorityViolations=${authorityViolations}`,
    ),
  );

  return {
    caseId: spec.caseId,
    surface: spec.surface,
    category: spec.category,
    evidenceLevel: "planner-projection",
    query: spec.query,
    gold: { ...spec.gold },
    observed: {
      resolutionPath: path,
      resolvedCapabilityId,
      candidateCapabilityRanking: resolution?.candidates.map((candidate) => candidate.capabilityId) ?? [],
      schemaDisclosedToolIds,
      plannerCallableToolIds,
      eligibleToolIds,
      invokedToolId: null,
      progressiveResolutionBudget: budget ?? null,
      progressiveResolutionDisclosure: disclosure,
    },
    metrics: {
      modelCalls,
      semanticAttempted: resolution?.trace.semanticAttempted ?? null,
      searchUsed,
      authorityViolations,
      tokens: null,
      latencyMs: observation.latencyMs ?? null,
      resolverLatencyMs: null,
    },
    assertions,
    status: statusOf(assertions),
    diagnostics: [
      "real production prepareContextNode projection: schema-disclosed Tools equal toolExposure.exposedTools (Planner-callable).",
      "the listToolDefinitions / matchToolCandidatesByEmbedding production seams are stubbed to a controlled resolution; the projection itself is the real node.",
      "a ranked candidate is not a selection; only resolvedCapabilityId drives disclosure.",
      "invokedToolId=null: no governed Tool invocation was observed (NOT_VERIFIED).",
      "tokens=null: the bounded task-model route does not expose provider token usage.",
    ],
  };
};
