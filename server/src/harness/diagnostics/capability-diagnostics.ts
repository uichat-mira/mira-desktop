import type { SandboxProfile } from "../../mcp/core/definitions.js";
import { resolveHarnessActionProfiles } from "../action-profiles.js";
import { resolveHarnessCapabilityProfiles } from "../profiles/index.js";
import { resolveHarnessToolCandidatesForTurn } from "../candidates-core/index.js";
import type { CapabilityResolutionResult } from "../candidates-core/index.js";
import { resolveHarnessToolExposure } from "../exposure-core/index.js";
import type { ToolIntentCandidate } from "@/agent/intent/types.js";
import type { HarnessTurnSource } from "../shared/types.js";
import { listToolDefinitions } from "../registry.js";
import { resolveAgentEligibleExternalMcpCapabilities } from "@/mcp/external";

export interface HarnessCapabilityDiagnosticsInput {
  query: string;
  source?: HarnessTurnSource;
  topK?: number;
  minScore?: number;
  selectedTopK?: number;
  selectedMinScore?: number;
  allowExternal?: boolean;
  allowedExternalToolIds?: string[];
  sandboxProfiles?: Partial<Record<SandboxProfile, boolean>>;
}

export interface HarnessCapabilityDiagnosticsResult {
  query: string;
  source: HarnessTurnSource;
  exposureReasons: string[];
  blockedCapabilityIds: string[];
  blockedCapabilityReasons: Record<string, string>;
  eligibleExternalCapabilityIds: string[];
  registeredBlockedExternalCapabilityIds: string[];
  externalExposure: Array<{ id: string; status: "exposed" | "candidate" | "blocked"; reason: string }>;
  toolExposure: {
    exposedToolIds: string[];
    exposedDefinitions: Array<{
      id: string;
      title: string;
      description: string;
      domain: string;
      source: "internal" | "external";
      mode: string;
      tags: string[];
    }>;
    reason: string[];
    blockedCapabilityIds: string[];
  };
  toolCandidates: Array<{
    toolId: string;
    title: string;
    description: string;
    domain: string;
    source: "internal" | "external";
    tags: string[];
    score: number;
    embeddingScore: number;
    ruleScore: number;
    rerankScore: number;
    finalScore: number;
    reason?: string;
    actionProfileId?: string;
    actionProfileTitle?: string;
    actionProfileDescription?: string;
  }>;
  resolution?: CapabilityResolutionResult;
  retrievalModel?: {
    provider?: string;
    model?: string;
    modelConfigId?: string;
  };
  retrievalError?: string;
  rerankModel?: {
    model?: string;
    modelConfigId?: string;
  };
  profiles: Array<{
    capabilityId: string;
    preferredToolId?: string;
    supportingToolIds: string[];
    actionProfileId?: string;
    actionProfileTitle?: string;
    actionProfileDescription?: string;
    title: string;
    description: string;
    domain: string;
    source: "internal" | "external";
    tags: string[];
  }>;
  actionProfiles: Array<{
    actionProfileId: string;
    runtimeToolId: string;
    title: string;
    description: string;
    domain: string;
    source: "internal";
    tags: string[];
  }>;
  candidates: ToolIntentCandidate[];
}

