import type { CapabilityResolutionPath } from "@/harness/candidates-core/capability-resolution.js";

/**
 * #311 acceptance evidence contract (test-only).
 *
 * This module defines the machine-readable shape of the Progressive Resolution
 * acceptance matrix. It is deliberately separate from any production Planner /
 * Harness / Policy / Approval contract: it only describes how the acceptance
 * runner records what it observed.
 *
 * ## Evidence vocabulary (must not be collapsed)
 *
 * The first implementation of this matrix treated `toolCandidates[0]` as the
 * "selected" Tool. That is wrong: the resolver returns a *ranking*, and a
 * ranking is not a Planner selection, not schema disclosure, and not an
 * invocation. Every observation in this contract keeps the following layers
 * distinct:
 *
 * 1. `candidateToolRanking` — ranked candidate Tools returned by the resolver
 *    (`toolCandidates`). Ranking only. It orders disclosure; it grants nothing.
 * 2. `resolvedCapabilityId` — the capability the deterministic cascade actually
 *    selected. This is the real resolution decision, not a candidate.
 * 3. `schemaDisclosedToolIds` — concrete Tools whose full input schema was
 *    materialized through the production Capability View. These are the only
 *    Tools the Planner can actually call with arguments.
 * 4. `plannerCallableToolIds` — the production `toolExposure.exposedTools`, i.e.
 *    the schema-disclosed subset the Planner is offered this turn.
 * 5. `invokedToolId` — the Tool actually invoked through Normalize / Policy /
 *    Approval / Harness. This is only observable from a governed execution and
 *    stays `null` / `NOT_VERIFIED` when no execution was observed.
 *
 * The matrix is an explicit gold-oracle comparison. It is NOT the original
 * #243 / Control Room fixture corpus; see `AcceptanceComparison` and
 * `ProgressiveAcceptanceReport.corpus` for the honesty boundary.
 */

export type AcceptanceCategory =
  | "reachability"
  | "efficiency"
  | "authority"
  | "durability"
  | "skill";

export type AcceptanceCaseStatus = "passed" | "failed" | "skipped";

/**
 * How strong the evidence behind a case actually is. A `planner-projection`
 * case exercises the real `prepareContextNode` schema-disclosure seam; a
 * `resolved-capability` case only observes the deterministic cascade. No case
 * claims `governed-execution` unless a real Tool invocation was observed, which
 * this test-only matrix does not do.
 */
export type AcceptanceEvidenceLevel =
  | "candidate-ranking"
  | "resolved-capability"
  | "disclosure-state"
  | "skill-provider"
  | "planner-projection"
  | "governed-execution";

