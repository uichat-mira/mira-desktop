import type {
  ToolInvocationContext,
  ToolExecutionResult,
  ToolImplementation,
} from "../core/definitions.js";
import {
  ToolApprovalRequiredError,
  mcpBadRequest,
  mcpNotFound,
} from "../core/errors.js";
import {
  encodeGitHubRepositoryPath,
  type GitHubAuthorizedRepositoryContext,
  type GitHubReadClient,
} from "@/microapps/github/read-client.js";
import {
  MAX_TEXT_CHARS,
  createGitHubApi,
  isRecord,
  truncate,
  withOperation,
} from "./github-domain.api.js";

export const rewriteArtifactToolId = (
  context: ToolInvocationContext,
  toolId: string,
): ToolInvocationContext["addArtifact"] =>
  (artifact) =>
    context.addArtifact({
      ...artifact,
      metadata: {
        ...(artifact.metadata ?? {}),
        toolId,
      },
    });

export const runReadDelegate = async (
  tool: ToolImplementation,
  context: ToolInvocationContext,
  toolId: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> => {
  const delegated = await tool.execute({
    ...context,
    args,
    addArtifact: rewriteArtifactToolId(context, toolId),
  });
  return {
    ...delegated,
    ...(delegated.result !== undefined
      ? { result: withOperation(operation, delegated.result) }
      : {}),
    ...(delegated.evidence
      ? {
          evidence: {
            ...delegated.evidence,
            data: {
              ...(isRecord(delegated.evidence.data)
                ? delegated.evidence.data
                : {}),
              operation,
            },
          },
        }
      : {}),
  };
};

export const authorizeRepository = async (
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

export const requireRemoteWriteApproval = (
  context: ToolInvocationContext,
  input: {
    operation: string;
    repository: string;
    summary: string;
    highRisk?: boolean;
  },
) => {
  if (context.approval?.granted) return;
  throw new ToolApprovalRequiredError(
    `${input.summary} This will modify GitHub repository ${input.repository}.`,
    {
      scope: input.highRisk ? "github.high_risk" : "github.remote_write",
    },
  );
};

export const addArtifact = (
  context: ToolInvocationContext,
  input: {
    toolId: string;
    operation: string;
    repository: string;
    title: string;
    kind?: "document" | "table" | "text" | "diff";
    data: unknown;
  },
) =>
  context.addArtifact({
    kind: input.kind ?? "document",
    title: input.title,
    data: input.data,
    metadata: {
      provider: "github",
      repository: input.repository,
      toolId: input.toolId,
      operation: input.operation,
      authorization: "github_app_installation",
    },
  });

export const completed = (
  operation: string,
  repository: string,
  result: unknown,
  facts: string[],
): ToolExecutionResult => ({
  result: withOperation(operation, result),
  evidence: {
    actionTaken: `Executed GitHub ${operation} for ${repository}`,
    facts,
    status: "completed",
    data: { operation, repository },
  },
});

export type RepoContentResponse = {
  type?: string;
  name?: string;
  path?: string;
  sha?: string;
  size?: number;
  encoding?: string;
  content?: string;
  html_url?: string;
  download_url?: string | null;
};

export type GitRefResponse = {
  ref?: string;
  url?: string;
  object?: { sha?: string; type?: string; url?: string };
};

export type CommitResponse = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string | null } | null;
  };
  author?: { login?: string } | null;
};

export type BranchResponse = {
  name?: string;
  protected?: boolean;
  commit?: { sha?: string; url?: string };
};

export type IssueResponse = {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  state_reason?: string | null;
  html_url?: string;
  pull_request?: unknown;
  labels?: Array<{ name?: string } | string>;
  assignees?: Array<{ login?: string }>;
  user?: { login?: string } | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
};

export type CommentResponse = {
  id?: number;
  body?: string | null;
  html_url?: string;
  user?: { login?: string } | null;
  created_at?: string;
  updated_at?: string;
};

export type PullResponse = {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  draft?: boolean;
  html_url?: string;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
  user?: { login?: string } | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
};

export type MergeResponse = {
  sha?: string;
  merged?: boolean;
  message?: string;
};

export type WorkflowRunResponse = {
  id?: number;
  name?: string;
  display_title?: string;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string;
  head_branch?: string | null;
  head_sha?: string;
  event?: string;
  run_number?: number;
  run_attempt?: number;
  created_at?: string;
  updated_at?: string;
};

