import assert from "node:assert/strict";
import {
  DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
  createProgressiveResolutionState,
  isProgressiveResolutionBudgetExhausted,
  readCapabilityDisclosure,
  reconcileProgressiveResolutionState,
  resolveAndDiscloseCapability,
} from "@/harness/progressive-resolution-state.js";
import {
  resolveCapabilityCascade,
  type CapabilityResolutionDocument,
  type SemanticCapabilityResolver,
} from "@/harness/candidates-core/capability-resolution.js";
import { resolveHarnessToolCandidatesForTurn } from "@/harness/candidates-core/resolver.js";
import { clearHarnessRegistry } from "@/harness/registry.js";
import {
  GENERIC_TASK_DELEGATE_TOOL_ID,
  createGenericTaskSkillContext,
  resolveGenericChildCapabilityView,
} from "@/agent/delegation/contract.js";
import {
  createMainAgentSkillVisibilityScope,
  createSkillChildSkillVisibilityScope,
  materializeResourceContent,
  projectResourceMetadata,
  projectSkillVisibilityView,
  promoteResourceContent,
  resourceDisclosureKey,
  type ResourceDisclosure,
} from "@/skills/context/disclosure.js";
import { SkillContextProvider } from "@/skills/context/provider.js";
import { SkillLoader } from "@/skills/context/loader.js";
import { SkillMatcher } from "@/skills/context/matcher.js";
import { SkillRegistry, type SkillScanner } from "@/skills/context/scanner.js";
import type {
  SkillManifest,
  SkillResource,
} from "@/skills/context/types.js";
import type {
  AcceptanceAssertion,
  AcceptanceCaseResult,
  AcceptanceCategory,
  ProgressiveAcceptanceReport,
  ResolutionCaseSpec,
} from "./contract.js";
import { REFERENCE_243 } from "./contract.js";
import {
  buildAcceptanceTool,
  installAcceptanceTools,
  noiseTools,
  workspaceLookupTools,
} from "./fixtures.js";

const ok = (
  name: string,
  condition: boolean,
  detail?: string,
): AcceptanceAssertion => ({
  name,
  ok: condition,
  ...(detail ? { detail } : {}),
});

const statusOf = (assertions: readonly AcceptanceAssertion[]): "passed" | "failed" =>
  assertions.every((assertion) => assertion.ok) ? "passed" : "failed";

const withAuthorityViolations = (
  assertions: AcceptanceAssertion[],
  authorityViolations: number,
): AcceptanceAssertion[] => [
  ...assertions,
  ok(
    "authority_violations_zero",
    authorityViolations === 0,
    `authorityViolations=${authorityViolations}`,
  ),
];

/* -------------------------------------------------------------------------- */
/* Resolution corpus (shared by the deterministic and live runners)           */
/* -------------------------------------------------------------------------- */

export const resolutionCaseSpecs: readonly ResolutionCaseSpec[] = [
  {
    caseId: "main-agent",
    surface: "main_agent",
    category: "reachability",
    query: "search the workspace files for a pattern",
    tools: [...workspaceLookupTools(), ...noiseTools(16)],
    gold: {
      path: "structural",
      selectedCapabilityId: "workspace_lookup",
      requiredToolId: "grep",
    },
    expectedSemanticResolverCalls: 0,
  },
  {
    caseId: "exact-known-tool",
    surface: "main_agent",
    category: "efficiency",
    query: "look this up for me",
    tools: [
      { id: "web_search", domain: "web_search", tags: ["web", "search"] },
      { id: "web_fetch", domain: "web_search", tags: ["web", "fetch"] },
      ...noiseTools(4),
    ],
    knownCapabilityId: "web_search",
    gold: {
      path: "exact",
      selectedCapabilityId: "web",
      requiredToolId: "web_search",
    },
    expectedSemanticResolverCalls: 0,
  },
  {
    caseId: "structural-domain",
    surface: "main_agent",
    category: "efficiency",
    query: "run a terminal command",
    tools: [
      { id: "terminal", domain: "terminal", tags: ["terminal", "command", "shell"] },
      ...noiseTools(20),
    ],
    gold: {
      path: "structural",
      selectedCapabilityId: "terminal_execution",
      requiredToolId: "terminal",
    },
    expectedSemanticResolverCalls: 0,
  },
  {
    caseId: "beyond-first20",
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
      requiredToolId: "late_lexical_target",
    },
    expectedSemanticResolverCalls: 0,
  },
  {
    caseId: "noisy-large-catalog",
    surface: "main_agent",
    category: "efficiency",
    query: "chronicle digest",
    tools: [
      ...noiseTools(30),
      {
        id: "chronicle_search",
        description: "Retrieves archived chronicle digests from the cached feed",
        domain: "web_search",
      },
    ],
    gold: {
      path: "lexical",
      selectedCapabilityId: "chronicle_search",
      requiredToolId: "chronicle_search",
    },
    expectedSemanticResolverCalls: 0,
  },
  {
    caseId: "no-match",
    surface: "main_agent",
    category: "efficiency",
    query: "zzzzqqqq",
    tools: [...workspaceLookupTools(), ...noiseTools(4)],
    gold: { path: "none" },
    expectedSemanticResolverCalls: 0,
  },
  {
    caseId: "ambiguous-semantic",
    surface: "main_agent",
    category: "reachability",
    query: "zephyrix ambiguous route",
    tools: [
      ...noiseTools(18),
      {
        id: "alpha_tool",
        description: "zephyrix ambiguous route handler",
        tags: ["routing"],
      },
      {
        id: "beta_tool",
        description: "zephyrix ambiguous route handler",
        tags: ["routing"],
      },
    ],
    gold: {
      path: "semantic",
      selectedCapabilityIdIn: ["alpha_tool", "beta_tool"],
    },
    expectedSemanticResolverCalls: 1,
  },
];

