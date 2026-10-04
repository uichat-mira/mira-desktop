import type { SandboxProfile, ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessTurnSource } from "../shared/types.js";

export type HarnessExposureSource = HarnessTurnSource;

export interface HarnessExposurePolicyInput {
  source: HarnessExposureSource;
  query?: string;
  allowExternal?: boolean;
  allowedExternalToolIds?: string[];
  sandboxProfiles?: Partial<Record<SandboxProfile, boolean>>;
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
