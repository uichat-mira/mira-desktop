import { resolveHarnessToolExposure } from "../exposure-core/index.js";
import { resolveHarnessCapabilityProfiles } from "../profiles/index.js";
import { resolveWorkspaceEditFacadeForModel } from "../edit-facade.js";
import {
  expandHarnessToolCandidates,
  exposeAllHarnessToolCandidates,
} from "./expand-tool-candidates.js";
import {
  buildCapabilityResolutionDocuments,
  type CapabilityResolutionResult,
} from "./capability-resolution.js";
import { resolveProgressiveCapabilitySearch } from "./capability-resolution.semantic.js";
import { TOOL_EXPOSURE_RECALL_THRESHOLD } from "./scoring.js";
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

  const fallbackTop20 = (
    reason: string,
    resolution?: CapabilityResolutionResult,
  ) => {
    const selectedDefinitions = visibleDefinitions.slice(0, MAX_PLANNER_TOOLS);
    const toolCandidates = exposeAllHarnessToolCandidates({
      definitions: selectedDefinitions,
      reason,
    });
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
      ...(resolution ? { resolution } : {}),
      ...(resolution?.trace.semanticError
        ? { retrievalError: resolution.trace.semanticError }
        : {}),
    } satisfies ResolveHarnessToolCandidatesForTurnResult;
  };

  if (!input.query.trim() || profiles.length === 0) {
    return fallbackTop20(
      "Tool set exceeds 20; progressive resolution input is unavailable, so Harness exposes a deterministic first 20 without applying any additional policy filter.",
    );
  }

  const resolution = await resolveProgressiveCapabilitySearch({
    query: input.query,
    capabilities: buildCapabilityResolutionDocuments(profiles),
    ...(input.knownCapabilityId
      ? { knownCapabilityId: input.knownCapabilityId }
      : {}),
    ...(input.semanticResolver
      ? { semanticResolver: input.semanticResolver }
      : {}),
    ...(input.resolutionBudget ? { budget: input.resolutionBudget } : {}),
  });

  const toMatches = (value: CapabilityResolutionResult) =>
    value.candidates
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
          reason: candidate.reason,
          candidateToolIds: profile.supportingToolIds,
          ...(profile.preferredToolId
            ? { preferredToolId: profile.preferredToolId }
            : {}),
        } satisfies ResolvedHarnessCapabilityMatch;
      })
      .filter(
        (match): match is NonNullable<typeof match> => match !== null,
      );

  const finalizeMatches = (matches: ResolvedHarnessCapabilityMatch[]) => {
    const rankedToolCandidates = dedupeCandidates(
      expandHarnessToolCandidates({
        matches,
        definitions: visibleDefinitions,
      }),
    );

    const rankedIds = new Set(
      rankedToolCandidates.map((candidate) => candidate.toolId),
    );
    const fillCandidates = exposeAllHarnessToolCandidates({
      definitions: visibleDefinitions.filter(
        (definition) => !rankedIds.has(definition.id),
      ),
      reason:
        "Unresolved public tool retained as deterministic overflow fallback.",
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

  if (
    resolution.selectedCapabilityId &&
    (resolution.path === "exact" ||
      resolution.path === "structural" ||
      resolution.path === "lexical" ||
      resolution.path === "semantic")
  ) {
    const matches = toMatches(resolution);
    if (matches.length > 0) {
      const { toolCandidates, exposedDefinitions } = finalizeMatches(matches);
      const resolutionReason =
        "Progressive capability resolution selected " +
        resolution.selectedCapabilityId +
        " via " +
        resolution.path +
        "; modelCalls=" +
        resolution.trace.modelCalls +
        ". Search changes disclosure order only and grants no authority.";

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
        resolution,
      };
    }
  }

  return fallbackTop20(
    "Tool set exceeds 20; progressive resolution stopped at " +
      resolution.path +
      " without a selected capability, so Harness exposes a deterministic first 20 while preserving the resolution trace.",
    resolution,
  );
};
