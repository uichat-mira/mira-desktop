import { describe, expect, it, vi } from "vitest";
import type { GitHubConnectionRecord } from "@/db/repositories/github-connection.repository.js";
import type { ToolInvocationContext } from "../core/definitions.js";
import { ToolApprovalRequiredError } from "../core/errors.js";
import { validateInvocationArgs } from "../core/schema.js";
import { sanitizeIssueSearchQuery } from "./github-domain.api.js";
import { createGitHubDomainTools } from "./github-domain.tool.js";

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

const authorizedRepository = {
  id: 10,
  name: "uichat-mira",
  full_name: "dangjingtao/uichat-mira",
  private: true,
  html_url: "https://github.com/dangjingtao/uichat-mira",
  default_branch: "main",
  permissions: { pull: true, push: true },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });

const createContext = (
  args: Record<string, unknown>,
  approvalGranted = false,
): ToolInvocationContext => ({
  invocationId: "github-domain-test",
  args,
  ...(approvalGranted
    ? { approval: { inputHash: "approved-hash", granted: true } }
    : {}),
  signal: new AbortController().signal,
  pushEvent() {},
  addArtifact(artifact) {
    return { id: "artifact-github-domain", ...artifact };
  },
  trace: {
    startSpan() {
      return { spanId: "span-github-domain", end() {} };
    },
  },
});

const createFetchRouter = () =>
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/user/installations") {
      return jsonResponse({ installations: [{ id: 55 }] });
    }
    if (url.pathname === "/user/installations/55/repositories") {
      return jsonResponse({ repositories: [authorizedRepository] });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/git/ref/heads/main") {
      return jsonResponse({ ref: "refs/heads/main", object: { sha: "base-sha" } });
    }
    if (
      url.pathname === "/repos/dangjingtao/uichat-mira/git/refs" &&
      method === "POST"
    ) {
      return jsonResponse(
        { ref: "refs/heads/feature/domain", object: { sha: "base-sha" } },
        201,
      );
    }
    if (
      url.pathname === "/repos/dangjingtao/uichat-mira/issues" &&
      method === "POST"
    ) {
      return jsonResponse(
        {
          number: 42,
          title: "Domain tool issue",
          body: "Created by test",
          state: "open",
          html_url: "https://github.com/dangjingtao/uichat-mira/issues/42",
          user: { login: "tomz" },
        },
        201,
      );
    }
    if (
      url.pathname === "/repos/dangjingtao/uichat-mira/pulls" &&
      method === "POST"
    ) {
      return jsonResponse(
        {
          number: 43,
          title: "Domain tool PR",
          body: "Created by test",
          state: "open",
          html_url: "https://github.com/dangjingtao/uichat-mira/pull/43",
          user: { login: "tomz" },
          head: { ref: "feature/domain", sha: "head-sha" },
          base: { ref: "main", sha: "base-sha" },
        },
        201,
      );
    }
    if (
      url.pathname ===
        "/repos/dangjingtao/uichat-mira/actions/workflows/ci.yml/dispatches" &&
      method === "POST"
    ) {
      return jsonResponse(null, 204);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/issues/12") {
      return jsonResponse({
        number: 12,
        title: "Issue",
        state: "open",
        html_url: "https://github.com/dangjingtao/uichat-mira/issues/12",
      });
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/pulls/7") {
      return jsonResponse({
        number: 7,
        title: "PR",
        state: "open",
        html_url: "https://github.com/dangjingtao/uichat-mira/pull/7",
        head: { ref: "feature", sha: "head-sha" },
        base: { ref: "main", sha: "base-sha" },
      });
    }

    throw new Error(`Unhandled GitHub domain test request: ${method} ${url.pathname}`);
  });

const createTools = (fetchImpl = createFetchRouter()) => ({
  fetchImpl,
  tools: createGitHubDomainTools({
    fetchImpl,
    getConnection: () => connection,
    saveConnection: () => connection,
  }),
});

const operationNames = (schema: Record<string, unknown>) =>
  ((schema.oneOf ?? []) as Array<Record<string, unknown>>).map((variant) => {
    const properties = variant.properties as Record<string, Record<string, unknown>>;
    return (properties.operation.enum as string[])[0];
  });

const expectApproval = async (
  invocation: unknown,
  scope: "github.remote_write" | "github.high_risk",
) => {
  try {
    await invocation;
    throw new Error("Expected GitHub write approval");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolApprovalRequiredError);
    expect((error as ToolApprovalRequiredError).scope).toBe(scope);
  }
};

