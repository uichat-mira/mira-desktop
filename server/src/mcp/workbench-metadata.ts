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

const DEFAULT_CASES: Record<
  string,
  NonNullable<ToolDefinition["workbench"]>["cases"]
> = {
  terminal: [
    {
      id: "short-success",
      title: "短命令成功",
      description: "执行一个跨平台 Node 短命令并返回稳定输出。",
      args: {
        command: "node -e \"process.stdout.write('MIRA_TERMINAL_OK')\"",
      },
    },
    {
      id: "short-failure",
      title: "短命令失败",
      description: "执行一个退出码为 7 的短命令，验证失败状态和 exit code。",
      args: {
        command: "node -e \"process.exit(7)\"",
      },
    },
    {
      id: "persistent-start",
      title: "持久任务",
      description:
        "启动持续输出的 Node 任务；观察窗口结束后，用 Continue / Status / Stop 验证持久会话合同。",
      args: {
        command:
          "node -e \"let i=0; setInterval(()=>console.log('MIRA_TICK:'+ ++i),250)\"",
        sessionMode: "persistent",
        timeoutMs: 700,
        outputLimitBytes: 4096,
      },
    },
    {
      id: "stale-session",
      title: "失效会话",
      description: "检查 unknown/stale sessionId 是否明确失败。",
      args: {
        operation: "status",
        sessionId: "tool-lab-stale-session",
      },
    },
  ],
};

const DEFAULT_ARGS: Record<string, Record<string, unknown>> = {
  read: { path: "" },
  list: { path: "." },
  glob: { pattern: "**/*", path: "." },
  grep: { pattern: "", path: "." },
  read_open: { path: "" },
  read_extract: { path: "" },
  write: { path: "", content: "" },
  edit: { path: "", edits: [{ oldText: "", newText: "" }] },
  delete: { path: "" },
  move: { path: "", destinationPath: "" },
  web_search: { query: "" },
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
        ...(DEFAULT_CASES[definition.id]?.length
          ? { cases: DEFAULT_CASES[definition.id] }
          : {}),
      },
    };
  });
};
