import type { ToolDefinition } from "../../mcp/core/definitions.js";
import { listToolDefinitions } from "../registry.js";
import {
  getDefinitionBlockReason,
  shouldIncludeDefinition,
} from "./filters.js";
import type { HarnessExposureDecision, HarnessExposurePolicyInput, HarnessExposureSource } from "./types.js";

const PRIMITIVE_EDIT_TOOL_IDS = new Set(["write", "edit", "move", "delete"]);

const materializeWorkspaceEditFacade = (
  definitions: ToolDefinition[],
  input: HarnessExposurePolicyInput,
) => {
  const requested =
    input.editFacade ?? (input.source === "tools_list" ? "all" : "primitives");
  const hasApplyPatch = definitions.some(
    (definition) => definition.id === "apply_patch",
  );
  const facade =
    requested === "apply_patch" && !hasApplyPatch ? "primitives" : requested;

  if (facade === "all") {
    return { definitions, reason: undefined };
  }

  if (facade === "apply_patch") {
    return {
      definitions: definitions.filter(
        (definition) => !PRIMITIVE_EDIT_TOOL_IDS.has(definition.id),
      ),
      reason:
        "Workspace Edit materialized as apply_patch for this exposure.",
    };
  }

  return {
    definitions: definitions.filter(
      (definition) => definition.id !== "apply_patch",
    ),
    reason: hasApplyPatch
      ? "Workspace Edit materialized as write/edit/move/delete for this exposure."
      : undefined,
  };
};

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

  const publicDefinitions = definitions
    .filter((definition) => {
      const allowed = shouldIncludeDefinition(definition, input);
      if (!allowed) {
        blockedCapabilityIds.push(definition.id);
        blockedCapabilityReasons[definition.id] =
          getDefinitionBlockReason(definition, input) ??
          "Capability is an internal implementation primitive and is not part of the public tool surface.";
      }
      return allowed;
    });

  const materialized = materializeWorkspaceEditFacade(
    publicDefinitions,
    input,
  );
  const visibleDefinitions = materialized.definitions.map((definition) =>
    applyExposureSchema(definition, input.source),
  );
  const reasons = materialized.reason ? [materialized.reason] : [];

  return {
    exposedToolIds: visibleDefinitions.map((definition) => definition.id),
    exposedDefinitions: visibleDefinitions,
    reason: reasons,
    visibleDefinitions,
    blockedCapabilityIds,
    blockedCapabilityReasons,
    reasons,
  };
};

export const __exposureTestUtils = {};
