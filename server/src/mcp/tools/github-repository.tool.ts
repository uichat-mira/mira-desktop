import { Buffer } from "node:buffer";
import type { ToolImplementation } from "../core/definitions.js";
import * as S from "./github-domain.shared.js";

const {
  GITHUB_WORKBENCH, repositorySchema, normalizeOperation,
  normalizeGitHubRepositoryName, runReadDelegate, authorizeRepository,
  encodeGitHubRepositoryPath, normalizeInteger, addArtifact, completed,
  normalizeString, normalizeRepositoryPath, encodeRepositoryFilePath,
  mcpNotFound, mcpBadRequest, MAX_FILE_CHARS, truncate,
  requireRemoteWriteApproval, MAX_COMPARE_ITEMS,
  DEFAULT_LIMIT, MAX_LIMIT, normalizeBoolean,
} = S;
type GitHubReadClient = S.GitHubReadClient;
type GitHubApi = ReturnType<typeof S.createGitHubApi>;
type BranchResponse = S.BranchResponse;
type CommitResponse = S.CommitResponse;
type RepoContentResponse = S.RepoContentResponse;
type GitRefResponse = S.GitRefResponse;

export const createRepositoryTool = (
  client: GitHubReadClient,
  api: GitHubApi,
  baseTool: ToolImplementation,
): ToolImplementation => ({
  definition: {
    id: "github_repository",
    title: "GitHub Repository",
    description:
      "读取和管理已授权仓库：仓库信息、分支、提交、文件、分支创建、文件提交/删除与提交比较。operation 决定具体参数结构。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: repositorySchema,
    outputSchema: { type: "object", additionalProperties: true },
    tags: [
      "github",
      "repository",
      "branch",
      "commit",
      "file",
      "仓库",
      "分支",
      "提交",
      "文件",
    ],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
    workbench: {
      ...GITHUB_WORKBENCH,
      defaultArgs: {
        operation: "get",
        repository: "owner/repository",
        includeReadme: true,
        includeLanguages: false,
        includeBranches: false,
        commitLimit: 5,
      },
    },
  },
  execute: async (context) => {
    const operation = normalizeOperation(context.args.operation, [
      "get",
      "list_branches",
      "list_commits",
      "read_file",
      "create_branch",
      "write_file",
      "delete_file",
      "compare_commits",
    ] as const);
    const repository = normalizeGitHubRepositoryName(context.args.repository);

    if (operation === "get") {
      return runReadDelegate(baseTool, context, "github_repository", operation, {
        repository,
        ref: context.args.ref,
        includeReadme: context.args.includeReadme,
        includeLanguages: context.args.includeLanguages,
        includeBranches: context.args.includeBranches,
        branchLimit: context.args.branchLimit,
        commitLimit: context.args.commitLimit,
      });
    }

    const authorized = await authorizeRepository(context, client, repository);
    const repoPath = encodeGitHubRepositoryPath(authorized.repository.fullName);
    const token = authorized.connection.accessToken;

    if (operation === "list_branches") {
      const limit = normalizeInteger(context.args.limit, "limit", {
        fallback: DEFAULT_LIMIT,
        min: 1,
        max: MAX_LIMIT,
      })!;
      const page = normalizeInteger(context.args.page, "page", {
        fallback: 1,
        min: 1,
      })!;
      const branches =
        (await api.json<BranchResponse[]>(
          `/repos/${repoPath}/branches?per_page=${limit}&page=${page}`,
          token,
          { signal: context.signal },
        )) ?? [];
      const result = {
        repository: authorized.repository.fullName,
        page,
        nextPage: branches.length === limit ? page + 1 : null,
        branches: branches.map((branch) => ({
          name: branch.name ?? "",
          protected: Boolean(branch.protected),
          commitSha: branch.commit?.sha ?? "",
        })),
      };
      addArtifact(context, {
        toolId: "github_repository",
        operation,
        repository: authorized.repository.fullName,
        title: `GitHub branches: ${authorized.repository.fullName}`,
        kind: "table",
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Returned ${result.branches.length} branch(es) from page ${page}.`,
      ]);
    }

    if (operation === "list_commits") {
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
      const ref = normalizeString(context.args.ref, "ref", { maxLength: 255 });
      const author = normalizeString(context.args.author, "author", { maxLength: 100 });
      const filePath = normalizeString(context.args.path, "path", { maxLength: 4_000 });
      const since = normalizeString(context.args.since, "since", { maxLength: 100 });
      const until = normalizeString(context.args.until, "until", { maxLength: 100 });
      if (ref) params.set("sha", ref);
      if (author) params.set("author", author);
      if (filePath) params.set("path", filePath);
      if (since) params.set("since", since);
      if (until) params.set("until", until);
      const commits =
        (await api.json<CommitResponse[]>(
          `/repos/${repoPath}/commits?${params.toString()}`,
          token,
          { signal: context.signal },
        )) ?? [];
      const result = {
        repository: authorized.repository.fullName,
        page,
        nextPage: commits.length === limit ? page + 1 : null,
        commits: commits.map((commit) => ({
          sha: commit.sha ?? "",
          shortSha: (commit.sha ?? "").slice(0, 7),
          message: commit.commit?.message ?? "",
          htmlUrl: commit.html_url ?? "",
          author: commit.author?.login ?? commit.commit?.author?.name ?? null,
          authoredAt: commit.commit?.author?.date ?? null,
        })),
      };
      addArtifact(context, {
        toolId: "github_repository",
        operation,
        repository: authorized.repository.fullName,
        title: `GitHub commits: ${authorized.repository.fullName}`,
        kind: "table",
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Returned ${result.commits.length} commit(s) from page ${page}.`,
      ]);
    }

    if (operation === "read_file") {
      const filePath = normalizeRepositoryPath(context.args.path);
      const ref = normalizeString(context.args.ref, "ref", { maxLength: 255 });
      const endpoint = `/repos/${repoPath}/contents/${encodeRepositoryFilePath(filePath)}${
        ref ? `?ref=${encodeURIComponent(ref)}` : ""
      }`;
      const file = await api.json<RepoContentResponse | RepoContentResponse[]>(
        endpoint,
        token,
        { signal: context.signal },
      );
      if (!file) throw mcpNotFound(`File ${filePath} was not found`);
      if (Array.isArray(file) || file.type === "dir") {
        throw mcpBadRequest(`${filePath} is a directory; read_file requires a file`);
      }
      const content =
        file.encoding === "base64" && file.content
          ? Buffer.from(file.content.replace(/\s/gu, ""), "base64").toString("utf8")
          : file.content ?? "";
      const result = {
        repository: authorized.repository.fullName,
        path: file.path ?? filePath,
        name: file.name ?? filePath.split("/").at(-1) ?? "",
        sha: file.sha ?? "",
        size: file.size ?? 0,
        htmlUrl: file.html_url ?? "",
        downloadUrl: file.download_url ?? null,
        content: truncate(content, MAX_FILE_CHARS),
        truncated: content.length > MAX_FILE_CHARS,
      };
      addArtifact(context, {
        toolId: "github_repository",
        operation,
        repository: authorized.repository.fullName,
        title: `${authorized.repository.fullName}:${filePath}`,
        kind: "text",
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Read ${result.size} byte(s) from ${filePath}.`,
      ]);
    }

    if (operation === "create_branch") {
      const branch = normalizeString(context.args.branch, "branch", {
        required: true,
        maxLength: 255,
      })!;
      const sourceRef =
        normalizeString(context.args.sourceRef, "sourceRef", { maxLength: 255 }) ??
        authorized.repository.defaultBranch;
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Create GitHub branch ${branch} from ${sourceRef}.`,
      });
      const source = await api.json<GitRefResponse>(
        `/repos/${repoPath}/git/ref/heads/${encodeURIComponent(sourceRef)}`,
        token,
        { signal: context.signal },
      );
      const sourceSha = source?.object?.sha;
      if (!sourceSha) {
        throw mcpBadRequest(`Could not resolve source ref ${sourceRef}`);
      }
      const created = await api.json<GitRefResponse>(
        `/repos/${repoPath}/git/refs`,
        token,
        {
          method: "POST",
          body: { ref: `refs/heads/${branch}`, sha: sourceSha },
          signal: context.signal,
        },
      );
      const result = {
        repository: authorized.repository.fullName,
        branch,
        sourceRef,
        sourceSha,
        ref: created?.ref ?? `refs/heads/${branch}`,
        sha: created?.object?.sha ?? sourceSha,
      };
      addArtifact(context, {
        toolId: "github_repository",
        operation,
        repository: authorized.repository.fullName,
        title: `Created GitHub branch ${branch}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Created branch ${branch} from ${sourceRef} at ${sourceSha.slice(0, 7)}.`,
      ]);
    }

    if (operation === "write_file") {
      const filePath = normalizeRepositoryPath(context.args.path);
      const content = normalizeString(context.args.content, "content", {
        required: true,
        maxLength: 2_000_000,
        preserveWhitespace: true,
        allowEmpty: true,
      })!;
      const commitMessage = normalizeString(
        context.args.commitMessage,
        "commitMessage",
        { required: true, maxLength: 500 },
      )!;
      const branch = normalizeString(context.args.branch, "branch", {
        required: true,
        maxLength: 255,
      })!;
      let expectedSha = normalizeString(context.args.expectedSha, "expectedSha", {
        maxLength: 100,
      });
      const overwrite = normalizeBoolean(context.args.overwrite, "overwrite");
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Commit ${filePath} to branch ${branch}.`,
      });
      if (!expectedSha && overwrite) {
        const current = await api.json<RepoContentResponse>(
          `/repos/${repoPath}/contents/${encodeRepositoryFilePath(filePath)}?ref=${encodeURIComponent(branch)}`,
          token,
          { signal: context.signal, allowNotFound: true },
        );
        expectedSha = current?.sha;
      }
      const response = await api.json<{
        content?: RepoContentResponse;
        commit?: { sha?: string; html_url?: string; message?: string };
      }>(`/repos/${repoPath}/contents/${encodeRepositoryFilePath(filePath)}`, token, {
        method: "PUT",
        body: {
          message: commitMessage,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch,
          ...(expectedSha ? { sha: expectedSha } : {}),
        },
        signal: context.signal,
      });
      const result = {
        repository: authorized.repository.fullName,
        path: response?.content?.path ?? filePath,
        fileSha: response?.content?.sha ?? null,
        commitSha: response?.commit?.sha ?? null,
        commitUrl: response?.commit?.html_url ?? null,
        branch,
        updatedExistingFile: Boolean(expectedSha),
      };
      addArtifact(context, {
        toolId: "github_repository",
        operation,
        repository: authorized.repository.fullName,
        title: `Committed ${filePath}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Committed ${filePath} to branch ${branch}.`,
        `Commit SHA is ${result.commitSha ?? "unknown"}.`,
      ]);
    }

    if (operation === "delete_file") {
      const filePath = normalizeRepositoryPath(context.args.path);
      const commitMessage = normalizeString(
        context.args.commitMessage,
        "commitMessage",
        { required: true, maxLength: 500 },
      )!;
      const branch = normalizeString(context.args.branch, "branch", {
        required: true,
        maxLength: 255,
      })!;
      let expectedSha = normalizeString(context.args.expectedSha, "expectedSha", {
        maxLength: 100,
      });
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Delete ${filePath} from branch ${branch}.`,
        highRisk: true,
      });
      if (!expectedSha) {
        const current = await api.json<RepoContentResponse>(
          `/repos/${repoPath}/contents/${encodeRepositoryFilePath(filePath)}?ref=${encodeURIComponent(branch)}`,
          token,
          { signal: context.signal },
        );
        expectedSha = current?.sha;
      }
      if (!expectedSha) {
        throw mcpBadRequest(`Could not resolve current SHA for ${filePath}`);
      }
      const response = await api.json<{
        commit?: { sha?: string; html_url?: string; message?: string };
      }>(`/repos/${repoPath}/contents/${encodeRepositoryFilePath(filePath)}`, token, {
        method: "DELETE",
        body: { message: commitMessage, sha: expectedSha, branch },
        signal: context.signal,
      });
      const result = {
        repository: authorized.repository.fullName,
        path: filePath,
        deletedSha: expectedSha,
        branch,
        commitSha: response?.commit?.sha ?? null,
        commitUrl: response?.commit?.html_url ?? null,
      };
      addArtifact(context, {
        toolId: "github_repository",
        operation,
        repository: authorized.repository.fullName,
        title: `Deleted ${filePath}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Deleted ${filePath} from branch ${branch}.`,
      ]);
    }

    const base = normalizeString(context.args.base, "base", {
      required: true,
      maxLength: 255,
    })!;
    const head = normalizeString(context.args.head, "head", {
      required: true,
      maxLength: 255,
    })!;
    const fileLimit = normalizeInteger(context.args.fileLimit, "fileLimit", {
      fallback: 50,
      min: 1,
      max: MAX_COMPARE_ITEMS,
    })!;
    const commitLimit = normalizeInteger(context.args.commitLimit, "commitLimit", {
      fallback: 50,
      min: 1,
      max: MAX_COMPARE_ITEMS,
    })!;
    const comparison = await api.json<{
      status?: string;
      ahead_by?: number;
      behind_by?: number;
      total_commits?: number;
      html_url?: string;
      merge_base_commit?: { sha?: string };
      commits?: CommitResponse[];
      files?: Array<{
        filename?: string;
        status?: string;
        additions?: number;
        deletions?: number;
        changes?: number;
        patch?: string;
        previous_filename?: string;
      }>;
    }>(
      `/repos/${repoPath}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      token,
      { signal: context.signal },
    );
    if (!comparison) throw mcpNotFound(`Comparison ${base}...${head} was not found`);
    const result = {
      repository: authorized.repository.fullName,
      base,
      head,
      status: comparison.status ?? "",
      aheadBy: comparison.ahead_by ?? 0,
      behindBy: comparison.behind_by ?? 0,
      totalCommits: comparison.total_commits ?? 0,
      htmlUrl: comparison.html_url ?? "",
      mergeBaseSha: comparison.merge_base_commit?.sha ?? null,
      commits: (comparison.commits ?? []).slice(0, commitLimit).map((commit) => ({
        sha: commit.sha ?? "",
        message: commit.commit?.message ?? "",
        htmlUrl: commit.html_url ?? "",
      })),
      files: (comparison.files ?? []).slice(0, fileLimit).map((file) => ({
        filename: file.filename ?? "",
        previousFilename: file.previous_filename ?? null,
        status: file.status ?? "",
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        changes: file.changes ?? 0,
        patch: truncate(file.patch ?? "", 12_000),
      })),
    };
    addArtifact(context, {
      toolId: "github_repository",
      operation,
      repository: authorized.repository.fullName,
      title: `GitHub compare ${base}...${head}`,
      kind: "diff",
      data: result,
    });
    return completed(operation, authorized.repository.fullName, result, [
      `${head} is ${result.aheadBy} commit(s) ahead and ${result.behindBy} behind ${base}.`,
      `Returned ${result.files.length} changed file(s).`,
    ]);
  },
});
