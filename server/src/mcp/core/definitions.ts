export type McpToolDomain =
  | "read"
  | "edit"
  | "web_search"
  | "terminal"
  | "browser_action"
  | "external_mcp"
  | (string & {});

export type McpToolMode = "sync" | "stream";

export type McpToolSideEffect = "none" | "local-write" | "process" | "network";

export type McpSandboxProfile =
  | "read_only"
  | "workspace_write"
  | "command"
  | "networked_command";

export type McpInvocationStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type McpInvocationFailureCode =
  | "approval_mismatch"
  | "policy_denied"
  | "schema_invalid"
  | "workspace_escape"
  | "tool_runtime_failed"
  | "command_exit_nonzero"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface McpStructuredInvocationErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
  suggestedAction?: string | null;
}

export type McpTraceSpanKind =
  | "invocation"
  | "permission_check"
  | "strategy_selection"
  | "session_acquire"
  | "process_spawn"
  | "command_execution"
  | "stream_observation"
  | "artifact_emit"
  | "result_normalization";

export type McpArtifactKind =
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

export interface McpCapabilityMetadata {
  sideEffect: McpToolSideEffect;
  requiresApproval: boolean;
  workspaceBound?: boolean;
  workspaceBoundary?: {
    argKeys: string[];
    argTypes?: Partial<Record<string, "path" | "directory">>;
  };
  networkAccess?: boolean;
  longRunning?: boolean;
  sandboxRequired?: boolean;
  sandboxProfile?: McpSandboxProfile;
}

export interface McpExecutionEnvironmentCapability {
  id: string;
  kind:
    | "directory"
    | "structured"
    | "text"
    | "fallback"
    | "locate"
    | "extract"
    | "slice"
    | "write"
    | "replace";
  provider: string;
  available: boolean;
  priority: number;
  extensions?: string[];
}

export interface McpExecutionEnvironment {
  source: "harness";
  workspace: {
    rootPath: string | null;
    source: "selected" | "configured" | "unset";
  };
  approvals: {
    outsideWorkspace: "prompt";
    persistence: "thread";
  };
  trace: {
    streamEvents: true;
  };
  read: {
    capabilities: McpExecutionEnvironmentCapability[];
  };
  edit: {
    capabilities: McpExecutionEnvironmentCapability[];
  };
  web_search: {
    capabilities: McpExecutionEnvironmentCapability[];
  };
  terminal: {
    capabilities: McpExecutionEnvironmentCapability[];
    shellProfile: {
      shell: string;
      shellFamily: "powershell" | "cmd" | "posix";
      argsMode: "powershell" | "cmd" | "posix";
      stdoutEncoding: string;
      stderrEncoding: string;
    };
  };
  toolConfig?: {
    web_search?: {
      apiKey?: string;
      baseUrl?: string;
    };
  };
}

export interface McpResourceDefinition {
  id: string;
  title: string;
  description: string;
  kind: string;
  mimeType?: string;
  tags: string[];
  capabilities: {
    read: boolean;
    list?: boolean;
  };
}

export interface McpResourceReadContext {
  args: Record<string, unknown>;
  environment?: McpExecutionEnvironment;
  pushEvent?: (event: McpStreamEventInput) => void;
}

export interface McpResourceReadResult {
  contents: unknown;
  artifacts?: McpArtifact[];
}

export interface McpResourceImplementation {
  definition: McpResourceDefinition;
  read?: (
    context: McpResourceReadContext,
  ) => Promise<McpResourceReadResult> | McpResourceReadResult;
}