interface CountingResolver {
  readonly resolver: SemanticCapabilityResolver;
  calls: number;
}

const createCountingResolver = (
  selection: string | undefined,
): CountingResolver => {
  const counting: CountingResolver = {
    calls: 0,
    resolver: async () => {
      counting.calls += 1;
      return selection;
    },
  };
  return counting;
};

export const buildResolutionCaseResult = async (
  spec: ResolutionCaseSpec,
  resolver: SemanticCapabilityResolver | undefined,
  options: {
    live: boolean;
    tokens?: number | null;
    latencyMs?: number | null;
    resolverLatencyMs?: number | null;
  },
): Promise<AcceptanceCaseResult> => {
  clearHarnessRegistry();
  installAcceptanceTools(spec.tools);
  const startedAt = Date.now();
  let resolverMs = 0;
  let resolverCalls = 0;
  const countingResolver: SemanticCapabilityResolver = async (input) => {
    resolverCalls += 1;
    const callStartedAt = Date.now();
    try {
      return resolver ? await resolver(input) : undefined;
    } finally {
      resolverMs += Date.now() - callStartedAt;
    }
  };

  const result = await resolveHarnessToolCandidatesForTurn({
    query: spec.query,
    source: "agent_intent",
    ...(spec.knownCapabilityId
      ? { knownCapabilityId: spec.knownCapabilityId }
      : {}),
    semanticResolver: countingResolver,
  });
  const latencyMs = options.latencyMs ?? Date.now() - startedAt;
  const resolverLatencyMs =
    options.resolverLatencyMs ?? (resolverCalls > 0 ? resolverMs : null);

  const resolution = result.resolution;
  const resolvedCapabilityId = resolution?.selectedCapabilityId ?? null;
  const path = resolution?.path ?? "none";
  const modelCalls = resolution?.trace.modelCalls ?? 0;
  const searchUsed = path === "lexical" || path === "semantic";

  // A ranking is not a selection. Keep the ranked candidates separate from the
  // capability the cascade actually resolved and from any Planner exposure.
  const candidateToolRanking = result.toolCandidates.map(
    (candidate) => candidate.toolId,
  );
  const eligibleToolIds = result.eligibleToolIds;
  const plannerCallableToolIds = result.toolExposure.exposedToolIds;

  const selectionMatches =
    spec.gold.selectedCapabilityId !== undefined
      ? resolvedCapabilityId === spec.gold.selectedCapabilityId
      : spec.gold.selectedCapabilityIdIn !== undefined
        ? spec.gold.selectedCapabilityIdIn.includes(resolvedCapabilityId ?? "")
        : resolvedCapabilityId === null;

  const assertions: AcceptanceAssertion[] = [
    ok(
      "gold_resolution_path",
      path === spec.gold.path,
      `expected=${spec.gold.path} observed=${path}`,
    ),
    ok(
      "gold_resolved_capability",
      selectionMatches,
      `expected=${JSON.stringify(spec.gold.selectedCapabilityId ?? spec.gold.selectedCapabilityIdIn)} observed=${resolvedCapabilityId}`,
    ),
    ok(
      "bounded_semantic_calls",
      resolverCalls === spec.expectedSemanticResolverCalls &&
        modelCalls === spec.expectedSemanticResolverCalls,
      `expected=${spec.expectedSemanticResolverCalls} resolverCalls=${resolverCalls} traceModelCalls=${modelCalls}`,
    ),
  ];

  if (spec.gold.requiredToolId) {
    const toolId = spec.gold.requiredToolId;
    assertions.push(
      ok(
        "gold_tool_in_authority_envelope",
        eligibleToolIds.includes(toolId),
        `tool=${toolId} eligible=${eligibleToolIds.includes(toolId)}`,
      ),
      ok(
        "gold_tool_in_candidate_ranking",
        candidateToolRanking.includes(toolId),
        `tool=${toolId} rankingIndex=${candidateToolRanking.indexOf(toolId)} topCandidate=${candidateToolRanking[0] ?? "none"}`,
      ),
    );
  }

  // Authority invariant derived from observed data, not a constant: Planner
  // exposure can never exceed the runtime-ready authority envelope.
  const exposureOutsideEnvelope = plannerCallableToolIds.filter(
    (toolId) => !eligibleToolIds.includes(toolId),
  );
  assertions.push(
    ok(
      "planner_exposure_within_authority_envelope",
      exposureOutsideEnvelope.length === 0,
      `outside=${exposureOutsideEnvelope.join(",") || "none"}`,
    ),
  );
  const authorityViolations = exposureOutsideEnvelope.length;

  return {
    caseId: spec.caseId,
    surface: spec.surface,
    category: spec.category,
    evidenceLevel: "resolved-capability",
    query: spec.query,
    gold: { ...spec.gold },
    observed: {
      resolutionPath: path,
      resolvedCapabilityId,
      candidateToolRanking,
      schemaDisclosedToolIds: [],
      plannerCallableToolIds,
      invokedToolId: null,
      eligibleToolIds,
      semanticAttempted: resolution?.trace.semanticAttempted ?? false,
    },
    metrics: {
      modelCalls,
      semanticAttempted: resolution?.trace.semanticAttempted ?? false,
      searchUsed,
      authorityViolations,
      tokens: options.tokens ?? null,
      latencyMs,
      resolverLatencyMs,
    },
    assertions: withAuthorityViolations(assertions, authorityViolations),
    status: statusOf(withAuthorityViolations(assertions, authorityViolations)),
    diagnostics: [
      options.live
        ? "live resolver route: production semantic Resolver used for genuine ambiguity"
        : "deterministic route: injected resolver; no provider call",
      "schemaDisclosedToolIds is empty at this resolution layer: concrete schema disclosure is only observable through prepareContextNode (see projection cases).",
      "invokedToolId=null: no governed Tool invocation was observed (NOT_VERIFIED).",
    ],
  };
};

