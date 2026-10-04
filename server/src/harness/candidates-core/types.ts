import type { SandboxProfile, ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessTurnSource } from "../shared/types.js";

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
  retrievalError?: string;
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
