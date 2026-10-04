import { describe, expect, it, vi } from "vitest";
import type { GitHubConnectionRecord } from "@/db/repositories/github-connection.repository.js";
import type { ToolInvocationContext } from "../core/definitions.js";
import { ToolApprovalRequiredError } from "../core/errors.js";
import { validateInvocationArgs } from "../core/schema.js";
import { createGitHubDomainRuntime } from "./github-domain.shared.js";
import {
  createExtendedRepositoryTool,
  extendedRepositorySchema,
} from "./github-repository-extended.tool.js";

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
  permissions: { pull: true, push: true, admin: true },
};

const createdRepository = {
  id: 20,
  name: "mira-docs",
  full_name: "tomz/mira-docs",
  private: true,
  visibility: "private",
  html_url: "https://github.com/tomz/mira-docs",
  default_branch: "main",
};

const unscopedRepository = {
  id: 21,
  name: "unscoped",
  full_name: "tomz/unscoped",
  private: false,
  visibility: "public",
  html_url: "https://github.com/tomz/unscoped",
  default_branch: "main",
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
  invocationId: "github-repository-extended-test",
  args,
  ...(approvalGranted
    ? { approval: { inputHash: "approved-hash", granted: true } }
    : {}),
  signal: new AbortController().signal,
  pushEvent() {},
  addArtifact(artifact) {
    return { id: "artifact-github-repository-extended", ...artifact };
  },
  trace: {
    startSpan() {
      return { spanId: "span-github-repository-extended", end() {} };
    },
  },
});

const createFixture = () => {
  let pages: {
    status?: string;
    build_type?: "legacy" | "workflow";
    source?: { branch?: string; path?: string };
    cname?: string | null;
    https_enforced?: boolean;
    html_url?: string;
  } | null = null;

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};

    if (url.pathname === "/user/installations") {
      return jsonResponse({ installations: [{ id: 55 }] });
    }
    if (url.pathname === "/user/installations/55/repositories") {
      return jsonResponse({ repositories: [authorizedRepository] });
    }
    if (url.pathname === "/user/repos" && method === "POST") {
      return jsonResponse(createdRepository, 201);
    }
    if (url.pathname === "/repos/tomz/mira-docs") {
      return jsonResponse(createdRepository);
    }
    if (url.pathname === "/repos/tomz/unscoped") {
      return jsonResponse(unscopedRepository);
    }
    if (url.pathname === "/repos/dangjingtao/uichat-mira/pages") {
      if (method === "GET") {
        return pages
          ? jsonResponse(pages)
          : jsonResponse({ message: "Not Found" }, 404);
      }
      if (method === "POST") {
        pages = {
          status: "building",
          build_type: body.build_type,
          source: body.source,
          cname: null,
          https_enforced: false,
          html_url: "https://dangjingtao.github.io/uichat-mira/",
        };
        return jsonResponse(pages, 201);
      }
      if (method === "PUT") {
        pages = {
          ...(pages ?? {}),
          ...(body.build_type !== undefined ? { build_type: body.build_type } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
          ...(body.cname !== undefined ? { cname: body.cname } : {}),
          ...(body.https_enforced !== undefined
            ? { https_enforced: body.https_enforced }
            : {}),
          status: "built",
          html_url: "https://docs.example.com/",
        };
        return jsonResponse(null, 204);
      }
    }

    throw new Error(`Unhandled GitHub repository extension request: ${method} ${url.pathname}`);
  });

  const runtime = createGitHubDomainRuntime({
    fetchImpl,
    getConnection: () => connection,
    saveConnection: () => connection,
  });
  const tool = createExtendedRepositoryTool(
    runtime.client,
    runtime.api,
    runtime.baseTools.githubRepoReadTool,
  );

  return { fetchImpl, tool };
};

const operationNames = () =>
  extendedRepositorySchema.oneOf.map(
    (variant) => variant.properties.operation.enum[0],
  );

const expectApproval = async (invocation: Promise<unknown>) => {
  try {
    await invocation;
    throw new Error("Expected GitHub write approval");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolApprovalRequiredError);
    expect((error as ToolApprovalRequiredError).scope).toBe("github.remote_write");
  }
};

