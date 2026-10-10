import { executeLocalEmbedding } from "@/services/internal-capabilities/local-embedding.js";
import { toCapabilityIntentDocuments } from "@/agent/intent/capability-documents.js";
import { resolveHarnessToolExposure } from "../exposure-core/index.js";
import { resolveHarnessCapabilityProfiles } from "../profiles/index.js";
import { resolveWorkspaceEditFacadeForModel } from "../edit-facade.js";
import { resolveRegistryNativeCapabilityReadiness } from "../native-capability-readiness.js";
import {
  expandHarnessToolCandidates,
  exposeAllHarnessToolCandidates,
} from "./expand-tool-candidates.js";
import {
  TOOL_EXPOSURE_RECALL_THRESHOLD,
  cosineSimilarity,
} from "./scoring.js";
import { rerankHarnessCapabilityMatches } from "./rerank.js";
import type {
  HarnessToolCandidate,
  HarnessToolExposure,
  ResolveHarnessToolCandidatesForTurnInput,
  ResolveHarnessToolCandidatesForTurnResult,
  ResolvedHarnessCapabilityMatch,
} from "./types.js";

const MAX_PLANNER_TOOLS = TOOL_EXPOSURE_RECALL_THRESHOLD;

const dedupeCandidates = (candidates: HarnessToolCandidate[]) => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.toolId)) {
      return false;
    }
    seen.add(candidate.toolId);
    return true;
  });
};

