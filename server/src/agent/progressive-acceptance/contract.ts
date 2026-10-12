import type { CapabilityResolutionPath } from "@/harness/candidates-core/capability-resolution.js";

/**
 * #311 acceptance evidence contract (test-only).
 *
 * This module defines the machine-readable shape of the Progressive Resolution
 * acceptance matrix. It is deliberately separate from any production Planner /
 * Harness / Policy / Approval contract: it only describes how the acceptance
 * runner records what it observed.
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

export interface AcceptanceAssertion {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface AcceptanceCaseMetrics {
  /** Semantic Resolver model calls actually spent by the production cascade. */
  readonly modelCalls: number | null;
  /** Whether the cascade reached its bounded semantic stage at all. */
  readonly semanticAttempted: boolean | null;
  /** Lexical/semantic Tool Search beyond exact/structural evidence. */
  readonly searchUsed: boolean | null;
  /** Count of observed authority violations (must stay 0). */
  readonly authorityViolations: number;
  /** Measured tokens, or null when the runtime route does not expose usage. */
  readonly tokens: number | null;
  /** Measured wall-clock latency, or null when unmeasured. */
  readonly latencyMs: number | null;
}

export interface AcceptanceCaseResult {
  readonly caseId: string;
  readonly surface: string;
  readonly category: AcceptanceCategory;
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
    readonly goldReachability: "13/13";
    readonly modelCalls: 86;
    readonly tokens: 209148;
    readonly caseCount: 16;
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
  /** When set, the resolved Tool id must be reachable in the Planner disclosure. */
  readonly selectedToolId?: string;
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

export const REFERENCE_243: AcceptanceComparison = {
  reference: {
    issue: "243",
    corpus: "control-room-16-case-poc",
    goldReachability: "13/13",
    modelCalls: 86,
    tokens: 209148,
    caseCount: 16,
  },
  directParity: "not_comparable",
  reason:
    "The original #243 / Control Room 16-case gold corpus and per-case model-call bookkeeping are not present in this repository, so the exact fixtures cannot be fetched or reused. This matrix is an explicit #311-matrix-analogous corpus with its own gold oracle; it does not silently reconstruct the #243 fixtures. Direct cost/reachability parity against 13/13 / 86 calls / 209,148 tokens is therefore NOT COMPARABLE.",
};
