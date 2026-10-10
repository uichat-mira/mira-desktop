import type { ToolDefinition } from "../mcp/core/definitions.js";
import {
  resolveToolRuntimeReadiness,
  type HarnessToolRuntimeReadiness,
} from "./runtime-readiness.js";

/**
 * A per-Agent scoped Capability View.
 *
 * This is a visibility projection over the Harness capability registry, not a
 * readiness subsystem and not an authority grant. Readiness/eligibility comes
 * exclusively from the existing Harness runtime-readiness contract, so a
 * Capability View can narrow what one Agent scope currently sees but can never
 * register a Tool, make an unavailable Tool ready, or authorize execution.
 *
 * The representation deliberately keeps these states independent:
 *
 *   registered != ready/eligible != discoverable != disclosed
 *
 * Execution authority continues to live in Harness Policy / Approval and is
 * never derivable from this view.
 */
export type AgentCapabilityScopeKind =
  | "main_agent"
  | "generic_child"
  | "skill_child";

/**
 * Disclosure levels. "metadata" is disclosed_metadata and "schema" is
 * disclosed_schema; both remain independent of discoverability, eligibility,
 * readiness and execution authority.
 */
export type CapabilityDisclosure = "hidden" | "metadata" | "schema";

export interface AgentCapabilityScope {
  scopeId: string;
  kind: AgentCapabilityScopeKind;
  /**
   * Optional authority/eligibility envelope for this scope. It narrows the
   * Harness runtime-readiness gate; it never widens it. When omitted, every
   * registered capability is eligible subject to Harness readiness.
   */
  eligibleCapabilityIds?: readonly string[];
  /**
   * Optional discoverability envelope. It limits which eligible capabilities
   * this scope may surface at all. This is intentionally independent of any
   * Parent's currently visible Tool IDs so a Child ceiling can be represented
   * without equalling the Parent snapshot.
   */
  discoverableCapabilityIds?: readonly string[];
  /** Highest disclosure this scope may reach. Defaults to "schema". */
  maxDisclosure?: CapabilityDisclosure;
}

export interface CapabilityViewEntry {
  capabilityId: string;
  readiness: HarnessToolRuntimeReadiness;
  eligible: boolean;
  discoverable: boolean;
  disclosure: CapabilityDisclosure;
}

export interface AgentCapabilityView {
  scopeId: string;
  scopeKind: AgentCapabilityScopeKind;
  capabilities: Map<string, CapabilityViewEntry>;
}

export interface CreateAgentCapabilityScopeInput {
  scopeId: string;
  eligibleCapabilityIds?: readonly string[];
  discoverableCapabilityIds?: readonly string[];
  maxDisclosure?: CapabilityDisclosure;
}

export interface ProjectAgentCapabilityViewInput {
  scope: AgentCapabilityScope;
  definitions: readonly ToolDefinition[];
  /**
   * Requested initial disclosure per capability. It is clamped by readiness,
   * discoverability and the scope ceiling, so it cannot disclose a capability
   * that Harness readiness or the scope envelope keeps hidden.
   */
  requestedDisclosure?: ReadonlyMap<string, CapabilityDisclosure>;
  /**
   * Requested discoverability per capability. It can suppress an otherwise
   * discoverable capability but cannot override Harness readiness.
   */
  requestedDiscoverable?: ReadonlyMap<string, boolean>;
}

export interface AgentCapabilityViewTraceEntry {
  capabilityId: string;
  readiness: HarnessToolRuntimeReadiness["state"];
  eligible: boolean;
  discoverable: boolean;
  disclosure: CapabilityDisclosure;
}

export interface AgentCapabilityViewTrace {
  scopeId: string;
  scopeKind: AgentCapabilityScopeKind;
  capabilityCount: number;
  entries: AgentCapabilityViewTraceEntry[];
}

const DISCLOSURE_RANK: Record<CapabilityDisclosure, number> = {
  hidden: 0,
  metadata: 1,
  schema: 2,
};

const createScope = (
  kind: AgentCapabilityScopeKind,
  input: CreateAgentCapabilityScopeInput,
): AgentCapabilityScope => ({
  scopeId: input.scopeId,
  kind,
  ...(input.eligibleCapabilityIds
    ? { eligibleCapabilityIds: [...input.eligibleCapabilityIds] }
    : {}),
  ...(input.discoverableCapabilityIds
    ? { discoverableCapabilityIds: [...input.discoverableCapabilityIds] }
    : {}),
  ...(input.maxDisclosure ? { maxDisclosure: input.maxDisclosure } : {}),
});

