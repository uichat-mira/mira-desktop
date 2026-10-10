import type { SandboxProfile, ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessTurnSource } from "../shared/types.js";
import type { CapabilityResolutionResult } from "./capability-resolution.js";

export interface HarnessCapabilityMatch {
  capabilityId: string;
  score: number;
  embeddingScore: number;
  ruleScore: number;
  rerankScore: number;
  finalScore: number;
  reason?: string;
  candidateToolIds: string[];
  preferredToolId?: string;
}

export interface ResolvedHarnessCapabilityMatch extends HarnessCapabilityMatch {
  title: string;
}

export interface HarnessToolCandidate {
  toolId: string;
  title: string;
  description: string;
  domain: ToolDefinition["domain"];
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
}

export interface HarnessToolExposure {
  exposedToolIds: string[];
  exposedDefinitions: ToolDefinition[];
  reason: string[];
  blockedCapabilityIds: string[];
  blockedCapabilityReasons: Record<string, string>;
}


export interface ResolveHarnessToolCandidatesForTurnInput {
  query: string;
  modelHint?: string;
  editFacade?: import("../edit-facade.js").WorkspaceEditFacade;
  source?: HarnessTurnSource;
  maxTools?: number;
  topK?: number;
  minScore?: number;
  allowExternal?: boolean;
  allowedExternalToolIds?: string[];
  sandboxProfiles?: Partial<Record<SandboxProfile, boolean>>;
}

export interface ResolveHarnessToolCandidatesForTurnResult {
  query: string;
  source: HarnessTurnSource;
  toolCandidates: HarnessToolCandidate[];
  toolExposure: HarnessToolExposure;
  /**
   * Authoritative pre-ranking eligibility envelope: every runtime-ready,
   * Harness-eligible capability for this turn before the <=20 disclosure
   * narrowing. It is the authority+readiness surface a delegated scope may
   * build from, and it is deliberately independent of the ranked disclosure
   * subset returned in `toolExposure`.
   */
  eligibleToolIds: string[];
  retrievalError?: string;
  /**
   * Deterministic-first resolution evidence. It records which cascade stage
   * decided the turn and how many ranking/semantic model calls it spent, so
   * callers can audit that Tool Search is not invoked unnecessarily.
   */
  resolution?: CapabilityResolutionResult;
  retrievalModel?: {
    provider?: string;
    model?: string;
    modelConfigId?: string;
  };
  rerankModel?: {
    model?: string;
    modelConfigId?: string;
  };
}
