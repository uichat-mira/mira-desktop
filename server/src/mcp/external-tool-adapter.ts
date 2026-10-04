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
 *
 * `title`, `description`, `inputSchema` and `outputSchema` carry the discovered
 * values unchanged. The description fallback is applied only when building the
 * neutral `ToolDefinition`, so the persisted discovery record keeps its original
 * shape.
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

const slugifyToolName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/**
 * Canonical projected Tool id for a discovered MCP protocol tool.
 *
 * Reproduces the legacy `toProjectedCapabilityId` semantics exactly, including
 * the slugify rule for the remote tool name. The persisted/wire format is
 * `mcp:<serverId>:tool:<slugifiedToolName>` and must not change: it is stored in
 * `external_mcp_servers.discovered_tools_json`, shown in the desktop MCP panel,
 * and used as the Harness Registry tool id.
 */
export const deriveProjectedToolId = (
  serverId: string,
  remoteToolName: string,
) => `mcp:${serverId}:tool:${slugifyToolName(remoteToolName)}`;

/**
 * Adapt a discovered MCP protocol tool into the neutral projection record.
 *
 * Carries `title`, `description`, `inputSchema` and `outputSchema` through
 * unchanged so discovery keeps its original persisted shape.
 */
export const toProjectedTool = (
  input: ExternalMcpProjectedToolInput,
): ExternalMcpProjectedTool => ({
  id: deriveProjectedToolId(input.serverId, input.remoteToolName),
  serverId: input.serverId,
  serverDisplayName: input.serverDisplayName,
  remoteToolName: input.remoteToolName,
  title: input.title,
  description: input.description,
  inputSchema: input.inputSchema,
  ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
});

/**
 * Project an adapted External MCP tool into a neutral Mira ToolDefinition.
 *
 * Preserves the legacy contract: canonical projected id, `source="external"`,
 * `domain="external_mcp"`, display labels, input/output schema, the `mcp` /
 * `external` / server-id tags, the description fallback keyed off the server
 * display name, and the network/approval policy metadata. The `sourceLabel` is
 * redacted by the generic invocation path when it emits events, so the adapter
 * does not inject server config here.
 */
export const toExternalMcpToolDefinition = (
  tool: ExternalMcpProjectedTool,
): ToolDefinition => ({
  id: tool.id,
  title: tool.title,
  description:
    tool.description ||
    `MCP capability ${tool.remoteToolName} from ${tool.serverDisplayName}`,
  domain: "external_mcp",
  source: "external",
  sourceLabel: tool.serverDisplayName,
  mode: "sync",
  inputSchema: tool.inputSchema,
  ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  tags: ["mcp", "external", tool.serverId],
  capabilities: {
    sideEffect: "network",
    requiresApproval: true,
    networkAccess: true,
    longRunning: true,
  },
});
