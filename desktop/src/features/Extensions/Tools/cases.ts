import type { ExternalMcpServerRecord } from "@/shared/api/tools";
import type { ToolLabCaseDefinition } from "./types";

const fixturePath = (fixtureId: string, relativePath: string) =>
  `.tool-lab-fixtures/${fixtureId}/${relativePath}`;

export const coreToolLabCases: ToolLabCaseDefinition[] = [
  {
    id: "core-read-success",
    toolId: "read",
    title: "读取工作区文件",
    purpose: "确认 Native read 通过真实 Harness 读取已知工作区文件。",
    expectedObservation: "Completed，并返回可检查的结构化结果或 Artifact。",
    args: {
      path: fixturePath("platform-read-success", "input.txt"),
    },
    group: "Core",
    workspace: "managed",
    fixture: "platform-read-success",
  },
  {
    id: "core-read-controlled-failure",
    toolId: "read",
    title: "读取不存在文件",
    purpose: "确认真实 Runtime 失败不会被包装成空成功。",
    expectedObservation: "Failed，并能在诊断层查看结构化错误与 Trace。",
    args: {
      path: fixturePath("platform-read-missing", "missing.txt"),
    },
    group: "Core",
    workspace: "managed",
    fixture: "platform-read-missing",
  },
  {
    id: "core-approval-boundary",
    toolId: "write_file",
    title: "写入审批边界",
    purpose: "确认需要审批的 Tool 会停在真实 Policy 边界，不会直接执行副作用。",
    expectedObservation: "Awaiting Approval，并显示审批原因与范围；不会写入文件。",
    args: {
      path: fixturePath("platform-approval-boundary", "approval-probe.txt"),
      content: "tool-lab-approval-probe",
      dryRun: true,
    },
    group: "Core",
    workspace: "managed",
    fixture: "platform-approval-boundary",
  },
];

const hasNoRequiredInput = (inputSchema: Record<string, unknown>) => {
  const required = inputSchema.required;
  return !Array.isArray(required) || required.length === 0;
};

export function buildExternalMcpToolLabCases(
  servers: ExternalMcpServerRecord[],
): ToolLabCaseDefinition[] {
  return servers.flatMap((server) =>
    server.discoveredTools
      .filter((tool) => hasNoRequiredInput(tool.inputSchema))
      .map((tool) => ({
        id: `external-mcp-${server.id}-${tool.name}`,
        toolId: tool.projectedCapabilityId,
        title: `${server.displayName} · ${tool.title}`,
        purpose:
          "确认 External MCP 投影 Tool 使用与 Native Tool 相同的 Harness、Approval 与结果展示。",
        expectedObservation: server.status === "connected" && server.enabled
          ? "Awaiting Approval；Source 显示 External MCP，且不会绕过真实审批边界。"
          : "Unavailable；明确显示来源当前不可用，而不是误报为执行失败。",
        args: {},
        group: "External MCP",
        workspace: "none",
      })),
  );
}

export function buildToolLabCases(servers: ExternalMcpServerRecord[]) {
  return [...coreToolLabCases, ...buildExternalMcpToolLabCases(servers)];
}
