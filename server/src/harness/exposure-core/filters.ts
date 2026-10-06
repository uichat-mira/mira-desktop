import type { ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessExposurePolicyInput } from "./types.js";

export const shouldIncludeDefinition = (
  definition: ToolDefinition,
  input: HarnessExposurePolicyInput,
) => !getDefinitionBlockReason(definition, input);

export const getDefinitionBlockReason = (
  definition: ToolDefinition,
  input?: HarnessExposurePolicyInput,
): string | undefined => {
  // External MCP exposure follows the user's explicit Agent Access switch only.
  // Harness does not apply semantic, domain, sandbox, browser, or terminal heuristics.
  if (definition.source === "external") {
    if (!input?.allowExternal || !input.allowedExternalToolIds?.includes(definition.id)) {
      return "External MCP capability is not explicitly enabled for Agent access.";
    }
  }

  return undefined;
};
