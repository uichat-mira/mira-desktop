import { del, get, patch, post, put } from "@/shared/lib/request";
import { getSession } from "@/shared/lib/sessionStorage";
import { getApiBaseUrl } from "@/shared/platform/desktopRuntime";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version?: string;
  category: "rag" | "system" | "tool";
  tags: string[];
  author?: string;
  parameters?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
}

export function getTools() {
  return get<ToolDefinition[]>("/tools");
}

export type ToolDomain =
  | "read"
  | "edit"
  | "web_search"
  | "terminal"
  | "browser_action"
  | "external_mcp"
  | (string & {});

export type HarnessToolDefinition = {
  id: string;
  title: string;
  description: string;
  domain: ToolDomain;
  source: "internal" | "external";
  mode: "sync" | "stream";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags: string[];
  capabilities: {
    sideEffect: "none" | "local-write" | "process" | "network";
    requiresApproval: boolean;
    workspaceBound?: boolean;
    networkAccess?: boolean;
    longRunning?: boolean;
  };
  workbench?: {
    groupId: string;
    groupLabel: string;
    groupDescription: string;
    groupOrder: number;
    icon: string;
    defaultArgs?: Record<string, unknown>;
  };
};

export type ToolArtifact = {
  id: string;
  kind:
    | "text"
    | "markdown"
    | "code"
    | "diff"
    | "table"
    | "search-results"
    | "document"
    | "image"
    | "html"
    | "terminal-log";
  title: string;
  mimeType?: string;
  data?: unknown;
  uri?: string;
  metadata?: Record<string, unknown>;
};

export type ToolInvocationEvent =
  | {
      type: "invocation:start";
      invocationId: string;
      toolId: string;
      at: string;
    }
  | {
      type: "invocation:approval_required";
      invocationId: string;
      message: string;
      scope?: string;
      at: string;
    }
  | {
      type: "invocation:progress";
      invocationId: string;
      message: string;
      at: string;
    }
  | {
      type: "invocation:stdout";
      invocationId: string;
      chunk: string;
      stream: "stdout" | "stderr";
      at: string;
    }
  | {
      type: "invocation:artifact";
      invocationId: string;
      artifact: ToolArtifact;
      at: string;
    }
  | {
      type: "invocation:result";
      invocationId: string;
      result: unknown;
      at: string;
    }
  | {
      type: "invocation:error";
      invocationId: string;
      message: string;
      at: string;
    }
  | {
      type: "invocation:finish";
      invocationId: string;
      status: "awaiting_approval" | "completed" | "failed" | "cancelled";
      at: string;
    };

export type ToolTraceSpanKind =
  | "invocation"
  | "permission_check"
  | "strategy_selection"
  | "session_acquire"
  | "process_spawn"
  | "command_execution"
  | "stream_observation"
  | "artifact_emit"
  | "result_normalization";

export type ToolTraceSpan = {
  id: string;
  traceId: string;
  invocationId: string;
  parentSpanId?: string;
  name: string;
  kind: ToolTraceSpanKind;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  metadata?: Record<string, unknown>;
};

export type ToolTrace = {
  traceId: string;
  invocationId: string;
  toolId: string;
  startedAt: string;
  finishedAt?: string;
  spans: ToolTraceSpan[];
};

export type McpWorkspaceSelection = {
  rootPath: string | null;
  source: "selected" | "configured" | "unset";
};

export type McpWebSearchConfig = {
  apiKey: string;
  baseUrl: string;
  maxResults: number;
};

export type McpMarketplaceTransport =
  | {
      kind: "streamable-http";
      packageType: "remote";
      installable: true;
      label: string;
      url: string;
    }
  | {
      kind: "stdio";
      packageType: "npm";
      installable: true;
      label: string;
      command?: string;
      args?: string[];
      packageIdentifier: string;
    }
  | {
      kind: "package";
      packageType: "pypi" | "oci" | "unknown";
      installable: false;
      label: string;
      packageIdentifier: string;
    };

