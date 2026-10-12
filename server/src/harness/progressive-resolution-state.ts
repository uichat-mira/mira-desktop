import type { ToolDefinition } from "../mcp/core/definitions.js";
import type { CapabilityDisclosure } from "./capability-view.js";
import type { CapabilityResolutionPath } from "./candidates-core/capability-resolution.js";
import type { HarnessCapabilityProfile } from "./profiles/types.js";
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
  /**
   * Capability disclosure keyed by canonical Tool id. The resolver may report a
   * grouped capability-profile id, but callers expand it to its supporting Tool
   * ids before recording, so reconciliation and Planner schema disclosure stay
   * aligned with the per-Tool registry/readiness authority model.
   */
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

const recordCapabilityDisclosure = (
  state: ProgressiveResolutionState,
  input: {
    capabilityId: string;
    target: Exclude<CapabilityDisclosure, "hidden">;
    path?: CapabilityResolutionPath;
    detail?: string;
  },
): ProgressiveResolutionState => {
  let next = appendTrace(state, {
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
  return next;
};

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
    return { state: recordCapabilityDisclosure(state, input), applied: true };
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

  return { state: recordCapabilityDisclosure(expanded, input), applied: true };
};

/**
 * Maps a Progressive Resolution capability key back to the canonical Tool ids
 * that own its registry, authority and readiness.
 *
 * Progressive Resolution may resolve a grouped capability profile (for example
 * `workspace_lookup`, whose `supportingToolIds` are `glob`/`grep`/`list`/`read`)
 * while the authoritative registry, eligibility envelope and readiness gate are
 * all defined per concrete Tool id. Reusing the existing capability-profile
 * Profile -> supportingToolIds mapping keeps persisted disclosure aligned with
 * the Tool identity used by reconciliation, schema disclosure and Planner
 * exposure, instead of silently dropping a grouped snapshot on resume. A key
 * that is already a canonical Tool id (including one-to-one fallback profiles)
 * maps to itself.
 */
export const createCapabilityToolIdResolver = (
  profiles: readonly HarnessCapabilityProfile[],
): ((capabilityId: string) => readonly string[]) => {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return (capabilityId: string) => {
    const profile = profileById.get(capabilityId);
    return profile ? profile.supportingToolIds : [capabilityId];
  };
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
  /**
   * Maps a persisted capability key to its canonical Tool ids. Defaults to
   * treating the key itself as a Tool id. Pass `createCapabilityToolIdResolver`
   * when disclosure may be keyed by a grouped capability profile.
   */
  resolveToolIds?: (capabilityId: string) => readonly string[];
}

/**
 * Reconcile persisted visibility with the current authoritative registry and
 * readiness.
 *
 * A capability is dropped from persisted disclosure when every canonical Tool
 * it maps to was unregistered (revocation), fell outside the current
 * eligibility envelope (authority revocation), or is currently
 * runtime-unavailable (readiness loss). This runs on every restore so a stale
 * snapshot can never keep surfacing a capability that the live runtime no
 * longer permits, while a still-authoritative grouped capability keeps its
 * legitimate disclosure.
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
  const resolveToolIds =
    input.resolveToolIds ?? ((capabilityId: string) => [capabilityId]);

  const disclosure: Record<string, CapabilityDisclosure> = {};
  for (const [capabilityId, level] of Object.entries(input.state.disclosure)) {
    const toolIds = resolveToolIds(capabilityId);
    if (toolIds.length === 0) continue;

    const registeredToolIds = toolIds.filter((toolId) => definitions.has(toolId));
    if (registeredToolIds.length === 0) continue;

    const authorizedToolIds = eligible
      ? registeredToolIds.filter((toolId) => eligible.has(toolId))
      : registeredToolIds;
    if (authorizedToolIds.length === 0) continue;

    // Readiness loss wins over stale persisted visibility. The capability is
    // dropped only when none of its canonical Tools is currently ready; a
    // partially degraded group keeps the disclosure that is still authoritative.
    if (
      authorizedToolIds.every(
        (toolId) => readiness(toolId).state === "unavailable",
      )
    ) {
      continue;
    }

    disclosure[capabilityId] = level;
  }

  return {
    ...input.state,
    disclosure,
  };
};