describe("GitHub domain capability package", () => {
  it("sanitizes Issue search punctuation without creating GitHub qualifiers", () => {
    expect(
      sanitizeIssueSearchQuery(
        'crash "quoted" \\path repo:someone/private is:pr (draft)',
      ),
    ).toBe("crash quoted path repo someone/private is pr draft in:title,body");
  });

  it("exposes exactly four domain tools with bounded operation schemas", () => {
    const { tools } = createTools();
    expect(Object.values(tools).map((tool) => tool.definition.id)).toEqual([
      "github_repository",
      "github_issue",
      "github_pull_request",
      "github_actions",
    ]);

    expect(operationNames(tools.githubRepositoryTool.definition.inputSchema)).toEqual([
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
    ]);
    expect(operationNames(tools.githubIssueTool.definition.inputSchema)).toEqual([
      "list",
      "search",
      "get",
      "create",
      "update",
      "comment",
      "close",
      "reopen",
    ]);
    expect(operationNames(tools.githubPullRequestTool.definition.inputSchema)).toEqual([
      "list",
      "get",
      "create",
      "update",
      "comment",
      "review",
      "merge",
    ]);
    expect(operationNames(tools.githubActionsTool.definition.inputSchema)).toEqual([
      "list_runs",
      "get_run",
      "get_logs",
      "dispatch",
      "rerun",
      "cancel",
    ]);

    for (const tool of Object.values(tools)) {
      expect(tool.definition).toMatchObject({
        domain: "github",
        source: "internal",
        capabilities: {
          sideEffect: "network",
          requiresApproval: false,
          networkAccess: true,
        },
        workbench: { groupId: "github" },
      });
    }
  });

  it("keeps operation parameters mutually exclusive", () => {
    const { tools } = createTools();
    // A field that belongs to another operation variant is rejected as an
    // unknown property for the selected variant; the variant count error only
    // applies when no single variant accepts the payload.
    expect(() =>
      validateInvocationArgs(
        {
          operation: "get",
          repository: "dangjingtao/uichat-mira",
          title: "not a repository get field",
        },
        tools.githubRepositoryTool.definition.inputSchema,
      ),
    ).toThrow("args.title is not allowed");

    // write_file without `branch` cannot satisfy any single variant: the
    // write_file variant demands it and configure_pages demands `mode`.
    expect(() =>
      validateInvocationArgs(
        {
          operation: "write_file",
          repository: "dangjingtao/uichat-mira",
          path: "docs/test.md",
          content: "test",
          commitMessage: "docs: test",
        },
        tools.githubRepositoryTool.definition.inputSchema,
      ),
    ).toThrow();
  });

  it("requires operation-aware approval before any remote write", async () => {
    const { fetchImpl, tools } = createTools();

    await expectApproval(
      tools.githubRepositoryTool.execute(
        createContext({
          operation: "create_branch",
          repository: "dangjingtao/uichat-mira",
          branch: "feature/domain",
        }),
      ),
      "github.remote_write",
    );
    await expectApproval(
      tools.githubIssueTool.execute(
        createContext({
          operation: "create",
          repository: "dangjingtao/uichat-mira",
          title: "No write before approval",
        }),
      ),
      "github.remote_write",
    );
    await expectApproval(
      tools.githubPullRequestTool.execute(
        createContext({
          operation: "merge",
          repository: "dangjingtao/uichat-mira",
          number: 7,
        }),
      ),
      "github.high_risk",
    );
    await expectApproval(
      tools.githubActionsTool.execute(
        createContext({
          operation: "cancel",
          repository: "dangjingtao/uichat-mira",
          runId: 99,
        }),
      ),
      "github.high_risk",
    );

    const writeRequests = fetchImpl.mock.calls.filter(
      (call: [string | URL | Request, RequestInit?]) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(
          call[1]?.method ?? "GET",
        ),
    );
    expect(writeRequests).toHaveLength(0);
  });

  it("executes approved write operations across all four domains", async () => {
    const { fetchImpl, tools } = createTools();

    const branch = await tools.githubRepositoryTool.execute(
      createContext(
        {
          operation: "create_branch",
          repository: "dangjingtao/uichat-mira",
          branch: "feature/domain",
          sourceRef: "main",
        },
        true,
      ),
    );
    expect(branch.structuredContent).toMatchObject({
      operation: "create_branch",
      branch: "feature/domain",
      sha: "base-sha",
    });

    const issue = await tools.githubIssueTool.execute(
      createContext(
        {
          operation: "create",
          repository: "dangjingtao/uichat-mira",
          title: "Domain tool issue",
          body: "Created by test",
        },
        true,
      ),
    );
    expect(issue.structuredContent).toMatchObject({
      operation: "create",
      number: 42,
      state: "open",
    });

    const pull = await tools.githubPullRequestTool.execute(
      createContext(
        {
          operation: "create",
          repository: "dangjingtao/uichat-mira",
          title: "Domain tool PR",
          head: "feature/domain",
          base: "main",
        },
        true,
      ),
    );
    expect(pull.structuredContent).toMatchObject({
      operation: "create",
      number: 43,
      state: "open",
    });

    const dispatch = await tools.githubActionsTool.execute(
      createContext(
        {
          operation: "dispatch",
          repository: "dangjingtao/uichat-mira",
          workflow: "ci.yml",
          ref: "main",
          inputs: { suite: "smoke" },
        },
        true,
      ),
    );
    expect(dispatch.structuredContent).toMatchObject({
      operation: "dispatch",
      workflow: "ci.yml",
      ref: "main",
      dispatched: true,
    });

    const writes = fetchImpl.mock.calls.map(
      (call: [string | URL | Request, RequestInit?]) => ({
        path: new URL(String(call[0])).pathname,
        method: call[1]?.method ?? "GET",
        body:
          typeof call[1]?.body === "string" ? JSON.parse(call[1].body) : null,
      }),
    );
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/repos/dangjingtao/uichat-mira/git/refs",
          method: "POST",
          body: { ref: "refs/heads/feature/domain", sha: "base-sha" },
        }),
        expect.objectContaining({
          path: "/repos/dangjingtao/uichat-mira/issues",
          method: "POST",
        }),
        expect.objectContaining({
          path: "/repos/dangjingtao/uichat-mira/pulls",
          method: "POST",
        }),
        expect.objectContaining({
          path:
            "/repos/dangjingtao/uichat-mira/actions/workflows/ci.yml/dispatches",
          method: "POST",
        }),
      ]),
    );
  });
});
