import { describe, expect, it, vi } from "vitest";
import type { GitHubConnectionRecord } from "@/db/repositories/github-connection.repository.js";
import type { ToolInvocationContext } from "../core/definitions.js";
import { createGitHubReadTools } from "./github-read.tool.js";

const connection: GitHubConnectionRecord = {
  id: "default",
  clientId: "Iv.test",
  appSlug: "uichat-mira-test",
  accessToken: "github-token",
  refreshToken: "",
  tokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  userId: "1",
  login: "tomz",
  avatarUrl: null,
  enabled: true,
  status: "connected",
  lastValidatedAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const createContext = (args: Record<string, unknown>): ToolInvocationContext => ({
  invocationId: "github-test",
  args,
  signal: new AbortController().signal,
  pushEvent() {},
  addArtifact(artifact) {
    return { id: "artifact-github", ...artifact };
  },
  trace: {
    startSpan() {
      return {
        spanId: "span-github",
        end() {},
      };
    },
  },
});

const authorizedRepository = {
  id: 10,
  name: "uichat-mira",
  full_name: "dangjingtao/uichat-mira",
  private: true,
  html_url: "https://github.com/dangjingtao/uichat-mira",
  default_branch: "main",
  permissions: { pull: true },
};

const createFetchRouter = () =>
  vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;

    if (url.pathname === "/user/installations") {
      return jsonResponse({ installations: [{ id: 55 }] });
    }
    if (url.pathname === "/user/installations/55/repositories") {
      return jsonResponse({ repositories: [authorizedRepository] });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira") {
      return jsonResponse({
        ...authorizedRepository,
        owner: { login: "dangjingtao", html_url: "https://github.com/dangjingtao" },
        description: "Mira",
        archived: false,
        disabled: false,
        visibility: "private",
        language: "TypeScript",
        topics: ["agent"],
        open_issues_count: 3,
        forks_count: 1,
        stargazers_count: 2,
        watchers_count: 2,
        size: 100,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-07-25T00:00:00Z",
        pushed_at: "2026-07-25T00:00:00Z",
      });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/readme") {
      return jsonResponse({
        name: "README.md",
        path: "README.md",
        encoding: "base64",
        content: Buffer.from("# Mira").toString("base64"),
        size: 6,
      });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/commits") {
      return jsonResponse([
        {
          sha: "1234567890",
          html_url: "https://github.com/dangjingtao/uichat-mira/commit/1234567890",
          commit: {
            message: "feat: github tools",
            author: { name: "Tomz", date: "2026-07-25T00:00:00Z" },
            committer: { name: "Tomz", date: "2026-07-25T00:00:00Z" },
          },
          author: { login: "dangjingtao" },
          committer: { login: "dangjingtao" },
        },
      ]);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/issues/12") {
      return jsonResponse({
        number: 12,
        title: "Issue title",
        body: "Issue body",
        state: "open",
        html_url: "https://github.com/dangjingtao/uichat-mira/issues/12",
        user: { login: "dangjingtao" },
        comments: 1,
        labels: [{ name: "bug", color: "ff0000" }],
      });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/issues/12/comments") {
      return jsonResponse([
        {
          id: 1,
          body: "Issue comment",
          user: { login: "dangjingtao" },
        },
      ]);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/pulls/7") {
      return jsonResponse({
        number: 7,
        title: "PR title",
        body: "PR body",
        state: "open",
        html_url: "https://github.com/dangjingtao/uichat-mira/pull/7",
        user: { login: "dangjingtao" },
        head: { ref: "feature", sha: "head", repo: { full_name: "dangjingtao/uichat-mira" } },
        base: { ref: "main", sha: "base", repo: { full_name: "dangjingtao/uichat-mira" } },
        additions: 10,
        deletions: 2,
        changed_files: 1,
      });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/pulls/7/files") {
      return jsonResponse([
        {
          filename: "server/src/example.ts",
          status: "modified",
          additions: 10,
          deletions: 2,
          changes: 12,
          patch: "@@ -1 +1 @@",
        },
      ]);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/issues/7/comments") {
      return jsonResponse([{ id: 2, body: "Conversation", user: { login: "reviewer" } }]);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/pulls/7/comments") {
      return jsonResponse([{ id: 3, body: "Inline", user: { login: "reviewer" }, path: "server/src/example.ts" }]);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/pulls/7/reviews") {
      return jsonResponse([{ id: 4, state: "APPROVED", user: { login: "reviewer" } }]);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/actions/runs/99") {
      return jsonResponse({
        id: 99,
        name: "CI",
        display_title: "CI",
        workflow_id: 5,
        run_number: 10,
        run_attempt: 1,
        event: "push",
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/dangjingtao/uichat-mira/actions/runs/99",
        head_branch: "main",
        head_sha: "abc",
      });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/actions/runs/99/jobs") {
      return jsonResponse({
        total_count: 1,
        jobs: [
          {
            id: 100,
            name: "test",
            status: "completed",
            conclusion: "success",
            steps: [{ number: 1, name: "pnpm check", status: "completed", conclusion: "success" }],
          },
        ],
      });
    }

    throw new Error(`Unhandled GitHub test request: ${path}`);
  });

