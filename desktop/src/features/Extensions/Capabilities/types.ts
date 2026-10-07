import type {
  HarnessToolDefinition,
  ToolInvocation,
  ToolInvocationEvent,
  ToolTrace,
} from "@/shared/api/tools";

export type CapabilityReadinessState = "ready" | "degraded" | "unavailable";

export type CapabilityReadiness = {
  state: CapabilityReadinessState;
  reason: string;
  settingsPath?: string;
};

export type CapabilityAcceptanceCase = {
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

export type CapabilityToolSource = {
  kind: "native" | "external_mcp";
  label: string;
  detail?: string;
  settingsPath: string;
};

export type CapabilityTool = Omit<
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
  sourceInfo: CapabilityToolSource;
  runtimeReadiness?: CapabilityReadiness;
  externalServerId?: string;
  agentAccessEnabled?: boolean;
};

export type CapabilityRunState = {
  isRunning: boolean;
  invocationId: string | null;
  invocation: ToolInvocation | null;
  resolutionInvocation: ToolInvocation | null;
  events: ToolInvocationEvent[];
  trace: ToolTrace | null;
  transportError: string | null;
};

export type CapabilityViewModel = {
  tools: CapabilityTool[];
  cases: CapabilityAcceptanceCase[];
  selectedTool: CapabilityTool | null;
  selectedCase: CapabilityAcceptanceCase | null;
  readiness: CapabilityReadiness;
};
