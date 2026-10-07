import { Buffer } from "node:buffer";
import type {
  ToolInvocationContext,
  ToolImplementation,
} from "../core/definitions.js";
import { mcpBadRequest, mcpNotFound } from "../core/errors.js";
import {
  createGitHubReadClient,
  encodeGitHubRepositoryPath,
  normalizeGitHubRepositoryName,
  type GitHubAuthorizedRepositoryContext,
  type GitHubReadClient,
  type GitHubReadClientDependencies,
} from "@/microapps/github/read-client.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_BODY_CHARS = 20_000;
const MAX_README_CHARS = 50_000;
const MAX_PATCH_CHARS = 12_000;

const GITHUB_WORKBENCH = {
  groupId: "github_read",
  groupLabel: "GitHub",
  groupDescription:
    "读取用户通过 GitHub 官方 installation 明确授权给 Mira 的仓库、Issue、Pull Request 和 Actions 状态。",
  groupOrder: 55,
  icon: "github",
} as const;

type GitHubActor = {
  login?: string;
  html_url?: string;
  avatar_url?: string;
  type?: string;
};

type GitHubLabel = {
  name?: string;
  color?: string;
  description?: string | null;
};

type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
  disabled?: boolean;
  visibility?: string;
  default_branch?: string;
  language?: string | null;
  topics?: string[];
  open_issues_count?: number;
  forks_count?: number;
  stargazers_count?: number;
  watchers_count?: number;
  size?: number;
  pushed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  owner?: GitHubActor;
  license?: { key?: string; name?: string; spdx_id?: string | null } | null;
  permissions?: Record<string, boolean>;
};

type GitHubReadmeResponse = {
  name?: string;
  path?: string;
  html_url?: string;
  encoding?: string;
  content?: string;
  size?: number;
};

type GitHubBranchResponse = {
  name: string;
  protected?: boolean;
  commit?: { sha?: string; url?: string };
};

type GitHubCommitResponse = {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string | null } | null;
    committer?: { name?: string; email?: string; date?: string | null } | null;
  };
  author?: GitHubActor | null;
  committer?: GitHubActor | null;
};

type GitHubIssueResponse = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  html_url: string;
  user?: GitHubActor | null;
  assignees?: GitHubActor[];
  labels?: Array<GitHubLabel | string>;
  milestone?: { number?: number; title?: string; state?: string } | null;
  locked?: boolean;
  comments?: number;
  reactions?: { total_count?: number };
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: unknown;
};

type GitHubIssueSearchResponse = {
  total_count?: number;
  incomplete_results?: boolean;
  items?: GitHubIssueResponse[];
};

type GitHubCommentResponse = {
  id: number;
  html_url?: string;
  body?: string | null;
  user?: GitHubActor | null;
  created_at?: string;
  updated_at?: string;
  path?: string;
  line?: number | null;
  side?: string | null;
  commit_id?: string;
};

type GitHubPullRequestResponse = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  html_url: string;
  user?: GitHubActor | null;
  assignees?: GitHubActor[];
  requested_reviewers?: GitHubActor[];
  labels?: Array<GitHubLabel | string>;
  locked?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  merged_at?: string | null;
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
  comments?: number;
  review_comments?: number;
  head?: {
    ref?: string;
    sha?: string;
    label?: string;
    repo?: { full_name?: string } | null;
  };
  base?: {
    ref?: string;
    sha?: string;
    label?: string;
    repo?: { full_name?: string } | null;
  };
};

type GitHubPullFileResponse = {
  sha?: string;
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  blob_url?: string;
  raw_url?: string;
  patch?: string;
  previous_filename?: string;
};

type GitHubReviewResponse = {
  id: number;
  html_url?: string;
  user?: GitHubActor | null;
  body?: string | null;
  state?: string;
  commit_id?: string;
  submitted_at?: string | null;
};

type GitHubWorkflowRunResponse = {
  id: number;
  name?: string;
  display_title?: string;
  workflow_id?: number;
  run_number?: number;
  run_attempt?: number;
  event?: string;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string;
  head_branch?: string | null;
  head_sha?: string;
  actor?: GitHubActor | null;
  triggering_actor?: GitHubActor | null;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string;
  jobs_url?: string;
};

type GitHubWorkflowRunsResponse = {
  total_count?: number;
  workflow_runs?: GitHubWorkflowRunResponse[];
};

type GitHubWorkflowJobResponse = {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  started_at?: string | null;
  completed_at?: string | null;
  runner_name?: string | null;
  steps?: Array<{
    number?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
  }>;
};

type GitHubWorkflowJobsResponse = {
  total_count?: number;
  jobs?: GitHubWorkflowJobResponse[];
};

const truncate = (value: string | null | undefined, max: number) => {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value;
};

const normalizeActor = (actor?: GitHubActor | null) =>
  actor
    ? {
        login: actor.login ?? "",
        htmlUrl: actor.html_url ?? "",
        avatarUrl: actor.avatar_url ?? "",
        type: actor.type ?? "",
      }
    : null;

const normalizeLabels = (labels: Array<GitHubLabel | string> | undefined) =>
  (labels ?? []).map((label) =>
    typeof label === "string"
      ? { name: label, color: "", description: null }
      : {
          name: label.name ?? "",
          color: label.color ?? "",
          description: label.description ?? null,
        },
  );