export type WorkflowJobsResponse = {
  total_count?: number;
  jobs?: Array<{
    id?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
    started_at?: string | null;
    completed_at?: string | null;
    steps?: Array<{
      number?: number;
      name?: string;
      status?: string;
      conclusion?: string | null;
    }>;
  }>;
};

export const normalizeIssueResult = (issue: IssueResponse) => ({
  number: issue.number ?? null,
  title: issue.title ?? "",
  body: truncate(issue.body ?? "", MAX_TEXT_CHARS),
  state: issue.state ?? "",
  stateReason: issue.state_reason ?? null,
  htmlUrl: issue.html_url ?? "",
  author: issue.user?.login ?? null,
  labels: (issue.labels ?? []).map((label) =>
    typeof label === "string" ? label : label.name ?? "",
  ),
  assignees: (issue.assignees ?? []).map((item) => item.login ?? ""),
  createdAt: issue.created_at ?? null,
  updatedAt: issue.updated_at ?? null,
  closedAt: issue.closed_at ?? null,
});

export const normalizeCommentResult = (comment: CommentResponse) => ({
  id: comment.id ? String(comment.id) : null,
  body: truncate(comment.body ?? "", MAX_TEXT_CHARS),
  htmlUrl: comment.html_url ?? "",
  author: comment.user?.login ?? null,
  createdAt: comment.created_at ?? null,
  updatedAt: comment.updated_at ?? null,
});

export const normalizePullResult = (pull: PullResponse) => ({
  number: pull.number ?? null,
  title: pull.title ?? "",
  body: truncate(pull.body ?? "", MAX_TEXT_CHARS),
  state: pull.state ?? "",
  draft: Boolean(pull.draft),
  merged: Boolean(pull.merged),
  mergeable: pull.mergeable ?? null,
  mergeableState: pull.mergeable_state ?? null,
  htmlUrl: pull.html_url ?? "",
  author: pull.user?.login ?? null,
  head: { ref: pull.head?.ref ?? "", sha: pull.head?.sha ?? "" },
  base: { ref: pull.base?.ref ?? "", sha: pull.base?.sha ?? "" },
  createdAt: pull.created_at ?? null,
  updatedAt: pull.updated_at ?? null,
  closedAt: pull.closed_at ?? null,
  mergedAt: pull.merged_at ?? null,
});

export const normalizeRunResult = (run: WorkflowRunResponse) => ({
  id: run.id ? String(run.id) : null,
  name: run.name ?? "",
  title: run.display_title ?? run.name ?? "",
  status: run.status ?? null,
  conclusion: run.conclusion ?? null,
  htmlUrl: run.html_url ?? "",
  branch: run.head_branch ?? null,
  headSha: run.head_sha ?? "",
  event: run.event ?? "",
  runNumber: run.run_number ?? null,
  attempt: run.run_attempt ?? null,
  createdAt: run.created_at ?? null,
  updatedAt: run.updated_at ?? null,
});

export const ensureIssueNotPullRequest = async (
  api: ReturnType<typeof createGitHubApi>,
  authorized: GitHubAuthorizedRepositoryContext,
  number: number,
  signal: AbortSignal,
) => {
  const path = encodeGitHubRepositoryPath(authorized.repository.fullName);
  const issue = await api.json<IssueResponse>(
    `/repos/${path}/issues/${number}`,
    authorized.connection.accessToken,
    { signal },
  );
  if (!issue) throw mcpNotFound(`Issue #${number} was not found`);
  if (issue.pull_request) {
    throw mcpBadRequest(
      `#${number} is a Pull Request; use github_pull_request instead`,
    );
  }
  return issue;
};

export const ensurePullRequest = async (
  api: ReturnType<typeof createGitHubApi>,
  authorized: GitHubAuthorizedRepositoryContext,
  number: number,
  signal: AbortSignal,
) => {
  const path = encodeGitHubRepositoryPath(authorized.repository.fullName);
  const pull = await api.json<PullResponse>(
    `/repos/${path}/pulls/${number}`,
    authorized.connection.accessToken,
    { signal },
  );
  if (!pull) throw mcpNotFound(`Pull Request #${number} was not found`);
  return pull;
};
