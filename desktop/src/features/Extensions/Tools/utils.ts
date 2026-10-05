import type {
  ExternalMcpServerRecord,
  HarnessToolDefinition,
  ToolArtifact,
  ToolInvocation,
} from "@/shared/api/tools";
import type {
  ToolLabCaseDefinition,
  ToolLabReadiness,
  ToolLabTool,
} from "./types";

const unavailable = (reason: string, settingsPath?: string): ToolLabReadiness => ({
  state: "unavailable",
  reason,
  ...(settingsPath ? { settingsPath } : {}),
});

export function toNativeToolLabTool(definition: HarnessToolDefinition): ToolLabTool {
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

export function toUnavailableNativeToolLabTool(toolId: string): ToolLabTool {
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

export function toExternalToolLabTools(
  servers: ExternalMcpServerRecord[],
): ToolLabTool[] {
  return servers.flatMap((server) => {
    const runtimeReadiness: ToolLabReadiness =
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
    } satisfies ToolLabTool));
  });
}

export function resolveToolLabReadiness(input: {
  caseDefinition: ToolLabCaseDefinition | null;
  tool: ToolLabTool | null;
  workspaceRoot: string | null;
}): ToolLabReadiness {
  if (!input.caseDefinition) {
    return unavailable("请选择一个验收用例。");
  }
  if (!input.tool) {
    return unavailable(
      `当前 Runtime 未注册 ${input.caseDefinition.toolId}。`,
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

export function formatToolLabDuration(invocation: ToolInvocation | null) {
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

export function summarizeToolLabInvocation(invocation: ToolInvocation | null) {
  if (!invocation) {
    return "尚未运行此用例。";
  }
  if (invocation.status === "awaiting_approval") {
    return invocation.approval?.reason ?? "执行已停在审批边界，等待审批。";
  }
  if (invocation.status === "failed") {
    return invocation.error?.message ?? "Tool 执行失败。";
  }
  if (invocation.status === "cancelled") {
    return invocation.error?.message ?? "Tool 执行已取消。";
  }
  if (invocation.status === "running" || invocation.status === "queued") {
    return "真实 Invocation 正在执行。";
  }
  if (invocation.evidence?.actionTaken) {
    return invocation.evidence.status && invocation.evidence.status !== "completed"
      ? `${invocation.evidence.actionTaken} · Evidence: ${invocation.evidence.status}`
      : invocation.evidence.actionTaken;
  }
  if (invocation.artifacts.length > 0) {
    return `执行完成，返回 ${invocation.artifacts.length} 个 Artifact。`;
  }
  if (invocation.result !== undefined) {
    return "执行完成，已返回结构化结果。";
  }
  return "执行完成。";
}

export function stringifyToolLabValue(value: unknown) {
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
    return stringifyToolLabValue(artifact.data);
  }
  if (artifact.uri) {
    return artifact.uri;
  }
  return "Artifact 没有可直接预览的 data / uri。";
}
