import type { ToolDefinition } from "../mcp/core/definitions.js";
import {
  resolveCapabilityCascade,
  type CapabilityResolutionDocument,
} from "./candidates-core/capability-resolution.js";
import type { HarnessCapabilityProfile } from "./profiles/types.js";

/**
 * Generic, opt-in Harness seam that separates a first-level Capability's
 * product/workbench ownership from the concrete Tool schema(s) disclosed for
 * one turn.
 *
 * Historically a selected capability was expanded straight to every
 * `supportingToolIds` member and all of them were promoted to the full schema
 * stage. That is correct for small, tightly-coupled product groups, but a large
 * first-level capability (for example a Managed Browser catalog of 10+ atomic
 * Tools) would then eagerly materialize its whole catalog and could exhaust the
 * Phase-2 disclosure budget by ordering rather than by task relevance.
 *
 * A capability opts in with `schemaDisclosure: "task_relevant"`. For that case
 * the concrete Tool(s) are chosen by reusing the same deterministic-first
 * resolution cascade (#301 exact -> structural -> lexical) over the capability's
 * own Tool metadata. The nested pass runs with no semantic resolver, so it never
 * spends a model roundtrip: a genuinely ambiguous nested request falls back to
 * the capability's declared `preferredToolId` instead of calling a model.
 *
 * This module only decides which already-eligible Tool schemas become visible.
 * It never registers a Tool, never changes runtime readiness, and never grants
 * execution authority; every invocation still flows through Normalize / Policy /
 * Approval / Harness.
 */
const toToolResolutionDocument = (
  definition: ToolDefinition,
): CapabilityResolutionDocument => ({
  capabilityId: definition.id,
  title: definition.title,
  description: definition.description,
  domain: definition.domain,
  tags: [...definition.tags],
  toolIds: [definition.id],
  aliases: [definition.id],
});

const selectTaskRelevantToolIds = async (input: {
  query: string;
  profile: HarnessCapabilityProfile;
  definitions: readonly ToolDefinition[];
}): Promise<readonly string[]> => {
  const definitionById = new Map(
    input.definitions.map((definition) => [definition.id, definition]),
  );
  const tools = input.profile.supportingToolIds.flatMap((toolId) => {
    const definition = definitionById.get(toolId);
    return definition ? [definition] : [];
  });

  if (tools.length === 0) return [];
  if (tools.length === 1) return [tools[0]!.id];

  const query = input.query.trim();
  if (query) {
    const resolution = await resolveCapabilityCascade({
      query,
      capabilities: tools.map(toToolResolutionDocument),
    });
    if (
      resolution.selectedCapabilityId &&
      tools.some((definition) => definition.id === resolution.selectedCapabilityId)
    ) {
      return [resolution.selectedCapabilityId];
    }
  }

  const preferredToolId = input.profile.preferredToolId;
  return preferredToolId &&
    tools.some((definition) => definition.id === preferredToolId)
    ? [preferredToolId]
    : [];
};

/**
 * Resolve the concrete Tool ids a selected capability should disclose a schema
 * for this turn.
 *
 * - A one-to-one fallback key (no grouped profile) resolves to itself.
 * - A non-opt-in grouped profile keeps the historical behavior and returns every
 *   `supportingToolIds` member.
 * - A `task_relevant` profile returns only the concrete Tool(s) selected by the
 *   existing deterministic-first cascade.
 */
export const resolveCapabilitySchemaToolIds = async (input: {
  capabilityId: string;
  query: string;
  profiles: readonly HarnessCapabilityProfile[];
  definitions: readonly ToolDefinition[];
}): Promise<readonly string[]> => {
  const profile = input.profiles.find(
    (candidate) => candidate.id === input.capabilityId,
  );
  if (!profile) return [input.capabilityId];
  if (profile.schemaDisclosure !== "task_relevant") {
    return profile.supportingToolIds;
  }
  return selectTaskRelevantToolIds({
    query: input.query,
    profile,
    definitions: input.definitions,
  });
};