export const defaultDeterministicSelection = (
  spec: ResolutionCaseSpec,
): string | undefined => {
  if (spec.gold.selectedCapabilityId) return spec.gold.selectedCapabilityId;
  return spec.gold.selectedCapabilityIdIn?.[0];
};

/* -------------------------------------------------------------------------- */
/* Non-resolution cases                                                       */
/* -------------------------------------------------------------------------- */

const buildResult = (input: {
  caseId: string;
  surface: string;
  category: AcceptanceCategory;
  query: string;
  gold: Record<string, unknown>;
  observed: Record<string, unknown>;
  assertions: AcceptanceAssertion[];
  authorityViolations: number;
  evidenceLevel?: AcceptanceCaseResult["evidenceLevel"];
  diagnostics?: readonly string[];
  modelCalls?: number | null;
  semanticAttempted?: boolean | null;
  searchUsed?: boolean | null;
  tokens?: number | null;
  latencyMs?: number | null;
  resolverLatencyMs?: number | null;
}): AcceptanceCaseResult => {
  const assertions = withAuthorityViolations(
    input.assertions,
    input.authorityViolations,
  );
  return {
    caseId: input.caseId,
    surface: input.surface,
    category: input.category,
    evidenceLevel: input.evidenceLevel ?? "resolved-capability",
    query: input.query,
    gold: input.gold,
    observed: input.observed,
    metrics: {
      modelCalls: input.modelCalls ?? null,
      semanticAttempted: input.semanticAttempted ?? null,
      searchUsed: input.searchUsed ?? null,
      authorityViolations: input.authorityViolations,
      tokens: input.tokens ?? null,
      latencyMs: input.latencyMs ?? null,
      resolverLatencyMs: input.resolverLatencyMs ?? null,
    },
    assertions,
    status: statusOf(assertions),
    diagnostics: input.diagnostics ?? [],
  };
};

