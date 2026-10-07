import type { ToolImplementation } from "../core/definitions.js";
import { createRepositoryTool } from "./github-repository.tool.js";
import * as S from "./github-domain.shared.js";

const {
  addArtifact,
  authorizeRepository,
  completed,
  encodeGitHubRepositoryPath,
  mcpBadRequest,
  normalizeBoolean,
  normalizeGitHubLogin,
  normalizeGitHubRepositoryName,
  normalizeOperation,
  normalizeString,
  operationVariant,
  repositorySchema,
  requireRemoteWriteApproval,
} = S;

type GitHubReadClient = S.GitHubReadClient;
type GitHubApi = ReturnType<typeof S.createGitHubApi>;

type RepositoryResponse = {
  id?: number;
  full_name?: string;
  private?: boolean;
  visibility?: string;
  html_url?: string;
  default_branch?: string;
};

type PagesResponse = {
  status?: string;
  build_type?: "legacy" | "workflow";
  source?: { branch?: string; path?: string };
  cname?: string | null;
  https_enforced?: boolean;
  html_url?: string;
};

type NormalizedPagesResult = {
  enabled: boolean;
  status: string | null;
  buildType: "legacy" | "workflow" | null;
  source: { branch: string; path: "/" | "/docs" } | null;
  customDomain: string | null;
  httpsEnforced: boolean;
  url: string | null;
};

const createRepositoryVariant = {
  type: "object",
  additionalProperties: false,
  required: ["operation", "owner", "name", "visibility"],
  properties: {
    operation: { type: "string", enum: ["create"] },
    owner: { type: "string" },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[A-Za-z0-9._-]+$",
    },
    visibility: { type: "string", enum: ["public", "private"] },
    description: { type: "string", maxLength: 350 },
    autoInit: { type: "boolean", default: true },
  },
} as const;

export const extendedRepositorySchema = {
  oneOf: [
    ...repositorySchema.oneOf,
    createRepositoryVariant,
    operationVariant("ensure_installation_access", {}),
    operationVariant("get_pages", {}),
    operationVariant(
      "configure_pages",
      {
        mode: { type: "string", enum: ["workflow", "branch"] },
        branch: { type: "string" },
        path: { type: "string", enum: ["/", "/docs"], default: "/" },
        customDomain: {
          description: "Custom domain string, or null to remove the current domain.",
        },
        enforceHttps: { type: "boolean" },
      },
      ["mode"],
    ),
  ],
} as const;

const normalizeRepositoryName = (value: unknown) => {
  const name = normalizeString(value, "name", {
    required: true,
    maxLength: 100,
  })!;
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
    throw mcpBadRequest(
      "name may contain only letters, numbers, periods, hyphens, and underscores",
    );
  }
  return name;
};

const normalizeVisibility = (value: unknown): "public" | "private" => {
  if (value !== "public" && value !== "private") {
    throw mcpBadRequest("visibility must be public or private");
  }
  return value;
};

const normalizePagesMode = (value: unknown): "workflow" | "branch" => {
  if (value !== "workflow" && value !== "branch") {
    throw mcpBadRequest("mode must be workflow or branch");
  }
  return value;
};

const normalizePagesPath = (value: unknown): "/" | "/docs" => {
  if (value === undefined || value === "/") return "/";
  if (value === "/docs") return "/docs";
  throw mcpBadRequest("path must be / or /docs");
};

const normalizeOptionalBoolean = (value: unknown, name: string) =>
  value === undefined ? undefined : normalizeBoolean(value, name);

const normalizeCustomDomain = (value: unknown) => {
  if (value === undefined || value === null) return value;
  return normalizeString(value, "customDomain", {
    required: true,
    maxLength: 253,
  });
};

const normalizePagesResult = (pages: PagesResponse | null): NormalizedPagesResult => ({
  enabled: Boolean(pages),
  status: pages?.status ?? null,
  buildType: pages?.build_type ?? null,
  source: pages?.source
    ? {
        branch: pages.source.branch ?? "",
        path: pages.source.path === "/docs" ? "/docs" : "/",
      }
    : null,
  customDomain: pages?.cname ?? null,
  httpsEnforced: pages?.https_enforced ?? false,
  url: pages?.html_url ?? null,
});

const isInstallationScopeError = (error: unknown) =>
  error instanceof Error && error.message.includes("is not authorized for Mira");

