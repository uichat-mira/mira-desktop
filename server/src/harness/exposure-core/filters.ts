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

  // Native runtime readiness is authoritative Harness data. A registered Tool
  // whose mandatory prerequisite is missing is not Agent-visible; readiness is
  // supplied by the caller so diagnostics can still project the block reason.
  if (definition.source === "internal") {
    const readiness = input?.nativeReadiness?.[definition.id];
    if (readiness && readiness.state !== "ready") {
      return (
        readiness.reason ??
        `Native capability ${definition.id} is ${readiness.state}.`
      );
    }
  }

  return undefined;
};
