import { del, get, patch, post, put } from "@/shared/lib/request";
import { getSession } from "@/shared/lib/sessionStorage";
import { getApiBaseUrl } from "@/shared/platform/desktopRuntime";

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
  sourceLabel?: string;
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
  /**
   * Server/Harness-supplied native runtime readiness. React must not infer
   * provider readiness from local secrets or duplicate runtime rules; it only
   * renders this secret-safe projection.
   */
  runtimeReadiness?: {
    state: "ready" | "blocked" | "unavailable";
    reason?: string;
    missingPrerequisites?: string[];
  };
  workbench?: {
    groupId: string;
    groupLabel: string;
    groupDescription: string;
    groupOrder: number;
    icon: string;
    defaultArgs?: Record<string, unknown>;
    cases?: Array<{
      id: string;
      title: string;
      description: string;
      args: Record<string, unknown>;
      fixture?: string;
    }>;
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

export type ToolInvocationStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ToolEvidence = {
  actionTaken: string;
  facts: string[];
  gaps?: string[];
  error?: string;
  status?:
    | "completed"
    | "failed"
    | "partial"
    | "blocked"
    | "denied"
    | "timed_out"
    | "truncated"
    | "binaryDetected";
  data?: unknown;
};

export type ToolInvocation = {
  id: string;
  toolId: string;
  status: ToolInvocationStatus;
  args: Record<string, unknown>;
  inputHash?: string;
  userId?: number;
  traceId?: string;
  result?: unknown;
  evidence?: ToolEvidence;
  error?: {
    message: string;
    failureCode?: string;
    code?: string;
    retryable?: boolean;
    suggestedAction?: string | null;
  };
  approval?: {
    required: true;
    reason: string;
    scope?: string;
    resolution?: {
      decision: "approved" | "rejected";
      resolutionInvocationId?: string;
      resolvedAt: string;
      reason?: string;
    };
  };
  artifacts: ToolArtifact[];
  threadId?: string;
  turnId?: string;
  startedAt?: string;
  finishedAt?: string;
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

export type ToolInvocationStreamEvent =
  | ToolInvocationEvent
  | {
      type: "invocation:done";
      invocationId: string;
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
  source: "selected" | "configured" | "managed" | "unset";
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

export type McpCapabilityFixtureResetResult = {
  fixtureId: string;
  workspace: McpWorkspaceSelection;
  fixtureRoot: string;
  resetAt: string;
};

export function getMcpCapabilityWorkspaceSelection() {
  return get<McpWorkspaceSelection>("/mcp/tool-lab/workspace");
}

export function getMcpManagedCapabilityWorkspaceSelection() {
  return get<McpWorkspaceSelection>("/mcp/tool-lab/workspace/managed");
}

export function resetMcpCapabilityFixture(fixtureId: string) {
  return post<McpCapabilityFixtureResetResult>(
    `/mcp/tool-lab/fixtures/${encodeURIComponent(fixtureId)}/reset`,
  );
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

export function getMcpRegisteredTools() {
  return get<HarnessToolDefinition[]>("/mcp/tools");
}

export function getMcpInvocation(invocationId: string) {
  return get<ToolInvocation>(`/mcp/invocations/${invocationId}`);
}

export type ToolInvocationApprovalResolution = {
  originalInvocation: ToolInvocation;
  resumedInvocation: ToolInvocation | null;
};

export function getMcpInvocationEvents(invocationId: string) {
  return get<ToolInvocationEvent[]>(`/mcp/invocations/${invocationId}/events`);
}

export function resolveMcpInvocationApproval(
  invocationId: string,
  input: {
    decision: "approved" | "rejected";
    toolId: string;
    args?: Record<string, unknown>;
  },
) {
  return post<ToolInvocationApprovalResolution>(
    `/mcp/invocations/${invocationId}/approval`,
    input,
  );
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
    workspaceContext?: "tool_lab" | "tool_lab_managed";
    signal?: AbortSignal;
  },
  onEvent: (event: ToolInvocationStreamEvent) => void | Promise<void>,
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
      ...(input.workspaceContext
        ? { workspaceContext: input.workspaceContext }
        : {}),
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

      const event = JSON.parse(dataLines.join("\n")) as ToolInvocationStreamEvent;
      await onEvent(event);
    }
  }
}
