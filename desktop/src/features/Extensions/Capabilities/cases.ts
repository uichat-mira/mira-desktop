import type { ExternalMcpServerRecord } from "@/shared/api/tools";
import type { CapabilityAcceptanceCase } from "./types";

const fixturePath = (fixtureId: string, relativePath: string) =>
  `.tool-lab-fixtures/${fixtureId}/${relativePath}`;

const UNIVERSAL_READ_FIXTURE = "universal-read";

export const nativeCapabilityAcceptanceCases: CapabilityAcceptanceCase[] = [
  {
    id: "core-read-success",
    toolId: "read",
    title: "读取工作区文件",
    purpose: "确认 Native read 通过真实 Harness 读取已知工作区文件。",
    expectedObservation: "Completed，并返回可检查的结构化结果或 Artifact。",
    args: {
      path: fixturePath("platform-read-success", "input.txt"),
    },
    group: "Native",
    workspace: "managed",
    fixture: "platform-read-success",
  },
  {
    id: "universal-read-range",
    toolId: "read",
    title: "分页读取文本",
    purpose: "确认 read 用 offset / limit 返回有界文本，并提供继续读取位置。",
    expectedObservation:
      "Completed；只返回指定行范围，hasMore/truncated 为 true，并给出 nextOffset。",
    args: {
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "text/notes.txt"),
      offset: 1,
      limit: 2,
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-read-image",
    toolId: "read",
    title: "读取 PNG 图片",
    purpose: "确认 raster 图片通过 canonical read 进入模型图片通道，而不是新增 read_image。",
    expectedObservation:
      "Completed；结构化结果标记 image/png 与 image mediaType，普通结果/Evidence 中不出现 base64。",
    args: {
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "image/pixel.png"),
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-read-svg",
    toolId: "read",
    title: "读取 SVG 文本",
    purpose: "确认 SVG 保持文本读取语义，不进入 raster 图片传输。",
    expectedObservation:
      "Completed；source.kind 为 text，mimeType 为 image/svg+xml，并可检查 SVG 文本内容。",
    args: {
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "image/icon.svg"),
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-read-binary",
    toolId: "read",
    title: "读取不支持的二进制文件",
    purpose: "确认不支持的二进制文件返回受控结果，而不是伪装成普通文本成功。",
    expectedObservation:
      "Completed；结构化结果明确标记 unsupported/binary 路由信息，不返回伪文本内容。",
    args: {
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "binary/blob.bin"),
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-list-direct",
    toolId: "list",
    title: "列出目录直接子项",
    purpose: "确认 list 只观察直接子项，并以稳定顺序返回文件/目录类型。",
    expectedObservation:
      "Completed；只出现 tree 的直接子项，目录排在文件之前，不递归展开 nested 内容。",
    args: {
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "tree"),
      limit: 20,
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-glob-match",
    toolId: "glob",
    title: "Glob 路径匹配",
    purpose: "确认 glob 使用真实 glob pattern 查找路径，而不是做 substring locate。",
    expectedObservation:
      "Completed；匹配 nested/gamma.ts，返回 workspace-relative path，且结果可继续分页。",
    args: {
      pattern: "**/*.ts",
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "tree"),
      limit: 20,
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-glob-no-match",
    toolId: "glob",
    title: "Glob 无匹配",
    purpose: "确认合法的无匹配查询是 completed empty result，不被误报成失败。",
    expectedObservation: "Completed；returnedCount 为 0，hasMore 为 false。",
    args: {
      pattern: "**/*.never",
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "tree"),
      limit: 20,
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-grep-match",
    toolId: "grep",
    title: "Grep 内容匹配",
    purpose: "确认 grep 通过 canonical 内容搜索返回文件、行、列和上下文。",
    expectedObservation:
      "Completed；匹配 nested/gamma.ts 中的 MIRA_NEEDLE，并返回 line/column/context。",
    args: {
      pattern: "MIRA_NEEDLE",
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "tree"),
      include: "**/*.ts",
      literal: true,
      context: 1,
      limit: 20,
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
  },
  {
    id: "universal-grep-no-match",
    toolId: "grep",
    title: "Grep 无匹配",
    purpose: "确认内容无匹配是 completed empty result，不与 provider/runtime failure 混淆。",
    expectedObservation: "Completed；returnedCount 为 0，且不是 Failed/Unavailable。",
    args: {
      pattern: "MIRA_ABSENT",
      path: fixturePath(UNIVERSAL_READ_FIXTURE, "tree"),
      literal: true,
      limit: 20,
    },
    group: "Universal Read",
    workspace: "managed",
    fixture: UNIVERSAL_READ_FIXTURE,
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
    group: "Native",
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
      content: "capabilities-approval-probe",
      dryRun: true,
    },
    group: "Native",
    workspace: "managed",
    fixture: "platform-approval-boundary",
  },
];

const hasNoRequiredInput = (inputSchema: Record<string, unknown>) => {
  const required = inputSchema.required;
  return !Array.isArray(required) || required.length === 0;
};

export function buildExternalMcpCapabilityAcceptanceCases(
  servers: ExternalMcpServerRecord[],
): CapabilityAcceptanceCase[] {
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

export function buildCapabilityAcceptanceCases(servers: ExternalMcpServerRecord[]) {
  return [...nativeCapabilityAcceptanceCases, ...buildExternalMcpCapabilityAcceptanceCases(servers)];
}
