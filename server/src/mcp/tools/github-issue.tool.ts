import type { ToolImplementation } from "../core/definitions.js";
import * as S from "./github-domain.shared.js";

const {
  GITHUB_WORKBENCH, issueSchema, normalizeOperation,
  normalizeGitHubRepositoryName, runReadDelegate, sanitizeIssueSearchQuery,
  normalizeGitHubLogin, normalizeGitHubDate, authorizeRepository,
  encodeGitHubRepositoryPath, normalizeString, MAX_TEXT_CHARS,
  normalizeStringArray, normalizeInteger, requireRemoteWriteApproval,
  normalizeIssueResult, addArtifact, completed, ensureIssueNotPullRequest,
  normalizeCommentResult, mcpBadRequest,
} = S;
type GitHubReadClient = S.GitHubReadClient;
type GitHubApi = ReturnType<typeof S.createGitHubApi>;
type IssueResponse = S.IssueResponse;
type CommentResponse = S.CommentResponse;

export const createIssueTool = (
  client: GitHubReadClient,
  api: GitHubApi,
  baseTool: ToolImplementation,
): ToolImplementation => ({
  definition: {
    id: "github_issue",
    title: "GitHub Issue",
    description:
      "列出、搜索、读取、创建、更新、评论、关闭和重新打开已授权仓库中的 Issue。operation 决定具体参数结构。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: issueSchema,
    outputSchema: { type: "object", additionalProperties: true },
    tags: ["github", "issue", "bug", "task", "ticket", "问题", "缺陷", "待办"],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
    workbench: {
      ...GITHUB_WORKBENCH,
      defaultArgs: {
        operation: "list",
        repository: "owner/repository",
        state: "open",
        sort: "updated",
        direction: "desc",
        limit: 20,
        page: 1,
      },
    },
  },
  execute: async (context) => {
    const operation = normalizeOperation(context.args.operation, [
      "list",
      "search",
      "get",
      "create",
      "update",
      "comment",
      "close",
      "reopen",
    ] as const);
    const repository = normalizeGitHubRepositoryName(context.args.repository);

    if (operation === "list" || operation === "search" || operation === "get") {
      return runReadDelegate(baseTool, context, "github_issue", operation, {
        repository,
        ...(operation === "get"
          ? {
              number: context.args.number,
              includeComments: context.args.includeComments,
              commentLimit: context.args.commentLimit,
            }
          : {
              query:
                operation === "search"
                  ? sanitizeIssueSearchQuery(context.args.query)
                  : undefined,
              state: context.args.state,
              labels: context.args.labels,
              assignee: normalizeGitHubLogin(context.args.assignee, "assignee"),
              creator: normalizeGitHubLogin(context.args.creator, "creator"),
              updatedSince: normalizeGitHubDate(
                context.args.updatedSince,
                "updatedSince",
              ),
              sort: context.args.sort,
              direction: context.args.direction,
              limit: context.args.limit,
              page: context.args.page,
            }),
      });
    }

    const authorized = await authorizeRepository(context, client, repository);
    const repoPath = encodeGitHubRepositoryPath(authorized.repository.fullName);
    const token = authorized.connection.accessToken;

    if (operation === "create") {
      const title = normalizeString(context.args.title, "title", {
        required: true,
        maxLength: 500,
      })!;
      const body = normalizeString(context.args.body, "body", {
        maxLength: MAX_TEXT_CHARS,
        preserveWhitespace: true,
      });
      const labels = normalizeStringArray(context.args.labels, "labels");
      const assignees = normalizeStringArray(context.args.assignees, "assignees", 20);
      const milestone = normalizeInteger(context.args.milestone, "milestone", {
        min: 1,
      });
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Create GitHub Issue "${title}".`,
      });
      const issue = await api.json<IssueResponse>(`/repos/${repoPath}/issues`, token, {
        method: "POST",
        body: {
          title,
          ...(body !== undefined ? { body } : {}),
          ...(labels ? { labels } : {}),
          ...(assignees ? { assignees } : {}),
          ...(milestone ? { milestone } : {}),
        },
        signal: context.signal,
      });
      if (!issue) throw mcpBadRequest("GitHub did not return the created Issue");
      const result = normalizeIssueResult(issue);
      addArtifact(context, {
        toolId: "github_issue",
        operation,
        repository: authorized.repository.fullName,
        title: `Created Issue #${result.number}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Created Issue #${result.number}: ${result.title}.`,
      ]);
    }

    const number = normalizeInteger(context.args.number, "number", {
      required: true,
      min: 1,
    })!;
    await ensureIssueNotPullRequest(api, authorized, number, context.signal);

    if (operation === "comment") {
      const body = normalizeString(context.args.body, "body", {
        required: true,
        maxLength: MAX_TEXT_CHARS,
        preserveWhitespace: true,
      })!;
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Comment on GitHub Issue #${number}.`,
      });
      const comment = await api.json<CommentResponse>(
        `/repos/${repoPath}/issues/${number}/comments`,
        token,
        {
          method: "POST",
          body: { body },
          signal: context.signal,
        },
      );
      if (!comment) throw mcpBadRequest("GitHub did not return the created comment");
      const result = { number, comment: normalizeCommentResult(comment) };
      addArtifact(context, {
        toolId: "github_issue",
        operation,
        repository: authorized.repository.fullName,
        title: `Commented on Issue #${number}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Added comment ${result.comment.id ?? ""} to Issue #${number}.`,
      ]);
    }

    const body: Record<string, unknown> = {};
    if (operation === "close") {
      body.state = "closed";
      body.state_reason =
        normalizeString(context.args.reason, "reason", { maxLength: 50 }) ??
        "completed";
    } else if (operation === "reopen") {
      body.state = "open";
      body.state_reason = "reopened";
    } else {
      const title = normalizeString(context.args.title, "title", { maxLength: 500 });
      const nextBody = normalizeString(context.args.body, "body", {
        maxLength: MAX_TEXT_CHARS,
        preserveWhitespace: true,
        allowEmpty: true,
      });
      const state = normalizeString(context.args.state, "state", { maxLength: 20 });
      const stateReason = normalizeString(context.args.stateReason, "stateReason", {
        maxLength: 50,
      });
      const labels = normalizeStringArray(context.args.labels, "labels");
      const assignees = normalizeStringArray(context.args.assignees, "assignees", 20);
      const milestone = normalizeInteger(context.args.milestone, "milestone", {
        min: 1,
      });
      if (title !== undefined) body.title = title;
      if (nextBody !== undefined) body.body = nextBody;
      if (state !== undefined) body.state = state;
      if (stateReason !== undefined) body.state_reason = stateReason;
      if (labels !== undefined) body.labels = labels;
      if (assignees !== undefined) body.assignees = assignees;
      if (milestone !== undefined) body.milestone = milestone;
      if (Object.keys(body).length === 0) {
        throw mcpBadRequest("update requires at least one field to change");
      }
    }

    requireRemoteWriteApproval(context, {
      operation,
      repository: authorized.repository.fullName,
      summary: `${operation === "update" ? "Update" : operation === "close" ? "Close" : "Reopen"} GitHub Issue #${number}.`,
    });
    const issue = await api.json<IssueResponse>(
      `/repos/${repoPath}/issues/${number}`,
      token,
      {
        method: "PATCH",
        body,
        signal: context.signal,
      },
    );
    if (!issue) throw mcpBadRequest("GitHub did not return the updated Issue");
    const result = normalizeIssueResult(issue);
    addArtifact(context, {
      toolId: "github_issue",
      operation,
      repository: authorized.repository.fullName,
      title: `${operation} Issue #${number}`,
      data: result,
    });
    return completed(operation, authorized.repository.fullName, result, [
      `Issue #${number} is now ${result.state}.`,
    ]);
  },
});
