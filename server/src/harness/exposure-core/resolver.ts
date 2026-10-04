import type { ToolDefinition } from "../../mcp/core/definitions.js";
import { listToolDefinitions } from "../registry.js";
import {
  getDefinitionBlockReason,
  shouldIncludeDefinition,
} from "./filters.js";
import type { HarnessExposureDecision, HarnessExposurePolicyInput, HarnessExposureSource } from "./types.js";

const applyExposureSchema = (
  definition: ToolDefinition,
  source: HarnessExposureSource,
): ToolDefinition => {
  const exposedInputSchema = definition.inputSchemaByExposure?.[source];
  if (!exposedInputSchema) {
    return definition;
  }

  return {
    ...definition,
    inputSchema: exposedInputSchema,
  };
};

export const resolveHarnessToolExposure = (
  input: HarnessExposurePolicyInput,
): HarnessExposureDecision => {
  const definitions = listToolDefinitions();
  const blockedCapabilityIds: string[] = [];
  const blockedCapabilityReasons: Record<string, string> = {};

  const visibleDefinitions = definitions
    .filter((definition) => {
      const allowed = shouldIncludeDefinition(definition, input);
      if (!allowed) {
        blockedCapabilityIds.push(definition.id);
        blockedCapabilityReasons[definition.id] =
          getDefinitionBlockReason(definition, input) ??
          "Capability is an internal implementation primitive and is not part of the public tool surface.";
      }
      return allowed;
    })
    .map((definition) => applyExposureSchema(definition, input.source));

  return {
    exposedToolIds: visibleDefinitions.map((definition) => definition.id),
    exposedDefinitions: visibleDefinitions,
    reason: [],
    visibleDefinitions,
    blockedCapabilityIds,
    blockedCapabilityReasons,
    reasons: [],
  };
};

export const __exposureTestUtils = {};
