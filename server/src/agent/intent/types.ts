import type { ProxyProviderParam } from "@/services/provider-proxy.service/index";
import type {
  CapabilityResolutionResult,
  HarnessToolCandidate,
  HarnessToolExposure,
} from "@/harness/tool-candidates";

export interface AgentIntentEmbeddingConfig {
  requestedProvider?: ProxyProviderParam;
  topK?: number;
  minScore?: number;
}

export interface CapabilityIntentDocument {
  capabilityId: string;
  title: string;
  text: string;
  source: "internal" | "external";
  domain: string;
  tags: string[];
  inputSchema?: Record<string, unknown>;
  sourceLabel?: string;
  preferredToolId?: string;
  supportingToolIds?: string[];
  actionProfileId?: string;
}

export interface ToolIntentCandidate {
  toolId: string;
  title: string;
  description: string;
  score: number;
  embeddingScore: number;
  ruleScore: number;
  rerankScore?: number;
  finalScore?: number;
  source: "internal" | "external";
  domain: string;
  tags: string[];
  actionProfileId?: string;
  actionProfileTitle?: string;
  actionProfileDescription?: string;
  reason?: string;
}

export interface ToolIntentResult {
  query: string;
  topCandidates: ToolIntentCandidate[];
  toolCandidates: HarnessToolCandidate[];
  toolExposure: HarnessToolExposure;
  /**
   * Authoritative pre-ranking eligibility envelope from the Harness turn
   * resolution. Optional for legacy callers that only carry disclosure.
   */
  eligibleToolIds?: string[];
  exposureReasons?: string[];
  /**
   * Deterministic-first resolution evidence for this turn: which cascade stage
   * decided the capability set and how many ranking/semantic model calls it
   * spent. It makes Tool Search usage auditable without changing exposure.
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

export type CapabilityIntentCandidate = ToolIntentCandidate;