const normalizeIssue = (issue: GitHubIssueResponse) => ({
  number: issue.number,
  title: issue.title,
  body: truncate(issue.body, MAX_BODY_CHARS),
  state: issue.state,
  stateReason: issue.state_reason ?? null,
  htmlUrl: issue.html_url,
  author: normalizeActor(issue.user),
  assignees: (issue.assignees ?? []).map(normalizeActor),
  labels: normalizeLabels(issue.labels),
  milestone: issue.milestone
    ? {
        number: issue.milestone.number ?? null,
        title: issue.milestone.title ?? "",
        state: issue.milestone.state ?? "",
      }
    : null,
  locked: Boolean(issue.locked),
  commentCount: issue.comments ?? 0,
  reactionCount: issue.reactions?.total_count ?? 0,
  createdAt: issue.created_at ?? null,
  updatedAt: issue.updated_at ?? null,
  closedAt: issue.closed_at ?? null,
});

const normalizeComment = (comment: GitHubCommentResponse) => ({
  id: String(comment.id),
  htmlUrl: comment.html_url ?? "",
  body: truncate(comment.body, MAX_BODY_CHARS),
  author: normalizeActor(comment.user),
  createdAt: comment.created_at ?? null,
  updatedAt: comment.updated_at ?? null,
  path: comment.path ?? null,
  line: comment.line ?? null,
  side: comment.side ?? null,
  commitId: comment.commit_id ?? null,
});

const normalizePullRequest = (pull: GitHubPullRequestResponse) => ({
  number: pull.number,
  title: pull.title,
  body: truncate(pull.body, MAX_BODY_CHARS),
  state: pull.state,
  draft: Boolean(pull.draft),
  htmlUrl: pull.html_url,
  author: normalizeActor(pull.user),
  assignees: (pull.assignees ?? []).map(normalizeActor),
  requestedReviewers: (pull.requested_reviewers ?? []).map(normalizeActor),
  labels: normalizeLabels(pull.labels),
  locked: Boolean(pull.locked),
  merged: Boolean(pull.merged),
  mergeable: pull.mergeable ?? null,
  mergeableState: pull.mergeable_state ?? null,
  head: {
    ref: pull.head?.ref ?? "",
    sha: pull.head?.sha ?? "",
    label: pull.head?.label ?? "",
    repository: pull.head?.repo?.full_name ?? null,
  },
  base: {
    ref: pull.base?.ref ?? "",
    sha: pull.base?.sha ?? "",
    label: pull.base?.label ?? "",
    repository: pull.base?.repo?.full_name ?? null,
  },
  additions: pull.additions ?? null,
  deletions: pull.deletions ?? null,
  changedFiles: pull.changed_files ?? null,
  commitCount: pull.commits ?? null,
  commentCount: pull.comments ?? null,
  reviewCommentCount: pull.review_comments ?? null,
  createdAt: pull.created_at ?? null,
  updatedAt: pull.updated_at ?? null,
  mergedAt: pull.merged_at ?? null,
  closedAt: pull.closed_at ?? null,
});

const normalizeWorkflowRun = (run: GitHubWorkflowRunResponse) => ({
  id: String(run.id),
  name: run.name ?? "",
  title: run.display_title ?? run.name ?? "",
  workflowId: run.workflow_id ? String(run.workflow_id) : null,
  runNumber: run.run_number ?? null,
  attempt: run.run_attempt ?? null,
  event: run.event ?? "",
  status: run.status ?? null,
  conclusion: run.conclusion ?? null,
  htmlUrl: run.html_url ?? "",
  branch: run.head_branch ?? null,
  headSha: run.head_sha ?? "",
  actor: normalizeActor(run.actor),
  triggeringActor: normalizeActor(run.triggering_actor),
  createdAt: run.created_at ?? null,
  startedAt: run.run_started_at ?? null,
  updatedAt: run.updated_at ?? null,
});

const normalizeBoolean = (
  value: unknown,
  name: string,
  fallback = false,
) => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw mcpBadRequest(`${name} must be a boolean`);
  }
  return value;
};

const normalizeInteger = (
  value: unknown,
  name: string,
  input: { fallback?: number; min?: number; max?: number } = {},
) => {
  if (value === undefined) {
    if (input.fallback === undefined) return undefined;
    return input.fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw mcpBadRequest(`${name} must be a finite number`);
  }
  const normalized = Math.trunc(value);
  const min = input.min ?? 1;
  const max = input.max ?? Number.MAX_SAFE_INTEGER;
  if (normalized < min || normalized > max) {
    throw mcpBadRequest(`${name} must be between ${min} and ${max}`);
  }
  return normalized;
};