export interface AcceptanceAssertion {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface AcceptanceCaseMetrics {
  /** Semantic Resolver model calls actually spent by the production cascade. */
  readonly modelCalls: number | null;
  /** Always null here: this bounded route does not expose provider token usage. */
  readonly tokens: number | null;
  /** Whether the cascade reached its bounded semantic stage at all. */
  readonly semanticAttempted: boolean | null;
  /** Lexical/semantic Tool Search beyond exact/structural evidence. */
  readonly searchUsed: boolean | null;
  /** Count of observed authority violations (must stay 0). */
  readonly authorityViolations: number;
  /** Measured wall-clock latency of the whole case, or null when unmeasured. */
  readonly latencyMs: number | null;
  /** Measured wall-clock latency of the semantic Resolver call, when it ran. */
  readonly resolverLatencyMs: number | null;
}

export interface AcceptanceCaseResult {
  readonly caseId: string;
  readonly surface: string;
  readonly category: AcceptanceCategory;
  readonly evidenceLevel: AcceptanceEvidenceLevel;
  readonly query: string;
  readonly gold: Readonly<Record<string, unknown>>;
  readonly observed: Readonly<Record<string, unknown>>;
  readonly metrics: AcceptanceCaseMetrics;
  readonly assertions: readonly AcceptanceAssertion[];
  readonly status: AcceptanceCaseStatus;
  readonly diagnostics: readonly string[];
}

export interface AcceptanceComparison {
  readonly reference: {
    readonly issue: "243";
    readonly corpus: "control-room-16-case-poc";
    readonly source: string;
    readonly goldReachability: "13/13";
    readonly modelCalls: 86;
    readonly tokens: 209148;
    readonly caseCount: 16;
    readonly caseIds: readonly string[];
  };
  readonly directParity: "not_comparable";
  readonly reason: string;
}

export interface ProgressiveAcceptanceReport {
  readonly runner: "progressive-resolution-acceptance";
  readonly generatedAt: string;
  readonly mode: "deterministic" | "live";
  /**
   * Where the evidence was produced. The deterministic matrix drives the real
   * production resolution/disclosure functions directly; the live mode drives
   * the same corpus through the production semantic Resolver route.
   */
  readonly evidenceLevel: string;
  /** Which evidence layers this report actually contains vs. leaves unverified. */
  readonly evidenceScope: {
    readonly resolutionObserved: boolean;
    readonly plannerProjectionObserved: boolean;
    readonly governedExecutionObserved: false;
    readonly modelCallUsageObserved: boolean;
  };
  readonly corpus: {
    readonly fixtureSource: "311-matrix-analogous";
    readonly note: string;
  };
  readonly comparison: AcceptanceComparison;
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
  readonly cases: readonly AcceptanceCaseResult[];
}

export interface ResolutionCaseGold {
  readonly path: CapabilityResolutionPath;
  readonly selectedCapabilityId?: string;
  readonly selectedCapabilityIdIn?: readonly string[];
  /**
   * When set, this concrete Tool id must stay reachable at the resolution
   * layer. It is checked against the authority+readiness envelope and the
   * candidate ranking only, and is never reported as an actual Planner
   * selection. Concrete schema disclosure and Planner callability are only
   * asserted by the `planner-projection` cases.
   */
  readonly requiredToolId?: string;
}

export interface ResolutionCaseSpec {
  readonly caseId: string;
  readonly surface: string;
  readonly category: AcceptanceCategory;
  readonly query: string;
  readonly tools: readonly AcceptanceToolSpec[];
  readonly knownCapabilityId?: string;
  readonly gold: ResolutionCaseGold;
  /**
   * Deterministic expectation for the semantic Resolver calls this case must
   * spend. `0` proves the case never reached the semantic stage; `1` proves the
   * bounded single fallback was used.
   */
  readonly expectedSemanticResolverCalls: number;
}

export interface AcceptanceToolReadiness {
  readonly state: "ready" | "degraded" | "unavailable";
  readonly reason: string;
  readonly code?: string;
}

export interface AcceptanceToolSpec {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly domain?:
    | "read"
    | "edit"
    | "web_search"
    | "terminal"
    | "browser_action"
    | "external_mcp";
  readonly tags?: readonly string[];
  readonly readiness?: AcceptanceToolReadiness;
}

/**
 * A deterministic expectation for a case driven through the real production
 * `prepareContextNode` projection. The gold oracle names the capability that
 * must resolve and the concrete Tool that must end up Planner-callable.
 */
export interface ProjectionCaseGold {
  readonly path: CapabilityResolutionPath;
  readonly selectedCapabilityId: string;
  /** Concrete Tool that must reach schema disclosure and Planner exposure. */
  readonly plannerCallableToolId: string;
  readonly expectSemanticSearch: boolean;
}

export interface ProjectionCaseSpec {
  readonly caseId: string;
  readonly surface: string;
  readonly category: AcceptanceCategory;
  readonly query: string;
  readonly tools: readonly AcceptanceToolSpec[];
  readonly gold: ProjectionCaseGold;
}

export const REFERENCE_243: AcceptanceComparison = {
  reference: {
    issue: "243",
    corpus: "control-room-16-case-poc",
    source:
      "uichat-mira/control-room PR #74 branch agent/issue-73-run-38046892622 src/research/progressive-agent-eval.ts lines 303-433",
    goldReachability: "13/13",
    modelCalls: 86,
    tokens: 209148,
    caseCount: 16,
    caseIds: [
      "workspace-read",
      "workspace-edit",
      "github-pr",
      "notion-create",
      "beyond-first20-synthetic",
      "indirect-submit-review",
      "terminal-clear-domain",
      "noisy-large-catalog-search",
      "no-match",
      "wrong-domain-recovery",
      "unavailable-domain",
      "unauthorized-admin",
      "resolution-budget-exhaustion",
      "degraded-baseline",
      "skill-disclosure",
      "generic-child-delegation",
    ],
  },
  directParity: "not_comparable",
  reason:
    "The original #243 / Control Room 16-case gold corpus is not present in this repository, so the exact fixtures cannot be fetched or reused. The research gold refers to synthetic external MCP capabilities that are not registered in current Desktop dev; this matrix uses an explicit #311-matrix-analogous gold oracle and does not silently reconstruct the #243 fixtures or the original per-case model-call bookkeeping. Direct cost/reachability parity against 13/13 / 86 calls / 209,148 tokens is therefore NOT COMPARABLE.",
};
