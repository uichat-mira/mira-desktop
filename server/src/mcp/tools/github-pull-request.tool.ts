import type { ToolImplementation } from "../core/definitions.js";
import * as S from "./github-domain.shared.js";

const {
  GITHUB_WORKBENCH, pullRequestSchema, normalizeOperation,
  normalizeGitHubRepositoryName, runReadDelegate, authorizeRepository,
  encodeGitHubRepositoryPath, normalizeString, MAX_TEXT_CHARS,
  normalizeBoolean, requireRemoteWriteApproval, normalizePullResult,
  addArtifact, completed, normalizeInteger, ensurePullRequest,
  normalizeCommentResult, normalizeObject, normalizeRepositoryPath,
  mcpBadRequest, truncate,
} = S;
type GitHubReadClient = S.GitHubReadClient;
type GitHubApi = ReturnType<typeof S.createGitHubApi>;
type PullResponse = S.PullResponse;
type CommentResponse = S.CommentResponse;
type MergeResponse = S.MergeResponse;

export const createPullRequestTool = (
  client: GitHubReadClient,
  api: GitHubApi,
  baseTool: ToolImplementation,
): ToolImplementation => ({
  definition: {
    id: "github_pull_request",
    title: "GitHub Pull Request",
    description:
      "列出、读取、创建、更新、评论、Review 和合并已授权仓库中的 Pull Request。operation 决定具体参数结构。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: pullRequestSchema,
    outputSchema: { type: "object", additionalProperties: true },
    tags: [
      "github",
      "pull request",
      "pr",
      "review",
      "merge",
      "拉取请求",
      "代码审查",
      "合并",
    ],
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
      "get",
      "create",
      "update",
      "comment",
      "review",
      "merge",
    ] as const);
    const repository = normalizeGitHubRepositoryName(context.args.repository);

    if (operation === "list" || operation === "get") {
      return runReadDelegate(baseTool, context, "github_pull_request", operation, {
        repository,
        ...(operation === "get"
          ? {
              number: context.args.number,
              includeFiles: context.args.includeFiles,
              includeComments: context.args.includeComments,
              includeReviews: context.args.includeReviews,
              detailLimit: context.args.detailLimit,
            }
          : {
              state: context.args.state,
              head: context.args.head,
              base: context.args.base,
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
      const head = normalizeString(context.args.head, "head", {
        required: true,
        maxLength: 255,
      })!;
      const base = normalizeString(context.args.base, "base", {
        required: true,
        maxLength: 255,
      })!;
      const body = normalizeString(context.args.body, "body", {
        maxLength: MAX_TEXT_CHARS,
        preserveWhitespace: true,
      });
      const draft = normalizeBoolean(context.args.draft, "draft");
      const maintainerCanModify = normalizeBoolean(
        context.args.maintainerCanModify,
        "maintainerCanModify",
        true,
      );
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Create Pull Request from ${head} into ${base}.`,
      });
      const pull = await api.json<PullResponse>(`/repos/${repoPath}/pulls`, token, {
        method: "POST",
        body: {
          title,
          head,
          base,
          ...(body !== undefined ? { body } : {}),
          draft,
          maintainer_can_modify: maintainerCanModify,
        },
        signal: context.signal,
      });
      if (!pull) throw mcpBadRequest("GitHub did not return the created Pull Request");
      const result = normalizePullResult(pull);
      addArtifact(context, {
        toolId: "github_pull_request",
        operation,
        repository: authorized.repository.fullName,
        title: `Created Pull Request #${result.number}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Created Pull Request #${result.number}: ${result.title}.`,
      ]);
    }

    const number = normalizeInteger(context.args.number, "number", {
      required: true,
      min: 1,
    })!;
    await ensurePullRequest(api, authorized, number, context.signal);

    if (operation === "comment") {
      const body = normalizeString(context.args.body, "body", {
        required: true,
        maxLength: MAX_TEXT_CHARS,
        preserveWhitespace: true,
      })!;
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Comment on Pull Request #${number}.`,
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
        toolId: "github_pull_request",
        operation,
        repository: authorized.repository.fullName,
        title: `Commented on Pull Request #${number}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Added comment ${result.comment.id ?? ""} to Pull Request #${number}.`,
      ]);
    }

    if (operation === "review") {
      const event = normalizeString(context.args.event, "event", {
        required: true,
        maxLength: 50,
      })!;
      const body = normalizeString(context.args.body, "body", {
        maxLength: MAX_TEXT_CHARS,
        preserveWhitespace: true,
      });
      const commentsValue = context.args.comments;
      let comments:
        | Array<{
            path: string;
            body: string;
            line: number;
            side: "LEFT" | "RIGHT";
            start_line?: number;
            start_side?: "LEFT" | "RIGHT";
          }>
        | undefined;
      if (commentsValue !== undefined) {
        if (!Array.isArray(commentsValue) || commentsValue.length > 50) {
          throw mcpBadRequest("comments must be an array with at most 50 items");
        }
        comments = commentsValue.map((item, index) => {
          const record = normalizeObject(item, `comments.${index}`)!;
          const path = normalizeRepositoryPath(record.path, `comments.${index}.path`);
          const commentBody = normalizeString(record.body, `comments.${index}.body`, {
            required: true,
            maxLength: MAX_TEXT_CHARS,
            preserveWhitespace: true,
          })!;
          const line = normalizeInteger(record.line, `comments.${index}.line`, {
            required: true,
            min: 1,
          })!;
          const side = normalizeString(record.side, `comments.${index}.side`, {
            required: true,
            maxLength: 5,
          }) as "LEFT" | "RIGHT";
          const startLine = normalizeInteger(
            record.startLine,
            `comments.${index}.startLine`,
            { min: 1 },
          );
          const startSide = normalizeString(
            record.startSide,
            `comments.${index}.startSide`,
            { maxLength: 5 },
          ) as "LEFT" | "RIGHT" | undefined;
          return {
            path,
            body: commentBody,
            line,
            side,
            ...(startLine ? { start_line: startLine } : {}),
            ...(startSide ? { start_side: startSide } : {}),
          };
        });
      }
      if (event === "request_changes" && !body?.trim()) {
        throw mcpBadRequest("request_changes review requires body");
      }
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `${event} review for Pull Request #${number}.`,
      });
      const review = await api.json<{
        id?: number;
        html_url?: string;
        state?: string;
        body?: string | null;
        submitted_at?: string | null;
        user?: { login?: string } | null;
      }>(`/repos/${repoPath}/pulls/${number}/reviews`, token, {
        method: "POST",
        body: {
          event:
            event === "approve"
              ? "APPROVE"
              : event === "request_changes"
                ? "REQUEST_CHANGES"
                : "COMMENT",
          ...(body !== undefined ? { body } : {}),
          ...(comments ? { comments } : {}),
        },
        signal: context.signal,
      });
      if (!review) throw mcpBadRequest("GitHub did not return the created review");
      const result = {
        number,
        review: {
          id: review.id ? String(review.id) : null,
          state: review.state ?? "",
          body: truncate(review.body ?? "", MAX_TEXT_CHARS),
          htmlUrl: review.html_url ?? "",
          author: review.user?.login ?? null,
          submittedAt: review.submitted_at ?? null,
        },
      };
      addArtifact(context, {
        toolId: "github_pull_request",
        operation,
        repository: authorized.repository.fullName,
        title: `Reviewed Pull Request #${number}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Submitted ${event} review for Pull Request #${number}.`,
      ]);
    }

    if (operation === "merge") {
      const mergeMethod =
        normalizeString(context.args.mergeMethod, "mergeMethod", { maxLength: 20 }) ??
        "merge";
      const commitTitle = normalizeString(context.args.commitTitle, "commitTitle", {
        maxLength: 500,
      });
      const commitMessage = normalizeString(
        context.args.commitMessage,
        "commitMessage",
        { maxLength: MAX_TEXT_CHARS, preserveWhitespace: true },
      );
      const expectedHeadSha = normalizeString(
        context.args.expectedHeadSha,
        "expectedHeadSha",
        { maxLength: 100 },
      );
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Merge Pull Request #${number} using ${mergeMethod}.`,
        highRisk: true,
      });
      const merge = await api.json<MergeResponse>(
        `/repos/${repoPath}/pulls/${number}/merge`,
        token,
        {
          method: "PUT",
          body: {
            merge_method: mergeMethod,
            ...(commitTitle ? { commit_title: commitTitle } : {}),
            ...(commitMessage ? { commit_message: commitMessage } : {}),
            ...(expectedHeadSha ? { sha: expectedHeadSha } : {}),
          },
          signal: context.signal,
        },
      );
      if (!merge) throw mcpBadRequest("GitHub did not return the merge result");
      const result = {
        number,
        merged: Boolean(merge.merged),
        sha: merge.sha ?? null,
        message: merge.message ?? "",
        mergeMethod,
      };
      addArtifact(context, {
        toolId: "github_pull_request",
        operation,
        repository: authorized.repository.fullName,
        title: `Merged Pull Request #${number}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        result.merged
          ? `Merged Pull Request #${number} at ${result.sha ?? "unknown SHA"}.`
          : `GitHub did not merge Pull Request #${number}: ${result.message}.`,
      ]);
    }

    const body: Record<string, unknown> = {};
    const title = normalizeString(context.args.title, "title", { maxLength: 500 });
    const nextBody = normalizeString(context.args.body, "body", {
      maxLength: MAX_TEXT_CHARS,
      preserveWhitespace: true,
      allowEmpty: true,
    });
    const state = normalizeString(context.args.state, "state", { maxLength: 20 });
    const base = normalizeString(context.args.base, "base", { maxLength: 255 });
    if (title !== undefined) body.title = title;
    if (nextBody !== undefined) body.body = nextBody;
    if (state !== undefined) body.state = state;
    if (base !== undefined) body.base = base;
    if (context.args.maintainerCanModify !== undefined) {
      body.maintainer_can_modify = normalizeBoolean(
        context.args.maintainerCanModify,
        "maintainerCanModify",
      );
    }
    if (Object.keys(body).length === 0) {
      throw mcpBadRequest("update requires at least one field to change");
    }
    requireRemoteWriteApproval(context, {
      operation,
      repository: authorized.repository.fullName,
      summary: `Update Pull Request #${number}.`,
    });
    const pull = await api.json<PullResponse>(
      `/repos/${repoPath}/pulls/${number}`,
      token,
      {
        method: "PATCH",
        body,
        signal: context.signal,
      },
    );
    if (!pull) throw mcpBadRequest("GitHub did not return the updated Pull Request");
    const result = normalizePullResult(pull);
    addArtifact(context, {
      toolId: "github_pull_request",
      operation,
      repository: authorized.repository.fullName,
      title: `Updated Pull Request #${number}`,
      data: result,
    });
    return completed(operation, authorized.repository.fullName, result, [
      `Pull Request #${number} is now ${result.state}.`,
    ]);
  },
});
