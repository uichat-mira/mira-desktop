import path from "node:path";
import type { CurrentTaskFrame } from "./types";
import {
  WORKSPACE_ROOT_SENTINEL,
  isWindowsAbsolutePath,
  normalizeWorkspaceRelativePathArg,
} from "@/mcp/workspace-path-args";

export type AgentTaskKind =
  | "list"
  | "locate"
  | "read_content"
  | "mutate"
  | "verify"
  | "search"
  | "terminal"
  | "mixed";

export interface AgentRequiredWork {
  taskKind: AgentTaskKind;
  requiredTargets: string[];
  requiredActions: Exclude<AgentTaskKind, "mixed">[];
  completionHints: string[];
}

const DIRECTORY_OVERVIEW_PATTERNS = [
  /\b(list|show|what's in|what is in|contents? of|files? under|files? in)\b/i,
  /列出|有哪些文件|有什么文件|看看有哪些|目录里有什么|目录内容/u,
] as const;

const LOCATE_PATTERNS = [
  /\b(where|locate|find|path of|located)\b/i,
  /在哪里|在哪儿|在哪|位置|定位|找到/u,
] as const;

const READ_CONTENT_PATTERNS = [
  /\b(open|read|content|contents|inside)\b/i,
  /内容|打开|读取|阅读|查看/u,
] as const;

const MUTATION_PATTERNS = [
  /\b(delete|remove|edit|write|rewrite|modify|update|replace|create|overwrite|move|rename)\b/i,
  /删除|移除|删掉|修改|编辑|改成|改为|替换|写入|新建|创建|覆盖|移动|重命名/u,
] as const;

const VERIFY_PATTERNS = [
  /\b(verify|verification|confirm|check|inspect|validate)\b/i,
  /验证|确认|检查|核实|确认一下|检查结果|验证结果|内容是否正确/u,
] as const;

const SEARCH_PATTERNS = [
  /\b(search|web|online|latest|news|release notes?)\b/i,
  /联网|搜索|查一下|网上|最新/u,
] as const;

const TERMINAL_PATTERNS = [
  /\b(run|command|terminal|shell|execute)\b/i,
  /执行|命令|终端|运行/u,
] as const;

const PATH_TARGET_PATTERN =
  /(?:[A-Za-z]:\\[^\s"'<>|]+|(?:\/workspace\/)?(?:\.{1,2}[\\/])?[A-Za-z0-9_./\\-]+\.[A-Za-z0-9_-]{1,12})/g;

const CONNECTOR_SPLIT_PATTERN = /\s*(?:,|，|、|\band\b|\bor\b|和|与|及)\s*/iu;

const ACTION_ORDER: Exclude<AgentTaskKind, "mixed">[] = [
  "list",
  "locate",
  "read_content",
  "mutate",
  "verify",
  "search",
  "terminal",
];

const uniqPush = (items: string[], value: string) => {
  if (value.length === 0 || items.includes(value)) {
    return;
  }
  items.push(value);
};

const trimQuotedText = (value: string) =>
  value.trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "");

export const normalizeTaskTargetPath = (
  value: string,
  workspaceRoot?: string | null,
) => {
  const trimmed = trimQuotedText(value).replace(/[。；;，,、]+$/u, "");
  if (!trimmed) {
    return "";
  }

  if (trimmed === WORKSPACE_ROOT_SENTINEL || trimmed === `${WORKSPACE_ROOT_SENTINEL}/`) {
    return "";
  }

  if (workspaceRoot && isWindowsAbsolutePath(trimmed)) {
    const normalizedWorkspace = workspaceRoot.replaceAll("\\", "/").toLowerCase();
    const normalizedValue = trimmed.replaceAll("\\", "/");
    const lowerValue = normalizedValue.toLowerCase();
    if (
      lowerValue === normalizedWorkspace ||
      lowerValue.startsWith(`${normalizedWorkspace}/`)
    ) {
      // Both operands are Windows paths here, so the relative form must be
      // computed with the win32 resolver; the host `path` module would treat
      // "D:\\..." as a relative POSIX filename on non-Windows hosts.
      const relativePath = path
        .win32.relative(workspaceRoot, trimmed)
        .replaceAll("\\", "/")
        .replace(/^\.\/+/, "");
      return relativePath.toLowerCase();
    }
    return normalizedValue.toLowerCase();
  }

  const normalizedWorkspaceRelative = normalizeWorkspaceRelativePathArg(trimmed);
  const normalizedValue =
    normalizedWorkspaceRelative.type === "reject"
      ? trimmed.replaceAll("\\", "/")
      : normalizedWorkspaceRelative.value.replaceAll("\\", "/");

  if (normalizedValue === "." || normalizedValue === WORKSPACE_ROOT_SENTINEL) {
    return "";
  }

  return normalizedValue.replace(/^\.\/+/, "").toLowerCase();
};

const normalizeNamedTargetCandidate = (value: string) =>
  trimQuotedText(value)
    .replace(/^(?:file|files|folder|folders|directory|directories)\s+/i, "")
    .replace(/^(?:文件|文件夹|目录)\s*/u, "")
    .replace(
      /\s+(?:after|then|afterwards|respectively|并且|然后|之后|后再|后验证|并验证).*/iu,
      "",
    )
    .replace(/[。；;，,、]+$/u, "")
    .trim();

const extractNamedTargetsFromMutationText = (text: string) => {
  const segments: string[] = [];
  const englishMatch = text.match(
    /\b(?:delete|remove|edit|write|rewrite|modify|update|replace|create|overwrite|move|rename)\b\s+(.+)/i,
  );
  if (englishMatch?.[1]) {
    segments.push(englishMatch[1]);
  }

  const chineseMatch = text.match(
    /(?:删除|移除|删掉|修改|编辑|改成|改为|替换|写入|新建|创建|覆盖|移动|重命名)(.+)/u,
  );
  if (chineseMatch?.[1]) {
    segments.push(chineseMatch[1]);
  }

  return segments.flatMap((segment) =>
    segment
      .split(CONNECTOR_SPLIT_PATTERN)
      .map((item) => normalizeNamedTargetCandidate(item))
      .filter(
        (item) =>
          item.length > 0 &&
          item.length <= 160 &&
          (!/\s/.test(item) || /[\\/]/.test(item)) &&
          /[\p{Script=Han}A-Za-z0-9_\-.\\/]/u.test(item),
      ),
  );
};

export const collectTaskIntentTexts = (input: {
  question?: string;
  currentTaskFrame?: CurrentTaskFrame;
}) =>
  [
    input.question?.trim(),
    input.currentTaskFrame?.currentGoal?.trim(),
    ...(input.currentTaskFrame?.completionCriteria ?? []).map((item) => item.trim()),
  ].filter((value): value is string => Boolean(value));

const classifyTextActions = (text: string): Exclude<AgentTaskKind, "mixed">[] => {
  const actions: Exclude<AgentTaskKind, "mixed">[] = [];
  const pushAction = (action: Exclude<AgentTaskKind, "mixed">) => {
    if (!actions.includes(action)) {
      actions.push(action);
    }
  };

  if (DIRECTORY_OVERVIEW_PATTERNS.some((pattern) => pattern.test(text))) {
    pushAction("list");
  }
  if (LOCATE_PATTERNS.some((pattern) => pattern.test(text))) {
    pushAction("locate");
  }
  if (READ_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    pushAction("read_content");
  }
  if (MUTATION_PATTERNS.some((pattern) => pattern.test(text))) {
    pushAction("mutate");
  }
  if (VERIFY_PATTERNS.some((pattern) => pattern.test(text))) {
    pushAction("verify");
  }
  if (SEARCH_PATTERNS.some((pattern) => pattern.test(text))) {
    pushAction("search");
  }
  if (TERMINAL_PATTERNS.some((pattern) => pattern.test(text))) {
    pushAction("terminal");
  }

  return actions;
};

const extractTargetsFromTexts = (texts: string[], workspaceRoot?: string | null) => {
  const targets: string[] = [];

  for (const text of texts) {
    const matches = text.match(PATH_TARGET_PATTERN) ?? [];
    for (const match of matches) {
      const normalized = normalizeTaskTargetPath(match, workspaceRoot);
      uniqPush(targets, normalized);
    }

    for (const namedTarget of extractNamedTargetsFromMutationText(text)) {
      const normalized = normalizeTaskTargetPath(namedTarget, workspaceRoot);
      uniqPush(targets, normalized);
    }
  }

  return targets;
};

const extractCompletionHints = (input: {
  question?: string;
  currentTaskFrame?: CurrentTaskFrame;
}) => {
  const hints: string[] = [];
  for (const item of input.currentTaskFrame?.completionCriteria ?? []) {
    const normalized = item.trim();
    if (normalized) {
      uniqPush(hints, normalized);
    }
  }

  const trimmedQuestion = input.question?.trim();
  const currentGoal = input.currentTaskFrame?.currentGoal?.trim();
  if (trimmedQuestion && trimmedQuestion !== currentGoal) {
    uniqPush(hints, trimmedQuestion);
  }

  return hints;
};

export const extractAgentRequiredWork = (input: {
  question?: string;
  currentTaskFrame?: CurrentTaskFrame;
  workspaceRoot?: string | null;
}): AgentRequiredWork => {
  const texts = collectTaskIntentTexts(input);
  const requiredTargets = extractTargetsFromTexts(texts, input.workspaceRoot);
  const actionSet = new Set<Exclude<AgentTaskKind, "mixed">>();

  for (const text of texts) {
    for (const action of classifyTextActions(text)) {
      actionSet.add(action);
    }
  }

  const requiredActions = ACTION_ORDER.filter((action) => actionSet.has(action));
  const taskKind =
    requiredActions.length === 1
      ? requiredActions[0]
      : requiredActions.length > 1
        ? "mixed"
        : requiredTargets.length > 0
          ? "read_content"
          : "mixed";

  return {
    taskKind,
    requiredTargets,
    requiredActions,
    completionHints: extractCompletionHints(input),
  };
};
