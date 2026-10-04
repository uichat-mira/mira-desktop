import { getSqlite } from "@/db";
import { mcpBadRequest, mcpInternalError, mcpNotFound } from "./core/errors.js";
import type { ToolDefinition, ToolImplementation } from "./core/definitions.js";
import {
  getToolImplementation,
  listToolDefinitions,
  registerTool,
  unregisterTool,
} from "../harness/registry.js";
import { StdioMcpSession } from "./stdio-session.js";
import { redactExternalMcpValue } from "./external-redaction.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const DISCLAIMER_TEXT_HASH = "external-mcp-disclaimer-v1";

export type ExternalMcpTransportKind = "streamable-http" | "stdio";
export type ExternalMcpServerStatus = "configured" | "connected" | "failed";
export type ExternalMcpAuthType = "none" | "bearer";

export type ExternalMcpTransportConfig =
  | {
      kind: "streamable-http";
      url: string;
    }
  | {
      kind: "stdio";
      command: string;
      args?: string[];
    };

export interface CreateExternalMcpServerInput {
  id?: string;
  registryUrl?: string;
  packageName?: string;
  documentationUrl?: string;
  repositoryUrl?: string;
  displayName: string;
  description?: string;
  version?: string;
  transport: ExternalMcpTransportConfig;
  disclaimerAccepted: boolean;
  disclaimerTextHash?: string;
}

export interface ExternalMcpDiscoveredTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  projectedCapabilityId: string;
}

export interface ExternalMcpConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "number" | "json";
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
}

export interface ExternalMcpConfigSchemaResolution {
  fields: ExternalMcpConfigField[];
  completeness: "known-partial" | "known-good" | "unknown";
  sources: Array<"preset" | "marketplace" | "server-self-describe" | "manual">;
  notes?: string[];
}

export interface ExternalMcpServerConfigRecord {
  endpointUrl?: string;
  command?: string;
  argsText?: string;
  packageName?: string;
  cwd?: string;
  envJson?: string;
  authType: ExternalMcpAuthType;
  timeoutMs: number;
  customHeadersJson: string;
  hasBearerToken: boolean;
}

export interface ExternalMcpRemoteServerInfo {
  name?: string;
  title?: string;
  version?: string;
}

export interface ExternalMcpRemoteCapabilitiesSummary {
  hasTools: boolean;
  hasResources: boolean;
  hasPrompts: boolean;
}

export interface UpdateExternalMcpServerConfigInput {
  endpointUrl?: string;
  command?: string;
  argsText?: string;
  cwd?: string;
  envJson?: string;
  authType: ExternalMcpAuthType;
  timeoutMs: number;
  customHeadersJson: string;
  bearerToken?: string | null;
}

export interface ExternalMcpServerRecord {
  id: string;
  source: "registry" | "manual";
  registryUrl?: string;
  packageName?: string;
  documentationUrl?: string;
  repositoryUrl?: string;
  displayName: string;
  description?: string;
  version?: string;
  transport: ExternalMcpTransportConfig;
  status: ExternalMcpServerStatus;
  enabled: boolean;
  agentEnabled: boolean;
  disclaimerAcceptedAt?: string;
  disclaimerTextHash?: string;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
  lastError?: string;
  sessionId?: string;
  protocolVersion?: string;
  remoteServerInfo?: ExternalMcpRemoteServerInfo;
  remoteCapabilities?: ExternalMcpRemoteCapabilitiesSummary;
  discoveredTools: ExternalMcpDiscoveredTool[];
}

interface ExternalMcpRuntimeConfig {
  endpointUrl?: string;
  command?: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  authType: ExternalMcpAuthType;
  timeoutMs: number;
  customHeaders: Record<string, string>;
  bearerToken?: string;
}

interface ExternalMcpServerRow {
  id: string;
  source: "registry" | "manual";
  registry_url: string | null;
  package_name: string | null;
  documentation_url: string | null;
  repository_url: string | null;
  display_name: string;
  description: string | null;
  version: string | null;
  transport_kind: ExternalMcpTransportKind;
  endpoint_url: string | null;
  command: string | null;
  args_json: string | null;
  cwd: string | null;
  env_json: string;
  status: ExternalMcpServerStatus;
  enabled: number;
  agent_enabled: number;
  disclaimer_accepted_at: string | null;
  disclaimer_text_hash: string | null;
  created_at: string;
  updated_at: string;
  last_connected_at: string | null;
  last_error: string | null;
  session_id: string | null;
  protocol_version: string | null;
  remote_server_info_json: string;
  remote_capabilities_json: string;
  discovered_tools_json: string;
  config_json: string;
  secret_json: string;
}

interface JsonRpcResponse<T> {
  jsonrpc?: "2.0";
  id?: string | number | null;
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
}

interface InitializeResult {
  protocolVersion?: string;
  serverInfo?: ExternalMcpRemoteServerInfo;
  capabilities?: Record<string, unknown>;
  sessionId?: string;
}

interface ToolsListResult {
  tools?: Array<{
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
}

const nowIso = () => new Date().toISOString();

const slugifyServerId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const sanitizeServerId = (input: CreateExternalMcpServerInput) => {
  const candidate =
    input.id ??
    input.packageName ??
    input.displayName ??
    (input.transport.kind === "streamable-http"
      ? new URL(input.transport.url).hostname
      : input.transport.command);
  const id = slugifyServerId(candidate);
  if (!id) {
    throw mcpBadRequest("External MCP server id is required");
  }
  return id;
};

const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
};

const parseDiscoveredTools = (value: string): ExternalMcpDiscoveredTool[] => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? (parsed as ExternalMcpDiscoveredTool[]) : [];
  } catch {
    return [];
  }
};

const parseRemoteServerInfo = (
  value: string | null | undefined,
): ExternalMcpRemoteServerInfo | undefined => {
  try {
    const parsed = JSON.parse(value || "null") as ExternalMcpRemoteServerInfo | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return {
      ...(typeof parsed.name === "string" && parsed.name.trim() ? { name: parsed.name.trim() } : {}),
      ...(typeof parsed.title === "string" && parsed.title.trim() ? { title: parsed.title.trim() } : {}),
      ...(typeof parsed.version === "string" && parsed.version.trim() ? { version: parsed.version.trim() } : {}),
    };
  } catch {
    return undefined;
  }
};

