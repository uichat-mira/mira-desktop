import type { ToolDefinition } from "../mcp/core/definitions.js";
import {
  getCapabilityViewEntry,
  withCapabilityDisclosure,
  type AgentCapabilityView,
  type CapabilityDisclosure,
  type CapabilityViewEntry,
} from "./capability-view.js";
import {
  resolveToolRuntimeReadiness,
  type HarnessToolRuntimeReadiness,
} from "./runtime-readiness.js";

/**
 * Progressive Tool disclosure over an Agent Capability View.
 *
 * The Capability View models visibility state:
 *
 *   registered != ready/eligible != discoverable != disclosed
 *
 * This module turns that state into two materially separate disclosure stages:
 *
 *   discoverable -> compact metadata -> full Tool schema
 *
 * Compact metadata is safe to hand to a model because it describes that a Tool
 * exists and what it roughly does, but it never carries the full input schema.
 * The full schema is only materialized through a controlled promotion, so a
 * scope cannot eagerly inflate model context with every registered schema.
 *
 * Disclosure changes model context only. It never grants authority: readiness
 * still comes from Harness runtime-readiness, execution authority still lives in
 * Harness Policy / Approval, and materializing a schema never bypasses the
 * normal Normalize -> Policy -> Approval -> Harness execution path.
 */

const SCHEMA_DISCLOSURE: CapabilityDisclosure = "schema";

export interface CapabilityToolMetadata {
  readonly capabilityId: string;
  readonly title: string;
  readonly description: string;
  readonly domain: ToolDefinition["domain"];
  readonly source: ToolDefinition["source"];
  readonly tags: readonly string[];
  readonly capabilities: Readonly<ToolDefinition["capabilities"]>;
  /** Disclosure stage this metadata was projected from. Never "hidden". */
  readonly disclosure: Extract<CapabilityDisclosure, "metadata" | "schema">;
}

export interface CapabilitySchemaDisclosure {
  readonly capabilityId: string;
  readonly disclosure: "schema";
  readonly inputSchema: ToolDefinition["inputSchema"];
}

export type CapabilityDisclosureTransitionReason =
  | "promoted"
  | "already-disclosed"
  | "blocked-ceiling"
  | "blocked-unavailable"
  | "blocked-not-discoverable"
  | "unknown-capability";

export interface CapabilityDisclosureTransition {
  readonly capabilityId: string;
  readonly from: CapabilityDisclosure;
  readonly to: CapabilityDisclosure;
  readonly reason: CapabilityDisclosureTransitionReason;
  readonly schemaMaterialized: boolean;
}

export interface PromoteCapabilitySchemaResult {
  readonly view: AgentCapabilityView;
  readonly transition: CapabilityDisclosureTransition;
  readonly schema?: CapabilitySchemaDisclosure;
}

export interface DiscloseCapabilitySchemasResult {
  readonly view: AgentCapabilityView;
  readonly transitions: readonly CapabilityDisclosureTransition[];
  readonly schemas: readonly CapabilitySchemaDisclosure[];
}

export interface CapabilityDisclosureTraceEntry {
  readonly capabilityId: string;
  readonly readiness: HarnessToolRuntimeReadiness["state"];
  readonly eligible: boolean;
  readonly discoverable: boolean;
  readonly disclosure: CapabilityDisclosure;
  /** Compact metadata is disclosed for metadata and schema stages. */
  readonly metadataDisclosed: boolean;
  /** Full schema is disclosed only for the schema stage. */
  readonly schemaDisclosed: boolean;
}

export interface CapabilityDisclosureTrace {
  readonly scopeId: string;
  readonly scopeKind: AgentCapabilityView["scopeKind"];
  readonly entries: CapabilityDisclosureTraceEntry[];
  readonly metadataDisclosedCount: number;
  readonly schemaDisclosedCount: number;
  readonly hiddenCount: number;
}

const findDefinition = (
  definitions: readonly ToolDefinition[],
  capabilityId: string,
): ToolDefinition | undefined =>
  definitions.find((definition) => definition.id === capabilityId);

const isMetadataStage = (
  disclosure: CapabilityDisclosure,
): disclosure is "metadata" | "schema" => disclosure !== "hidden";

const toMetadata = (
  entry: CapabilityViewEntry,
  definition: ToolDefinition,
): CapabilityToolMetadata => ({
  capabilityId: definition.id,
  title: definition.title,
  description: definition.description,
  domain: definition.domain,
  source: definition.source,
  tags: [...definition.tags],
  capabilities: Object.freeze({ ...definition.capabilities }),
  // The caller already filtered to metadata/schema stages.
  disclosure: entry.disclosure as "metadata" | "schema",
});

