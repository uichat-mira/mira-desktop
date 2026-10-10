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
  readonly capabilityId: string;
  readonly readiness: Readonly<HarnessToolRuntimeReadiness>;
  readonly eligible: boolean;
  readonly discoverable: boolean;
  readonly disclosure: CapabilityDisclosure;
}

export interface AgentCapabilityView {
  readonly scopeId: string;
  readonly scopeKind: AgentCapabilityScopeKind;
  readonly maxDisclosure: CapabilityDisclosure;
  readonly capabilities: ReadonlyMap<string, Readonly<CapabilityViewEntry>>;
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


const freezeCapabilityEntry = (
  entry: CapabilityViewEntry,
): Readonly<CapabilityViewEntry> =>
  Object.freeze({
    ...entry,
    readiness: Object.freeze({ ...entry.readiness }),
  });

const toReadonlyCapabilityMap = (
  source: ReadonlyMap<string, Readonly<CapabilityViewEntry>>,
): ReadonlyMap<string, Readonly<CapabilityViewEntry>> => {
  const snapshot = new Map(source);
  let readonlyMap: ReadonlyMap<string, Readonly<CapabilityViewEntry>>;
  readonlyMap = Object.freeze({
    get size() {
      return snapshot.size;
    },
    get: (key: string) => snapshot.get(key),
    has: (key: string) => snapshot.has(key),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    forEach: (
      callbackfn: (
        value: Readonly<CapabilityViewEntry>,
        key: string,
        map: ReadonlyMap<string, Readonly<CapabilityViewEntry>>,
      ) => void,
      thisArg?: unknown,
    ) => {
      snapshot.forEach((value, key) => {
        callbackfn.call(thisArg, value, key, readonlyMap);
      });
    },
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  });
  return readonlyMap;
};

const createCapabilityView = (input: {
  scopeId: string;
  scopeKind: AgentCapabilityScopeKind;
  maxDisclosure: CapabilityDisclosure;
  capabilities: ReadonlyMap<string, Readonly<CapabilityViewEntry>>;
}): AgentCapabilityView =>
  Object.freeze({
    scopeId: input.scopeId,
    scopeKind: input.scopeKind,
    maxDisclosure: input.maxDisclosure,
    capabilities: toReadonlyCapabilityMap(input.capabilities),
  });

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

    capabilities.set(
      definition.id,
      freezeCapabilityEntry({
        capabilityId: definition.id,
        readiness,
        eligible,
        discoverable,
        disclosure,
      }),
    );
  }

  return createCapabilityView({
    scopeId: scope.scopeId,
    scopeKind: scope.kind,
    maxDisclosure: ceiling,
    capabilities,
  });
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

  const nextDisclosure = entry.discoverable
    ? clampDisclosure(disclosure, view.maxDisclosure)
    : "hidden";
  if (nextDisclosure === entry.disclosure) return view;

  const capabilities = new Map(view.capabilities);
  capabilities.set(
    capabilityId,
    freezeCapabilityEntry({
      ...entry,
      readiness: entry.readiness,
      disclosure: nextDisclosure,
    }),
  );
  return createCapabilityView({
    scopeId: view.scopeId,
    scopeKind: view.scopeKind,
    maxDisclosure: view.maxDisclosure,
    capabilities,
  });
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
