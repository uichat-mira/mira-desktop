import type { ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessExposurePolicyInput } from "./types.js";

const INTERNAL_READ_PRIMITIVE_TOOL_IDS = new Set([
  "read_discover",
  "read_open",
  "read_list",
  "read_locate",
  "read_extract",
  "read_slice",
]);

export const isInternalIntentOnlyTool = (definition: ToolDefinition) =>
  definition.source === "internal" && INTERNAL_READ_PRIMITIVE_TOOL_IDS.has(definition.id);

export const shouldIncludeDefinition = (
  definition: ToolDefinition,
  input: HarnessExposurePolicyInput,
) => !getDefinitionBlockReason(definition, input);

export const getDefinitionBlockReason = (
  definition: ToolDefinition,
  input?: HarnessExposurePolicyInput,
): string | undefined => {
  // These are implementation/compatibility primitives, not public Agent tools.
  if (isInternalIntentOnlyTool(definition)) {
    return "Internal read primitive is not part of the public Read contract.";
  }

  // External MCP exposure follows the user's explicit Agent Access switch only.
  // Harness does not apply semantic, domain, sandbox, browser, or terminal heuristics.
  if (definition.source === "external") {
    if (!input?.allowExternal || !input.allowedExternalToolIds?.includes(definition.id)) {
      return "External MCP capability is not explicitly enabled for Agent access.";
    }
  }

  return undefined;
};