const parseRemoteCapabilities = (
  value: string | null | undefined,
): ExternalMcpRemoteCapabilitiesSummary | undefined => {
  try {
    const parsed = JSON.parse(value || "null") as ExternalMcpRemoteCapabilitiesSummary | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return {
      hasTools: Boolean(parsed.hasTools),
      hasResources: Boolean(parsed.hasResources),
      hasPrompts: Boolean(parsed.hasPrompts),
    };
  } catch {
    return undefined;
  }
};

const parseConfigJson = (
  value: string | null | undefined,
): {
  authType?: ExternalMcpAuthType;
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
} => {
  try {
    const parsed = JSON.parse(value || "{}") as {
      authType?: ExternalMcpAuthType;
      timeoutMs?: number;
      customHeaders?: Record<string, string>;
    };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const parseSecretJson = (
  value: string | null | undefined,
): {
  bearerToken?: string;
} => {
  try {
    const parsed = JSON.parse(value || "{}") as {
      bearerToken?: string;
    };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const DEFAULT_TIMEOUT_MS = 30000;
const stdioSessions = new Map<string, StdioMcpSession>();

const redactExternalMcpText = (value: string, row?: ExternalMcpServerRow) => {
  const secret = row ? parseSecretJson(row.secret_json).bearerToken : undefined;
  return String(redactExternalMcpValue(value, secret ? [secret] : []));
};

const externalMcpFailure = (error: unknown, row?: ExternalMcpServerRow) =>
  new Error(redactExternalMcpText(error instanceof Error ? error.message : String(error), row));

const canRecoverExternalMcpSession = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /session|initialize|timed out|HTTP (?:400|404|405|406|410)|not available|closed unexpectedly/iu.test(
    message,
  );
};

const toRuntimeConfig = (row: ExternalMcpServerRow): ExternalMcpRuntimeConfig => {
  const config = parseConfigJson(row.config_json);
  const secret = parseSecretJson(row.secret_json);
  const args = (() => {
    try {
      const parsed = JSON.parse(row.args_json || "[]");
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  })();
  const env = (() => {
    try {
      const parsed = JSON.parse(row.env_json || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          result[key] = value;
        }
      }
      return result;
    } catch {
      return {};
    }
  })();
  return {
    ...(row.endpoint_url ? { endpointUrl: row.endpoint_url } : {}),
    ...(row.command ? { command: row.command } : {}),
    args,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    env,
    authType: config.authType === "bearer" ? "bearer" : "none",
    timeoutMs:
      typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
        ? Math.round(config.timeoutMs)
        : DEFAULT_TIMEOUT_MS,
    customHeaders:
      config.customHeaders && typeof config.customHeaders === "object" ? config.customHeaders : {},
    ...(secret.bearerToken ? { bearerToken: secret.bearerToken } : {}),
  };
};

const formatConnectFailureMessage = (row: ExternalMcpServerRow, error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  const command = row.command?.trim() ?? "";

  if (raw.includes("spawn npx ENOENT") || raw.includes("spawn npx.cmd ENOENT")) {
    return "连接失败：当前系统环境里找不到 npx。请确认 Node.js / npm 已正确安装，或把启动命令改成可执行的完整路径。";
  }

  if (raw.includes("spawn uvx ENOENT") || raw.includes("spawn uvx.cmd ENOENT")) {
    return "连接失败：当前系统环境里找不到 uvx。请确认 uv 已安装，或把启动命令改成可执行的完整路径。";
  }

  if (raw.includes("timeout")) {
    return `连接失败：请求超时。${raw}`;
  }

  if (raw.includes("response did not include result")) {
    return "连接失败：本地 MCP 进程启动了，但没有返回有效的初始化结果。请检查该 MCP 包是否兼容当前协议。";
  }

  if (raw.includes("Content-Length")) {
    return "连接失败：本地 MCP 进程输出格式不符合 stdio MCP 协议。";
  }

  return command
    ? `连接失败：启动 ${command} 时出错。${raw}`
    : `连接失败：${raw}`;
};

const serializeHeadersJson = (headers: Record<string, string>) =>
  Object.keys(headers).length === 0 ? "" : JSON.stringify(headers, null, 2);

const toRecord = (row: ExternalMcpServerRow): ExternalMcpServerRecord => ({
  id: row.id,
  source: row.source,
  ...(row.registry_url ? { registryUrl: row.registry_url } : {}),
  ...(row.package_name ? { packageName: row.package_name } : {}),
  ...(row.documentation_url ? { documentationUrl: row.documentation_url } : {}),
  ...(row.repository_url ? { repositoryUrl: row.repository_url } : {}),
  displayName: row.display_name,
  ...(row.description ? { description: row.description } : {}),
  ...(row.version ? { version: row.version } : {}),
  transport:
    row.transport_kind === "stdio"
      ? {
          kind: "stdio",
          command: row.command ?? "",
          args: (() => {
            try {
              const parsed = JSON.parse(row.args_json || "[]");
              return Array.isArray(parsed)
                ? parsed.filter((item): item is string => typeof item === "string")
                : [];
            } catch {
              return [];
            }
          })(),
        }
      : {
          kind: "streamable-http",
          url: row.endpoint_url ?? "",
        },
  status: row.status,
  enabled: Boolean(row.enabled),
  agentEnabled: Boolean(row.agent_enabled),
  ...(row.disclaimer_accepted_at ? { disclaimerAcceptedAt: row.disclaimer_accepted_at } : {}),
  ...(row.disclaimer_text_hash ? { disclaimerTextHash: row.disclaimer_text_hash } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.last_connected_at ? { lastConnectedAt: row.last_connected_at } : {}),
  ...(row.last_error ? { lastError: row.last_error } : {}),
  ...(row.session_id ? { sessionId: row.session_id } : {}),
  ...(row.protocol_version ? { protocolVersion: row.protocol_version } : {}),
  ...(parseRemoteServerInfo(row.remote_server_info_json)
    ? { remoteServerInfo: parseRemoteServerInfo(row.remote_server_info_json) }
    : {}),
  ...(parseRemoteCapabilities(row.remote_capabilities_json)
    ? { remoteCapabilities: parseRemoteCapabilities(row.remote_capabilities_json) }
    : {}),
  discoveredTools: parseDiscoveredTools(row.discovered_tools_json),
});

export const initializeExternalMcpDatabase = () => {
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS external_mcp_servers (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('registry', 'manual')),
      registry_url TEXT,
      package_name TEXT,
      documentation_url TEXT,
      repository_url TEXT,
      display_name TEXT NOT NULL,
      description TEXT,
      version TEXT,
      transport_kind TEXT NOT NULL CHECK(transport_kind IN ('streamable-http', 'stdio')),
      endpoint_url TEXT,
      command TEXT,
      args_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('configured', 'connected', 'failed')) DEFAULT 'configured',
      enabled INTEGER NOT NULL DEFAULT 1,
      agent_enabled INTEGER NOT NULL DEFAULT 0,
      disclaimer_accepted_at TEXT,
      disclaimer_text_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_connected_at TEXT,
      last_error TEXT,
      session_id TEXT,
      protocol_version TEXT,
      remote_server_info_json TEXT NOT NULL DEFAULT 'null',
      remote_capabilities_json TEXT NOT NULL DEFAULT 'null',
      discovered_tools_json TEXT NOT NULL DEFAULT '[]',
      config_json TEXT NOT NULL DEFAULT '{}',
      secret_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_external_mcp_servers_status
      ON external_mcp_servers(status);
  `);

  const tableSql = (
    sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'external_mcp_servers'")
      .get() as { sql?: string } | undefined
  )?.sql;

  const requiresLegacyTableMigration =
    typeof tableSql === "string" &&
    (tableSql.includes("CHECK(transport_kind IN ('streamable-http'))") ||
      tableSql.includes("endpoint_url TEXT NOT NULL"));

  if (requiresLegacyTableMigration) {
    sqlite.exec(`
      BEGIN;

      ALTER TABLE external_mcp_servers RENAME TO external_mcp_servers_legacy;

      CREATE TABLE external_mcp_servers (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('registry', 'manual')),
        registry_url TEXT,
        package_name TEXT,
        documentation_url TEXT,
        repository_url TEXT,
        display_name TEXT NOT NULL,
        description TEXT,
        version TEXT,
        transport_kind TEXT NOT NULL CHECK(transport_kind IN ('streamable-http', 'stdio')),
        endpoint_url TEXT,
        command TEXT,
        args_json TEXT NOT NULL DEFAULT '[]',
        cwd TEXT,
        env_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK(status IN ('configured', 'connected', 'failed')) DEFAULT 'configured',
        enabled INTEGER NOT NULL DEFAULT 1,
        agent_enabled INTEGER NOT NULL DEFAULT 0,
        disclaimer_accepted_at TEXT,
        disclaimer_text_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_connected_at TEXT,
        last_error TEXT,
        session_id TEXT,
        protocol_version TEXT,
        remote_server_info_json TEXT NOT NULL DEFAULT 'null',
        remote_capabilities_json TEXT NOT NULL DEFAULT 'null',
        discovered_tools_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        secret_json TEXT NOT NULL DEFAULT '{}'
      );

      INSERT INTO external_mcp_servers (
        id,
        source,
        registry_url,
        package_name,
        documentation_url,
        repository_url,
        display_name,
        description,
        version,
        transport_kind,
        endpoint_url,
        command,
        args_json,
        status,
        enabled,
        agent_enabled,
        disclaimer_accepted_at,
        disclaimer_text_hash,
        created_at,
        updated_at,
        last_connected_at,
        last_error,
        session_id,
        protocol_version,
        remote_server_info_json,
        remote_capabilities_json,
        discovered_tools_json,
        config_json,
        secret_json
      )
      SELECT
        id,
        source,
        registry_url,
        package_name,
        NULL,
        NULL,
        display_name,
        description,
        version,
        transport_kind,
        endpoint_url,
        command,
        COALESCE(args_json, '[]'),
        status,
        enabled,
        0,
        disclaimer_accepted_at,
        disclaimer_text_hash,
        created_at,
        updated_at,
        last_connected_at,
        last_error,
        session_id,
        protocol_version,
        COALESCE(remote_server_info_json, 'null'),
        COALESCE(remote_capabilities_json, 'null'),
        COALESCE(discovered_tools_json, '[]'),
        COALESCE(config_json, '{}'),
        COALESCE(secret_json, '{}')
      FROM external_mcp_servers_legacy;

      DROP TABLE external_mcp_servers_legacy;

      CREATE INDEX IF NOT EXISTS idx_external_mcp_servers_status
        ON external_mcp_servers(status);

      COMMIT;
    `);
  }

  const columns = (
    sqlite.prepare("PRAGMA table_info(external_mcp_servers)").all() as Array<{ name: string }>
  ).map((column) => column.name);

  if (!columns.includes("config_json")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'",
    );
  }

  if (!columns.includes("secret_json")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN secret_json TEXT NOT NULL DEFAULT '{}'",
    );
  }

  if (!columns.includes("remote_server_info_json")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN remote_server_info_json TEXT NOT NULL DEFAULT 'null'",
    );
  }

  if (!columns.includes("remote_capabilities_json")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN remote_capabilities_json TEXT NOT NULL DEFAULT 'null'",
    );
  }

  if (!columns.includes("command")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN command TEXT",
    );
  }

  if (!columns.includes("args_json")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN args_json TEXT NOT NULL DEFAULT '[]'",
    );
  }

  if (!columns.includes("cwd")) {
    sqlite.exec("ALTER TABLE external_mcp_servers ADD COLUMN cwd TEXT");
  }

  if (!columns.includes("env_json")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN env_json TEXT NOT NULL DEFAULT '{}'",
    );
  }

  if (!columns.includes("documentation_url")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN documentation_url TEXT",
    );
  }

  if (!columns.includes("repository_url")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN repository_url TEXT",
    );
  }

  if (!columns.includes("agent_enabled")) {
    sqlite.exec(
      "ALTER TABLE external_mcp_servers ADD COLUMN agent_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }
};

const getServerRow = (serverId: string): ExternalMcpServerRow | undefined => {
  initializeExternalMcpDatabase();
  return getSqlite()
    .prepare("SELECT * FROM external_mcp_servers WHERE id = ?")
    .get(serverId) as ExternalMcpServerRow | undefined;
};

const getRequiredServer = (serverId: string): ExternalMcpServerRecord => {
  const row = getServerRow(serverId);
  if (!row) {
    throw mcpNotFound(`External MCP server not found: ${serverId}`);
  }
  return toRecord(row);
};

export const getExternalMcpServer = (serverId: string): ExternalMcpServerRecord =>
  getRequiredServer(serverId);

export const listExternalMcpServers = (): ExternalMcpServerRecord[] => {
  initializeExternalMcpDatabase();
  return (
    getSqlite()
      .prepare("SELECT * FROM external_mcp_servers ORDER BY updated_at DESC")
      .all() as ExternalMcpServerRow[]
  ).map(toRecord);
};

export type UpdateExternalMcpAccessInput = {
  agentEnabled: boolean;
};

export const updateExternalMcpAccess = (
  serverId: string,
  input: UpdateExternalMcpAccessInput,
): ExternalMcpServerRecord => {
  if (typeof input.agentEnabled !== "boolean") {
    throw mcpBadRequest("agentEnabled must be a boolean");
  }
  const existing = getRequiredServer(serverId);
  initializeExternalMcpDatabase();
  getSqlite()
    .prepare(
      `UPDATE external_mcp_servers
       SET agent_enabled = @agentEnabled, updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run({
      id: serverId,
      agentEnabled: input.agentEnabled ? 1 : 0,
      updatedAt: nowIso(),
    });
  return getRequiredServer(existing.id);
};

export const updateExternalMcpEnabled = (
  serverId: string,
  enabled: boolean,
): ExternalMcpServerRecord => {
  if (typeof enabled !== "boolean") {
    throw mcpBadRequest("enabled must be a boolean");
  }
  const existing = getRequiredServer(serverId);
  initializeExternalMcpDatabase();
  getSqlite()
    .prepare(
      `UPDATE external_mcp_servers
       SET enabled = @enabled, updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run({ id: serverId, enabled: enabled ? 1 : 0, updatedAt: nowIso() });
  if (!enabled) {
    unregisterExternalMcpServerCapabilities(existing);
    disposeExternalMcpServerSession(serverId);
  }
  const updated = getRequiredServer(serverId);
  if (enabled) {
    registerExternalMcpServerCapabilities(updated);
  }
  return updated;
};

export const clearExternalMcpServers = () => {
  initializeExternalMcpDatabase();
  for (const server of listExternalMcpServers()) {
    unregisterExternalMcpServerCapabilities(server);
    disposeExternalMcpServerSession(server.id);
  }
  getSqlite().prepare("DELETE FROM external_mcp_servers").run();
};

export const deleteExternalMcpServer = (serverId: string): ExternalMcpServerRecord => {
  const existing = getRequiredServer(serverId);
  unregisterExternalMcpServerCapabilities(existing);
  disposeExternalMcpServerSession(serverId);
  initializeExternalMcpDatabase();
  getSqlite()
    .prepare("DELETE FROM external_mcp_servers WHERE id = ?")
    .run(serverId);
  return existing;
};

const validateCustomHeadersJson = (input: string): Record<string, string> => {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw mcpBadRequest("Custom headers must be a JSON object");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw mcpBadRequest("Custom header values must be strings");
    }
    headers[key] = value;
  }
  return headers;
};

const validateArgsText = (input: string | undefined): string[] => {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw mcpBadRequest("Args must be a JSON string array");
  }

  return parsed;
};

const ensureStdioCommand = (command: string | undefined) => {
  const normalized = command?.trim();
  if (!normalized) {
    throw mcpBadRequest("External stdio MCP command is required");
  }
  return normalized;
};

export const createExternalMcpServer = (
  input: CreateExternalMcpServerInput,
): ExternalMcpServerRecord => {
  if (!input.disclaimerAccepted) {
    throw mcpBadRequest("External MCP server disclaimer must be accepted before install");
  }
  const id = sanitizeServerId(input);
  const createdAt = nowIso();
  let endpointUrl: string | null = null;
  let command: string | null = null;
  let args: string[] = [];

  if (input.transport.kind === "streamable-http") {
    const url = new URL(input.transport.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw mcpBadRequest("External MCP endpoint must be http or https");
    }
    endpointUrl = url.toString();
  } else {
    command = ensureStdioCommand(input.transport.command);
    args = Array.isArray(input.transport.args)
      ? input.transport.args.filter((item): item is string => typeof item === "string")
      : [];
  }

  initializeExternalMcpDatabase();
  const existing = getServerRow(id);
  if (existing) {
    unregisterExternalMcpServerCapabilities(toRecord(existing));
    disposeExternalMcpServerSession(id);
  }
  const nextRecord = {
    id,
    source: input.registryUrl ? "registry" : "manual",
    registryUrl: input.registryUrl ?? null,
    packageName: input.packageName ?? null,
    documentationUrl: input.documentationUrl ?? null,
    repositoryUrl: input.repositoryUrl ?? null,
    displayName: input.displayName.trim(),
    description: input.description ?? null,
    version: input.version ?? null,
    transportKind: input.transport.kind,
    endpointUrl,
    command,
    argsJson: JSON.stringify(args),
    status: "configured" as const,
    enabled: 1,
    agentEnabled: existing ? Number(existing.agent_enabled ?? 0) : 0,
    disclaimerAcceptedAt: createdAt,
    disclaimerTextHash: input.disclaimerTextHash ?? DISCLAIMER_TEXT_HASH,
    createdAt: existing?.created_at ?? createdAt,
    updatedAt: createdAt,
    lastConnectedAt: null,
    lastError: null,
    sessionId: null,
    protocolVersion: null,
    remoteServerInfoJson: "null",
    remoteCapabilitiesJson: "null",
    discoveredToolsJson: "[]",
    configJson: existing?.config_json ?? "{}",
    secretJson: existing?.secret_json ?? "{}",
  };

  if (existing) {
    getSqlite()
      .prepare(
        `
          UPDATE external_mcp_servers
          SET source = @source,
              registry_url = @registryUrl,
              package_name = @packageName,
              documentation_url = @documentationUrl,
              repository_url = @repositoryUrl,
              display_name = @displayName,
              description = @description,
              version = @version,
              transport_kind = @transportKind,
              endpoint_url = @endpointUrl,
              command = @command,
              args_json = @argsJson,
              status = @status,
              enabled = @enabled,
              agent_enabled = @agentEnabled,
              disclaimer_accepted_at = @disclaimerAcceptedAt,
              disclaimer_text_hash = @disclaimerTextHash,
              last_connected_at = @lastConnectedAt,
              last_error = @lastError,
              session_id = @sessionId,
              protocol_version = @protocolVersion,
              remote_server_info_json = @remoteServerInfoJson,
              remote_capabilities_json = @remoteCapabilitiesJson,
              discovered_tools_json = @discoveredToolsJson,
              updated_at = @updatedAt
          WHERE id = @id
        `,
      )
      .run(nextRecord);
  } else {
    getSqlite()
      .prepare(
        `
          INSERT INTO external_mcp_servers (
            id, source, registry_url, package_name, documentation_url, repository_url, display_name, description, version,
            transport_kind, endpoint_url, command, args_json, status, enabled, agent_enabled, disclaimer_accepted_at,
            disclaimer_text_hash, created_at, updated_at, remote_server_info_json,
            remote_capabilities_json, discovered_tools_json, config_json, secret_json
          )
          VALUES (@id, @source, @registryUrl, @packageName, @documentationUrl, @repositoryUrl, @displayName, @description, @version,
            @transportKind, @endpointUrl, @command, @argsJson, @status, @enabled, @agentEnabled, @disclaimerAcceptedAt,
            @disclaimerTextHash, @createdAt, @updatedAt, @remoteServerInfoJson,
            @remoteCapabilitiesJson, @discoveredToolsJson, @configJson, @secretJson)
        `,
      )
      .run(nextRecord);
  }
  return getRequiredServer(id);
};

export const getExternalMcpServerConfigSchema = (
  serverId: string,
): ExternalMcpConfigSchemaResolution => {
  const server = getRequiredServer(serverId);
  if (server.transport.kind === "stdio") {
    return {
      fields: [
        {
          key: "command",
          label: "Command",
          type: "text",
          required: true,
          defaultValue: server.transport.command,
        },
        {
          key: "argsText",
          label: "Args JSON",
          type: "json",
          required: false,
          defaultValue: JSON.stringify(server.transport.args ?? [], null, 2),
        },
        {
          key: "timeoutMs",
          label: "Timeout (ms)",
          type: "number",
          required: true,
          defaultValue: DEFAULT_TIMEOUT_MS,
        },
        {
          key: "cwd",
          label: "Working Directory",
          type: "text",
          required: false,
          placeholder: "D:\\workspace\\rag-demo",
        },
        {
          key: "envJson",
          label: "Env JSON",
          type: "json",
          required: false,
          placeholder: '{\n  "HTTP_PROXY": "http://127.0.0.1:7890"\n}',
        },
      ],
      completeness: "known-partial",
      sources: server.source === "registry" ? ["marketplace", "manual"] : ["manual"],
      notes: [
        "This schema is a known configuration draft for stdio MCP servers and may be incomplete.",
        "Args must be entered as a JSON string array.",
        ...(server.packageName
          ? [`Installed package hint: ${server.packageName}`]
          : []),
      ],
    };
  }
  return {
    fields: [
      {
        key: "endpointUrl",
        label: "Endpoint URL",
        type: "url",
        required: true,
        defaultValue: server.transport.url,
      },
      {
        key: "bearerToken",
        label: "Bearer Token",
        type: "password",
        required: false,
        secret: true,
        placeholder: "sk-...",
        description: "Optional token used as Authorization: Bearer <token>.",
      },
      {
        key: "customHeadersJson",
        label: "Custom Headers JSON",
        type: "json",
        required: false,
        placeholder: '{\n  "X-Org-Id": "demo"\n}',
      },
      {
        key: "timeoutMs",
        label: "Timeout (ms)",
        type: "number",
        required: true,
        defaultValue: DEFAULT_TIMEOUT_MS,
      },
    ],
    completeness: "known-partial",
    sources: server.source === "registry" ? ["marketplace", "manual"] : ["manual"],
    notes: [
      "This schema is a known configuration draft for streamable-http MCP servers and may be incomplete.",
    ],
  };
};

export const getExternalMcpServerConfig = (
  serverId: string,
): ExternalMcpServerConfigRecord => {
  const row = getServerRow(serverId);
  if (!row) {
    throw mcpNotFound(`External MCP server not found: ${serverId}`);
  }
  const runtimeConfig = toRuntimeConfig(row);
  return {
    ...(runtimeConfig.endpointUrl ? { endpointUrl: runtimeConfig.endpointUrl } : {}),
    ...(runtimeConfig.command ? { command: runtimeConfig.command } : {}),
    ...(row.transport_kind === "stdio"
      ? { argsText: JSON.stringify(runtimeConfig.args, null, 2) }
      : {}),
    ...(row.package_name ? { packageName: row.package_name } : {}),
    ...(runtimeConfig.cwd ? { cwd: runtimeConfig.cwd } : {}),
    envJson: JSON.stringify(runtimeConfig.env ?? {}, null, 2),
    authType: runtimeConfig.authType,
    timeoutMs: runtimeConfig.timeoutMs,
    customHeadersJson: serializeHeadersJson(runtimeConfig.customHeaders),
    hasBearerToken: Boolean(runtimeConfig.bearerToken),
  };
};

export const updateExternalMcpServerConfig = (
  serverId: string,
  input: UpdateExternalMcpServerConfigInput,
): ExternalMcpServerConfigRecord => {
  const row = getServerRow(serverId);
  if (!row) {
    throw mcpNotFound(`External MCP server not found: ${serverId}`);
  }

  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw mcpBadRequest("Timeout must be a positive number");
  }

  const customHeaders =
    row.transport_kind === "streamable-http" ? validateCustomHeadersJson(input.customHeadersJson) : {};
  const previousSecret = parseSecretJson(row.secret_json);
  const nextBearerToken =
    input.bearerToken === undefined
      ? previousSecret.bearerToken
      : input.bearerToken === null || input.bearerToken.trim() === ""
        ? undefined
        : input.bearerToken.trim();
  const nextAuthType =
    row.transport_kind === "streamable-http" && input.authType === "bearer" && nextBearerToken
      ? "bearer"
      : "none";
  const at = nowIso();
  const endpointUrl =
    row.transport_kind === "streamable-http"
      ? (() => {
          const url = new URL(input.endpointUrl ?? "");
          if (!["http:", "https:"].includes(url.protocol)) {
            throw mcpBadRequest("External MCP endpoint must be http or https");
          }
          return url.toString();
        })()
      : row.endpoint_url;
  const command =
    row.transport_kind === "stdio"
      ? ensureStdioCommand(input.command ?? row.command ?? undefined)
      : row.command;
  const args =
    row.transport_kind === "stdio"
      ? validateArgsText(input.argsText ?? JSON.stringify(toRuntimeConfig(row).args))
      : [];
  const cwd =
    row.transport_kind === "stdio"
      ? (() => {
          const normalized = input.cwd?.trim();
          return normalized ? normalized : null;
        })()
      : null;
  const env =
    row.transport_kind === "stdio"
      ? (() => {
          const trimmed = (input.envJson ?? "{}").trim();
          if (!trimmed) {
            return {};
          }
          const parsed = JSON.parse(trimmed) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw mcpBadRequest("Env JSON must be a JSON object");
          }
          const result: Record<string, string> = {};
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value !== "string") {
              throw mcpBadRequest("Env JSON values must be strings");
            }
            result[key] = value;
          }
          return result;
        })()
      : {};

  disposeExternalMcpServerSession(serverId);

  getSqlite()
    .prepare(
      `
        UPDATE external_mcp_servers
        SET endpoint_url = @endpointUrl,
            command = @command,
            args_json = @argsJson,
            cwd = @cwd,
            env_json = @envJson,
            config_json = @configJson,
            secret_json = @secretJson,
            status = 'configured',
            session_id = NULL,
            protocol_version = NULL,
            remote_server_info_json = 'null',
            remote_capabilities_json = 'null',
            last_error = NULL,
            discovered_tools_json = '[]',
            updated_at = @at
        WHERE id = @id
      `,
    )
    .run({
      id: serverId,
      endpointUrl,
      command,
      argsJson: JSON.stringify(args),
      cwd,
      envJson: JSON.stringify(env),
      configJson: JSON.stringify({
        authType: nextAuthType,
        timeoutMs: Math.round(input.timeoutMs),
        customHeaders,
      }),
      secretJson: JSON.stringify({
        ...(nextBearerToken ? { bearerToken: nextBearerToken } : {}),
      }),
      at,
    });

  unregisterExternalMcpServerCapabilities(toRecord(row));
  return getExternalMcpServerConfig(serverId);
};

const summarizeRemoteCapabilities = (
  capabilities: Record<string, unknown> | undefined,
): ExternalMcpRemoteCapabilitiesSummary | undefined => {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return undefined;
  }
  return {
    hasTools: Object.prototype.hasOwnProperty.call(capabilities, "tools"),
    hasResources: Object.prototype.hasOwnProperty.call(capabilities, "resources"),
    hasPrompts: Object.prototype.hasOwnProperty.call(capabilities, "prompts"),
  };
};

const parseJsonRpcResponse = async <T>(response: Response): Promise<JsonRpcResponse<T>> => {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const payload = contentType.includes("text/event-stream")
    ? body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .find((line) => line && line !== "[DONE]")
    : body;

  if (!payload) {
    throw new Error("MCP server returned an empty response");
  }
  return parseJsonObject(payload) as JsonRpcResponse<T>;
};

const postJsonRpc = async <T>(
  server: ExternalMcpServerRecord,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<{ result: T; sessionId?: string; protocolVersion?: string }> => {
  const row = getServerRow(server.id);
  if (!row) {
    throw mcpNotFound(`External MCP server not found: ${server.id}`);
  }
  const runtimeConfig = toRuntimeConfig(row);
  if (row.transport_kind === "stdio") {
    try {
      const session = getOrCreateStdioSession(server.id, row);
      const result = await session.request<T>(method, params, runtimeConfig.timeoutMs);
      return {
        result,
        sessionId: server.sessionId,
        protocolVersion: server.protocolVersion ?? MCP_PROTOCOL_VERSION,
      };
    } catch (error) {
      throw externalMcpFailure(error, row);
    }
  }
  if (!runtimeConfig.endpointUrl) {
    throw new Error("External MCP endpoint URL is not configured");
  }
  const id = crypto.randomUUID();
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": server.protocolVersion ?? MCP_PROTOCOL_VERSION,
    ...runtimeConfig.customHeaders,
  };
  if (runtimeConfig.authType === "bearer" && runtimeConfig.bearerToken) {
    headers.Authorization = `Bearer ${runtimeConfig.bearerToken}`;
  }
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const response = await fetch(runtimeConfig.endpointUrl, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(runtimeConfig.timeoutMs),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw externalMcpFailure(`MCP ${method} failed with HTTP ${response.status}`, row);
  }
  let message: JsonRpcResponse<T>;
  try {
    message = await parseJsonRpcResponse<T>(response);
  } catch (error) {
    throw externalMcpFailure(error, row);
  }
  if (message.error) {
    throw externalMcpFailure(message.error.message ?? `MCP ${method} failed`, row);
  }
  if (message.result === undefined) {
    throw externalMcpFailure(`MCP ${method} response did not include result`, row);
  }
  return {
    result: message.result,
    sessionId: response.headers.get("mcp-session-id") ?? undefined,
    protocolVersion: response.headers.get("mcp-protocol-version") ?? undefined,
  };
};

const sendInitializedNotification = async (
  server: ExternalMcpServerRecord,
  sessionId?: string,
) => {
  const row = getServerRow(server.id);
  if (!row) {
    throw mcpNotFound(`External MCP server not found: ${server.id}`);
  }
  const runtimeConfig = toRuntimeConfig(row);
  if (row.transport_kind === "stdio") {
    const session = getOrCreateStdioSession(server.id, row);
    session.notify("notifications/initialized", {});
    return;
  }
  if (!runtimeConfig.endpointUrl) {
    throw new Error("External MCP endpoint URL is not configured");
  }
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": server.protocolVersion ?? MCP_PROTOCOL_VERSION,
    ...runtimeConfig.customHeaders,
  };
  if (runtimeConfig.authType === "bearer" && runtimeConfig.bearerToken) {
    headers.Authorization = `Bearer ${runtimeConfig.bearerToken}`;
  }
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }
  await fetch(runtimeConfig.endpointUrl, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(runtimeConfig.timeoutMs),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });
};

const handleStdioSessionExit = (serverId: string, message: string) => {
  stdioSessions.delete(serverId);
  const row = getServerRow(serverId);
  if (!row) {
    return;
  }

  getSqlite()
    .prepare(
      `
        UPDATE external_mcp_servers
        SET status = 'failed',
            last_error = @lastError,
            session_id = NULL,
            updated_at = @updatedAt
        WHERE id = @id
      `,
    )
    .run({
      id: serverId,
      lastError: message,
      updatedAt: nowIso(),
    });
};

const getOrCreateStdioSession = (serverId: string, row: ExternalMcpServerRow) => {
  const existing = stdioSessions.get(serverId);
  if (existing) {
    return existing;
  }

  const runtimeConfig = toRuntimeConfig(row);
  if (!runtimeConfig.command) {
    throw mcpBadRequest("External stdio MCP command is required");
  }

  const session = new StdioMcpSession({
    command: runtimeConfig.command,
    args: runtimeConfig.args,
    ...(runtimeConfig.cwd ? { cwd: runtimeConfig.cwd } : {}),
    ...(runtimeConfig.env ? { env: runtimeConfig.env } : {}),
    onExit: (message) => handleStdioSessionExit(serverId, message),
  });
  stdioSessions.set(serverId, session);
  return session;
};

const disposeExternalMcpServerSession = (serverId: string) => {
  const session = stdioSessions.get(serverId);
  if (!session) {
    return;
  }
  stdioSessions.delete(serverId);
  session.dispose();
};

export const connectExternalMcpServer = async (
  serverId: string,
): Promise<ExternalMcpServerRecord> => {
  const row = getServerRow(serverId);
  if (!row) {
    throw mcpNotFound(`External MCP server not found: ${serverId}`);
  }
  const server = toRecord(row);
  try {
    const initialized = await postJsonRpc<InitializeResult>(server, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "ui-chat-rag-tester",
        version: "0.7.1",
      },
    });
    const protocolVersion =
      initialized.result.protocolVersion ?? initialized.protocolVersion ?? MCP_PROTOCOL_VERSION;
    const sessionId =
      initialized.result.sessionId ??
      initialized.sessionId ??
      (server.transport.kind === "stdio" ? `stdio:${server.id}` : undefined);
    const at = nowIso();
    initializeExternalMcpDatabase();
    getSqlite()
      .prepare(
        `
          UPDATE external_mcp_servers
          SET status = 'connected',
              last_connected_at = @at,
              last_error = NULL,
              session_id = @sessionId,
              protocol_version = @protocolVersion,
              remote_server_info_json = @remoteServerInfoJson,
              remote_capabilities_json = @remoteCapabilitiesJson,
              updated_at = @at
          WHERE id = @id
        `,
      )
      .run({
        id: serverId,
        sessionId: sessionId ?? null,
        protocolVersion,
        remoteServerInfoJson: JSON.stringify(initialized.result.serverInfo ?? null),
        remoteCapabilitiesJson: JSON.stringify(
          summarizeRemoteCapabilities(initialized.result.capabilities) ?? null,
        ),
        at,
      });
    await sendInitializedNotification(
      { ...server, sessionId, protocolVersion },
      sessionId,
    );
  } catch (error) {
    disposeExternalMcpServerSession(serverId);
    const at = nowIso();
    getSqlite()
      .prepare(
        `
          UPDATE external_mcp_servers
          SET status = 'failed', last_error = @lastError, updated_at = @at
          WHERE id = @id
        `,
      )
      .run({
        id: serverId,
        lastError: error instanceof Error ? error.message : String(error),
        at,
      });
    throw mcpInternalError(formatConnectFailureMessage(row, error), { cause: error });
  }
  return getRequiredServer(serverId);
};

const toProjectedCapabilityId = (serverId: string, toolName: string) =>
  `mcp:${serverId}:tool:${slugifyServerId(toolName)}`;

const normalizeDiscoveredTools = (
  serverId: string,
  tools: ToolsListResult["tools"],
): ExternalMcpDiscoveredTool[] =>
  (tools ?? [])
    .filter((tool) => typeof tool.name === "string" && tool.name.trim())
    .map((tool) => ({
      name: tool.name!.trim(),
      title: tool.title?.trim() || tool.name!.trim(),
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true },
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      projectedCapabilityId: toProjectedCapabilityId(serverId, tool.name!.trim()),
    }));

const registerProjectedTool = (
  server: ExternalMcpServerRecord,
  tool: ExternalMcpDiscoveredTool,
) => {
  const implementation: ToolImplementation = {
    definition: {
      id: tool.projectedCapabilityId,
      title: tool.title,
      description: tool.description || `MCP capability ${tool.name} from ${server.displayName}`,
      domain: "external_mcp",
      source: "external",
      sourceLabel: server.displayName,
      mode: "sync",
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      tags: ["mcp", "external", server.id],
      capabilities: {
        sideEffect: "network",
        requiresApproval: true,
        networkAccess: true,
        longRunning: true,
      },
    } satisfies ToolDefinition,
    execute: async (context) => {
      context.pushEvent({
        type: "invocation:progress",
        message: `Calling MCP capability ${tool.name} on ${server.displayName}`,
      });
      const invoke = async (candidate: ExternalMcpServerRecord, recoveryOccurred: boolean) => {
        const current = getRequiredServer(candidate.id);
        const discovered = current.discoveredTools.find(
          (item) => item.name === tool.name && item.projectedCapabilityId === tool.projectedCapabilityId,
        );
        const registered = getToolImplementation(tool.projectedCapabilityId);
        if (
          !current.enabled ||
          !current.agentEnabled ||
          !isExternalMcpRuntimeEligible(current) ||
          !discovered ||
          !registered ||
          registered.definition.source !== "external"
        ) {
          throw new Error("External MCP capability is no longer eligible for Agent execution");
        }
        const response = await postJsonRpc<unknown>(
          current,
          "tools/call",
          { name: tool.name, arguments: context.args },
          current.sessionId,
        );
        return {
          result: {
            type: "external_mcp",
            serverId: current.id,
            remoteToolName: tool.name,
            invocationStatus: "completed",
            recoveryOccurred,
            result: response.result,
          },
        };
      };

      try {
        return await invoke(getRequiredServer(server.id), false);
      } catch (firstError) {
        const latest = getRequiredServer(server.id);
        if (!latest.enabled || !latest.agentEnabled || !canRecoverExternalMcpSession(firstError)) {
          throw firstError;
        }
        // One reinitialize handles stale persisted sessions without unbounded retries.
        disposeExternalMcpServerSession(server.id);
        try {
          const reinitialized = await connectExternalMcpServer(server.id);
          return await invoke(reinitialized, true);
        } catch (secondError) {
          const row = getServerRow(server.id);
          throw externalMcpFailure(
            `External MCP recovery exhausted after one recovery attempt: ${
              secondError instanceof Error ? secondError.message : String(secondError)
            }`,
            row ?? undefined,
          );
        }
      }
    },
  };
  registerTool(implementation);
};

const unregisterExternalMcpServerCapabilities = (
  server: Pick<ExternalMcpServerRecord, "id" | "discoveredTools">,
) => {
  const canonicalPrefix = `mcp:${server.id}:tool:`;
  for (const definition of listToolDefinitions()) {
    if (
      definition.source === "external" &&
      definition.id.startsWith(canonicalPrefix) &&
      definition.tags.includes(server.id)
    ) {
      unregisterTool(definition.id);
    }
  }
  for (const tool of server.discoveredTools) {
    const canonicalId = toProjectedCapabilityId(server.id, tool.name);
    unregisterTool(canonicalId);
  }
};

export const registerExternalMcpServerCapabilities = (
  server: ExternalMcpServerRecord,
) => {
  unregisterExternalMcpServerCapabilities(server);
  if (!isExternalMcpRuntimeEligible(server)) {
    return;
  }
  for (const tool of server.discoveredTools) {
    if (tool.projectedCapabilityId !== toProjectedCapabilityId(server.id, tool.name)) {
      continue;
    }
    registerProjectedTool(server, tool);
  }
};

export const registerAllExternalMcpCapabilities = () => {
  for (const server of listExternalMcpServers()) {
    registerExternalMcpServerCapabilities(server);
  }
};

const isExternalMcpTransportConfigured = (server: ExternalMcpServerRecord) => {
  if (server.transport.kind === "streamable-http") {
    try {
      const url = new URL(server.transport.url);
      return ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }
  return Boolean(server.transport.command.trim());
};

const isExternalMcpRuntimeEligible = (server: ExternalMcpServerRecord) =>
  server.enabled &&
  server.status === "connected" &&
  Boolean(server.disclaimerAcceptedAt && server.disclaimerTextHash) &&
  server.discoveredTools.length > 0 &&
  isExternalMcpTransportConfigured(server);

export const resolveAgentEligibleExternalMcpCapabilities = (): ToolDefinition[] => {
  const eligible: ToolDefinition[] = [];
  for (const server of listExternalMcpServers()) {
    if (!isExternalMcpRuntimeEligible(server) || !server.agentEnabled) {
      continue;
    }
    for (const tool of server.discoveredTools) {
      const canonicalId = toProjectedCapabilityId(server.id, tool.name);
      if (tool.projectedCapabilityId !== canonicalId) {
        continue;
      }
      const implementation = getToolImplementation(canonicalId);
      if (!implementation || implementation.definition.source !== "external") {
        continue;
      }
      if (implementation.definition.id !== canonicalId) {
        continue;
      }
      eligible.push(implementation.definition);
    }
  }
  return eligible;
};

export const discoverExternalMcpServer = async (
  serverId: string,
): Promise<ExternalMcpServerRecord> => {
  let server = getRequiredServer(serverId);
  if (server.status !== "connected") {
    server = await connectExternalMcpServer(serverId);
  }
  const response = await postJsonRpc<ToolsListResult>(
    server,
    "tools/list",
    {},
    server.sessionId,
  );
  const discoveredTools = normalizeDiscoveredTools(server.id, response.result.tools);
  const at = nowIso();
  unregisterExternalMcpServerCapabilities(server);
  getSqlite()
    .prepare(
      `
        UPDATE external_mcp_servers
        SET discovered_tools_json = @discoveredToolsJson,
            last_error = NULL,
            updated_at = @at
        WHERE id = @id
      `,
    )
    .run({
      id: server.id,
      discoveredToolsJson: JSON.stringify(discoveredTools),
      at,
    });
  const updated = getRequiredServer(server.id);
  registerExternalMcpServerCapabilities(updated);
  return updated;
};
