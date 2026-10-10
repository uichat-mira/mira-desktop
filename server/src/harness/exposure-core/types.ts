import type { SandboxProfile, ToolDefinition } from "../../mcp/core/definitions.js";
import type { NativeCapabilityReadiness } from "../native-capability-readiness.js";
import type { HarnessTurnSource } from "../shared/types.js";

export type HarnessExposureSource = HarnessTurnSource;

export interface HarnessExposurePolicyInput {
  source: HarnessExposureSource;
  editFacade?: import("../edit-facade.js").WorkspaceEditFacade;
  query?: string;
  allowExternal?: boolean;
  allowedExternalToolIds?: string[];
  sandboxProfiles?: Partial<Record<SandboxProfile, boolean>>;
  /**
   * Authoritative Harness runtime readiness keyed by Tool id. When present,
   * native capabilities that are not ready are excluded from the Agent-visible
   * surface. Callers that omit readiness keep the raw registry projection for
   * diagnostics; the Agent candidate resolver supplies it.
   */
  nativeReadiness?: Record<string, NativeCapabilityReadiness>;
}

export interface HarnessExposureDecision {
  exposedToolIds: string[];
  exposedDefinitions: ToolDefinition[];
  reason: string[];
  visibleDefinitions: ToolDefinition[];
  blockedCapabilityIds: string[];
  reasons: string[];
  blockedCapabilityReasons: Record<string, string>;
}

export type HarnessToolExposureResult = HarnessExposureDecision;