describe("GitHub repository bootstrap operations", () => {
  it("extends github_repository from 8 operations to 12", () => {
    expect(operationNames()).toEqual([
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

    expect(() =>
      validateInvocationArgs(
        {
          operation: "create",
          owner: "tomz",
          name: "mira-docs",
          visibility: "private",
        },
        extendedRepositorySchema,
      ),
    ).not.toThrow();
  });

  it("requires approval before repository or Pages writes", async () => {
    const { fetchImpl, tool } = createFixture();

    await expectApproval(
      tool.execute(
        createContext({
          operation: "create",
          owner: "tomz",
          name: "mira-docs",
          visibility: "private",
        }),
      ),
    );
    await expectApproval(
      tool.execute(
        createContext({
          operation: "configure_pages",
          repository: "dangjingtao/uichat-mira",
          mode: "workflow",
        }),
      ),
    );

    const writes = fetchImpl.mock.calls.filter(
      (call: [string | URL | Request, RequestInit?]) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(call[1]?.method ?? "GET"),
    );
    expect(writes).toHaveLength(0);
  });

  it("creates a repository and returns the read-back snapshot", async () => {
    const { fetchImpl, tool } = createFixture();
    const execution = await tool.execute(
      createContext(
        {
          operation: "create",
          owner: "tomz",
          name: "mira-docs",
          visibility: "private",
          autoInit: true,
        },
        true,
      ),
    );

    expect(execution.result).toMatchObject({
      operation: "create",
      id: 20,
      fullName: "tomz/mira-docs",
      defaultBranch: "main",
      visibility: "private",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/user/repos",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "mira-docs",
          private: true,
          auto_init: true,
        }),
      }),
    );
  });

  it("checks installation access without pretending it can always mutate scope", async () => {
    const { tool } = createFixture();

    const accessible = await tool.execute(
      createContext({
        operation: "ensure_installation_access",
        repository: "dangjingtao/uichat-mira",
      }),
    );
    expect(accessible.result).toMatchObject({
      operation: "ensure_installation_access",
      accessible: true,
      installationId: 55,
      resolution: "already_accessible",
    });

    const unscoped = await tool.execute(
      createContext({
        operation: "ensure_installation_access",
        repository: "tomz/unscoped",
      }),
    );
    expect(unscoped.result).toMatchObject({
      operation: "ensure_installation_access",
      accessible: false,
      resolution: "user_action_required",
      authorizationUrl: "https://github.com/settings/installations",
    });
  });

  it("normalizes disabled Pages and reads back configured workflow Pages", async () => {
    const { fetchImpl, tool } = createFixture();

    const disabled = await tool.execute(
      createContext({
        operation: "get_pages",
        repository: "dangjingtao/uichat-mira",
      }),
    );
    expect(disabled.result).toMatchObject({
      operation: "get_pages",
      enabled: false,
      url: null,
    });

    const configured = await tool.execute(
      createContext(
        {
          operation: "configure_pages",
          repository: "dangjingtao/uichat-mira",
          mode: "workflow",
          customDomain: "docs.example.com",
          enforceHttps: true,
        },
        true,
      ),
    );
    expect(configured.result).toMatchObject({
      operation: "configure_pages",
      enabled: true,
      buildType: "workflow",
      customDomain: "docs.example.com",
      httpsEnforced: true,
      url: "https://docs.example.com/",
    });

    const writes = fetchImpl.mock.calls.map(
      (call: [string | URL | Request, RequestInit?]) => ({
        path: new URL(String(call[0])).pathname,
        method: call[1]?.method ?? "GET",
        body: typeof call[1]?.body === "string" ? JSON.parse(call[1].body) : null,
      }),
    );
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/repos/dangjingtao/uichat-mira/pages",
          method: "POST",
          body: { build_type: "workflow" },
        }),
        expect.objectContaining({
          path: "/repos/dangjingtao/uichat-mira/pages",
          method: "PUT",
          body: { cname: "docs.example.com", https_enforced: true },
        }),
      ]),
    );
  });
});
