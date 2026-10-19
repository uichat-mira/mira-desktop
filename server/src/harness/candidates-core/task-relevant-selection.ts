import type { ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessCapabilityProfile } from "../profiles/index.js";
import {
  resolveCapabilityCascade,
  type CapabilityResolutionDocument,
} from "./capability-resolution.js";

/**
 * Opt-in task-relevant concrete Tool schema selection.
 *
 * A capability profile can keep a first-level / product ownership identity while
 * schema disclosure narrows to the concrete Tool(s) that actually match the
 * request. This reuses the same deterministic exact -> structural -> lexical
 * #301 cascade used for capability resolution, but runs it over the profile's
 * own concrete Tools and never supplies a semantic Resolver. It therefore adds
 * no extra model roundtrip and never eagerly materializes the whole atomic
 * catalog merely because the first-level capability matched.
 *
 * This returns Tool ids only. It does not read runtime-readiness and never
 * grants authority; callers still resolve readiness and Policy / Approval per
 * invocation.
 */

export const buildTaskRelevantToolDocuments = (
  profile: HarnessCapabilityProfile,
  definitions: readonly ToolDefinition[],
): CapabilityResolutionDocument[] => {
  const definitionMap = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const toolAliases = profile.taskSelection?.toolAliases ?? {};
  const documents: CapabilityResolutionDocument[] = [];

  for (const toolId of profile.supportingToolIds) {
    const definition = definitionMap.get(toolId);
    if (!definition) continue;
    documents.push({
      capabilityId: definition.id,
      title: definition.title,
      description: definition.description,
      domain: definition.domain,
      tags: [...definition.tags],
      toolIds: [definition.id],
      aliases: [definition.id, ...(toolAliases[definition.id] ?? [])],
    });
  }

  return documents;
};

export const resolveTaskRelevantToolSelection = async (input: {
  query: string;
  profile: HarnessCapabilityProfile;
  definitions: readonly ToolDefinition[];
}): Promise<string[]> => {
  const documents = buildTaskRelevantToolDocuments(
    input.profile,
    input.definitions,
  );
  if (documents.length === 0) return [];
  if (documents.length === 1) return [documents[0]!.capabilityId];

  if (input.query.trim()) {
    const result = await resolveCapabilityCascade({
      query: input.query,
      capabilities: documents,
    });
    if (
      result.selectedCapabilityId &&
      (result.path === "exact" ||
        result.path === "structural" ||
        result.path === "lexical")
    ) {
      return [result.selectedCapabilityId];
    }
  }

  // No confident deterministic match: disclose exactly the capability's own
  // declared entry Tool. This is not a legacy facade fallback and it never
  // expands to the atomic catalog.
  const defaultToolId = input.profile.taskSelection?.defaultToolId;
  if (
    defaultToolId &&
    documents.some((document) => document.capabilityId === defaultToolId)
  ) {
    return [defaultToolId];
  }

  return [];
};