describe("GitHub read capability package", () => {
  it("declares four explicit read-only network tools in one workbench package", () => {
    const tools = createGitHubReadTools({
      fetchImpl: createFetchRouter(),
      getConnection: () => connection,
      saveConnection: () => connection,
    });
    const definitions = Object.values(tools).map((tool) => tool.definition);

    expect(definitions.map((definition) => definition.id)).toEqual([
      "github_repo_read",
      "github_issue_read",
      "github_pr_read",
      "github_actions_status",
    ]);
    for (const definition of definitions) {
      expect(definition).toMatchObject({
        domain: "github",
        source: "internal",
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
          networkAccess: true,
        },
        workbench: { groupId: "github_read" },
      });
      expect(definition.inputSchema).toMatchObject({
        type: "object",
        required: ["repository"],
        additionalProperties: false,
      });
    }

    expect(tools.githubRepoReadTool.definition.inputSchema).toHaveProperty(
      "properties.includeReadme",
    );
    expect(tools.githubIssueReadTool.definition.inputSchema).toHaveProperty(
      "properties.number",
    );
    expect(tools.githubPrReadTool.definition.inputSchema).toHaveProperty(
      "properties.includeFiles",
    );
    expect(tools.githubActionsStatusTool.definition.inputSchema).toHaveProperty(
      "properties.runId",
    );
  });

  it("executes all four tools only after installation repository validation", async () => {
    const fetchImpl = createFetchRouter();
    const tools = createGitHubReadTools({
      fetchImpl,
      getConnection: () => connection,
      saveConnection: () => connection,
    });

    const repositoryResult = await tools.githubRepoReadTool.execute(
      createContext({
        repository: "dangjingtao/uichat-mira",
        includeReadme: true,
        commitLimit: 1,
      }),
    );
    expect(repositoryResult.result).toMatchObject({
      repository: "dangjingtao/uichat-mira",
      metadata: { language: "TypeScript" },
      readme: { content: "# Mira" },
      commits: [{ shortSha: "1234567" }],
    });

    const issueResult = await tools.githubIssueReadTool.execute(
      createContext({
        repository: "dangjingtao/uichat-mira",
        number: 12,
        includeComments: true,
      }),
    );
    expect(issueResult.result).toMatchObject({
      mode: "detail",
      issue: { number: 12, title: "Issue title" },
      comments: [{ body: "Issue comment" }],
    });

    const pullResult = await tools.githubPrReadTool.execute(
      createContext({
        repository: "dangjingtao/uichat-mira",
        number: 7,
        includeFiles: true,
        includeComments: true,
        includeReviews: true,
      }),
    );
    expect(pullResult.result).toMatchObject({
      mode: "detail",
      pullRequest: { number: 7, title: "PR title" },
      files: [{ filename: "server/src/example.ts" }],
      reviews: [{ state: "APPROVED" }],
    });

    const actionsResult = await tools.githubActionsStatusTool.execute(
      createContext({
        repository: "dangjingtao/uichat-mira",
        runId: 99,
        includeJobs: true,
      }),
    );
    expect(actionsResult.result).toMatchObject({
      mode: "detail",
      run: { id: "99", conclusion: "success" },
      jobs: [{ name: "test", conclusion: "success" }],
    });

    const requestedUrls = fetchImpl.mock.calls.map(([input]) => String(input));
    expect(
      requestedUrls.filter((url) => url.includes("/user/installations?")),
    ).toHaveLength(4);
    expect(
      requestedUrls.filter((url) =>
        url.includes("/user/installations/55/repositories?"),
      ),
    ).toHaveLength(4);
  });

  it("rejects repositories outside the GitHub App installation scope", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/user/installations") {
        return jsonResponse({ installations: [{ id: 55 }] });
      }
      if (url.pathname === "/user/installations/55/repositories") {
        return jsonResponse({ repositories: [authorizedRepository] });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const tools = createGitHubReadTools({
      fetchImpl,
      getConnection: () => connection,
      saveConnection: () => connection,
    });

    await expect(
      tools.githubRepoReadTool.execute(
        createContext({ repository: "someone/private-repository" }),
      ),
    ).rejects.toThrow(
      "Repository someone/private-repository is not authorized for Mira",
    );
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        String(input).includes("/repos/someone/private-repository"),
      ),
    ).toBe(false);
  });
});
