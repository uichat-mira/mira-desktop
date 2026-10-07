import type { ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessExposurePolicyInput } from "./types.js";

const INTERNAL_TERMINAL_COMPAT_TOOL_IDS = new Set([
  "terminal_session",
]);

export const shouldIncludeDefinition = (
  definition: ToolDefinition,
  input: HarnessExposurePolicyInput,
) => !getDefinitionBlockReason(definition, input);

export const getDefinitionBlockReason = (
  definition: ToolDefinition,
  input?: HarnessExposurePolicyInput,
): string | undefined => {
  if (
    definition.source === "internal" &&
    INTERNAL_TERMINAL_COMPAT_TOOL_IDS.has(definition.id)
  ) {
    return "Legacy terminal alias is not part of the public Terminal contract.";
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