export interface McpToolDefinition {
  id: string;
  title: string;
  description: string;
  domain: McpToolDomain;
  source: "internal" | "external";
  sourceLabel?: string;
  mode: McpToolMode;
  inputSchema: Record<string, unknown>;
  inputSchemaByExposure?: Partial<
    Record<"tools_list" | "agent_intent" | "chat_surface", Record<string, unknown>>
  >;
  outputSchema?: Record<string, unknown>;
  tags: string[];
  capabilities: McpCapabilityMetadata;
  workbench?: {
    groupId: string;
    groupLabel: string;
    groupDescription: string;
    groupOrder: number;
    icon: string;
    defaultArgs?: Record<string, unknown>;
  };
  legacyProjection?: {
    category: "rag" | "system" | "tool";
    name?: string;
    author?: string;
    version?: string;
  };
}

export interface McpArtifact {
  id: string;
  kind: McpArtifactKind;
  title: string;
  mimeType?: string;
  data?: unknown;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface McpToolEvidence {
  actionTaken: string;
  facts: string[];
  gaps?: string[];
  error?: string;
  status?: "completed" | "failed" | "partial" | "blocked" | "denied" | "timed_out" | "truncated" | "binaryDetected";
  data?: unknown;
}

export interface McpInvocationRecord {
  id: string;
  toolId: string;
  status: McpInvocationStatus;
  args: Record<string, unknown>;
  inputHash?: string;
  userId?: number;
  traceId?: string;
  result?: unknown;
  evidence?: McpToolEvidence;
  error?: {
    message: string;
    failureCode?: McpInvocationFailureCode;
    code?: McpStructuredInvocationErrorDetail["code"];
    retryable?: McpStructuredInvocationErrorDetail["retryable"];
    suggestedAction?: McpStructuredInvocationErrorDetail["suggestedAction"];
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
  artifacts: McpArtifact[];
  threadId?: string;
  turnId?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface McpTraceSpan {
  id: string;
  traceId: string;
  invocationId: string;
  parentSpanId?: string;
  name: string;
  kind: McpTraceSpanKind;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface McpInvocationTrace {
  traceId: string;
  invocationId: string;
  toolId: string;
  startedAt: string;
  finishedAt?: string;
  spans: McpTraceSpan[];
  debugView?: {
    invocationId: string;
    toolId: string;
    traceId: string;
    spanCount: number;
    runningSpanCount: number;
    kinds: McpTraceSpanKind[];
  };
}

export type McpStreamEvent =
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
      artifact: McpArtifact;
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
      status: Exclude<McpInvocationStatus, "queued" | "running">;
      at: string;
    };

export type McpStreamEventInput =
  | {
      type: "invocation:start";
      toolId: string;
    }
  | {
      type: "invocation:approval_required";
      message: string;
      scope?: string;
    }
  | {
      type: "invocation:progress";
      message: string;
    }
  | {
      type: "invocation:stdout";
      chunk: string;
      stream: "stdout" | "stderr";
    }
  | {
      type: "invocation:artifact";
      artifact: McpArtifact;
    }
  | {
      type: "invocation:result";
      result: unknown;
    }
  | {
      type: "invocation:error";
      message: string;
    }
  | {
      type: "invocation:finish";
      status: Exclude<McpInvocationStatus, "queued" | "running">;
    };

export interface McpInvocationContext {
  invocationId: string;
  args: Record<string, unknown>;
  userId?: number;
  approval?: {
    inputHash: string;
    granted: boolean;
  };
  threadId?: string;
  turnId?: string;
  pushEvent: (event: McpStreamEventInput) => void;
  addArtifact: (artifact: Omit<McpArtifact, "id">) => McpArtifact;
  trace: {
    startSpan: (input: {
      name: string;
      kind: McpTraceSpanKind;
      parentSpanId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      spanId: string;
      end: (input?: {
        status?: "completed" | "failed" | "cancelled";
        metadata?: Record<string, unknown>;
      }) => void;
    };
  };
  signal: AbortSignal;
  environment?: McpExecutionEnvironment;
}

export interface McpToolExecutionResult {
  result?: unknown;
  evidence?: McpToolEvidence;
}

export interface McpToolImplementation {
  definition: McpToolDefinition;
  execute: (
    context: McpInvocationContext,
  ) => Promise<McpToolExecutionResult> | McpToolExecutionResult;
}
