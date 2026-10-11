import type { ToolDefinition } from "../mcp/core/definitions.js";
import type { CapabilityDisclosure } from "./capability-view.js";
import type { CapabilityResolutionPath } from "./candidates-core/capability-resolution.js";
import {
  resolveToolRuntimeReadiness,
  type HarnessToolRuntimeReadiness,
} from "./runtime-readiness.js";

/**
 * Durable Progressive Resolution state for one Agent run.
 *
 * Progressive Resolution is the deterministic-first capability cascade that
 * decides which capability detail becomes visible to the model when the
 * eligible surface is larger than the Planner disclosure budget. This module
 * makes its effects durable across ordinary continuation and approval/resume
 * without introducing a new persistence framework or a new authority model.
 *
 * The state intentionally keeps three concerns separate:
 *
 *   budget     = how many capability detail expansions this run may still spend
 *   disclosure = the capability detail already surfaced to the model
 *   trace      = a compact, inspectable record of resolution/disclosure steps
 *
 * Invariants:
 *
 * - Only expanding *new* capability detail (hidden -> metadata, or
 *   metadata -> schema, or hidden -> schema) consumes the resolution budget.
 *   Re-recording an already-disclosed level is idempotent and free.
 * - The budget never grants authority and never marks a task complete. Execution
 *   authority stays in Harness Policy / Approval; readiness stays in Harness
 *   runtime-readiness.
 * - Budget exhaustion is bounded and transparent: already-disclosed capability
 *   detail stays usable, and a newly requested expansion is refused with an
 *   explicit unresolved-capability gap instead of a silent fallback.
 * - Disclosure state is reconciled against the current authoritative registry
 *   and readiness before it is reused, so a revocation or readiness loss after a
 *   checkpoint always wins over stale persisted visibility.
 * - Failure/no-progress recovery is owned by the existing Planner recovery
 *   budget and is deliberately not represented here.
 */

export const DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET = 8;

/**
 * Trace stages. They distinguish "the resolver searched", "a capability was
 * resolved/selected", and the two disclosure stages so metadata disclosure is
 * never confused with full-schema disclosure.
 */
export type ProgressiveResolutionTraceStage =
  | "searched"
  | "resolved"
  | "disclosed_metadata"
  | "disclosed_schema"
  | "selected";

export interface ProgressiveResolutionTraceEvent {
  readonly stage: ProgressiveResolutionTraceStage;
  readonly capabilityId?: string;
  readonly path?: CapabilityResolutionPath;
  readonly modelCalls?: number;
  readonly detail?: string;
}

export interface ProgressiveResolutionBudgetUsage {
  readonly limit: number;
  readonly consumed: number;
}

export interface ProgressiveResolutionState {
  readonly budget: ProgressiveResolutionBudgetUsage;
  readonly disclosure: Readonly<Record<string, CapabilityDisclosure>>;
  readonly trace: readonly ProgressiveResolutionTraceEvent[];
  readonly exhausted: boolean;
  /**
   * Set when an expansion was refused because the budget was exhausted. It is
   * surfaced transparently so the caller can report an unresolved capability gap
   * instead of pretending the capability is unavailable by policy.
   */
  readonly unresolvedCapabilityGap?: string;
}

const DISCLOSURE_RANK: Record<CapabilityDisclosure, number> = {
  hidden: 0,
  metadata: 1,
  schema: 2,
};

export interface ExpandCapabilityDetailResult {
  readonly state: ProgressiveResolutionState;
  readonly applied: boolean;
}

const normalizeLimit = (limit: number): number => {
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.floor(limit));
};

export const createProgressiveResolutionState = (
  limit: number = DEFAULT_PROGRESSIVE_RESOLUTION_BUDGET,
): ProgressiveResolutionState => ({
  budget: { limit: normalizeLimit(limit), consumed: 0 },
  disclosure: {},
  trace: [],
  exhausted: false,
});

export const remainingProgressiveResolutionBudget = (
  state: ProgressiveResolutionState,
): number => Math.max(0, state.budget.limit - state.budget.consumed);

export const isProgressiveResolutionBudgetExhausted = (
  state: ProgressiveResolutionState,
): boolean =>
  state.exhausted || remainingProgressiveResolutionBudget(state) <= 0;

const appendTrace = (
  state: ProgressiveResolutionState,
  event: ProgressiveResolutionTraceEvent,
): ProgressiveResolutionState => ({
  ...state,
  trace: [...state.trace, event],
});

/**
 * Records that the deterministic-first resolver searched. Searching itself is
 * context-only and does not consume the resolution budget.
 */