export const runGenericChildCase = (): AcceptanceCaseResult => {
  clearHarnessRegistry();
  installAcceptanceTools([
    { id: "read", domain: "read", tags: ["read", "workspace", "open"] },
    { id: "write", domain: "edit", tags: ["edit", "workspace", "write"] },
  ]);

  const resolution = resolveGenericChildCapabilityView({
    parentVisibleToolIds: ["read"],
    delegatedAuthorityToolIds: ["read", "write"],
  });
  const childContext = createGenericTaskSkillContext({
    task: { goal: "update the target file", acceptanceCriteria: ["file updated"] },
    parentVisibleToolIds: ["read"],
    delegatedAuthorityToolIds: ["read", "write"],
    capabilityResolution: resolution,
  });
  const allowedTools = childContext.primary?.execution?.allowedTools ?? [];

  const assertions = [
    ok(
      "parent_visible_excludes_write",
      resolution.parentVisibleToolIds.includes("write") === false,
    ),
    ok(
      "child_reaches_authorized_write_outside_parent_visible",
      resolution.discoverableToolIds.includes("write") &&
        resolution.allowedTools.includes("write"),
      `discoverable=${resolution.discoverableToolIds.join(",")} allowed=${resolution.allowedTools.join(",")}`,
    ),
    ok(
      "child_schema_only_for_parent_known_tool",
      resolution.disclosedToolIds.length === 1 &&
        resolution.disclosedToolIds[0] === "read",
      `disclosed=${resolution.disclosedToolIds.join(",")}`,
    ),
    ok(
      "child_context_carries_authorized_envelope",
      allowedTools.includes("read") &&
        allowedTools.includes("write") &&
        allowedTools.includes(GENERIC_TASK_DELEGATE_TOOL_ID) === false,
      `allowedTools=${allowedTools.join(",")}`,
    ),
    ok(
      "child_metadata_encodes_hidden_tool",
      (childContext.primary?.body ?? "").includes('"capabilityId":"write"'),
    ),
  ];

  return buildResult({
    caseId: "generic-child",
    surface: "generic_child",
    category: "reachability",
    query: "delegate one bounded workspace task",
    gold: {
      parentVisibleToolIds: ["read"],
      discoverableToolIds: ["read", "write"],
      disclosedToolIds: ["read"],
    },
    observed: {
      parentVisibleToolIds: resolution.parentVisibleToolIds,
      discoverableToolIds: resolution.discoverableToolIds,
      allowedTools: resolution.allowedTools,
      disclosedToolIds: resolution.disclosedToolIds,
      invokedToolId: null,
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "disclosure-state",
  });
};

export const runUnauthorizedCapabilityCase = (): AcceptanceCaseResult => {
  clearHarnessRegistry();
  installAcceptanceTools([
    { id: "read", domain: "read", tags: ["read", "workspace", "open"] },
    { id: "write", domain: "edit", tags: ["edit", "workspace", "write"] },
    { id: "terminal", domain: "terminal", tags: ["terminal", "command"] },
  ]);

  const resolution = resolveGenericChildCapabilityView({
    parentVisibleToolIds: ["read"],
    delegatedAuthorityToolIds: ["read"],
  });

  const outsideEnvelope = ["write", "terminal"];
  const leaked = outsideEnvelope.filter(
    (toolId) =>
      resolution.discoverableToolIds.includes(toolId) ||
      resolution.allowedTools.includes(toolId) ||
      resolution.disclosedToolIds.includes(toolId),
  );

  const assertions = [
    ok(
      "registered_and_ready_but_outside_envelope_not_discoverable",
      resolution.discoverableToolIds.includes("write") === false &&
        resolution.discoverableToolIds.includes("terminal") === false,
    ),
    ok(
      "unauthorized_capability_not_allowed_or_disclosed",
      leaked.length === 0,
      `leaked=${leaked.join(",")}`,
    ),
  ];

  return buildResult({
    caseId: "unauthorized-capability",
    surface: "generic_child",
    category: "authority",
    query: "attempt to use an out-of-scope capability",
    gold: { delegatedAuthorityToolIds: ["read"], forbiddenToolIds: outsideEnvelope },
    observed: {
      discoverableToolIds: resolution.discoverableToolIds,
      allowedTools: resolution.allowedTools,
      disclosedToolIds: resolution.disclosedToolIds,
      invokedToolId: null,
    },
    assertions,
    authorityViolations: leaked.length,
    evidenceLevel: "disclosure-state",
  });
};

export const runUnavailableToolCase = async (): Promise<AcceptanceCaseResult> => {
  clearHarnessRegistry();
  installAcceptanceTools([
    { id: "read", domain: "read", tags: ["read", "workspace", "open"] },
    ...noiseTools(4),
    {
      id: "terminal",
      domain: "terminal",
      tags: ["terminal", "command", "shell"],
      readiness: {
        state: "unavailable",
        reason: "Terminal runtime prerequisite is missing.",
        code: "test_runtime_unavailable",
      },
    },
  ]);

  const result = await resolveHarnessToolCandidatesForTurn({
    query: "run a terminal command",
    source: "agent_intent",
    semanticResolver: async () => {
      throw new Error("semantic resolver must not run for an unavailable Tool");
    },
  });

  const terminalEligible = result.eligibleToolIds.includes("terminal");
  const terminalExposed = result.toolExposure.exposedToolIds.includes("terminal");
  const selected = result.resolution?.selectedCapabilityId ?? null;

  const assertions = [
    ok(
      "unavailable_tool_not_in_authority_envelope",
      terminalEligible === false && terminalExposed === false,
      `eligible=${terminalEligible} exposed=${terminalExposed}`,
    ),
    ok(
      "unavailable_tool_not_selected",
      selected !== "terminal_execution",
      `selected=${selected}`,
    ),
  ];

  return buildResult({
    caseId: "unavailable-tool",
    surface: "main_agent",
    category: "authority",
    query: "run a terminal command",
    gold: { forbiddenToolId: "terminal", forbiddenCapabilityId: "terminal_execution" },
    observed: {
      eligibleToolIds: result.eligibleToolIds,
      plannerCallableToolIds: result.toolExposure.exposedToolIds,
      resolvedCapabilityId: selected,
      candidateToolRanking: result.toolCandidates.map((candidate) => candidate.toolId),
      invokedToolId: null,
    },
    assertions,
    authorityViolations: terminalEligible || terminalExposed ? 1 : 0,
    evidenceLevel: "disclosure-state",
    modelCalls: 0,
    semanticAttempted: false,
    searchUsed: false,
  });
};

export const runResolutionBudgetCase = (): AcceptanceCaseResult => {
  const limit = DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET;
  const disclosedCapabilities = Array.from(
    { length: limit },
    (_, index) => `capability_${index}`,
  );
  let state = createProgressiveResolutionState(limit);
  for (const capabilityId of disclosedCapabilities) {
    state = resolveAndDiscloseCapability(state, {
      capabilityId,
      target: "schema",
    }).state;
  }
  const refused = resolveAndDiscloseCapability(state, {
    capabilityId: "capability_overflow",
    target: "schema",
  });

  const assertions = [
    ok("default_budget_is_eight", limit === 8, `limit=${limit}`),
    ok(
      "budget_consumed_exactly",
      refused.state.budget.consumed === limit &&
        refused.state.budget.limit === limit,
      `limit=${refused.state.budget.limit} consumed=${refused.state.budget.consumed}`,
    ),
    ok("expansion_refused", refused.applied === false),
    ok(
      "exhaustion_is_transparent",
      refused.state.exhausted === true &&
        (refused.state.unresolvedCapabilityGap ?? "").includes(
          "capability_overflow",
        ),
      `gap=${refused.state.unresolvedCapabilityGap ?? "none"}`,
    ),
    ok(
      "already_disclosed_detail_preserved",
      disclosedCapabilities.every(
        (capabilityId) =>
          readCapabilityDisclosure(refused.state, capabilityId) === "schema",
      ) &&
        readCapabilityDisclosure(refused.state, "capability_overflow") ===
          "hidden",
    ),
    ok(
      "exhausted_is_not_task_completion",
      isProgressiveResolutionBudgetExhausted(refused.state) === true &&
        !("status" in refused.state) &&
        !("recoveryBudget" in refused.state),
      "resolution exhaustion carries no completion/status field",
    ),
    ok(
      "fresh_state_not_exhausted",
      isProgressiveResolutionBudgetExhausted(
        createProgressiveResolutionState(DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET),
      ) === false,
    ),
  ];

  return buildResult({
    caseId: "resolution-budget-exhaustion",
    surface: "main_agent",
    category: "durability",
    query: "exhaust the 8-step disclosure budget with a second capability",
    gold: { limit, refusedCapabilityId: "capability_overflow" },
    observed: {
      limit: refused.state.budget.limit,
      consumed: refused.state.budget.consumed,
      exhausted: refused.state.exhausted,
      disclosureCount: Object.keys(refused.state.disclosure).length,
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "disclosure-state",
  });
};

export const runApprovalResumeCase = (): AcceptanceCaseResult => {
  let state = createProgressiveResolutionState(DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET);
  state = resolveAndDiscloseCapability(state, {
    capabilityId: "glob",
    target: "schema",
  }).state;

  // Durable checkpoints round-trip through JSON structured cloning.
  const checkpoint = JSON.parse(JSON.stringify(state)) as typeof state;
  const replayed = resolveAndDiscloseCapability(checkpoint, {
    capabilityId: "glob",
    target: "schema",
  });
  const promoted = resolveAndDiscloseCapability(replayed.state, {
    capabilityId: "web_search",
    target: "schema",
  });

  const assertions = [
    ok(
      "resume_does_not_recharge",
      replayed.state.budget.consumed === 1,
      `consumed=${replayed.state.budget.consumed}`,
    ),
    ok(
      "resume_preserves_disclosure",
      readCapabilityDisclosure(replayed.state, "glob") === "schema",
    ),
    ok(
      "resume_can_promote_new_capability",
      promoted.state.budget.consumed === 2 &&
        readCapabilityDisclosure(promoted.state, "web_search") === "schema",
      `consumed=${promoted.state.budget.consumed}`,
    ),
  ];

  return buildResult({
    caseId: "approval-resume",
    surface: "main_agent",
    category: "durability",
    query: "resume after a durable checkpoint and reconcile disclosure",
    gold: { initialConsumed: 1, postResumeConsumed: 2 },
    observed: {
      checkpointConsumed: checkpoint.budget.consumed,
      replayedConsumed: replayed.state.budget.consumed,
      promotedConsumed: promoted.state.budget.consumed,
      disclosure: { ...promoted.state.disclosure },
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "disclosure-state",
  });
};

export const runReadinessRevocationCase = (): AcceptanceCaseResult => {
  let state = createProgressiveResolutionState(DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET);
  for (const capabilityId of ["glob", "read", "web_search"]) {
    state = resolveAndDiscloseCapability(state, {
      capabilityId,
      target: "schema",
    }).state;
  }
  const budgetBefore = state.budget.consumed;

  const definitions = [
    buildAcceptanceTool({ id: "glob" }).definition,
    buildAcceptanceTool({ id: "read" }).definition,
  ];

  const reconciled = reconcileProgressiveResolutionState({
    state,
    definitions,
    eligibleCapabilityIds: ["glob", "read"],
    readiness: (capabilityId) =>
      capabilityId === "read"
        ? {
            state: "unavailable",
            reason: "Runtime prerequisite missing after checkpoint.",
            code: "test_runtime_unavailable",
          }
        : { state: "ready", reason: "ready" },
  });

  const assertions = [
    ok(
      "revoked_capability_dropped",
      readCapabilityDisclosure(reconciled, "web_search") === "hidden",
    ),
    ok(
      "readiness_loss_dropped",
      readCapabilityDisclosure(reconciled, "read") === "hidden",
    ),
    ok(
      "ready_authorized_capability_preserved",
      readCapabilityDisclosure(reconciled, "glob") === "schema",
    ),
    ok(
      "reconcile_preserves_prior_spend",
      reconciled.budget.consumed === budgetBefore,
      `before=${budgetBefore} after=${reconciled.budget.consumed}`,
    ),
  ];

  return buildResult({
    caseId: "readiness-revocation-after-checkpoint",
    surface: "main_agent",
    category: "durability",
    query: "resume after registry revocation and readiness loss",
    gold: { revoked: "web_search", readinessLost: "read", preserved: "glob" },
    observed: {
      disclosure: { ...reconciled.disclosure },
      budgetBefore,
      budgetAfter: reconciled.budget.consumed,
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "disclosure-state",
  });
};

export const runWrongDomainRecoveryCase = async (): Promise<AcceptanceCaseResult> => {
  // The domain hint comes from a structural match while the correct capability
  // only surfaces from the semantic stage. Documents are supplied directly so
  // the cross-domain ambiguity is reproducible through the production cascade.
  const capabilities: CapabilityResolutionDocument[] = [
    {
      capabilityId: "terminal_execution",
      title: "Terminal Execution",
      description: "Run local terminal commands.",
      domain: "terminal",
      tags: ["terminal"],
      toolIds: ["terminal"],
      aliases: ["terminal"],
    },
    {
      capabilityId: "mail_reading",
      title: "Mail Reading",
      description: "zephyrix mailbox reader",
      domain: "read",
      tags: ["inbox"],
      toolIds: ["mail_query"],
      aliases: ["mail_query"],
    },
  ];

  const resolver = createCountingResolver("mail_reading");
  const result = await resolveCapabilityCascade({
    query: "zephyrix terminal alpha beta",
    capabilities,
    semanticResolver: resolver.resolver,
    // Force the deterministic lexical stage to stay non-confident so the
    // bounded semantic stage is the only way to recover the cross-domain match.
    minLexicalScore: 999,
  });

  const assertions = [
    ok("recovered_via_semantic_stage", result.path === "semantic", `path=${result.path}`),
    ok(
      "recovered_cross_domain",
      result.trace.wrongDomainRecovered === true &&
        result.trace.domainHint === "terminal" &&
        result.trace.selectedDomain === "read",
      `domainHint=${result.trace.domainHint} selectedDomain=${result.trace.selectedDomain}`,
    ),
    ok(
      "single_bounded_call",
      resolver.calls === 1 && result.trace.modelCalls === 1,
      `resolverCalls=${resolver.calls} traceModelCalls=${result.trace.modelCalls}`,
    ),
    ok(
      "selected_authorized_capability",
      result.selectedCapabilityId === "mail_reading",
      `selected=${result.selectedCapabilityId}`,
    ),
  ];

  return buildResult({
    caseId: "wrong-domain-recovery",
    surface: "main_agent",
    category: "reachability",
    query: "zephyrix terminal alpha beta",
    gold: {
      domainHint: "terminal",
      selectedDomain: "read",
      selectedCapabilityId: "mail_reading",
    },
    observed: {
      resolutionPath: result.path,
      resolvedCapabilityId: result.selectedCapabilityId,
      candidateToolRanking: result.candidates.map((candidate) => candidate.capabilityId),
      schemaDisclosedToolIds: [],
      plannerCallableToolIds: [],
      invokedToolId: null,
      domainHint: result.trace.domainHint,
      selectedDomain: result.trace.selectedDomain,
      wrongDomainRecovered: result.trace.wrongDomainRecovered,
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "resolved-capability",
    modelCalls: result.trace.modelCalls,
    semanticAttempted: result.trace.semanticAttempted,
    searchUsed: true,
  });
};

export const runSkillChildScopeCase = (): AcceptanceCaseResult => {
  const skills = [
    {
      id: "xlsx",
      name: "Excel models",
      description: "Spreadsheet and DCF financial modelling",
      version: "1.0.0",
    },
    {
      id: "docx",
      name: "Word documents",
      description: "Draft and review Word documents",
      version: "1.0.0",
    },
  ];

  const mainView = projectSkillVisibilityView({
    scope: createMainAgentSkillVisibilityScope({ scopeId: "main_agent" }),
    skills,
  });
  const childView = projectSkillVisibilityView({
    scope: createSkillChildSkillVisibilityScope({
      scopeId: "skill_child:xlsx",
      discoverableSkillIds: ["xlsx"],
    }),
    skills,
  });

  const mainDocx = mainView.skills.get("docx");
  const childDocx = childView.skills.get("docx");
  const childXlsx = childView.skills.get("xlsx");

  const assertions = [
    ok(
      "main_scope_discovers_both_skills",
      mainView.skills.size === 2 && mainDocx?.discoverable === true,
    ),
    ok(
      "child_scope_is_independent_narrowing",
      childView.scopeKind === "skill_child" &&
        childXlsx?.discoverable === true &&
        childDocx?.discoverable === false,
      `childScope=${childView.scopeKind} xlsx=${childXlsx?.discoverable} docx=${childDocx?.discoverable}`,
    ),
    ok(
      "child_scope_does_not_match_parent_view",
      childDocx?.disclosure === "hidden",
    ),
  ];

  return buildResult({
    caseId: "skill-child-scope",
    surface: "skill_child",
    category: "reachability",
    query: "fork a Skill Child scoped to a single Skill",
    gold: { mainDiscoverable: ["xlsx", "docx"], childDiscoverable: ["xlsx"] },
    observed: {
      mainDiscoverable: [...mainView.skills.values()]
        .filter((entry) => entry.discoverable)
        .map((entry) => entry.skillId),
      childDiscoverable: [...childView.skills.values()]
        .filter((entry) => entry.discoverable)
        .map((entry) => entry.skillId),
      invokedToolId: null,
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "skill-provider",
  });
};

/* -------------------------------------------------------------------------- */
/* Skill / Resource disclosure cases (production provider + disclosure)       */
/* -------------------------------------------------------------------------- */

const skillManifests: readonly SkillManifest[] = [
  {
    id: "xlsx",
    name: "Excel models",
    description: "Spreadsheet and DCF financial modelling",
    version: "1.0.0",
    entry: "/unused/xlsx/SKILL.md",
  },
  {
    id: "docx",
    name: "Word documents",
    description: "Draft and review Word documents",
    version: "1.0.0",
    entry: "/unused/docx/SKILL.md",
  },
];

const createSkillProviderHarness = () => {
  const state = { loadContentCalls: 0 };
  const loader = {
    listResources: async () => [],
    loadContent: async (manifest: SkillManifest) => {
      state.loadContentCalls += 1;
      return { manifest, body: `# ${manifest.id} private Skill body` };
    },
  };
  const scanner = {
    scan: async () => [...skillManifests],
  } as unknown as SkillScanner;
  const provider = new SkillContextProvider(
    new SkillRegistry(scanner),
    new SkillMatcher(),
    loader as unknown as SkillLoader,
  );
  return { provider, state };
};

export const runSkillSummaryBodyCase = async (): Promise<AcceptanceCaseResult> => {
  const { provider, state } = createSkillProviderHarness();

  const discover = await provider.prepare({
    query: "help me understand this problem",
    messages: [{ role: "user", content: "help me understand this problem" }],
  });
  const summaries = (discover?.skillVisibility?.skills ?? []).map((entry) => ({
    skillId: entry.skillId,
    disclosure: entry.disclosure,
  }));
  const discoverCalls = state.loadContentCalls;

  const matched = await provider.prepare({
    query: "做一个 DCF Excel 模型",
    messages: [{ role: "user", content: "做一个 DCF Excel 模型" }],
  });
  const xlsx = matched?.skillVisibility?.skills.find(
    (entry) => entry.skillId === "xlsx",
  );
  const docx = matched?.skillVisibility?.skills.find(
    (entry) => entry.skillId === "docx",
  );

  const assertions = [
    ok(
      "summary_stage_discoverable_without_body",
      summaries.length === 2 &&
        summaries.every((entry) => entry.disclosure === "summary") &&
        discover?.primary === undefined &&
        discoverCalls === 0,
      `summaries=${JSON.stringify(summaries)} discoverBodyCalls=${discoverCalls}`,
    ),
    ok(
      "matched_skill_promoted_to_body",
      matched?.primary?.id === "xlsx" && xlsx?.disclosure === "body" && docx?.disclosure === "summary",
      `primary=${matched?.primary?.id} xlsx=${xlsx?.disclosure} docx=${docx?.disclosure}`,
    ),
    ok(
      "unrelated_body_not_loaded",
      state.loadContentCalls === 1,
      `loadContentCalls=${state.loadContentCalls}`,
    ),
  ];

  return buildResult({
    caseId: "skill-summary-body",
    surface: "main_agent",
    category: "skill",
    query: "discover a Skill summary, then promote the matched body",
    gold: {
      discoverDisclosure: "summary",
      matchedSkillId: "xlsx",
      matchedDisclosure: "body",
    },
    observed: {
      discoverSummaries: summaries,
      matchedSkillId: matched?.primary?.id ?? null,
      xlsxDisclosure: xlsx?.disclosure ?? null,
      docxDisclosure: docx?.disclosure ?? null,
      loadContentCalls: state.loadContentCalls,
      invokedToolId: null,
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "skill-provider",
    diagnostics: ["production SkillContextProvider / registry / matcher path"],
  });
};

export const runResourceMetadataContentCase = (): AcceptanceCaseResult => {
  const uri = "skill://xlsx/reference/DCF_SKILL.md";
  const resources: SkillResource[] = [
    {
      uri,
      skillId: "xlsx",
      name: "DCF",
      kind: "reference",
      description: "Discounted cash flow reference",
    },
  ];

  const view = projectSkillVisibilityView({
    scope: createMainAgentSkillVisibilityScope({ scopeId: "main_agent" }),
    skills: [
      {
        id: "xlsx",
        name: "Excel models",
        description: "Spreadsheet and DCF financial modelling",
        version: "1.0.0",
        resources,
      },
    ],
    requestedResourceDisclosure: new Map<string, ResourceDisclosure>([
      [resourceDisclosureKey("xlsx", uri), "metadata"],
    ]),
  });

  const metadata = projectResourceMetadata(view, "xlsx");
  const beforeContent = materializeResourceContent(view, "xlsx", uri, [
    { ...resources[0]!, content: "DCF rules" },
  ]);
  const promoted = promoteResourceContent({
    view,
    skillId: "xlsx",
    uri,
    resources: [{ ...resources[0]!, content: "DCF rules" }],
  });
  const afterContent = materializeResourceContent(promoted.view, "xlsx", uri, [
    { ...resources[0]!, content: "DCF rules" },
  ]);

  const assertions = [
    ok(
      "metadata_stage_discloses_uri_without_content",
      metadata.length === 1 &&
        metadata[0]?.disclosure === "metadata" &&
        beforeContent === undefined,
      `metadata=${JSON.stringify(metadata)} beforeContent=${beforeContent ? "leaked" : "undefined"}`,
    ),
    ok(
      "content_promotion_materializes_content",
      promoted.transition.contentMaterialized === true &&
        promoted.content?.content === "DCF rules" &&
        afterContent?.content === "DCF rules",
      `transition=${promoted.transition.reason}`,
    ),
    ok(
      "content_only_at_content_stage",
      afterContent !== undefined && afterContent.disclosure === "content",
    ),
  ];

  return buildResult({
    caseId: "resource-metadata-content",
    surface: "main_agent",
    category: "skill",
    query: "disclose Resource metadata, then promote its content",
    gold: {
      metadataDisclosure: "metadata",
      contentDisclosure: "content",
      content: "DCF rules",
    },
    observed: {
      metadata: metadata.map((entry) => ({
        uri: entry.uri,
        disclosure: entry.disclosure,
      })),
      promotedFrom: promoted.transition.from,
      promotedTo: promoted.transition.to,
      contentMaterialized: promoted.transition.contentMaterialized,
      invokedToolId: null,
    },
    assertions,
    authorityViolations: 0,
    evidenceLevel: "skill-provider",
  });
};

/* -------------------------------------------------------------------------- */
/* Matrix                                                                     */
/* -------------------------------------------------------------------------- */

export const runProgressiveAcceptanceMatrix = async (): Promise<ProgressiveAcceptanceReport> => {
  const cases: AcceptanceCaseResult[] = [];

  for (const spec of resolutionCaseSpecs) {
    const selection =
      spec.expectedSemanticResolverCalls > 0
        ? defaultDeterministicSelection(spec)
        : undefined;
    const resolver: SemanticCapabilityResolver | undefined =
      spec.expectedSemanticResolverCalls > 0
        ? createCountingResolver(selection).resolver
        : undefined;
    cases.push(
      await buildResolutionCaseResult(spec, resolver, { live: false }),
    );
  }

  cases.push(runGenericChildCase());
  cases.push(runUnauthorizedCapabilityCase());
  cases.push(await runUnavailableToolCase());
  cases.push(runResolutionBudgetCase());
  cases.push(runApprovalResumeCase());
  cases.push(runReadinessRevocationCase());
  cases.push(await runWrongDomainRecoveryCase());
  cases.push(runSkillChildScopeCase());
  cases.push(await runSkillSummaryBodyCase());
  cases.push(runResourceMetadataContentCase());

  clearHarnessRegistry();

  const passed = cases.filter((item) => item.status === "passed").length;
  const failed = cases.filter((item) => item.status === "failed").length;
  const skipped = cases.filter((item) => item.status === "skipped").length;

  const evidenceLevels = [...new Set(cases.map((item) => item.evidenceLevel))];

  return {
    runner: "progressive-resolution-acceptance",
    generatedAt: new Date().toISOString(),
    mode: "deterministic",
    evidenceLevel:
      `production resolution/disclosure/Skill-provider functions driven directly; evidence levels present: ${evidenceLevels.join(", ")}; not full Main/Child/Skill graph execution`,
    evidenceScope: {
      resolutionObserved: true,
      // Projection cases are driven by the vitest harness in cases.test.ts,
      // where listToolDefinitions / matchToolCandidatesByEmbedding can be
      // stubbed in-process. This plain deterministic CLI cannot construct that
      // seam, so it reports resolution-level evidence only.
      plannerProjectionObserved: false,
      governedExecutionObserved: false,
      modelCallUsageObserved: false,
    },
    corpus: {
      fixtureSource: "311-matrix-analogous",
      note:
        "Analogous #311-matrix fixtures with an explicit per-case gold oracle. The original #243 / Control Room corpus and the 16 gold ids are recorded in comparison.reference but are not present in this repository and were not reconstructed.",
    },
    comparison: REFERENCE_243,
    summary: { total: cases.length, passed, failed, skipped },
    cases,
  };
};

export const assertMatrixShape = (report: ProgressiveAcceptanceReport): void => {
  // The #311 matrix has 16 required surfaces; the explicit ambiguous-semantic
  // fallback case is the 17th required case from the maintainer follow-up.
  assert.equal(report.cases.length, 17);
};