export const resolveHarnessCapabilityDiagnostics = async (
  input: HarnessCapabilityDiagnosticsInput,
): Promise<HarnessCapabilityDiagnosticsResult> => {
  const source = input.source ?? "agent_intent";

  const candidateResolution = await resolveHarnessToolCandidatesForTurn({
    query: input.query,
    source,
    topK: input.topK,
    minScore: input.minScore,
    allowExternal: input.allowExternal,
    allowedExternalToolIds: input.allowedExternalToolIds,
    sandboxProfiles: input.sandboxProfiles,
  });
  const profiles = resolveHarnessCapabilityProfiles(
    candidateResolution.toolExposure.exposedDefinitions,
  );
  const actionProfiles = resolveHarnessActionProfiles(
    candidateResolution.toolExposure.exposedDefinitions,
  );
  const eligibleExternalCapabilityIds = resolveAgentEligibleExternalMcpCapabilities().map((item) => item.id);
  const eligibleSet = new Set(input.allowedExternalToolIds ?? eligibleExternalCapabilityIds);
  const registeredExternal = listToolDefinitions().filter((item) => item.source === "external");
  const exposureDecision = resolveHarnessToolExposure({
    source,
    query: input.query,
    allowExternal: input.allowExternal,
    allowedExternalToolIds: input.allowedExternalToolIds,
    sandboxProfiles: input.sandboxProfiles,
  });
  const exposureSet = new Set(exposureDecision.exposedToolIds);
  const candidateSet = new Set(candidateResolution.toolCandidates.map((candidate) => candidate.toolId));
  const candidates: ToolIntentCandidate[] = candidateResolution.toolCandidates.map((candidate) => ({
    toolId: candidate.toolId,
    title: candidate.title,
    description: candidate.description,
    score: candidate.score,
    embeddingScore: candidate.embeddingScore,
    ruleScore: candidate.ruleScore,
    rerankScore: candidate.rerankScore,
    finalScore: candidate.finalScore,
    source: candidate.source,
    domain: candidate.domain,
    tags: candidate.tags,
    ...(candidate.actionProfileId
      ? {
          actionProfileId: candidate.actionProfileId,
          actionProfileTitle: candidate.actionProfileTitle,
          actionProfileDescription: candidate.actionProfileDescription,
        }
      : {}),
    ...(candidate.reason ? { reason: candidate.reason } : {}),
  }));

  return {
    query: input.query,
    source,
    exposureReasons: candidateResolution.retrievalError
      ? [
          ...candidateResolution.toolExposure.reason,
          `Capability resolution fallback diagnostic: ${candidateResolution.retrievalError}`,
        ]
      : candidateResolution.toolExposure.reason,
    blockedCapabilityIds: candidateResolution.toolExposure.blockedCapabilityIds,
    blockedCapabilityReasons: candidateResolution.toolExposure.blockedCapabilityReasons,
    eligibleExternalCapabilityIds,
    registeredBlockedExternalCapabilityIds: registeredExternal
      .filter((item) => !exposureSet.has(item.id))
      .map((item) => item.id),
    externalExposure: registeredExternal.map((item) => ({
      id: item.id,
      status: candidateSet.has(item.id) ? "candidate" : exposureSet.has(item.id) ? "exposed" : "blocked",
      reason: exposureDecision.blockedCapabilityReasons[item.id] ??
        (eligibleSet.has(item.id) ? "External capability passed exposure." : "External capability is not in the explicit eligible allowlist."),
    })),
    toolExposure: {
      exposedToolIds: candidateResolution.toolExposure.exposedToolIds,
      exposedDefinitions: candidateResolution.toolExposure.exposedDefinitions.map((definition) => ({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        domain: definition.domain,
        source: definition.source,
        mode: definition.mode,
        tags: definition.tags,
      })),
      reason: candidateResolution.toolExposure.reason,
      blockedCapabilityIds: candidateResolution.toolExposure.blockedCapabilityIds,
    },
    toolCandidates: candidateResolution.toolCandidates.map((candidate) => ({
      toolId: candidate.toolId,
      title: candidate.title,
      description: candidate.description,
      domain: candidate.domain,
      source: candidate.source,
      tags: candidate.tags,
      score: candidate.score,
      embeddingScore: candidate.embeddingScore,
      ruleScore: candidate.ruleScore,
      rerankScore: candidate.rerankScore,
      finalScore: candidate.finalScore,
      ...(candidate.reason ? { reason: candidate.reason } : {}),
      ...(candidate.actionProfileId
        ? {
            actionProfileId: candidate.actionProfileId,
            actionProfileTitle: candidate.actionProfileTitle,
            actionProfileDescription: candidate.actionProfileDescription,
          }
        : {}),
    })),
    ...(candidateResolution.resolution
      ? { resolution: candidateResolution.resolution }
      : {}),
    ...(candidateResolution.retrievalModel
      ? { retrievalModel: candidateResolution.retrievalModel }
      : {}),
    ...(candidateResolution.retrievalError
      ? { retrievalError: candidateResolution.retrievalError }
      : {}),
    ...(candidateResolution.rerankModel
      ? { rerankModel: candidateResolution.rerankModel }
      : {}),
    profiles: profiles.map((profile) => ({
      capabilityId: profile.id,
      ...(profile.preferredToolId ? { preferredToolId: profile.preferredToolId } : {}),
      supportingToolIds: profile.supportingToolIds,
      ...(profile.actionProfileId
        ? {
            actionProfileId: profile.actionProfileId,
            actionProfileTitle: profile.actionProfileTitle,
            actionProfileDescription: profile.actionProfileDescription,
          }
        : {}),
      title: profile.title,
      description: profile.description,
      domain: profile.domain,
      source: profile.source,
      tags: profile.tags,
    })),
    actionProfiles: actionProfiles.map((profile) => ({
      actionProfileId: profile.id,
      runtimeToolId: profile.runtimeToolId,
      title: profile.title,
      description: profile.description,
      domain: profile.domain,
      source: profile.source,
      tags: profile.tags,
    })),
    candidates,
  };
};
