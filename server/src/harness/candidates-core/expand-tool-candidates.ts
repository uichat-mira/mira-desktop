import type { ToolDefinition } from "../../mcp/core/definitions.js";
import { resolveHarnessCapabilityProfiles } from "../profiles/index.js";
import { toReason } from "./scoring.js";
import type { HarnessToolCandidate, ResolvedHarnessCapabilityMatch } from "./types.js";

export const expandHarnessToolCandidates = (input: {
  matches: ResolvedHarnessCapabilityMatch[];
  definitions: ToolDefinition[];
}) => {
  const definitionMap = new Map(input.definitions.map((definition) => [definition.id, definition]));
  const profiles = resolveHarnessCapabilityProfiles(input.definitions);
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const candidates: HarnessToolCandidate[] = [];

  for (const match of input.matches) {
    const profile = profileMap.get(match.capabilityId);
    const reason =
      match.reason ??
      toReason({
        title: match.title,
        embeddingScore: match.embeddingScore,
        rerankScore: match.rerankScore,
        finalScore: match.finalScore,
      });

    for (const toolId of match.candidateToolIds) {
      const definition = definitionMap.get(toolId);
      if (!definition) {
        continue;
      }

      candidates.push({
        toolId,
        title: definition.title,
        description: definition.description,
        domain: definition.domain,
        source: definition.source,
        tags: definition.tags,
        score: match.finalScore,
        embeddingScore: match.embeddingScore,
        ruleScore: match.ruleScore,
        rerankScore: match.rerankScore,
        finalScore: match.finalScore,
        reason,
        ...(profile?.actionProfileId
          ? {
              actionProfileId: profile.actionProfileId,
              actionProfileTitle: profile.actionProfileTitle,
              actionProfileDescription: profile.actionProfileDescription,
            }
          : {}),
      });
    }
  }

  return candidates;
};

export const exposeAllHarnessToolCandidates = (input: {
  definitions: ToolDefinition[];
  reason: string;
}) => {
  const profiles = resolveHarnessCapabilityProfiles(input.definitions);
  const profileByToolId = new Map(
    profiles.flatMap((profile) =>
      profile.supportingToolIds.map((toolId) => [toolId, profile] as const),
    ),
  );

  return input.definitions.map((definition) => {
    const profile = profileByToolId.get(definition.id);
    return {
      toolId: definition.id,
      title: definition.title,
      description: definition.description,
      domain: definition.domain,
      source: definition.source,
      tags: definition.tags,
      score: 0,
      embeddingScore: 0,
      ruleScore: 0,
      rerankScore: 0,
      finalScore: 0,
      reason: input.reason,
      ...(profile?.actionProfileId
        ? {
            actionProfileId: profile.actionProfileId,
            actionProfileTitle: profile.actionProfileTitle,
            actionProfileDescription: profile.actionProfileDescription,
          }
        : {}),
    } satisfies HarnessToolCandidate;
  });
};
