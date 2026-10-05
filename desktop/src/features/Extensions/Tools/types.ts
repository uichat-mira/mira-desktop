import type {
  HarnessToolDefinition,
  ToolInvocation,
  ToolInvocationEvent,
  ToolTrace,
} from "@/shared/api/tools";

export type ToolLabReadinessState = "ready" | "degraded" | "unavailable";

export type ToolLabReadiness = {
  state: ToolLabReadinessState;
  reason: string;
  settingsPath?: string;
};

export type ToolLabCaseDefinition = {
  id: string;
  toolId: string;
  title: string;
  purpose: string;
  expectedObservation: string;
  args: Record<string, unknown>;
  group: string;
  workspace: "managed" | "none";
  fixture?: string;
};

export type ToolLabSource = {
  kind: "native" | "external_mcp";
  label: string;
  detail?: string;
  settingsPath: string;
};

export type ToolLabTool = Omit<
  Pick<
    HarnessToolDefinition,
    | "id"
    | "title"
    | "description"
    | "domain"
    | "source"
    | "sourceLabel"
    | "inputSchema"
    | "outputSchema"
    | "tags"
    | "capabilities"
    | "workbench"
  >,
  "capabilities"
> & {
  capabilities?: HarnessToolDefinition["capabilities"];
  sourceInfo: ToolLabSource;
  runtimeReadiness?: ToolLabReadiness;
  externalServerId?: string;
  agentAccessEnabled?: boolean;
};

export type ToolLabRunState = {
  isRunning: boolean;
  invocationId: string | null;
  invocation: ToolInvocation | null;
  resolutionInvocation: ToolInvocation | null;
  events: ToolInvocationEvent[];
  trace: ToolTrace | null;
  transportError: string | null;
};

export type ToolLabViewModel = {
  tools: ToolLabTool[];
  cases: ToolLabCaseDefinition[];
  selectedTool: ToolLabTool | null;
  selectedCase: ToolLabCaseDefinition | null;
  readiness: ToolLabReadiness;
};