export type McpMarketplaceServer = {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string | null;
  status: string | null;
  isLatest: boolean | null;
  publishedAt: string | null;
  updatedAt: string | null;
  websiteUrl: string | null;
  repositoryUrl: string | null;
  transports: McpMarketplaceTransport[];
  category?: string;
  categorySource?: "publisher" | "inferred" | "uncategorized";
};

export type McpMarketplaceSyncStatus = {
  sourceUrl: string;
  status: "idle" | "syncing" | "failed";
  mode: "full" | "incremental" | null;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFullSyncAt: string | null;
  updatedCount: number;
  lastError: string | null;
  nextAutoSyncAt: string | null;
};

export type ExternalMcpServerRecord = {
  id: string;
  source: "registry" | "manual";
  registryUrl?: string;
  packageName?: string;
  documentationUrl?: string;
  repositoryUrl?: string;
  displayName: string;
  description?: string;
  version?: string;
  transport:
    | {
        kind: "streamable-http";
        url: string;
      }
    | {
        kind: "stdio";
        command: string;
        args?: string[];
      };
  status: "configured" | "connected" | "failed";
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
  remoteServerInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
  remoteCapabilities?: {
    hasTools: boolean;
    hasResources: boolean;
    hasPrompts: boolean;
  };
  discoveredTools: Array<{
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    projectedCapabilityId: string;
  }>;
};

export type ExternalMcpConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "number" | "json";
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
};

export type ExternalMcpConfigSchemaResolution = {
  fields: ExternalMcpConfigField[];
  completeness: "known-partial" | "known-good" | "unknown";
  sources: Array<"preset" | "marketplace" | "server-self-describe" | "manual">;
  notes?: string[];
};

export type ExternalMcpServerConfigRecord = {
  endpointUrl?: string;
  command?: string;
  argsText?: string;
  packageName?: string;
  cwd?: string;
  envJson?: string;
  authType: "none" | "bearer";
  timeoutMs: number;
  customHeadersJson: string;
  hasBearerToken: boolean;
};

const MCP_REQUEST_TIMEOUT_MS = 300000;

