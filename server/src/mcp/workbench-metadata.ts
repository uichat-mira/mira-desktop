import type { ToolDefinition } from "./core/definitions.js";
import { resolveHarnessCapabilityProfiles } from "../harness/profiles/resolver.js";

type WorkbenchPresentation = Omit<
  NonNullable<ToolDefinition["workbench"]>,
  "groupId" | "defaultArgs"
>;

const DOMAIN_METADATA: Record<string, WorkbenchPresentation> = {
  read: {
    groupLabel: "阅读",
    groupDescription: "文件读取、目录浏览、定位与片段提取。",
    groupOrder: 10,
    icon: "file-search",
  },
  edit: {
    groupLabel: "编辑",
    groupDescription: "文件写入、精确替换、删除与移动。",
    groupOrder: 20,
    icon: "pencil",
  },
  web_search: {
    groupLabel: "网络搜索",
    groupDescription: "公网实时搜索与本地新闻源检索。",
    groupOrder: 30,
    icon: "globe",
  },
  terminal: {
    groupLabel: "终端",
    groupDescription: "命令执行、调试链路与长任务观察。",
    groupOrder: 40,
    icon: "terminal",
  },
  github: {
    groupLabel: "GitHub",
    groupDescription:
      "在 GitHub 官方 installation 授权范围内管理仓库、Issue、Pull Request 与 Actions。",
    groupOrder: 50,
    icon: "github",
  },
  external_expert: {
    groupLabel: "问策",
    groupDescription: "向已连接的外部专家请求第二意见。",
    groupOrder: 70,
    icon: "external-expert",
  },
};

type WorkbenchCase = NonNullable<
  NonNullable<ToolDefinition["workbench"]>["cases"]
>[number];

const FILE_MUTATION_FIXTURE_ROOT = ".tool-lab-fixtures/file-mutation";

const WORKBENCH_CASES: Record<string, WorkbenchCase[]> = {
  apply_patch: [
    {
      id: "apply-patch-add",
      title: "新增文件",
      description:
        "确认 apply_patch 在审批后通过 Add File 创建新文件，并输出可审计的逐步 diff。",
      fixture: "file-mutation",
      args: {
        patchText: `*** Begin Patch
*** Add File: ${FILE_MUTATION_FIXTURE_ROOT}/apply-patch-added.txt
+alpha patch line
+omega patch line
*** End Patch
`,
      },
    },
    {
      id: "apply-patch-update",
      title: "更新文件",
      description:
        "确认 apply_patch 通过 Update File 精确替换已有内容，并保留上下文校验。",
      fixture: "file-mutation",
      args: {
        patchText: `*** Begin Patch
*** Update File: ${FILE_MUTATION_FIXTURE_ROOT}/overwrite.txt
@@
-before overwrite
+after overwrite
*** End Patch
`,
      },
    },
    {
      id: "apply-patch-move",
      title: "移动文件",
      description:
        "确认 apply_patch 在同一 hunk 中更新内容并通过 Move to 迁移到新路径。",
      fixture: "file-mutation",
      args: {
        patchText: `*** Begin Patch
*** Update File: ${FILE_MUTATION_FIXTURE_ROOT}/move-source.txt
*** Move to: ${FILE_MUTATION_FIXTURE_ROOT}/move-target.txt
@@
-move me
+moved by patch
*** End Patch
`,
      },
    },
    {
      id: "apply-patch-delete",
      title: "删除文件",
      description:
        "确认 apply_patch 通过 Delete File 删除文件，并把 committed delete 投影到 Result / Artifact。",
      fixture: "file-mutation",
      args: {
        patchText: `*** Begin Patch
*** Delete File: ${FILE_MUTATION_FIXTURE_ROOT}/delete-file.txt
*** End Patch
`,
      },
    },
    {
      id: "apply-patch-controlled-error",
      title: "受控失败：源文件缺失",
      description:
        "确认 apply_patch 在 Update File 源文件不存在时明确失败，而不是产生部分写入。",
      fixture: "file-mutation",
      args: {
        patchText: `*** Begin Patch
*** Update File: ${FILE_MUTATION_FIXTURE_ROOT}/does-not-exist.txt
@@
-ghost
+phantom
*** End Patch
`,
      },
    },
  ],
};

const DEFAULT_ARGS: Record<string, Record<string, unknown>> = {
  read: { path: "" },
  list: { path: "." },
  glob: { pattern: "**/*", path: "." },
  grep: { pattern: "", path: "." },
  write: { path: "", content: "" },
  edit: { path: "", edits: [{ oldText: "", newText: "" }] },
  delete: { path: "" },
  move: { path: "", destinationPath: "" },
  apply_patch: { patchText: "*** Begin Patch\n*** End Patch\n" },
  web_search: { queries: [""] },
  web_fetch: { url: "" },
  news_search: { query: "" },
  github_repository: {
    operation: "get",
    repository: "owner/repository",
    includeReadme: true,
    includeLanguages: false,
    includeBranches: false,
    commitLimit: 5,
  },
  github_issue: {
    operation: "list",
    repository: "owner/repository",
    state: "open",
    sort: "updated",
    direction: "desc",
    limit: 20,
    page: 1,
  },
  github_pull_request: {
    operation: "list",
    repository: "owner/repository",
    state: "open",
    sort: "updated",
    direction: "desc",
    limit: 20,
    page: 1,
  },
  github_actions: {
    operation: "list_runs",
    repository: "owner/repository",
    limit: 20,
    page: 1,
  },
  terminal: { command: "" },
};

const fallbackDomainMetadata = (domain: string) => ({
  groupLabel: domain
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" "),
  groupDescription: `${domain} capability tools.`,
  groupOrder: 1000,
  icon: "wrench",
});

export const withWorkbenchMetadata = (
  definitions: ToolDefinition[],
  ownershipDefinitions: ToolDefinition[] = definitions,
): ToolDefinition[] => {
  const explicitOwnership = new Map<
    string,
    { groupId: string; presentation: WorkbenchPresentation }
  >();

  for (const profile of resolveHarnessCapabilityProfiles(ownershipDefinitions)) {
    if (!profile.workbench) {
      continue;
    }
    for (const toolId of profile.supportingToolIds) {
      explicitOwnership.set(toolId, {
        groupId: profile.id,
        presentation: {
          groupLabel: profile.workbench.label,
          groupDescription: profile.workbench.description,
          groupOrder: profile.workbench.order,
          icon: profile.workbench.icon,
        },
      });
    }
  }

  return definitions.map((definition) => {
    const ownership = explicitOwnership.get(definition.id);
    return {
      ...definition,
      workbench: {
        groupId: ownership?.groupId ?? definition.domain,
        ...(ownership?.presentation ??
          DOMAIN_METADATA[definition.domain] ??
          fallbackDomainMetadata(definition.domain)),
        ...(DEFAULT_ARGS[definition.id]
          ? { defaultArgs: DEFAULT_ARGS[definition.id] }
          : {}),
        ...(WORKBENCH_CASES[definition.id]
          ? { cases: WORKBENCH_CASES[definition.id] }
          : {}),
      },
    };
  });
};
