import type { ToolDefinition } from "@/mcp/core/definitions.js";
import { resolveHarnessToolExposure } from "@/harness/exposure.js";

export interface ChatToolSurfaceDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  tags: string[];
  domain: ToolDefinition["domain"];
  mode: ToolDefinition["mode"];
}

export interface ResolveChatToolSurfaceInput {
  allowlist?: string[];
  maxTools?: number;
  agentEnabled?: boolean;
}

const DEFAULT_CHAT_TOOL_ALLOWLIST = [
  "web_search",
] as const;
const DEFAULT_MAX_CHAT_TOOLS = 8;

const toChatToolSurfaceDefinition = (
  definition: ToolDefinition,
): ChatToolSurfaceDefinition => ({
  id: definition.id,
  name: definition.id,
  description: definition.description,
  inputSchema: definition.inputSchema,
  tags: definition.tags,
  domain: definition.domain,
  mode: definition.mode,
});

const isExternalMcpProjection = (definition: ToolDefinition) =>
  definition.tags.includes("external") && definition.tags.includes("mcp");

/**
 * Resolves the model-visible chat tool surface from the Harness registry.
 *
 * Important:
 * - It does not execute tools.
 * - It exposes the internal Harness tool surface to chat.
 * - Agent mode expands to all built-in tools but still excludes external MCP projections.
 */
export const resolveChatToolSurface = (
  input: ResolveChatToolSurfaceInput = {},
): ChatToolSurfaceDefinition[] => {
  const definitions = resolveHarnessToolExposure({
    source: input.agentEnabled ? "agent_intent" : "chat_surface",
  }).visibleDefinitions;

  if (input.agentEnabled) {
    return definitions
      .filter((definition) => !isExternalMcpProjection(definition))
      .map(toChatToolSurfaceDefinition);
  }

  const allowlist = new Set(input.allowlist ?? DEFAULT_CHAT_TOOL_ALLOWLIST);
  const maxTools = Math.max(1, input.maxTools ?? DEFAULT_MAX_CHAT_TOOLS);

  return definitions
    .filter((definition) => allowlist.has(definition.id))
    .slice(0, maxTools)
    .map(toChatToolSurfaceDefinition);
};

export const __chatToolSurfaceTestUtils = {
  DEFAULT_CHAT_TOOL_ALLOWLIST,
  DEFAULT_MAX_CHAT_TOOLS,
  isExternalMcpProjection,
};