const normalizeString = (
  value: unknown,
  name: string,
  input: { required?: boolean; maxLength?: number } = {},
) => {
  if (value === undefined || value === null) {
    if (input.required) throw mcpBadRequest(`${name} is required`);
    return undefined;
  }
  if (typeof value !== "string") {
    throw mcpBadRequest(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (input.required && !normalized) {
    throw mcpBadRequest(`${name} is required`);
  }
  if ((input.maxLength ?? 500) < normalized.length) {
    throw mcpBadRequest(`${name} is too long`);
  }
  return normalized || undefined;
};

const normalizeStringArray = (
  value: unknown,
  name: string,
  maxItems = 20,
) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw mcpBadRequest(`${name} must be an array of strings`);
  }
  if (value.length > maxItems) {
    throw mcpBadRequest(`${name} cannot contain more than ${maxItems} items`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
};

const normalizeEnum = <T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw mcpBadRequest(`${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
};

const authorizeRepository = async (
  context: ToolInvocationContext,
  client: GitHubReadClient,
  repository: string,
) => {
  const span = context.trace.startSpan({
    name: "Validate GitHub installation repository scope",
    kind: "permission_check",
    metadata: { repository },
  });
  try {
    const authorized = await client.resolveAuthorizedRepository(
      repository,
      context.signal,
    );
    span.end({
      metadata: {
        repository: authorized.repository.fullName,
        installationId: authorized.repository.installationId,
      },
    });
    return authorized;
  } catch (error) {
    span.end({ status: "failed" });
    throw error;
  }
};

const addResultArtifact = (
  context: ToolInvocationContext,
  input: {
    kind: "document" | "table";
    title: string;
    data: unknown;
    repository: string;
    toolId: string;
  },
) =>
  context.addArtifact({
    kind: input.kind,
    title: input.title,
    data: input.data,
    metadata: {
      provider: "github",
      repository: input.repository,
      toolId: input.toolId,
      authorization: "github_app_installation",
    },
  });

const repositoryInputProperty = {
  type: "string",
  description:
    "目标仓库，必须使用 owner/repository 格式，并且已经在 GitHub 微应用中授权给 Mira。",
  minLength: 3,
} as const;

const commonWorkbench = (defaultArgs: Record<string, unknown>) => ({
  ...GITHUB_WORKBENCH,
  defaultArgs,
});

const createRepoReadTool = (client: GitHubReadClient): ToolImplementation => ({
  definition: {
    id: "github_repo_read",
    title: "GitHub Repository Read",
    description:
      "读取已授权 GitHub 仓库的元数据，并可按参数附带 README、语言统计、分支和最近提交。不要用它读取 Issue、Pull Request 或 Actions；对应内容使用各自的 GitHub 工具。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repository"],
      properties: {
        repository: repositoryInputProperty,
        ref: {
          type: "string",
          description: "可选分支、Tag 或提交 SHA，用于读取 README 和最近提交。",
        },
        includeReadme: {
          type: "boolean",
          default: false,
          description: "是否读取 README 正文；默认 false。",
        },
        includeLanguages: {
          type: "boolean",
          default: false,
          description: "是否读取 GitHub 语言字节统计；默认 false。",
        },
        includeBranches: {
          type: "boolean",
          default: false,
          description: "是否读取分支列表；默认 false。",
        },
        branchLimit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "includeBranches=true 时返回的分支数量，默认 20，最大 100。",
        },
        commitLimit: {
          type: "integer",
          minimum: 0,
          maximum: 20,
          default: 0,
          description: "返回最近提交数量；0 表示不读取，最大 20。",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["repository", "metadata"],
      properties: {
        repository: { type: "string" },
        metadata: { type: "object" },
        readme: { type: ["object", "null"] },
        languages: { type: ["object", "null"] },
        branches: { type: "array" },
        commits: { type: "array" },
      },
    },
    tags: [
      "github",
      "repository",
      "repo",
      "readme",
      "branch",
      "commit",
      "仓库",
      "项目",
      "代码库",
    ],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
    workbench: commonWorkbench({
      repository: "owner/repository",
      includeReadme: true,
      includeLanguages: false,
      includeBranches: false,
      branchLimit: 20,
      commitLimit: 5,
    }),
  },
  execute: async (context) => {
    const repository = normalizeGitHubRepositoryName(context.args.repository);
    const ref = normalizeString(context.args.ref, "ref", { maxLength: 200 });
    const includeReadme = normalizeBoolean(
      context.args.includeReadme,
      "includeReadme",
    );
    const includeLanguages = normalizeBoolean(
      context.args.includeLanguages,
      "includeLanguages",
    );
    const includeBranches = normalizeBoolean(
      context.args.includeBranches,
      "includeBranches",
    );
    const branchLimit = normalizeInteger(context.args.branchLimit, "branchLimit", {
      fallback: 20,
      min: 1,
      max: 100,
    })!;
    const commitLimit = normalizeInteger(context.args.commitLimit, "commitLimit", {
      fallback: 0,
      min: 0,
      max: 20,
    })!;
    const authorized = await authorizeRepository(context, client, repository);
    const path = encodeGitHubRepositoryPath(authorized.repository.fullName);
    const metadata = await client.requestJson<GitHubRepositoryResponse>(
      `/repos/${path}`,
      authorized.connection.accessToken,
      { signal: context.signal },
    );
    if (!metadata) throw mcpNotFound(`Repository ${repository} was not found`);

    const readmePromise = includeReadme
      ? client.requestJson<GitHubReadmeResponse>(
          `/repos/${path}/readme${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
          authorized.connection.accessToken,
          { signal: context.signal, allowNotFound: true },
        )
      : Promise.resolve(null);
    const languagesPromise = includeLanguages
      ? client.requestJson<Record<string, number>>(
          `/repos/${path}/languages`,
          authorized.connection.accessToken,
          { signal: context.signal },
        )
      : Promise.resolve(null);
    const branchesPromise = includeBranches
      ? client.requestJson<GitHubBranchResponse[]>(
          `/repos/${path}/branches?per_page=${branchLimit}&page=1`,
          authorized.connection.accessToken,
          { signal: context.signal },
        )
      : Promise.resolve(null);
    const commitParams = new URLSearchParams({
      per_page: String(Math.max(commitLimit, 1)),
      page: "1",
    });
    if (ref) commitParams.set("sha", ref);
    const commitsPromise =
      commitLimit > 0
        ? client.requestJson<GitHubCommitResponse[]>(
            `/repos/${path}/commits?${commitParams.toString()}`,
            authorized.connection.accessToken,
            { signal: context.signal },
          )
        : Promise.resolve(null);

    const [readme, languages, branches, commits] = await Promise.all([
      readmePromise,
      languagesPromise,
      branchesPromise,
      commitsPromise,
    ]);
    const readmeContent =
      readme?.encoding === "base64" && readme.content
        ? truncate(
            Buffer.from(readme.content.replace(/\s/gu, ""), "base64").toString(
              "utf8",
            ),
            MAX_README_CHARS,
          )
        : "";
    const result = {
      repository: authorized.repository.fullName,
      metadata: {
        id: String(metadata.id),
        name: metadata.name,
        fullName: metadata.full_name,
        owner: normalizeActor(metadata.owner),
        private: metadata.private,
        htmlUrl: metadata.html_url,
        description: metadata.description ?? null,
        fork: Boolean(metadata.fork),
        archived: Boolean(metadata.archived),
        disabled: Boolean(metadata.disabled),
        visibility: metadata.visibility ?? null,
        defaultBranch: metadata.default_branch ?? authorized.repository.defaultBranch,
        language: metadata.language ?? null,
        topics: metadata.topics ?? [],
        openIssueCount: metadata.open_issues_count ?? 0,
        forkCount: metadata.forks_count ?? 0,
        starCount: metadata.stargazers_count ?? 0,
        watcherCount: metadata.watchers_count ?? 0,
        size: metadata.size ?? 0,
        license: metadata.license
          ? {
              key: metadata.license.key ?? "",
              name: metadata.license.name ?? "",
              spdxId: metadata.license.spdx_id ?? null,
            }
          : null,
        permissions: metadata.permissions ?? authorized.repository.permissions,
        createdAt: metadata.created_at ?? null,
        updatedAt: metadata.updated_at ?? null,
        pushedAt: metadata.pushed_at ?? null,
      },
      readme: readme
        ? {
            name: readme.name ?? "README",
            path: readme.path ?? "",
            htmlUrl: readme.html_url ?? "",
            size: readme.size ?? 0,
            content: readmeContent,
          }
        : null,
      languages: languages ?? null,
      branches: (branches ?? []).map((branch) => ({
        name: branch.name,
        protected: Boolean(branch.protected),
        commitSha: branch.commit?.sha ?? "",
      })),
      commits: (commits ?? []).slice(0, commitLimit).map((commit) => ({
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        message: commit.commit?.message ?? "",
        htmlUrl: commit.html_url ?? "",
        author: normalizeActor(commit.author),
        committer: normalizeActor(commit.committer),
        authoredBy: commit.commit?.author?.name ?? null,
        authoredAt: commit.commit?.author?.date ?? null,
        committedAt: commit.commit?.committer?.date ?? null,
      })),
    };

    addResultArtifact(context, {
      kind: "document",
      title: `GitHub repository: ${authorized.repository.fullName}`,
      data: result,
      repository: authorized.repository.fullName,
      toolId: "github_repo_read",
    });
    return {
      structuredContent: result,

    };
  },
});

