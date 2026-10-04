import type {
  HarnessToolDefinition,
  McpWorkspaceSelection,
  ToolArtifact,
  ToolInvocationEvent,
} from "@/shared/api/tools";

export type ToolWorkbenchGroupId = string;

export type ToolGroupSummary = {
  id: ToolWorkbenchGroupId;
  label: string;
  description: string;
  count: number;
  order: number;
  icon: string;
};

export type WorkbenchToolDefinition = HarnessToolDefinition & {
  source: "internal";
  workbench: NonNullable<HarnessToolDefinition["workbench"]>;
};

export type ToolsWorkbenchState = {
  activeGroupId: ToolWorkbenchGroupId;
  selectedToolId: string | null;
  argsDraft: string;
  isRunning: boolean;
  isLoading: boolean;
  isWorkspaceLoading: boolean;
  isSelectingWorkspace: boolean;
  tools: WorkbenchToolDefinition[];
  workspaceSelection: McpWorkspaceSelection | null;
  workspaceRootInput: string;
  events: ToolInvocationEvent[];
  result: unknown;
  artifacts: ToolArtifact[];
  runError: string | null;
  runStatus: "idle" | "completed" | "failed" | "cancelled";
};
