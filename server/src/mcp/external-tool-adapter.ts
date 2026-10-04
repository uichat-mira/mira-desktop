import type { ToolDefinition } from "./core/definitions.js";

/**
 * Kind of MCP protocol surface a projected record belongs to. Today only the
 * `tool` surface is registered as a Mira Tool; resource/prompt are protocol
 * surfaces and must not be projected here.
 */
export type ExternalMcpProjectedKind = "tool";

/**
 * Neutral projection of a discovered MCP protocol tool.
 *
 * This is the canonical adapter boundary: everything below already speaks the
 * neutral Mira Tool vocabulary, so nothing in the registry/harness generic
 * execution path needs to know about External MCP protocol records.
 */
export interface ExternalMcpProjectedTool {
  id: string;
  serverId: string;
  serverDisplayName: string;
  remoteToolName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface ExternalMcpProjectedToolInput {
  serverId: string;
  serverDisplayName: string;
  remoteToolName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

const clampText = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

/**
 * Canonical projected Tool id for a discovered MCP protocol tool.
 *
 * The persisted/wire format is `mcp:<serverId>:tool:<toolName>` and must not
 * change: it is stored in `external_mcp_servers.discovered_tools_json`, shown
 * in the desktop MCP panel and used as the Harness Registry tool id.
 */
export const deriveProjectedToolId = (
  serverId: string,
  remoteToolName: string,
) => `mcp:${serverId}:tool:${remoteToolName}`;

export const toProjectedTool = (
  input: ExternalMcpProjectedToolInput,
): ExternalMcpProjectedTool => {
  const id = deriveProjectedToolId(input.serverId, input.remoteToolName);
  const remoteName = clampText(input.remoteToolName, 120);
  const description = input.description.trim()
    ? clampText(input.description, 1200)
    : `MCP capability ${remoteName} from ${input.serverDisplayName}`;

  return {
    id,
    serverId: input.serverId,
    serverDisplayName: input.serverDisplayName,
    remoteToolName: input.remoteToolName,
    title: input.title,
    description,
    inputSchema: input.inputSchema,
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
  };
};

const SAFE_TAG = /^[a-z0-9._-]+$/u;

/**
 * Project an adapted External MCP tool into a neutral Mira ToolDefinition.
 *
 * Preserves the existing contract: canonical projected id, `source="external"`,
 * `domain="external_mcp"`, display labels, input/output schema, the `mcp` /
 * `external` discovery tags plus a safe server-id tag, and the network/approval
 * policy metadata. The `sourceLabel` is redacted by the generic invocation path
 * when it emits events, so the adapter does not inject server config here.
 */
export const toExternalMcpToolDefinition = (
  tool: ExternalMcpProjectedTool,
): ToolDefinition => ({
  id: tool.id,
  title: tool.title,
  description: tool.description,
  domain: "external_mcp",
  source: "external",
  sourceLabel: tool.serverDisplayName,
  mode: "sync",
  inputSchema: tool.inputSchema,
  ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  tags: [
    "mcp",
    "external",
    ...(SAFE_TAG.test(tool.serverId) ? [tool.serverId] : []),
  ],
  capabilities: {
    sideEffect: "network",
    requiresApproval: true,
    networkAccess: true,
    longRunning: true,
  },
});