const createIssueReadTool = (client: GitHubReadClient): ToolImplementation => ({
  definition: {
    id: "github_issue_read",
    title: "GitHub Issue Read",
    description:
      "列出或读取已授权仓库中的 GitHub Issue。传 number 时读取单个 Issue；不传 number 时按 query、state、labels、assignee、creator、updatedSince 等参数搜索列表。includeComments 仅用于单个 Issue。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repository"],
      properties: {
        repository: repositoryInputProperty,
        number: {
          type: "integer",
          minimum: 1,
          description: "Issue 编号。传入后进入单条读取模式。",
        },
        query: {
          type: "string",
          description: "列表模式下的关键词搜索，可匹配标题和正文。",
        },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          default: "open",
          description: "列表模式下的 Issue 状态。",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "列表模式下必须同时包含的标签。",
        },
        assignee: {
          type: "string",
          description: "列表模式下按负责人 GitHub login 过滤。",
        },
        creator: {
          type: "string",
          description: "列表模式下按创建者 GitHub login 过滤。",
        },
        updatedSince: {
          type: "string",
          description: "列表模式下按更新时间下限过滤，建议 ISO 8601 日期或时间。",
        },
        sort: {
          type: "string",
          enum: ["created", "updated", "comments"],
          default: "updated",
        },
        direction: {
          type: "string",
          enum: ["asc", "desc"],
          default: "desc",
        },
        includeComments: {
          type: "boolean",
          default: false,
          description: "单条模式下是否读取评论。",
        },
        commentLimit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
          description: "单条模式下最多读取的评论数。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "列表模式返回数量。",
        },
        page: {
          type: "integer",
          minimum: 1,
          default: 1,
          description: "列表模式页码。",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["mode", "repository"],
      properties: {
        mode: { type: "string", enum: ["detail", "list"] },
        repository: { type: "string" },
        issue: { type: "object" },
        comments: { type: "array" },
        items: { type: "array" },
        total: { type: "integer" },
        nextPage: { type: ["integer", "null"] },
      },
    },
    tags: [
      "github",
      "issue",
      "bug",
      "task",
      "ticket",
      "问题",
      "缺陷",
      "待办",
    ],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
    workbench: commonWorkbench({
      repository: "owner/repository",
      state: "open",
      sort: "updated",
      direction: "desc",
      limit: 20,
      page: 1,
    }),
  },
  execute: async (context) => {
    const repository = normalizeGitHubRepositoryName(context.args.repository);
    const number = normalizeInteger(context.args.number, "number", {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const includeComments = normalizeBoolean(
      context.args.includeComments,
      "includeComments",
    );
    const commentLimit = normalizeInteger(context.args.commentLimit, "commentLimit", {
      fallback: 50,
      min: 1,
      max: 100,
    })!;
    if (includeComments && number === undefined) {
      throw mcpBadRequest("includeComments requires an Issue number");
    }
    const authorized = await authorizeRepository(context, client, repository);
    const path = encodeGitHubRepositoryPath(authorized.repository.fullName);

    if (number !== undefined) {
      const issue = await client.requestJson<GitHubIssueResponse>(
        `/repos/${path}/issues/${number}`,
        authorized.connection.accessToken,
        { signal: context.signal },
      );
      if (!issue) throw mcpNotFound(`Issue #${number} was not found`);
      if (issue.pull_request) {
        throw mcpBadRequest(
          `#${number} is a Pull Request; use github_pr_read instead`,
        );
      }
      const comments = includeComments
        ? ((await client.requestJson<GitHubCommentResponse[]>(
            `/repos/${path}/issues/${number}/comments?per_page=${commentLimit}&page=1`,
            authorized.connection.accessToken,
            { signal: context.signal },
          )) ?? [])
        : [];
      const result = {
        mode: "detail" as const,
        repository: authorized.repository.fullName,
        issue: normalizeIssue(issue),
        comments: comments.map(normalizeComment),
      };
      addResultArtifact(context, {
        kind: "document",
        title: `${authorized.repository.fullName} Issue #${number}`,
        data: result,
        repository: authorized.repository.fullName,
        toolId: "github_issue_read",
      });
      return {
        structuredContent: result,

      };
    }

    const state = normalizeEnum(
      context.args.state,
      "state",
      ["open", "closed", "all"] as const,
      "open",
    );
    const sort = normalizeEnum(
      context.args.sort,
      "sort",
      ["created", "updated", "comments"] as const,
      "updated",
    );
    const direction = normalizeEnum(
      context.args.direction,
      "direction",
      ["asc", "desc"] as const,
      "desc",
    );
    const limit = normalizeInteger(context.args.limit, "limit", {
      fallback: DEFAULT_LIMIT,
      min: 1,
      max: MAX_LIMIT,
    })!;
    const page = normalizeInteger(context.args.page, "page", {
      fallback: 1,
      min: 1,
    })!;
    const query = normalizeString(context.args.query, "query", {
      maxLength: 500,
    });
    const labels = normalizeStringArray(context.args.labels, "labels");
    const assignee = normalizeString(context.args.assignee, "assignee", {
      maxLength: 100,
    });
    const creator = normalizeString(context.args.creator, "creator", {
      maxLength: 100,
    });
    const updatedSince = normalizeString(
      context.args.updatedSince,
      "updatedSince",
      { maxLength: 100 },
    );
    const qualifiers = [
      `repo:${authorized.repository.fullName}`,
      "is:issue",
      ...(state === "all" ? [] : [`state:${state}`]),
      ...labels.map((label) => `label:"${label.replace(/"/gu, "")}"`),
      ...(assignee ? [`assignee:${assignee}`] : []),
      ...(creator ? [`author:${creator}`] : []),
      ...(updatedSince ? [`updated:>=${updatedSince}`] : []),
      ...(query ? [query] : []),
    ];
    const params = new URLSearchParams({
      q: qualifiers.join(" "),
      sort,
      order: direction,
      per_page: String(limit),
      page: String(page),
    });
    const search = await client.requestJson<GitHubIssueSearchResponse>(
      `/search/issues?${params.toString()}`,
      authorized.connection.accessToken,
      { signal: context.signal },
    );
    const items = (search?.items ?? []).map(normalizeIssue);
    const result = {
      mode: "list" as const,
      repository: authorized.repository.fullName,
      query: query ?? null,
      filters: { state, labels, assignee: assignee ?? null, creator: creator ?? null, updatedSince: updatedSince ?? null },
      items,
      total: search?.total_count ?? items.length,
      incomplete: Boolean(search?.incomplete_results),
      page,
      nextPage: items.length === limit ? page + 1 : null,
    };
    addResultArtifact(context, {
      kind: "table",
      title: `GitHub Issues: ${authorized.repository.fullName}`,
      data: result,
      repository: authorized.repository.fullName,
      toolId: "github_issue_read",
    });
    return {
      structuredContent: result,

    };
  },
});