/**
 * Project the compact metadata disclosure stage for every discoverable
 * capability in the scope. It deliberately never includes `inputSchema`, so two
 * Tools can stay discoverable while neither has a full schema in context.
 */
export const projectCapabilityToolMetadata = (
  view: AgentCapabilityView,
  definitions: readonly ToolDefinition[],
): CapabilityToolMetadata[] => {
  const projected: CapabilityToolMetadata[] = [];
  for (const entry of view.capabilities.values()) {
    if (!entry.discoverable || !isMetadataStage(entry.disclosure)) continue;
    const definition = findDefinition(definitions, entry.capabilityId);
    if (!definition) continue;
    projected.push(toMetadata(entry, definition));
  }
  return projected;
};

/**
 * Materialize the full schema stage for one capability. This is a read of the
 * current disclosure state: a capability that is not discoverable in this scope
 * or that is still at the metadata stage returns `undefined` instead of leaking
 * its schema. Promotion must happen explicitly through `promoteCapabilitySchema`.
 */
export const materializeCapabilitySchema = (
  view: AgentCapabilityView,
  capabilityId: string,
  definitions: readonly ToolDefinition[],
): CapabilitySchemaDisclosure | undefined => {
  const entry = getCapabilityViewEntry(view, capabilityId);
  if (!entry || !entry.discoverable || entry.disclosure !== SCHEMA_DISCLOSURE) {
    return undefined;
  }
  const definition = findDefinition(definitions, capabilityId);
  if (!definition) return undefined;
  return {
    capabilityId: definition.id,
    disclosure: "schema",
    inputSchema: definition.inputSchema,
  };
};

const blockedTransition = (
  entry: CapabilityViewEntry,
  capabilityId: string,
): CapabilityDisclosureTransition => {
  const reason: CapabilityDisclosureTransitionReason =
    entry.readiness.state === "unavailable"
      ? "blocked-unavailable"
      : !entry.discoverable
        ? "blocked-not-discoverable"
        : "blocked-ceiling";
  return {
    capabilityId,
    from: entry.disclosure,
    to: entry.disclosure,
    reason,
    schemaMaterialized: false,
  };
};

/**
 * Controlled promotion from the metadata stage to the full schema stage.
 *
 * Promotion is clamped by readiness, discoverability and the scope disclosure
 * ceiling, so a capability that Harness keeps hidden or a scope that caps at
 * metadata can never be lifted to schema here. The returned transition is the
 * durable trace/debug evidence for the disclosure change.
 */
export const promoteCapabilitySchema = (input: {
  view: AgentCapabilityView;
  capabilityId: string;
  definitions: readonly ToolDefinition[];
}): PromoteCapabilitySchemaResult => {
  const entry = getCapabilityViewEntry(input.view, input.capabilityId);
  if (!entry) {
    return {
      view: input.view,
      transition: {
        capabilityId: input.capabilityId,
        from: "hidden",
        to: "hidden",
        reason: "unknown-capability",
        schemaMaterialized: false,
      },
    };
  }

  const definition = findDefinition(input.definitions, input.capabilityId);
  if (!definition) {
    return {
      view: input.view,
      transition: {
        capabilityId: input.capabilityId,
        from: entry.disclosure,
        to: entry.disclosure,
        reason: "unknown-capability",
        schemaMaterialized: false,
      },
    };
  }

  if (entry.disclosure === SCHEMA_DISCLOSURE) {
    return {
      view: input.view,
      transition: {
        capabilityId: input.capabilityId,
        from: SCHEMA_DISCLOSURE,
        to: SCHEMA_DISCLOSURE,
        reason: "already-disclosed",
        schemaMaterialized: true,
      },
      schema: {
        capabilityId: definition.id,
        disclosure: "schema",
        inputSchema: definition.inputSchema,
      },
    };
  }

  if (
    !entry.discoverable ||
    entry.readiness.state === "unavailable" ||
    input.view.maxDisclosure !== SCHEMA_DISCLOSURE
  ) {
    return { view: input.view, transition: blockedTransition(entry, input.capabilityId) };
  }

  const nextView = withCapabilityDisclosure(
    input.view,
    input.capabilityId,
    SCHEMA_DISCLOSURE,
  );
  const promotedEntry = getCapabilityViewEntry(nextView, input.capabilityId);
  if (!promotedEntry || promotedEntry.disclosure !== SCHEMA_DISCLOSURE) {
    return {
      view: nextView,
      transition: blockedTransition(promotedEntry ?? entry, input.capabilityId),
    };
  }

  return {
    view: nextView,
    transition: {
      capabilityId: input.capabilityId,
      from: entry.disclosure,
      to: SCHEMA_DISCLOSURE,
      reason: "promoted",
      schemaMaterialized: true,
    },
    schema: {
      capabilityId: definition.id,
      disclosure: "schema",
      inputSchema: definition.inputSchema,
    },
  };
};