export function getMcpMarketplaceServers(params?: {
  cursor?: string;
  limit?: number;
  query?: string;
  category?: string;
  transport?: "remote" | "local";
  installable?: boolean;
  signal?: AbortSignal;
}) {
  const searchParams = new URLSearchParams();
  if (params?.cursor) searchParams.set("cursor", params.cursor);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.query) searchParams.set("query", params.query);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.transport) searchParams.set("transport", params.transport);
  if (typeof params?.installable === "boolean") {
    searchParams.set("installable", String(params.installable));
  }
  const query = searchParams.toString();
  return get<{
    servers: McpMarketplaceServer[];
    metadata: {
      count: number;
      nextCursor: string | null;
      sourceUrl: string;
      cache: {
        hit: boolean;
        stale: boolean;
        cachedAt: string | null;
      };
      sync?: McpMarketplaceSyncStatus;
      searchPending?: boolean;
    };
  }>(`/mcp/marketplace/servers${query ? `?${query}` : ""}`, {
    signal: params?.signal,
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function getMcpMarketplaceSyncStatus() {
  return get<McpMarketplaceSyncStatus>("/mcp/marketplace/sync-status", {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function requestMcpMarketplaceSync() {
  return post<{ started: boolean; status: McpMarketplaceSyncStatus }>(
    "/mcp/marketplace/sync",
    undefined,
    { timeout: MCP_REQUEST_TIMEOUT_MS },
  );
}

export function getExternalMcpServers() {
  return get<ExternalMcpServerRecord[]>("/mcp/external/servers", {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function createExternalMcpServer(
  input: {
    id?: string;
    registryUrl?: string;
    packageName?: string;
    documentationUrl?: string;
    repositoryUrl?: string;
    displayName: string;
    description?: string;
    version?: string;
    transport:
      | {
          kind: "streamable-http";
          url: string;
        }
      | {
          kind: "stdio";
          command: string;
          args?: string[];
        };
    disclaimerAccepted: boolean;
  },
) {
  return post<ExternalMcpServerRecord>("/mcp/external/servers", input, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function connectExternalMcpServer(id: string) {
  return post<ExternalMcpServerRecord>(`/mcp/external/servers/${id}/connect`, undefined, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function discoverExternalMcpServer(id: string) {
  return post<ExternalMcpServerRecord>(`/mcp/external/servers/${id}/discover`, undefined, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function updateExternalMcpAccess(id: string, agentEnabled: boolean) {
  return patch<ExternalMcpServerRecord>(`/mcp/external/servers/${id}/access`, { agentEnabled }, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function updateExternalMcpEnabled(id: string, enabled: boolean) {
  return patch<ExternalMcpServerRecord>(`/mcp/external/servers/${id}/enabled`, { enabled }, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function deleteExternalMcpServer(id: string) {
  return del<ExternalMcpServerRecord>(`/mcp/external/servers/${id}`, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function getExternalMcpServerConfigSchema(id: string) {
  return get<ExternalMcpConfigSchemaResolution>(`/mcp/external/servers/${id}/config-schema`, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function getExternalMcpServerConfig(id: string) {
  return get<ExternalMcpServerConfigRecord>(`/mcp/external/servers/${id}/config`, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function updateExternalMcpServerConfig(
  id: string,
  input: {
    endpointUrl?: string;
    command?: string;
    argsText?: string;
    cwd?: string;
    envJson?: string;
    authType: "none" | "bearer";
    timeoutMs: number;
    customHeadersJson: string;
    bearerToken?: string | null;
  },
) {
  return patch<ExternalMcpServerConfigRecord>(`/mcp/external/servers/${id}/config`, input, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
}

export function getMcpWorkspaceSelection() {
  return get<McpWorkspaceSelection>("/mcp/workspace");
}

export function getMcpWebSearchConfig() {
  return get<McpWebSearchConfig>("/mcp/web-search/config");
}

export function saveMcpWebSearchConfig(input: Partial<McpWebSearchConfig>) {
  return put<McpWebSearchConfig>("/mcp/web-search/config", input);
}

export function selectMcpWorkspaceRoot(rootPath: string) {
  return post<McpWorkspaceSelection>("/mcp/workspace/select", { rootPath });
}

export function getMcpTools() {
  return get<HarnessToolDefinition[]>("/mcp/tools?source=agent_intent");
}

export function getMcpInvocationTrace(invocationId: string) {
  return get<ToolTrace>(`/mcp/invocations/${invocationId}/trace`);
}

const decodeSseEvents = (buffer: string) => {
  const events: string[] = [];
  let remaining = buffer;

  while (true) {
    const boundaryIndex = remaining.indexOf("\n\n");
    if (boundaryIndex < 0) {
      break;
    }

    events.push(remaining.slice(0, boundaryIndex));
    remaining = remaining.slice(boundaryIndex + 2);
  }

  return { events, remaining };
};

export async function executeMcpInvocationStream(
  input: {
    toolId: string;
    args?: Record<string, unknown>;
    signal?: AbortSignal;
  },
  onEvent: (event: ToolInvocationEvent) => void | Promise<void>,
) {
  const session = getSession();
  const response = await fetch(`${getApiBaseUrl()}/mcp/invocations/stream`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify({
      toolId: input.toolId,
      args: input.args ?? {},
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`MCP invocation stream failed with HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("MCP invocation stream is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const decoded = decodeSseEvents(buffer);
    buffer = decoded.remaining;

    for (const chunk of decoded.events) {
      const dataLines = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length === 0) {
        continue;
      }

      const event = JSON.parse(dataLines.join("\n")) as ToolInvocationEvent;
      await onEvent(event);
    }
  }
}