const createPullRequestReadTool = (
  client: GitHubReadClient,
): ToolImplementation => ({
  definition: {
    id: "github_pr_read",
    title: "GitHub Pull Request Read",
    description:
      "列出或读取已授权仓库中的 Pull Request。传 number 时读取单个 PR，并可按参数附带文件、会话评论、行级 Review 评论和 Reviews；不传 number 时按 state、base、head、sort 等参数列出 PR。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repository"],
      properties: {
        repository: repositoryInputProperty,
        number: {
          type: "integer",
          minimum: 1,
          description: "Pull Request 编号。传入后进入单条读取模式。",
        },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          default: "open",
          description: "列表模式下的 PR 状态。",
        },
        base: {
          type: "string",
          description: "列表模式下按目标分支过滤。",
        },
        head: {
          type: "string",
          description: "列表模式下按来源过滤，GitHub 格式通常为 owner:branch。",
        },
        sort: {
          type: "string",
          enum: ["created", "updated", "popularity", "long-running"],
          default: "updated",
        },
        direction: {
          type: "string",
          enum: ["asc", "desc"],
          default: "desc",
        },
        includeFiles: {
          type: "boolean",
          default: false,
          description: "单条模式下是否读取改动文件和有限 patch。",
        },
        includeComments: {
          type: "boolean",
          default: false,
          description: "单条模式下是否读取会话评论与行级 Review 评论。",
        },
        includeReviews: {
          type: "boolean",
          default: false,
          description: "单条模式下是否读取 Review 提交记录。",
        },
        detailLimit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 100,
          description: "单条模式下每类文件、评论或 Review 的最大返回数。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "列表模式返回数量。",
        },
        page: {
          type: "integer",
          minimum: 1,
          default: 1,
          description: "列表模式页码。",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["mode", "repository"],
      properties: {
        mode: { type: "string", enum: ["detail", "list"] },
        repository: { type: "string" },
        pullRequest: { type: "object" },
        files: { type: "array" },
        conversationComments: { type: "array" },
        reviewComments: { type: "array" },
        reviews: { type: "array" },
        items: { type: "array" },
        nextPage: { type: ["integer", "null"] },
      },
    },
    tags: [
      "github",
      "pull-request",
      "pr",
      "review",
      "merge",
      "diff",
      "拉取请求",
      "代码审查",
      "合并请求",
    ],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
    workbench: commonWorkbench({
      repository: "owner/repository",
      state: "open",
      sort: "updated",
      direction: "desc",
      limit: 20,
      page: 1,
    }),
  },
  execute: async (context) => {
    const repository = normalizeGitHubRepositoryName(context.args.repository);
    const number = normalizeInteger(context.args.number, "number", {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const includeFiles = normalizeBoolean(context.args.includeFiles, "includeFiles");
    const includeComments = normalizeBoolean(
      context.args.includeComments,
      "includeComments",
    );
    const includeReviews = normalizeBoolean(
      context.args.includeReviews,
      "includeReviews",
    );
    const detailLimit = normalizeInteger(context.args.detailLimit, "detailLimit", {
      fallback: 100,
      min: 1,
      max: 100,
    })!;
    if ((includeFiles || includeComments || includeReviews) && number === undefined) {
      throw mcpBadRequest(
        "includeFiles, includeComments, and includeReviews require a Pull Request number",
      );
    }
    const authorized = await authorizeRepository(context, client, repository);
    const path = encodeGitHubRepositoryPath(authorized.repository.fullName);

    if (number !== undefined) {
      const pull = await client.requestJson<GitHubPullRequestResponse>(
        `/repos/${path}/pulls/${number}`,
        authorized.connection.accessToken,
        { signal: context.signal },
      );
      if (!pull) throw mcpNotFound(`Pull Request #${number} was not found`);
      const filesPromise = includeFiles
        ? client.requestJson<GitHubPullFileResponse[]>(
            `/repos/${path}/pulls/${number}/files?per_page=${detailLimit}&page=1`,
            authorized.connection.accessToken,
            { signal: context.signal },
          )
        : Promise.resolve(null);
      const conversationPromise = includeComments
        ? client.requestJson<GitHubCommentResponse[]>(
            `/repos/${path}/issues/${number}/comments?per_page=${detailLimit}&page=1`,
            authorized.connection.accessToken,
            { signal: context.signal },
          )
        : Promise.resolve(null);
      const reviewCommentsPromise = includeComments
        ? client.requestJson<GitHubCommentResponse[]>(
            `/repos/${path}/pulls/${number}/comments?per_page=${detailLimit}&page=1`,
            authorized.connection.accessToken,
            { signal: context.signal },
          )
        : Promise.resolve(null);
      const reviewsPromise = includeReviews
        ? client.requestJson<GitHubReviewResponse[]>(
            `/repos/${path}/pulls/${number}/reviews?per_page=${detailLimit}&page=1`,
            authorized.connection.accessToken,
            { signal: context.signal },
          )
        : Promise.resolve(null);
      const [files, conversationComments, reviewComments, reviews] =
        await Promise.all([
          filesPromise,
          conversationPromise,
          reviewCommentsPromise,
          reviewsPromise,
        ]);
      const result = {
        mode: "detail" as const,
        repository: authorized.repository.fullName,
        pullRequest: normalizePullRequest(pull),
        files: (files ?? []).map((file) => ({
          sha: file.sha ?? "",
          filename: file.filename,
          previousFilename: file.previous_filename ?? null,
          status: file.status ?? "",
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          changes: file.changes ?? 0,
          blobUrl: file.blob_url ?? "",
          rawUrl: file.raw_url ?? "",
          patch: truncate(file.patch, MAX_PATCH_CHARS),
        })),
        conversationComments: (conversationComments ?? []).map(normalizeComment),
        reviewComments: (reviewComments ?? []).map(normalizeComment),
        reviews: (reviews ?? []).map((review) => ({
          id: String(review.id),
          htmlUrl: review.html_url ?? "",
          author: normalizeActor(review.user),
          body: truncate(review.body, MAX_BODY_CHARS),
          state: review.state ?? "",
          commitId: review.commit_id ?? null,
          submittedAt: review.submitted_at ?? null,
        })),
      };
      addResultArtifact(context, {
        kind: "document",
        title: `${authorized.repository.fullName} Pull Request #${number}`,
        data: result,
        repository: authorized.repository.fullName,
        toolId: "github_pr_read",
      });
      return {
        structuredContent: result,

      };
    }

    const state = normalizeEnum(
      context.args.state,
      "state",
      ["open", "closed", "all"] as const,
      "open",
    );
    const sort = normalizeEnum(
      context.args.sort,
      "sort",
      ["created", "updated", "popularity", "long-running"] as const,
      "updated",
    );
    const direction = normalizeEnum(
      context.args.direction,
      "direction",
      ["asc", "desc"] as const,
      "desc",
    );
    const base = normalizeString(context.args.base, "base", { maxLength: 200 });
    const head = normalizeString(context.args.head, "head", { maxLength: 300 });
    const limit = normalizeInteger(context.args.limit, "limit", {
      fallback: DEFAULT_LIMIT,
      min: 1,
      max: MAX_LIMIT,
    })!;
    const page = normalizeInteger(context.args.page, "page", {
      fallback: 1,
      min: 1,
    })!;
    const params = new URLSearchParams({
      state,
      sort,
      direction,
      per_page: String(limit),
      page: String(page),
    });
    if (base) params.set("base", base);
    if (head) params.set("head", head);
    const pulls =
      (await client.requestJson<GitHubPullRequestResponse[]>(
        `/repos/${path}/pulls?${params.toString()}`,
        authorized.connection.accessToken,
        { signal: context.signal },
      )) ?? [];
    const items = pulls.map(normalizePullRequest);
    const result = {
      mode: "list" as const,
      repository: authorized.repository.fullName,
      filters: { state, base: base ?? null, head: head ?? null, sort, direction },
      items,
      page,
      nextPage: items.length === limit ? page + 1 : null,
    };
    addResultArtifact(context, {
      kind: "table",
      title: `GitHub Pull Requests: ${authorized.repository.fullName}`,
      data: result,
      repository: authorized.repository.fullName,
      toolId: "github_pr_read",
    });
    return {
      structuredContent: result,

    };
  },
});