/**
 * Controlled batch promotion for the concrete Tools a turn actually selected.
 *
 * A production scope starts metadata-first: every discoverable Tool carries
 * compact metadata but no full schema. This helper promotes exactly the
 * selected / exact-known Tools to the schema stage in one step and returns the
 * resulting view plus the durable, inspectable transitions. It never widens
 * authority: promotion is clamped by readiness, discoverability and the scope
 * ceiling inside `promoteCapabilitySchema`, and undisclosed schemas keep their
 * eligibility.
 */
export const discloseCapabilitySchemas = (input: {
  view: AgentCapabilityView;
  capabilityIds: readonly string[];
  definitions: readonly ToolDefinition[];
}): DiscloseCapabilitySchemasResult => {
  let view = input.view;
  const transitions: CapabilityDisclosureTransition[] = [];
  const schemas: CapabilitySchemaDisclosure[] = [];
  const seen = new Set<string>();

  for (const capabilityId of input.capabilityIds) {
    if (seen.has(capabilityId)) continue;
    seen.add(capabilityId);
    const promoted = promoteCapabilitySchema({
      view,
      capabilityId,
      definitions: input.definitions,
    });
    transitions.push(promoted.transition);
    if (promoted.schema) schemas.push(promoted.schema);
    view = promoted.view;
  }

  return { view, transitions, schemas };
};

/**
 * Exact known Tool direct schema materialization.
 *
 * When a caller already knows the concrete Tool id (for example an exact
 * Planner selection or an exact approval resume), it may read that schema
 * directly without running any capability search or ranking. This still resolves
 * Harness runtime-readiness first and, when a scoped View is supplied, requires
 * the Tool to be discoverable in that scope. It changes model context only: the
 * eventual invocation still flows through Normalize / Policy / Approval /
 * Harness.
 */
export const materializeKnownCapabilitySchema = (input: {
  capabilityId: string;
  definitions: readonly ToolDefinition[];
  view?: AgentCapabilityView;
}): CapabilitySchemaDisclosure | undefined => {
  const definition = findDefinition(input.definitions, input.capabilityId);
  if (!definition) return undefined;

  // Readiness resolves closed, so an unverified runtime never yields a schema.
  if (resolveToolRuntimeReadiness(definition.id).state === "unavailable") {
    return undefined;
  }

  if (input.view) {
    const entry = getCapabilityViewEntry(input.view, definition.id);
    if (!entry || !entry.discoverable) return undefined;
  }

  return {
    capabilityId: definition.id,
    disclosure: "schema",
    inputSchema: definition.inputSchema,
  };
};

/**
 * Inspectable disclosure trace. It keeps metadata disclosure and schema
 * disclosure distinguishable per capability, which lets trace/debug output tell
 * "the model saw this Tool exists" apart from "the model saw its full schema".
 */
export const describeCapabilityDisclosure = (
  view: AgentCapabilityView,
): CapabilityDisclosureTrace => {
  const entries: CapabilityDisclosureTraceEntry[] = [
    ...view.capabilities.values(),
  ].map((entry) => ({
    capabilityId: entry.capabilityId,
    readiness: entry.readiness.state,
    eligible: entry.eligible,
    discoverable: entry.discoverable,
    disclosure: entry.disclosure,
    metadataDisclosed: isMetadataStage(entry.disclosure),
    schemaDisclosed: entry.disclosure === SCHEMA_DISCLOSURE,
  }));

  return {
    scopeId: view.scopeId,
    scopeKind: view.scopeKind,
    entries,
    metadataDisclosedCount: entries.filter((entry) => entry.metadataDisclosed)
      .length,
    schemaDisclosedCount: entries.filter((entry) => entry.schemaDisclosed).length,
    hiddenCount: entries.filter((entry) => entry.disclosure === "hidden").length,
  };
};
