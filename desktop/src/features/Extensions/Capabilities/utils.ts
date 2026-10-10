import type {
  ExternalMcpServerRecord,
  HarnessToolDefinition,
  ToolArtifact,
  ToolInvocation,
} from "@/shared/api/tools";
import type {
  CapabilityAcceptanceCase,
  CapabilityReadiness,
  CapabilityTool,
} from "./types";

const unavailable = (reason: string, settingsPath?: string): CapabilityReadiness => ({
  state: "unavailable",
  reason,
  ...(settingsPath ? { settingsPath } : {}),
});

export function toNativeCapabilityTool(definition: HarnessToolDefinition): CapabilityTool {
  return {
    ...definition,
    sourceInfo: {
      kind: "native",
      label: "Native",
      detail: definition.domain,
      settingsPath: "/settings/tools",
    },
  };
}

export function resolveToolReadiness(tool: CapabilityTool): CapabilityReadiness["state"] {
  if (tool.runtimeReadiness?.state) {
    return tool.runtimeReadiness.state;
  }

  return tool.id === "web_search" ? "unavailable" : "ready";
}

export function toUnavailableNativeCapabilityTool(toolId: string): CapabilityTool {
  return {
    id: toolId,
    title: toolId,
    description: "当前 Runtime 尚未注册这个 Tool。",
    domain: "unknown",
    source: "internal",
    inputSchema: {},
    tags: [],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
    },
    sourceInfo: {
      kind: "native",
      label: "Native",
      settingsPath: "/settings/tools",
    },
    runtimeReadiness: unavailable("当前 Runtime 尚未注册这个 Tool。", "/settings/tools"),
  };
}

export function toExternalCapabilityTools(
  servers: ExternalMcpServerRecord[],
): CapabilityTool[] {
  return servers.flatMap((server) => {
    const runtimeReadiness: CapabilityReadiness =
      !server.enabled
        ? unavailable("External MCP 已停用。", "/settings/mcp")
        : server.status !== "connected"
          ? unavailable(
              server.lastError
                ? `External MCP 不可用：${server.lastError}`
                : "External MCP 尚未连接。",
              "/settings/mcp",
            )
          : { state: "ready", reason: "External MCP 已连接并可进入真实 Harness。" };

    return server.discoveredTools.map((tool) => ({
      id: tool.projectedCapabilityId,
      title: tool.title,
      description: tool.description,
      domain: "external_mcp",
      source: "external",
      sourceLabel: server.displayName,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      tags: [server.id, tool.name],
      sourceInfo: {
        kind: "external_mcp",
        label: `External MCP · ${server.displayName}`,
        detail: tool.name,
        settingsPath: "/settings/mcp",
      },
      runtimeReadiness,
      externalServerId: server.id,
      agentAccessEnabled: server.agentEnabled,
    } satisfies CapabilityTool));
  });
}

export function resolveCapabilityReadiness(input: {
  caseDefinition: CapabilityAcceptanceCase | null;
  tool: CapabilityTool | null;
  workspaceRoot: string | null;
}): CapabilityReadiness {
  if (!input.caseDefinition) {
    return unavailable("请选择一个验收用例。");
  }
  if (!input.tool) {
    return unavailable(
      `当前 Runtime 未注册 ${input.caseDefinition.toolId}。`,
      "/settings/tools",
    );
  }
  if (input.tool.id === "web_search" && !input.tool.runtimeReadiness) {
    return unavailable(
      "Web Search runtime readiness is unavailable.",
      "/settings/tools",
    );
  }
  if (input.tool.runtimeReadiness?.state === "unavailable") {
    return input.tool.runtimeReadiness;
  }
  if (input.tool.capabilities?.workspaceBound && !input.workspaceRoot) {
    return unavailable("此用例需要先选择 Workspace。", "/settings/tools");
  }
  if (input.tool.runtimeReadiness?.state === "degraded") {
    return input.tool.runtimeReadiness;
  }
  return {
    state: "ready",
    reason: input.tool.runtimeReadiness?.reason ?? "前置条件已满足，可以运行。",
  };
}

export function formatCapabilityDuration(invocation: ToolInvocation | null) {
  if (!invocation?.startedAt || !invocation.finishedAt) {
    return "—";
  }
  const startedAt = new Date(invocation.startedAt).getTime();
  const finishedAt = new Date(invocation.finishedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    return "—";
  }
  const duration = Math.max(0, finishedAt - startedAt);
  return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(2)}s`;
}

type CapabilitySummaryTranslator = (key: string) => string;

const defaultSummaryText: Record<string, string> = {
  notRun: "尚未运行此用例。",
  awaitingApproval: "执行已停在审批边界，等待审批。",
  failed: "Tool 执行失败。",
  cancelled: "Tool 执行已取消。",
  running: "真实 Invocation 正在执行。",
  completedArtifacts: "执行完成，返回 {{count}} 个 Artifact。",
  completedResult: "执行完成，已返回结构化结果。",
  completed: "执行完成。",
};

export function summarizeCapabilityInvocation(
  invocation: ToolInvocation | null,
  translate?: CapabilitySummaryTranslator,
) {
  const text = (key: string) =>
    translate?.(`settings.development.capabilities.summary.${key}`) ??
    defaultSummaryText[key]!;
  if (!invocation) {
    return text("notRun");
  }
  if (invocation.status === "awaiting_approval") {
    return invocation.approval?.reason ?? text("awaitingApproval");
  }
  if (invocation.status === "failed") {
    return invocation.error?.message ?? text("failed");
  }
  if (invocation.status === "cancelled") {
    return invocation.error?.message ?? text("cancelled");
  }
  if (invocation.status === "running" || invocation.status === "queued") {
    return text("running");
  }
  if (invocation.evidence?.actionTaken) {
    return invocation.evidence.status && invocation.evidence.status !== "completed"
      ? `${invocation.evidence.actionTaken} · Evidence: ${invocation.evidence.status}`
      : invocation.evidence.actionTaken;
  }
  if (invocation.artifacts.length > 0) {
    return text("completedArtifacts").replace("{{count}}", String(invocation.artifacts.length));
  }
  if (invocation.result !== undefined) {
    return text("completedResult");
  }
  return text("completed");
}

export function stringifyCapabilityValue(value: unknown) {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function previewToolArtifact(artifact: ToolArtifact) {
  if (artifact.data !== undefined) {
    return stringifyCapabilityValue(artifact.data);
  }
  if (artifact.uri) {
    return artifact.uri;
  }
  return "Artifact 没有可直接预览的 data / uri。";
}