export const createExtendedRepositoryTool = (
  client: GitHubReadClient,
  api: GitHubApi,
  baseTool: ToolImplementation,
): ToolImplementation => {
  const repositoryTool = createRepositoryTool(client, api, baseTool);

  return {
    ...repositoryTool,
    definition: {
      ...repositoryTool.definition,
      description:
        "读取和管理 GitHub 仓库，并支持创建仓库、检查 installation 授权和配置 GitHub Pages。operation 决定具体参数结构。",
      inputSchema: extendedRepositorySchema,
      tags: [...repositoryTool.definition.tags, "pages", "site", "建站"],
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
        "create",
        "ensure_installation_access",
        "get_pages",
        "configure_pages",
      ] as const);

      if (
        operation !== "create" &&
        operation !== "ensure_installation_access" &&
        operation !== "get_pages" &&
        operation !== "configure_pages"
      ) {
        return repositoryTool.execute(context);
      }

      if (operation === "create") {
        const owner = normalizeGitHubLogin(context.args.owner, "owner");
        if (!owner) throw mcpBadRequest("owner is required");
        const name = normalizeRepositoryName(context.args.name);
        const visibility = normalizeVisibility(context.args.visibility);
        const description = normalizeString(context.args.description, "description", {
          maxLength: 350,
        });
        const autoInit = normalizeBoolean(context.args.autoInit, "autoInit", true);
        const targetRepository = `${owner}/${name}`;

        requireRemoteWriteApproval(context, {
          operation,
          repository: targetRepository,
          summary: `Create ${visibility} GitHub repository ${targetRepository}.`,
        });

        const connection = await client.getActiveConnection(context.signal);
        const endpoint =
          (connection.login ?? "").toLowerCase() === owner.toLowerCase()
            ? "/user/repos"
            : `/orgs/${encodeURIComponent(owner)}/repos`;
        const created = await api.json<RepositoryResponse>(endpoint, connection.accessToken, {
          method: "POST",
          body: {
            name,
            private: visibility === "private",
            auto_init: autoInit,
            ...(description ? { description } : {}),
          },
          signal: context.signal,
        });
        const fullName = created?.full_name ?? targetRepository;
        const readBack = await api.json<RepositoryResponse>(
          `/repos/${encodeGitHubRepositoryPath(fullName)}`,
          connection.accessToken,
          { signal: context.signal },
        );
        if (!readBack?.id || !readBack.full_name) {
          throw mcpBadRequest(
            `GitHub created ${targetRepository}, but repository read-back did not return a complete snapshot`,
          );
        }
        const result = {
          id: readBack.id,
          fullName: readBack.full_name,
          defaultBranch: readBack.default_branch ?? "",
          visibility:
            readBack.visibility === "public" || readBack.visibility === "private"
              ? readBack.visibility
              : readBack.private
                ? "private"
                : "public",
          htmlUrl: readBack.html_url ?? "",
        };
        addArtifact(context, {
          toolId: "github_repository",
          operation,
          repository: result.fullName,
          title: `Created GitHub repository ${result.fullName}`,
          data: result,
        });
        return completed(operation, result.fullName, result, [
          `Created ${result.visibility} repository ${result.fullName}.`,
          `Read back repository ${result.id} with default branch ${result.defaultBranch || "unset"}.`,
        ]);
      }

      const repository = normalizeGitHubRepositoryName(context.args.repository);

      if (operation === "ensure_installation_access") {
        try {
          const authorized = await authorizeRepository(context, client, repository);
          const result = {
            accessible: true,
            installationId: authorized.repository.installationId,
            resolution: "already_accessible",
            repository: {
              id: authorized.repository.id,
              fullName: authorized.repository.fullName,
              defaultBranch: authorized.repository.defaultBranch,
              htmlUrl: authorized.repository.htmlUrl,
            },
          };
          addArtifact(context, {
            toolId: "github_repository",
            operation,
            repository: authorized.repository.fullName,
            title: `GitHub installation access: ${authorized.repository.fullName}`,
            data: result,
          });
          return completed(operation, authorized.repository.fullName, result, [
            `${authorized.repository.fullName} is available to installation ${authorized.repository.installationId}.`,
          ]);
        } catch (error) {
          if (!isInstallationScopeError(error)) throw error;
          const connection = await client.getActiveConnection(context.signal);
          const repositorySnapshot = await api.json<RepositoryResponse>(
            `/repos/${encodeGitHubRepositoryPath(repository)}`,
            connection.accessToken,
            { signal: context.signal, allowNotFound: true },
          );
          const fullName = repositorySnapshot?.full_name ?? repository;
          const result = {
            accessible: false,
            installationId: null,
            resolution: "user_action_required",
            authorizationUrl: "https://github.com/settings/installations",
            instructions:
              "Open the GitHub App installation settings, add this repository to Mira, then run ensure_installation_access again.",
            repository: {
              id: repositorySnapshot?.id ?? null,
              fullName,
              defaultBranch: repositorySnapshot?.default_branch ?? "",
              htmlUrl: repositorySnapshot?.html_url ?? "",
            },
          };
          addArtifact(context, {
            toolId: "github_repository",
            operation,
            repository: fullName,
            title: `GitHub installation authorization required: ${fullName}`,
            data: result,
          });
          return completed(operation, fullName, result, [
            `${fullName} is not currently authorized for Mira.`,
            "User action is required in GitHub App installation settings.",
          ]);
        }
      }

      const authorized = await authorizeRepository(context, client, repository);
      const repoPath = encodeGitHubRepositoryPath(authorized.repository.fullName);
      const token = authorized.connection.accessToken;

      if (operation === "get_pages") {
        const pages = await api.json<PagesResponse>(`/repos/${repoPath}/pages`, token, {
          signal: context.signal,
          allowNotFound: true,
        });
        const result = {
          repository: authorized.repository.fullName,
          ...normalizePagesResult(pages),
        };
        addArtifact(context, {
          toolId: "github_repository",
          operation,
          repository: authorized.repository.fullName,
          title: `GitHub Pages: ${authorized.repository.fullName}`,
          data: result,
        });
        return completed(operation, authorized.repository.fullName, result, [
          result.enabled
            ? `GitHub Pages is enabled at ${result.url ?? "an unresolved URL"}.`
            : "GitHub Pages is not enabled.",
        ]);
      }

      const mode = normalizePagesMode(context.args.mode);
      const branch =
        mode === "branch"
          ? normalizeString(context.args.branch, "branch", {
              required: true,
              maxLength: 255,
            })!
          : undefined;
      if (mode === "workflow" && context.args.branch !== undefined) {
        throw mcpBadRequest("branch is only valid when mode is branch");
      }
      if (mode === "workflow" && context.args.path !== undefined) {
        throw mcpBadRequest("path is only valid when mode is branch");
      }
      const sourcePath = normalizePagesPath(context.args.path);
      const customDomain = normalizeCustomDomain(context.args.customDomain);
      const enforceHttps = normalizeOptionalBoolean(
        context.args.enforceHttps,
        "enforceHttps",
      );

      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Configure GitHub Pages using ${mode} mode.`,
      });

      const current = await api.json<PagesResponse>(`/repos/${repoPath}/pages`, token, {
        signal: context.signal,
        allowNotFound: true,
      });
      const sourceBody =
        mode === "branch"
          ? { build_type: "legacy", source: { branch, path: sourcePath } }
          : { build_type: "workflow" };

      if (current) {
        await api.json<unknown>(`/repos/${repoPath}/pages`, token, {
          method: "PUT",
          body: {
            ...sourceBody,
            ...(customDomain !== undefined ? { cname: customDomain } : {}),
            ...(enforceHttps !== undefined ? { https_enforced: enforceHttps } : {}),
          },
          signal: context.signal,
        });
      } else {
        await api.json<unknown>(`/repos/${repoPath}/pages`, token, {
          method: "POST",
          body: sourceBody,
          signal: context.signal,
        });
        if (customDomain !== undefined || enforceHttps !== undefined) {
          await api.json<unknown>(`/repos/${repoPath}/pages`, token, {
            method: "PUT",
            body: {
              ...(customDomain !== undefined ? { cname: customDomain } : {}),
              ...(enforceHttps !== undefined ? { https_enforced: enforceHttps } : {}),
            },
            signal: context.signal,
          });
        }
      }

      const readBack = await api.json<PagesResponse>(`/repos/${repoPath}/pages`, token, {
        signal: context.signal,
      });
      if (!readBack) {
        throw mcpBadRequest("GitHub Pages configuration completed without a readable final state");
      }
      const result = {
        repository: authorized.repository.fullName,
        ...normalizePagesResult(readBack),
      };
      addArtifact(context, {
        toolId: "github_repository",
        operation,
        repository: authorized.repository.fullName,
        title: `Configured GitHub Pages: ${authorized.repository.fullName}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Configured GitHub Pages in ${mode} mode.`,
        `Read back final Pages URL ${result.url ?? "unresolved"}.`,
      ]);
    },
  };
};