export const resolveHarnessToolCandidatesForTurn = async (
  input: ResolveHarnessToolCandidatesForTurnInput,
): Promise<ResolveHarnessToolCandidatesForTurnResult> => {
  const source = input.source ?? "agent_intent";

  const nativeReadiness =
    input.nativeReadiness ?? resolveRegistryNativeCapabilityReadiness();

  const exposureDecision = resolveHarnessToolExposure({
    source,
    query: input.query,
    editFacade:
      input.editFacade ??
      (source === "tools_list"
        ? "all"
        : resolveWorkspaceEditFacadeForModel(input.modelHint)),
    allowExternal: input.allowExternal,
    allowedExternalToolIds: input.allowedExternalToolIds,
    sandboxProfiles: input.sandboxProfiles,
    nativeReadiness,
  });

  // Registered public tools are available to Planner. Harness does not infer
  // task phases, domains, browser intent, sandbox suitability, terminal need,
  // or semantic relevance to hide them. Ranking is only used when the public
  // tool set exceeds the 20-tool context budget.
  const visibleDefinitions = exposureDecision.exposedDefinitions;
  const initialToolExposure: HarnessToolExposure = {
    exposedToolIds: visibleDefinitions.map((definition) => definition.id),
    exposedDefinitions: visibleDefinitions,
    reason: exposureDecision.reason,
    blockedCapabilityIds: exposureDecision.blockedCapabilityIds,
    blockedCapabilityReasons: exposureDecision.blockedCapabilityReasons,
    nativeReadiness,
  };

  if (visibleDefinitions.length <= MAX_PLANNER_TOOLS) {
    const exposureReason =
      "All public tools are exposed because the tool set is at most 20 tools.";
    const toolCandidates = exposeAllHarnessToolCandidates({
      definitions: visibleDefinitions,
      reason: exposureReason,
    });
    return {
      query: input.query,
      source,
      toolCandidates,
      toolExposure: {
        ...initialToolExposure,
        reason: [...initialToolExposure.reason, exposureReason],
      },
    };
  }

  const profiles = resolveHarnessCapabilityProfiles(visibleDefinitions);
  const fallbackTop20 = (reason: string, retrievalError?: string) => {
    const selectedDefinitions = visibleDefinitions.slice(0, MAX_PLANNER_TOOLS);
    const toolCandidates = exposeAllHarnessToolCandidates({
      definitions: selectedDefinitions,
      reason,
    });
    return {
      query: input.query,
      source,
      toolCandidates,
      toolExposure: {
        exposedToolIds: selectedDefinitions.map((definition) => definition.id),
        exposedDefinitions: selectedDefinitions,
        reason: [...initialToolExposure.reason, reason],
        blockedCapabilityIds: initialToolExposure.blockedCapabilityIds,
        blockedCapabilityReasons: initialToolExposure.blockedCapabilityReasons,
        nativeReadiness,
      },
      ...(retrievalError ? { retrievalError } : {}),
    } satisfies ResolveHarnessToolCandidatesForTurnResult;
  };

  if (!input.query.trim() || profiles.length === 0) {
    return fallbackTop20(
      "Tool set exceeds 20; ranking input is unavailable, so Harness exposes a deterministic first 20 without applying any additional policy filter.",
    );
  }

  const documents = toCapabilityIntentDocuments(profiles);
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  let embeddingResult:
    | Awaited<ReturnType<typeof executeLocalEmbedding>>
    | undefined;
  let queryEmbedding: number[] | undefined;
  let documentEmbeddings: number[][] = [];
  let retrievalError: string | undefined;

  try {
    embeddingResult = await executeLocalEmbedding({
      texts: [input.query, ...documents.map((document) => document.text)],
    });
    [queryEmbedding, ...documentEmbeddings] = embeddingResult.embeddings ?? [];
  } catch (error) {
    retrievalError = error instanceof Error ? error.message : String(error);
  }

  if (retrievalError) {
    return fallbackTop20(
      "Tool set exceeds 20 and ranking failed; Harness exposes a deterministic first 20 rather than blocking tools by policy.",
      retrievalError,
    );
  }

  let matches: ResolvedHarnessCapabilityMatch[] = documents
    .map((document, index) => {
      const profile = profileMap.get(document.capabilityId);
      if (!profile) {
        return null;
      }

      const documentEmbedding = documentEmbeddings[index];
      const embeddingScore =
        queryEmbedding && documentEmbedding
          ? cosineSimilarity(queryEmbedding, documentEmbedding)
          : 0;

      return {
        capabilityId: profile.id,
        title: profile.title,
        score: embeddingScore,
        embeddingScore,
        ruleScore: 0,
        rerankScore: 0,
        finalScore: embeddingScore,
        candidateToolIds: profile.supportingToolIds,
        ...(profile.preferredToolId ? { preferredToolId: profile.preferredToolId } : {}),
      } satisfies ResolvedHarnessCapabilityMatch;
    })
    .filter((match): match is NonNullable<typeof match> => match !== null)
    .sort((left, right) => right.finalScore - left.finalScore);

  let rerankModel:
    | {
        model?: string;
        modelConfigId?: string;
      }
    | undefined;

  if (matches.length > 0) {
    try {
      const reranked = await rerankHarnessCapabilityMatches({
        query: input.query,
        matches,
      });
      matches = reranked.matches;
      rerankModel = reranked.rerankModel;
    } catch {
      // Embedding order remains a valid ranking fallback.
    }
  }

  const rankedToolCandidates = dedupeCandidates(
    expandHarnessToolCandidates({
      matches,
      definitions: visibleDefinitions,
    }).sort(
      (left, right) =>
        right.rerankScore - left.rerankScore ||
        right.embeddingScore - left.embeddingScore,
    ),
  );

  // Every public definition has a fallback capability profile, but fill any
  // unexpected gap deterministically so overflow exposure is always exactly
  // the best available 20 rather than silently shrinking Planner's tool set.
  const rankedIds = new Set(rankedToolCandidates.map((candidate) => candidate.toolId));
  const fillCandidates = exposeAllHarnessToolCandidates({
    definitions: visibleDefinitions.filter((definition) => !rankedIds.has(definition.id)),
    reason: "Unranked public tool retained as deterministic overflow fallback.",
  });
  const toolCandidates = [...rankedToolCandidates, ...fillCandidates].slice(
    0,
    MAX_PLANNER_TOOLS,
  );

  const definitionMap = new Map(
    visibleDefinitions.map((definition) => [definition.id, definition]),
  );
  const exposedDefinitions = toolCandidates
    .map((candidate) => definitionMap.get(candidate.toolId))
    .filter((definition): definition is NonNullable<typeof definition> => Boolean(definition));

  const rankingReason =
    "Public tool set exceeds 20; Harness ranks the available tools for this turn and exposes the top 20. No additional semantic or runtime policy filtering is applied here.";
  const toolExposure: HarnessToolExposure = {
    exposedToolIds: exposedDefinitions.map((definition) => definition.id),
    exposedDefinitions,
    reason: [...exposureDecision.reason, rankingReason],
    blockedCapabilityIds: exposureDecision.blockedCapabilityIds,
    blockedCapabilityReasons: exposureDecision.blockedCapabilityReasons,
    nativeReadiness,
  };

  return {
    query: input.query,
    source,
    toolCandidates,
    toolExposure,
    ...(embeddingResult
      ? {
          retrievalModel: {
            provider: "local",
            model: embeddingResult.embeddingModel,
            modelConfigId: embeddingResult.embeddingModelConfigId,
          },
        }
      : {}),
    ...(rerankModel ? { rerankModel } : {}),
  };
};
