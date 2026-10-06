import type { ExternalMcpServerRecord } from "@/shared/api/tools";
import type { CapabilityAcceptanceCase } from "./types";

const fixturePath = (fixtureId: string, relativePath: string) =>
  `.tool-lab-fixtures/${fixtureId}/${relativePath}`;

const UNIVERSAL_READ_FIXTURE = "universal-read";
const FILE_MUTATION_FIXTURE = "file-mutation";

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
    id: "file-mutation-write-create",
    toolId: "write",
    title: "创建文件",
    purpose: "确认 write 在审批后创建缺失文件，并返回实际提交的 Result / Artifact / Evidence。",
    expectedObservation:
      "Awaiting Approval；批准后 Completed，created=true，Artifact 为 diff，目标文件真实出现。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "created.txt"),
      content: "created by Mira Tool Lab\n",
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-write-overwrite",
    toolId: "write",
    title: "显式覆盖文件",
    purpose: "确认 write 只有 overwrite=true 时才完整替换现有文件，并保留可审计 diff。",
    expectedObservation:
      "Awaiting Approval；批准后 Completed，overwritten=true，diff 显示 before overwrite 被替换。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "overwrite.txt"),
      content: "after overwrite\n",
      overwrite: true,
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-edit-multi",
    toolId: "edit",
    title: "一次执行多个编辑",
    purpose: "确认 edit 在同一文件中先验证全部非重叠 edits，再一次性提交。",
    expectedObservation:
      "Awaiting Approval；批准后 Completed，editsApplied=2，Artifact diff 同时包含 alpha 与 omega 两处修改。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "multi-edit.txt"),
      edits: [
        { oldText: "alpha target", newText: "alpha changed" },
        { oldText: "omega target", newText: "omega changed" },
      ],
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-edit-tolerant",
    toolId: "edit",
    title: "确定性容差编辑",
    purpose: "确认 edit 能处理普通缩进/空白与常见 Unicode 引号漂移，但仍要求唯一目标。",
    expectedObservation:
      "Awaiting Approval；批准后 Completed，tolerantEdits=1，且只修改唯一 message 行。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "tolerant.txt"),
      edits: [
        {
          oldText: '  const message = "hello";',
          newText: '  const message = "hello from Mira";',
        },
      ],
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-edit-missing",
    toolId: "edit",
    title: "编辑目标不存在",
    purpose: "确认 edit 找不到 oldText 时失败，且不会产生部分修改。",
    expectedObservation:
      "Awaiting Approval；批准后 Failed，错误明确 target was not found，fixture 内容保持原样。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "missing-edit.txt"),
      edits: [
        { oldText: "MIRA_ABSENT", newText: "must not appear" },
      ],
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-edit-ambiguous",
    toolId: "edit",
    title: "编辑目标歧义",
    purpose: "确认 edit 在 oldText 匹配多处时拒绝猜测，不选择任意一个位置。",
    expectedObservation:
      "Awaiting Approval；批准后 Failed，错误明确 target is ambiguous，文件不发生修改。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "ambiguous-edit.txt"),
      edits: [
        { oldText: "MIRA_DUPLICATE", newText: "must not choose" },
      ],
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-move",
    toolId: "move",
    title: "移动文件",
    purpose: "确认 move 在统一 runtime 中移动/重命名文件，并记录源路径与目标路径。",
    expectedObservation:
      "Awaiting Approval；批准后 Completed，movedType=file，源文件消失且 destinationPath 出现。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "move-source.txt"),
      destinationPath: fixturePath(FILE_MUTATION_FIXTURE, "move-destination.txt"),
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-delete-file",
    toolId: "delete",
    title: "删除文件",
    purpose: "确认 delete 可删除普通文件，并把 committed delete 投影到 Result / Artifact / Evidence。",
    expectedObservation:
      "Awaiting Approval；批准后 Completed，deletedType=file，目标文件真实消失。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "delete-file.txt"),
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-delete-recursive",
    toolId: "delete",
    title: "递归删除目录",
    purpose: "确认非空目录只有显式 recursive=true 才能递归删除。",
    expectedObservation:
      "Awaiting Approval；批准后 Completed，deletedType=directory、recursive=true，目录整体消失。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "recursive-dir"),
      recursive: true,
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-boundary-rejection",
    toolId: "write",
    title: "拒绝越出工作区",
    purpose: "确认 Approval 不能把 write 变成越权通行证，workspace 外路径最终仍由 runtime 拒绝。",
    expectedObservation:
      "Awaiting Approval，并提示 workspace 边界；即使批准也 Failed，且不会在 managed workspace 外写文件。",
    args: {
      path: "../file-mutation-outside.txt",
      content: "must not escape\n",
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
  },
  {
    id: "file-mutation-controlled-failure",
    toolId: "delete",
    title: "受控失败：非空目录",
    purpose: "确认 delete 非空目录缺少 recursive=true 时明确失败，而不是静默删除。",
    expectedObservation:
      "Awaiting Approval；批准后 Failed，错误明确 recursive=true is required，目录与 nested.txt 都保留。",
    args: {
      path: fixturePath(FILE_MUTATION_FIXTURE, "controlled-dir"),
    },
    group: "File Mutation",
    workspace: "managed",
    fixture: FILE_MUTATION_FIXTURE,
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
    toolId: "write",
    title: "写入审批边界",
    purpose: "确认需要审批的 Tool 会停在真实 Policy 边界，不会直接执行副作用。",
    expectedObservation: "Awaiting Approval，并显示审批原因与范围；不会写入文件。",
    args: {
      path: fixturePath("platform-approval-boundary", "approval-probe.txt"),
      content: "capabilities-approval-probe",
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