const createActionsStatusTool = (
  client: GitHubReadClient,
): ToolImplementation => ({
  definition: {
    id: "github_actions_status",
    title: "GitHub Actions Status",
    description:
      "读取已授权仓库的 GitHub Actions workflow runs。传 runId 时读取单次运行，可用 includeJobs 附带 Jobs 与 Steps；不传 runId 时按 workflow、branch、event、status、actor 等参数列出运行记录。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repository"],
      properties: {
        repository: repositoryInputProperty,
        runId: {
          type: "integer",
          minimum: 1,
          description: "Workflow run ID。传入后进入单条运行读取模式。",
        },
        workflow: {
          oneOf: [{ type: "string" }, { type: "integer", minimum: 1 }],
          description: "列表模式下限定 workflow 文件名、路径或数字 ID。",
        },
        branch: {
          type: "string",
          description: "列表模式下按分支过滤。",
        },
        event: {
          type: "string",
          description: "列表模式下按触发事件过滤，例如 push、pull_request、workflow_dispatch。",
        },
        status: {
          type: "string",
          enum: [
            "queued",
            "in_progress",
            "completed",
            "requested",
            "waiting",
            "pending",
            "action_required",
            "cancelled",
            "failure",
            "neutral",
            "skipped",
            "stale",
            "startup_failure",
            "success",
            "timed_out",
          ],
          description: "列表模式下按运行状态或结论过滤。",
        },
        actor: {
          type: "string",
          description: "列表模式下按触发者 GitHub login 过滤。",
        },
        includeJobs: {
          type: "boolean",
          default: false,
          description: "单条 runId 模式下是否读取 Jobs 与 Steps。",
        },
        jobLimit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 100,
          description: "单条模式下最多读取的 Jobs 数。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "列表模式返回数量。",
        },
        page: {
          type: "integer",
          minimum: 1,
          default: 1,
          description: "列表模式页码。",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["mode", "repository"],
      properties: {
        mode: { type: "string", enum: ["detail", "list"] },
        repository: { type: "string" },
        run: { type: "object" },
        jobs: { type: "array" },
        runs: { type: "array" },
        total: { type: "integer" },
        nextPage: { type: ["integer", "null"] },
      },
    },
    tags: [
      "github",
      "actions",
      "workflow",
      "ci",
      "build",
      "test",
      "deployment",
      "流水线",
      "构建",
      "检查",
    ],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
    workbench: commonWorkbench({
      repository: "owner/repository",
      limit: 20,
      page: 1,
    }),
  },
  execute: async (context) => {
    const repository = normalizeGitHubRepositoryName(context.args.repository);
    const runId = normalizeInteger(context.args.runId, "runId", {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const includeJobs = normalizeBoolean(context.args.includeJobs, "includeJobs");
    const jobLimit = normalizeInteger(context.args.jobLimit, "jobLimit", {
      fallback: 100,
      min: 1,
      max: 100,
    })!;
    if (includeJobs && runId === undefined) {
      throw mcpBadRequest("includeJobs requires runId");
    }
    const authorized = await authorizeRepository(context, client, repository);
    const path = encodeGitHubRepositoryPath(authorized.repository.fullName);

    if (runId !== undefined) {
      const run = await client.requestJson<GitHubWorkflowRunResponse>(
        `/repos/${path}/actions/runs/${runId}`,
        authorized.connection.accessToken,
        { signal: context.signal },
      );
      if (!run) throw mcpNotFound(`Workflow run ${runId} was not found`);
      const jobsResponse = includeJobs
        ? await client.requestJson<GitHubWorkflowJobsResponse>(
            `/repos/${path}/actions/runs/${runId}/jobs?per_page=${jobLimit}&page=1`,
            authorized.connection.accessToken,
            { signal: context.signal },
          )
        : null;
      const result = {
        mode: "detail" as const,
        repository: authorized.repository.fullName,
        run: normalizeWorkflowRun(run),
        jobs: (jobsResponse?.jobs ?? []).map((job) => ({
          id: String(job.id),
          name: job.name ?? "",
          status: job.status ?? "",
          conclusion: job.conclusion ?? null,
          htmlUrl: job.html_url ?? "",
          runnerName: job.runner_name ?? null,
          startedAt: job.started_at ?? null,
          completedAt: job.completed_at ?? null,
          steps: (job.steps ?? []).map((step) => ({
            number: step.number ?? null,
            name: step.name ?? "",
            status: step.status ?? "",
            conclusion: step.conclusion ?? null,
            startedAt: step.started_at ?? null,
            completedAt: step.completed_at ?? null,
          })),
        })),
      };
      addResultArtifact(context, {
        kind: "document",
        title: `${authorized.repository.fullName} Actions run ${runId}`,
        data: result,
        repository: authorized.repository.fullName,
        toolId: "github_actions_status",
      });
      return {
        structuredContent: result,

      };
    }

    const workflowValue = context.args.workflow;
    let workflow: string | undefined;
    if (workflowValue !== undefined) {
      if (
        (typeof workflowValue !== "string" || !workflowValue.trim()) &&
        (typeof workflowValue !== "number" || !Number.isInteger(workflowValue) || workflowValue < 1)
      ) {
        throw mcpBadRequest("workflow must be a non-empty string or positive integer");
      }
      workflow = String(workflowValue).trim();
    }
    const branch = normalizeString(context.args.branch, "branch", {
      maxLength: 200,
    });
    const event = normalizeString(context.args.event, "event", {
      maxLength: 100,
    });
    const actor = normalizeString(context.args.actor, "actor", {
      maxLength: 100,
    });
    const allowedStatuses = [
      "queued",
      "in_progress",
      "completed",
      "requested",
      "waiting",
      "pending",
      "action_required",
      "cancelled",
      "failure",
      "neutral",
      "skipped",
      "stale",
      "startup_failure",
      "success",
      "timed_out",
    ] as const;
    const status =
      context.args.status === undefined
        ? undefined
        : normalizeEnum(
            context.args.status,
            "status",
            allowedStatuses,
            "completed",
          );
    const limit = normalizeInteger(context.args.limit, "limit", {
      fallback: DEFAULT_LIMIT,
      min: 1,
      max: MAX_LIMIT,
    })!;
    const page = normalizeInteger(context.args.page, "page", {
      fallback: 1,
      min: 1,
    })!;
    const params = new URLSearchParams({
      per_page: String(limit),
      page: String(page),
    });
    if (branch) params.set("branch", branch);
    if (event) params.set("event", event);
    if (status) params.set("status", status);
    if (actor) params.set("actor", actor);
    const endpoint = workflow
      ? `/repos/${path}/actions/workflows/${encodeURIComponent(workflow)}/runs`
      : `/repos/${path}/actions/runs`;
    const runsResponse = await client.requestJson<GitHubWorkflowRunsResponse>(
      `${endpoint}?${params.toString()}`,
      authorized.connection.accessToken,
      { signal: context.signal },
    );
    const runs = (runsResponse?.workflow_runs ?? []).map(normalizeWorkflowRun);
    const result = {
      mode: "list" as const,
      repository: authorized.repository.fullName,
      filters: {
        workflow: workflow ?? null,
        branch: branch ?? null,
        event: event ?? null,
        status: status ?? null,
        actor: actor ?? null,
      },
      runs,
      total: runsResponse?.total_count ?? runs.length,
      page,
      nextPage: runs.length === limit ? page + 1 : null,
    };
    addResultArtifact(context, {
      kind: "table",
      title: `GitHub Actions: ${authorized.repository.fullName}`,
      data: result,
      repository: authorized.repository.fullName,
      toolId: "github_actions_status",
    });
    return {
      structuredContent: result,

    };
  },
});

export const createGitHubReadTools = (
  dependencies: Partial<GitHubReadClientDependencies> = {},
) => {
  const client = createGitHubReadClient(dependencies);
  return {
    githubRepoReadTool: createRepoReadTool(client),
    githubIssueReadTool: createIssueReadTool(client),
    githubPrReadTool: createPullRequestReadTool(client),
    githubActionsStatusTool: createActionsStatusTool(client),
  };
};

const defaultTools = createGitHubReadTools();

export const githubRepoReadTool = defaultTools.githubRepoReadTool;
export const githubIssueReadTool = defaultTools.githubIssueReadTool;
export const githubPrReadTool = defaultTools.githubPrReadTool;
export const githubActionsStatusTool = defaultTools.githubActionsStatusTool;
