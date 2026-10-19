import type { ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessExposurePolicyInput } from "./types.js";
import { resolveToolRuntimeReadiness } from "../runtime-readiness.js";

const INTERNAL_TERMINAL_COMPAT_TOOL_IDS = new Set([
  "terminal_session",
]);

const INTERNAL_AGENT_LEGACY_BROWSER_TOOL_IDS = new Set([
  "browser_observe",
  "browser_act",
]);

export const isAgentIntentCompatibilityOnlyToolId = (toolId: string) =>
  INTERNAL_AGENT_LEGACY_BROWSER_TOOL_IDS.has(toolId);

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

  if (
    definition.source === "internal" &&
    input?.source === "agent_intent" &&
    isAgentIntentCompatibilityOnlyToolId(definition.id)
  ) {
    // AGT-012 cutover: Computer Use Studio/Debugger still calls these exact ids,
    // but Main/Generic Agent must not discover them. Remove this compatibility
    // carve-out when those supported Studio consumers migrate off the legacy ids.
    return "Legacy Managed Browser Computer Use Tool is retained only for Computer Use Studio/Debugger compatibility and is not part of Agent exposure.";
  }

  // External MCP exposure follows the user's explicit Agent Access switch only.
  // Harness does not apply semantic, domain, sandbox, browser, or terminal heuristics.
  if (definition.source === "external") {
    if (!input?.allowExternal || !input.allowedExternalToolIds?.includes(definition.id)) {
      return "External MCP capability is not explicitly enabled for Agent access.";
    }
  }

  const readiness = resolveToolRuntimeReadiness(definition.id);
  if (readiness.state === "unavailable") {
    return readiness.reason;
  }

  return undefined;
};