export const createMainAgentCapabilityScope = (
  input: CreateAgentCapabilityScopeInput,
): AgentCapabilityScope => createScope("main_agent", input);

export const createGenericChildCapabilityScope = (
  input: CreateAgentCapabilityScopeInput,
): AgentCapabilityScope => createScope("generic_child", input);

export const createSkillChildCapabilityScope = (
  input: CreateAgentCapabilityScopeInput,
): AgentCapabilityScope => createScope("skill_child", input);

const clampDisclosure = (
  requested: CapabilityDisclosure,
  ceiling: CapabilityDisclosure,
): CapabilityDisclosure =>
  DISCLOSURE_RANK[requested] <= DISCLOSURE_RANK[ceiling] ? requested : ceiling;

export const projectAgentCapabilityView = (
  input: ProjectAgentCapabilityViewInput,
): AgentCapabilityView => {
  const { scope } = input;
  const eligibleEnvelope = scope.eligibleCapabilityIds
    ? new Set(scope.eligibleCapabilityIds)
    : undefined;
  const discoverableEnvelope = scope.discoverableCapabilityIds
    ? new Set(scope.discoverableCapabilityIds)
    : undefined;
  const ceiling = scope.maxDisclosure ?? "schema";

  const capabilities = new Map<string, CapabilityViewEntry>();
  for (const definition of input.definitions) {
    const readiness = resolveToolRuntimeReadiness(definition.id);
    const readyForScope = readiness.state !== "unavailable";
    const withinEligibleEnvelope =
      !eligibleEnvelope || eligibleEnvelope.has(definition.id);
    const eligible = readyForScope && withinEligibleEnvelope;

    const withinDiscoverableEnvelope =
      !discoverableEnvelope || discoverableEnvelope.has(definition.id);
    const discoveryRequested =
      input.requestedDiscoverable?.get(definition.id) ?? true;
    const discoverable =
      eligible && withinDiscoverableEnvelope && discoveryRequested;

    const requestedDisclosure =
      input.requestedDisclosure?.get(definition.id) ??
      (discoverable ? "metadata" : "hidden");
    const disclosure = discoverable
      ? clampDisclosure(requestedDisclosure, ceiling)
      : "hidden";

    capabilities.set(definition.id, {
      capabilityId: definition.id,
      readiness: { ...readiness },
      eligible,
      discoverable,
      disclosure,
    });
  }

  return {
    scopeId: scope.scopeId,
    scopeKind: scope.kind,
    capabilities,
  };
};

export const getCapabilityViewEntry = (
  view: AgentCapabilityView,
  capabilityId: string,
): CapabilityViewEntry | undefined => view.capabilities.get(capabilityId);

export const listCapabilityIdsAtDisclosure = (
  view: AgentCapabilityView,
  disclosure: CapabilityDisclosure,
): string[] =>
  [...view.capabilities.values()]
    .filter((entry) => entry.disclosure === disclosure)
    .map((entry) => entry.capabilityId);

/**
 * Returns a new view with one capability's disclosure changed. Disclosure may
 * move between "hidden", "metadata" and "schema", but a capability that is not
 * discoverable in this scope is forced to stay hidden. The view can narrow
 * visibility; it can never manufacture eligibility or authority.
 */
export const withCapabilityDisclosure = (
  view: AgentCapabilityView,
  capabilityId: string,
  disclosure: CapabilityDisclosure,
): AgentCapabilityView => {
  const entry = view.capabilities.get(capabilityId);
  if (!entry) return view;

  const nextDisclosure = entry.discoverable ? disclosure : "hidden";
  if (nextDisclosure === entry.disclosure) return view;

  const capabilities = new Map(view.capabilities);
  capabilities.set(capabilityId, {
    ...entry,
    disclosure: nextDisclosure,
  });
  return { ...view, capabilities };
};

export const describeAgentCapabilityView = (
  view: AgentCapabilityView,
): AgentCapabilityViewTrace => ({
  scopeId: view.scopeId,
  scopeKind: view.scopeKind,
  capabilityCount: view.capabilities.size,
  entries: [...view.capabilities.values()].map((entry) => ({
    capabilityId: entry.capabilityId,
    readiness: entry.readiness.state,
    eligible: entry.eligible,
    discoverable: entry.discoverable,
    disclosure: entry.disclosure,
  })),
});
