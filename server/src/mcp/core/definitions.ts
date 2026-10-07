export type ToolDomain =
  | "read"
  | "edit"
  | "web_search"
  | "terminal"
  | "browser_action"
  | "external_mcp"
  | (string & {});

export type ToolMode = "sync" | "stream";

export type ToolSideEffect = "none" | "local-write" | "process" | "network";

export type SandboxProfile =
  | "read_only"
  | "workspace_write"
  | "command"
  | "networked_command";

export type ToolInvocationStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ToolInvocationFailureCode =
  | "approval_mismatch"
  | "policy_denied"
  | "schema_invalid"
  | "workspace_escape"
  | "tool_runtime_failed"
  | "command_exit_nonzero"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface StructuredInvocationErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
  suggestedAction?: string | null;
}

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

export type ToolArtifactKind =
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

export interface ToolPolicyMetadata {
  sideEffect: ToolSideEffect;
  requiresApproval: boolean;
  workspaceBound?: boolean;
  workspaceBoundary?: {
    argKeys: string[];
    argTypes?: Partial<Record<string, "path" | "directory">>;
  };
  networkAccess?: boolean;
  longRunning?: boolean;
  sandboxRequired?: boolean;
  sandboxProfile?: SandboxProfile;
}

export interface RuntimeCapability {
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

export interface ToolExecutionEnvironment {
  source: "harness";
  workspace: {
    rootPath: string | null;
    source: "selected" | "configured" | "managed" | "unset";
  };
  approvals: {
    outsideWorkspace: "prompt";
    persistence: "thread";
  };
  trace: {
    streamEvents: true;
  };
  read: {
    capabilities: RuntimeCapability[];
  };
  edit: {
    capabilities: RuntimeCapability[];
  };
  web_search: {
    capabilities: RuntimeCapability[];
  };
  terminal: {
    capabilities: RuntimeCapability[];
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
  environment?: ToolExecutionEnvironment;
  pushEvent?: (event: ToolInvocationEventInput) => void;
}

export interface McpResourceReadResult {
  contents: unknown;
  artifacts?: ToolArtifact[];
}

export interface McpResourceImplementation {
  definition: McpResourceDefinition;
  read?: (
    context: McpResourceReadContext,
  ) => Promise<McpResourceReadResult> | McpResourceReadResult;
}

export interface ToolDefinition {
  id: string;
  title: string;
  description: string;
  domain: ToolDomain;
  source: "internal" | "external";
  sourceLabel?: string;
  mode: ToolMode;
  inputSchema: Record<string, unknown>;
  inputSchemaByExposure?: Partial<
    Record<"tools_list" | "agent_intent" | "chat_surface", Record<string, unknown>>
  >;
  outputSchema?: Record<string, unknown>;
  tags: string[];
  capabilities: ToolPolicyMetadata;
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
  legacyProjection?: {
    category: "rag" | "system" | "tool";
    name?: string;
    author?: string;
    version?: string;
  };
}

export interface ToolArtifact {
  id: string;
  kind: ToolArtifactKind;
  title: string;
  mimeType?: string;
  data?: unknown;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolEvidence {
  actionTaken: string;
  facts: string[];
  gaps?: string[];
  error?: string;
  status?: "completed" | "failed" | "partial" | "blocked" | "denied" | "timed_out" | "truncated" | "binaryDetected";
  data?: unknown;
}

export interface ToolInvocation {
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
    failureCode?: ToolInvocationFailureCode;
    code?: StructuredInvocationErrorDetail["code"];
    retryable?: StructuredInvocationErrorDetail["retryable"];
    suggestedAction?: StructuredInvocationErrorDetail["suggestedAction"];
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
}

export type ToolContentBlock = {
  type: string;
  [key: string]: unknown;
};

export interface ToolTraceSpan {
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
}

export interface ToolTrace {
  traceId: string;
  invocationId: string;
  toolId: string;
  startedAt: string;
  finishedAt?: string;
  spans: ToolTraceSpan[];
  debugView?: {
    invocationId: string;
    toolId: string;
    traceId: string;
    spanCount: number;
    runningSpanCount: number;
    kinds: ToolTraceSpanKind[];
  };
}

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
      status: Exclude<ToolInvocationStatus, "queued" | "running">;
      at: string;
    };

export type ToolInvocationEventInput =
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
      artifact: ToolArtifact;
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
      status: Exclude<ToolInvocationStatus, "queued" | "running">;
    };

export interface ToolInvocationContext {
  invocationId: string;
  args: Record<string, unknown>;
  userId?: number;
  approval?: {
    inputHash: string;
    granted: boolean;
  };
  threadId?: string;
  turnId?: string;
  pushEvent: (event: ToolInvocationEventInput) => void;
  addArtifact: (artifact: Omit<ToolArtifact, "id">) => ToolArtifact;
  trace: {
    startSpan: (input: {
      name: string;
      kind: ToolTraceSpanKind;
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
  environment?: ToolExecutionEnvironment;
}

export interface ToolResult<S = unknown> {
  content?: ToolContentBlock[];
  structuredContent?: S;
  isError?: boolean;
}

export interface ToolImplementation {
  definition: ToolDefinition;
  execute: (
    context: ToolInvocationContext,
  ) => Promise<ToolResult> | ToolResult;
}
