import { executeLocalEmbedding } from "@/services/internal-capabilities/local-embedding.js";
import { toCapabilityIntentDocuments } from "@/agent/intent/capability-documents.js";
import { resolveHarnessToolExposure } from "../exposure-core/index.js";
import { resolveHarnessCapabilityProfiles } from "../profiles/index.js";
import { resolveWorkspaceEditFacadeForModel } from "../edit-facade.js";
import {
  expandHarnessToolCandidates,
  exposeAllHarnessToolCandidates,
} from "./expand-tool-candidates.js";
import {
  buildCapabilityResolutionDocuments,
  resolveCapabilityCascade,
  type CapabilityResolutionResult,
} from "./capability-resolution.js";
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
  });

  // Runtime readiness has already removed unavailable capabilities here.
  // Harness still does not infer task phases, domains, browser intent, sandbox
  // suitability, terminal need, or semantic relevance to hide ready tools.
  // Ranking is only used when the eligible public set exceeds the 20-tool
  // context budget.
  const visibleDefinitions = exposureDecision.exposedDefinitions;
  // The pre-ranking eligible surface is the authority+readiness envelope. It is
  // captured before disclosure narrowing so a delegated scope can never be
  // capped by the ranked <=20 Planner disclosure.
  const eligibleToolIds = visibleDefinitions.map((definition) => definition.id);
  const initialToolExposure: HarnessToolExposure = {
    exposedToolIds: eligibleToolIds,
    exposedDefinitions: visibleDefinitions,
    reason: exposureDecision.reason,
    blockedCapabilityIds: exposureDecision.blockedCapabilityIds,
    blockedCapabilityReasons: exposureDecision.blockedCapabilityReasons,
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
      eligibleToolIds,
      toolExposure: {
        ...initialToolExposure,
        reason: [...initialToolExposure.reason, exposureReason],
      },
    };
  }

  const profiles = resolveHarnessCapabilityProfiles(visibleDefinitions);
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const fallbackTop20 = (reason: string, retrievalError?: string) => {
    const selectedDefinitions = visibleDefinitions.slice(0, MAX_PLANNER_TOOLS);
    const toolCandidates = exposeAllHarnessToolCandidates({
      definitions: selectedDefinitions,
      reason,
    });
    const fallbackResolution: CapabilityResolutionResult = retrievalError
      ? {
          ...deterministicResolution,
          path: "semantic",
          trace: {
            ...deterministicResolution.trace,
            path: "semantic",
            modelCalls: 1,
            semanticAttempted: true,
          },
        }
      : deterministicResolution;
    return {
      query: input.query,
      source,
      toolCandidates,
      eligibleToolIds,
      toolExposure: {
        exposedToolIds: selectedDefinitions.map((definition) => definition.id),
        exposedDefinitions: selectedDefinitions,
        reason: [...initialToolExposure.reason, reason],
        blockedCapabilityIds: initialToolExposure.blockedCapabilityIds,
        blockedCapabilityReasons: initialToolExposure.blockedCapabilityReasons,
      },
      resolution: fallbackResolution,
      ...(retrievalError ? { retrievalError } : {}),
    } satisfies ResolveHarnessToolCandidatesForTurnResult;
  };

  // Deterministic-first preflight over the compact capability set. Exact and
  // clear capability/domain structural cases are resolved here without any
  // ranking model call. Lexical/semantic Tool Search stays a Progressive
  // Resolution fallback and is handled by the embedding/rerank path below.
  const deterministicResolution = await resolveCapabilityCascade({
    query: input.query,
    capabilities: buildCapabilityResolutionDocuments(profiles),
  });

  // Shared tail that expands resolved capabilities into concrete candidates and
  // fills any deterministic overflow so exposure is always exactly the best 20.
  const finalizeMatches = (matches: ResolvedHarnessCapabilityMatch[]) => {
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

    const rankedIds = new Set(
      rankedToolCandidates.map((candidate) => candidate.toolId),
    );
    const fillCandidates = exposeAllHarnessToolCandidates({
      definitions: visibleDefinitions.filter(
        (definition) => !rankedIds.has(definition.id),
      ),
      reason: "Unranked public tool retained as deterministic overflow fallback.",
    });
    const toolCandidates = [
      ...rankedToolCandidates,
      ...fillCandidates,
    ].slice(0, MAX_PLANNER_TOOLS);

    const definitionMap = new Map(
      visibleDefinitions.map((definition) => [definition.id, definition]),
    );
    const exposedDefinitions = toolCandidates
      .map((candidate) => definitionMap.get(candidate.toolId))
      .filter(
        (definition): definition is NonNullable<typeof definition> =>
          Boolean(definition),
      );

    return { toolCandidates, exposedDefinitions };
  };

  if (!input.query.trim() || profiles.length === 0) {
    return fallbackTop20(
      "Tool set exceeds 20; ranking input is unavailable, so Harness exposes a deterministic first 20 without applying any additional policy filter.",
    );
  }

  if (
    (deterministicResolution.path === "exact" ||
      deterministicResolution.path === "structural") &&
    deterministicResolution.candidates.length > 0
  ) {
    const matches = deterministicResolution.candidates
      .map((candidate) => {
        const profile = profileMap.get(candidate.capabilityId);
        if (!profile) return null;
        return {
          capabilityId: profile.id,
          title: profile.title,
          score: candidate.score,
          embeddingScore: 0,
          ruleScore: 0,
          rerankScore: 0,
          finalScore: candidate.score,
          candidateToolIds: profile.supportingToolIds,
          ...(profile.preferredToolId
            ? { preferredToolId: profile.preferredToolId }
            : {}),
        } satisfies ResolvedHarnessCapabilityMatch;
      })
      .filter(
        (match): match is NonNullable<typeof match> => match !== null,
      );

    const { toolCandidates, exposedDefinitions } = finalizeMatches(matches);
    const resolutionReason = `Capability resolution: deterministic ${deterministicResolution.path} match resolved without ranking, so no Tool Search model call was spent.`;

    return {
      query: input.query,
      source,
      toolCandidates,
      eligibleToolIds,
      toolExposure: {
        exposedToolIds: exposedDefinitions.map((definition) => definition.id),
        exposedDefinitions,
        reason: [...exposureDecision.reason, resolutionReason],
        blockedCapabilityIds: exposureDecision.blockedCapabilityIds,
        blockedCapabilityReasons: exposureDecision.blockedCapabilityReasons,
      },
      resolution: deterministicResolution,
    };
  }

  const documents = toCapabilityIntentDocuments(profiles);

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

  const { toolCandidates, exposedDefinitions } = finalizeMatches(matches);

  const rankingReason =
    "Eligible public tool set exceeds 20; Harness ranks the runtime-ready tools for this turn and exposes the top 20. Ranking adds no semantic policy filter.";
  const toolExposure: HarnessToolExposure = {
    exposedToolIds: exposedDefinitions.map((definition) => definition.id),
    exposedDefinitions,
    reason: [...exposureDecision.reason, rankingReason],
    blockedCapabilityIds: exposureDecision.blockedCapabilityIds,
    blockedCapabilityReasons: exposureDecision.blockedCapabilityReasons,
  };

  const semanticTopMatch = matches[0];
  const semanticResolution: CapabilityResolutionResult = {
    ...deterministicResolution,
    path: "semantic",
    selectedCapabilityId: semanticTopMatch?.capabilityId ?? null,
    trace: {
      ...deterministicResolution.trace,
      path: "semantic",
      modelCalls: retrievalError ? 1 : 2,
      semanticAttempted: true,
      ambiguous: true,
      selectedCapabilityId: semanticTopMatch?.capabilityId ?? null,
      selectedDomain: semanticTopMatch
        ? (profileMap.get(semanticTopMatch.capabilityId)?.domain ?? null)
        : null,
    },
  };

  return {
    query: input.query,
    source,
    toolCandidates,
    eligibleToolIds,
    toolExposure,
    resolution: semanticResolution,
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