export const recordProgressiveResolutionSearch = (
  state: ProgressiveResolutionState,
  input: {
    path: CapabilityResolutionPath;
    modelCalls?: number;
    detail?: string;
  },
): ProgressiveResolutionState =>
  appendTrace(state, {
    stage: "searched",
    path: input.path,
    ...(input.modelCalls !== undefined ? { modelCalls: input.modelCalls } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  });

/**
 * Records that one capability was selected by the resolver. Selection is a
 * resolution decision, not an authority grant, and does not consume the budget;
 * the disclosure expansion it may lead to does.
 */
export const recordProgressiveResolutionSelection = (
  state: ProgressiveResolutionState,
  input: {
    capabilityId: string;
    path?: CapabilityResolutionPath;
    detail?: string;
  },
): ProgressiveResolutionState =>
  appendTrace(state, {
    stage: "selected",
    capabilityId: input.capabilityId,
    ...(input.path ? { path: input.path } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  });

export const readCapabilityDisclosure = (
  state: ProgressiveResolutionState,
  capabilityId: string,
): CapabilityDisclosure => state.disclosure[capabilityId] ?? "hidden";

/**
 * Expands one capability's disclosure to `target` if the budget permits.
 *
 * - If the capability already sits at or above `target`, this is idempotent and
 *   free (ordinary continuation and approval/resume must not re-consume).
 * - Otherwise it spends exactly one budget step and records resolved plus the
 *   matching disclosure trace stage.
 * - When the budget is exhausted it refuses the expansion, keeps every already
 *   disclosed capability, and records the unresolved capability gap.
 */
export const resolveAndDiscloseCapability = (
  state: ProgressiveResolutionState,
  input: {
    capabilityId: string;
    target: Exclude<CapabilityDisclosure, "hidden">;
    path?: CapabilityResolutionPath;
    detail?: string;
  },
): ExpandCapabilityDetailResult => {
  const current = readCapabilityDisclosure(state, input.capabilityId);
  if (DISCLOSURE_RANK[input.target] <= DISCLOSURE_RANK[current]) {
    const recorded = appendTrace(state, {
      stage: "resolved",
      capabilityId: input.capabilityId,
      ...(input.path ? { path: input.path } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    });
    return { state: recorded, applied: true };
  }

  if (remainingProgressiveResolutionBudget(state) <= 0) {
    return {
      state: {
        ...state,
        exhausted: true,
        unresolvedCapabilityGap:
          state.unresolvedCapabilityGap ??
          `Progressive resolution budget of ${state.budget.limit} steps is exhausted; capability "${input.capabilityId}" remains undisclosed.`,
      },
      applied: false,
    };
  }

  const expanded: ProgressiveResolutionState = {
    ...state,
    budget: {
      ...state.budget,
      consumed: state.budget.consumed + 1,
    },
    disclosure: {
      ...state.disclosure,
      [input.capabilityId]: input.target,
    },
  };

  let next = appendTrace(expanded, {
    stage: "resolved",
    capabilityId: input.capabilityId,
    ...(input.path ? { path: input.path } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  });
  next = appendTrace(next, {
    stage:
      input.target === "schema" ? "disclosed_schema" : "disclosed_metadata",
    capabilityId: input.capabilityId,
    ...(input.path ? { path: input.path } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  });

  return { state: next, applied: true };
};

export interface ReconcileProgressiveResolutionInput {
  state: ProgressiveResolutionState;
  /** Current authoritative registry definitions. */
  definitions: readonly ToolDefinition[];
  /**
   * Optional authoritative eligibility envelope. A capability outside it has
   * lost authority and must not keep a stale persisted visibility.
   */
  eligibleCapabilityIds?: readonly string[];
  readiness?: (capabilityId: string) => HarnessToolRuntimeReadiness;
}

/**
 * Reconcile persisted visibility with the current authoritative registry and
 * readiness.
 *
 * A capability is dropped from persisted disclosure when it was unregistered
 * (revocation), fell outside the current eligibility envelope (authority
 * revocation), or is currently runtime-unavailable (readiness loss). This runs
 * on every restore so a stale snapshot can never keep surfacing a capability
 * that the live runtime no longer permits.
 *
 * The budget usage is deliberately preserved: reconciliation is not a fresh
 * resolution pass and must not hand a resumed run a new budget.
 */
export const reconcileProgressiveResolutionState = (
  input: ReconcileProgressiveResolutionInput,
): ProgressiveResolutionState => {
  const definitions = new Set(input.definitions.map((definition) => definition.id));
  const eligible = input.eligibleCapabilityIds
    ? new Set(input.eligibleCapabilityIds)
    : undefined;
  const readiness =
    input.readiness ??
    ((capabilityId: string) => resolveToolRuntimeReadiness(capabilityId));

  const disclosure: Record<string, CapabilityDisclosure> = {};
  for (const [capabilityId, level] of Object.entries(input.state.disclosure)) {
    if (!definitions.has(capabilityId)) continue;
    if (eligible && !eligible.has(capabilityId)) continue;
    if (readiness(capabilityId).state === "unavailable") continue;
    disclosure[capabilityId] = level;
  }

  return {
    ...input.state,
    disclosure,
  };
};
