import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mcpRoutes from "./routes.js";
import {
  clearHarnessRegistry,
  getToolImplementation,
  registerTool,
} from "../harness/registry.js";
import { clearHarnessInvocations } from "../harness/invocations.js";
import { resetHarnessRuntime } from "./bootstrap.js";
import { clearWorkspaceSelection } from "./workspace.js";
import { clearExternalMcpServers } from "./external.js";
import { sendRouteError } from "@/utils/route-errors.js";
import { getLoggerConfig } from "@/logger";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { integrationCapabilitiesRepository } from "@/db/repositories/integration-capabilities.repository.js";
import { integrationInstancesRepository } from "@/db/repositories/integration-instances.repository.js";
import { wecomSettingsRepository } from "@/db/repositories/wecom-settings.repository.js";
import { resolveWecomConfig } from "@/integrations/wecom/config.js";
import {
  createTimestampedTestArtifactPath,
} from "@/test-support/artifacts.js";
import { createComputerUseBrowserTools } from "./tools/browser-tools.tool.js";
import {
  browserAttachedActTool,
  browserAttachedBrowseTool,
  browserAttachedLookTool,
  browserAttachedTransferTool,
} from "./tools/browser-attached.tool.js";

type StdioMockHandler = (request: {
  method?: string;
  params?: Record<string, unknown>;
}) => {
  result?: unknown;
  error?: { code?: number; message?: string };
} | null;

const stdioMockHandlers: StdioMockHandler[] = [];

const encodeStdioFrame = (payload: unknown) => {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
};

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((_command: string, _args: string[]) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
      const errorHandlers: Array<(error: Error) => void> = [];
      const handler = stdioMockHandlers.shift();
      let buffer = "";
      let killed = false;

      const processMock = {
        stdout,
        stderr,
        stdin,
        killed,
        kill: vi.fn(() => {
          killed = true;
          processMock.killed = true;
          for (const exitHandler of exitHandlers) {
            exitHandler(0, null);
          }
          return true;
        }),
        on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (event === "exit") {
            exitHandlers.push(callback as (code: number | null, signal: NodeJS.Signals | null) => void);
          }
          if (event === "error") {
            errorHandlers.push(callback as (error: Error) => void);
          }
          return processMock;
        }),
      };

      stdin.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) {
            return;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) {
            continue;
          }

          let request: { id?: string | number; method?: string; params?: Record<string, unknown> };
          try {
            request = JSON.parse(line) as {
              id?: string | number;
              method?: string;
              params?: Record<string, unknown>;
            };
          } catch (error) {
            for (const errorHandler of errorHandlers) {
              errorHandler(error instanceof Error ? error : new Error(String(error)));
            }
            return;
          }

          const response = handler?.({
            method: request.method,
            params: request.params,
          });
          if (request.id !== undefined && response) {
            stdout.write(
              encodeStdioFrame({
                jsonrpc: "2.0",
                id: request.id,
                ...(response.error ? { error: response.error } : { result: response.result }),
              }),
            );
          }
        }
      });

      return processMock;
    }),
  };
});

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-mcp-routes");
const tempDatabasePath = createTimestampedTestArtifactPath("db", "rag-demo-mcp-routes", ".sqlite");

describe("mcp routes", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    process.env.DATABASE_URL = `file:${tempDatabasePath}`;
    clearHarnessRegistry();
    clearHarnessInvocations();
    resetHarnessRuntime();
    clearWorkspaceSelection();
    clearExternalMcpServers();
    vi.unstubAllGlobals();
    stdioMockHandlers.length = 0;
    initializeModelConfigDatabase();
    initializeKnowledgeBaseDatabase();
    wecomSettingsRepository.initialize();
    integrationInstancesRepository.initialize();
    integrationCapabilitiesRepository.initialize();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.DATABASE_URL;
    delete process.env.UI_CHAT_DATABASE_DIR;
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
    vi.unstubAllGlobals();
    stdioMockHandlers.length = 0;
  });

  it("lists tools/resources and streams invocation events", async () => {
    fs.writeFileSync(path.join(tempRoot, "a.txt"), "hello");
    createComputerUseBrowserTools({
      observe: async () => ({ ok: true }),
      act: async () => ({ ok: true }),
      assert: async () => ({ ok: true }),
    } as never).forEach(registerTool);
    [
      browserAttachedLookTool,
      browserAttachedBrowseTool,
      browserAttachedActTool,
      browserAttachedTransferTool,
    ].forEach(registerTool);

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const workspaceResponse = await app.inject({
      method: "GET",
      url: "/mcp/workspace",
    });
    expect(workspaceResponse.statusCode).toBe(200);
    expect((workspaceResponse.json() as { data: { rootPath: string } }).data.rootPath).toBe(
      tempRoot,
    );

    const toolsResponse = await app.inject({
      method: "GET",
      url: "/mcp/tools",
    });
    expect(toolsResponse.statusCode).toBe(200);
    const toolIds = (toolsResponse.json() as { data: Array<{ id: string }> }).data.map(
      (tool) => tool.id,
    );
    expect(toolIds).toEqual(
      expect.arrayContaining(["read", "list", "glob", "grep"]),
    );
    expect(toolIds).not.toEqual(
      expect.arrayContaining([
        "read_discover",
        "read_open",
        "read_list",
        "read_locate",
        "read_extract",
        "read_slice",
      ]),
    );
    const readTool = (toolsResponse.json() as {
      data: Array<{
        id: string;
        domain: string;
        workbench?: {
          groupId: string;
          groupLabel: string;
          groupDescription: string;
          groupOrder: number;
          icon: string;
          defaultArgs?: Record<string, unknown>;
        };
      }>;
    }).data.find((tool) => tool.id === "read");
    expect(readTool?.workbench).toMatchObject({
      groupId: "read",
      groupLabel: "阅读",
      groupOrder: 10,
      icon: "file-search",
    });

    const browserTools = (toolsResponse.json() as {
      data: Array<{
        id: string;
        domain: string;
        workbench?: { groupId: string };
      }>;
    }).data.filter((tool) => tool.domain === "browser_action");
    expect(
      browserTools
        .filter((tool) => tool.workbench?.groupId === "browser_computer_use")
        .map((tool) => tool.id)
        .sort(),
    ).toEqual(
      ["browser_act", "browser_assert", "browser_observe"],
    );
    expect(
      browserTools
        .filter((tool) => tool.workbench?.groupId === "browser_attached")
        .map((tool) => tool.id)
        .sort(),
    ).toEqual(
      [
        "browser_attached_act",
        "browser_attached_browse",
        "browser_attached_look",
        "browser_attached_transfer",
      ],
    );

    const resourceReadResponse = await app.inject({
      method: "POST",
      url: "/mcp/resources/workspace/read",
      payload: {
        path: "a.txt",
      },
    });
    expect(resourceReadResponse.statusCode).toBe(200);

    const streamResponse = await app.inject({
      method: "POST",
      url: "/mcp/invocations/stream",
      payload: {
        toolId: "edit_file",
        args: {
          path: "a.txt",
          operation: "replace_block",
          expectedOldText: "hello",
          newText: "world",
        },
      },
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.body).toContain("invocation:start");
    expect(streamResponse.body).toContain("invocation:approval_required");
    expect(streamResponse.body).toContain('"status":"awaiting_approval"');

    const streamEvents = streamResponse.body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; invocationId?: string });
    const editInvocationId = streamEvents.find(
      (event) => event.type === "invocation:start",
    )?.invocationId;
    expect(editInvocationId).toBeTruthy();

    const invalidApprovalResponse = await app.inject({
      method: "POST",
      url: `/mcp/invocations/${editInvocationId}/approval`,
      payload: {
        decision: "reject",
        toolId: "edit_file",
        args: {
          path: "a.txt",
          operation: "replace_block",
          expectedOldText: "hello",
          newText: "world",
        },
      },
    });
    expect(invalidApprovalResponse.statusCode).toBe(400);
    expect(fs.readFileSync(path.join(tempRoot, "a.txt"), "utf8")).toBe("hello");

    const approvedResponse = await app.inject({
      method: "POST",
      url: `/mcp/invocations/${editInvocationId}/approval`,
      payload: {
        decision: "approved",
        toolId: "edit_file",
        args: {
          path: "a.txt",
          operation: "replace_block",
          expectedOldText: "hello",
          newText: "world",
        },
      },
    });
    expect(approvedResponse.statusCode).toBe(200);
    expect(
      (
        approvedResponse.json() as {
          data: {
            originalInvocation: { status: string };
            resumedInvocation: { status: string } | null;
          };
        }
      ).data,
    ).toMatchObject({
      originalInvocation: { status: "completed" },
      resumedInvocation: { status: "completed" },
    });
    expect(fs.readFileSync(path.join(tempRoot, "a.txt"), "utf8")).toBe("world");

    const rejectedStreamResponse = await app.inject({
      method: "POST",
      url: "/mcp/invocations/stream",
      payload: {
        toolId: "edit_file",
        args: {
          path: "a.txt",
          operation: "replace_block",
          expectedOldText: "world",
          newText: "rejected-change",
        },
      },
    });
    const rejectedEvents = rejectedStreamResponse.body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; invocationId?: string });
    const rejectedInvocationId = rejectedEvents.find(
      (event) => event.type === "invocation:start",
    )?.invocationId;
    expect(rejectedInvocationId).toBeTruthy();

    const rejectedResponse = await app.inject({
      method: "POST",
      url: `/mcp/invocations/${rejectedInvocationId}/approval`,
      payload: {
        decision: "rejected",
        toolId: "edit_file",
        args: {
          path: "a.txt",
          operation: "replace_block",
          expectedOldText: "world",
          newText: "rejected-change",
        },
      },
    });
    expect(rejectedResponse.statusCode).toBe(200);
    expect(
      (
        rejectedResponse.json() as {
          data: {
            originalInvocation: { status: string };
            resumedInvocation: null;
          };
        }
      ).data,
    ).toMatchObject({
      originalInvocation: { status: "cancelled" },
      resumedInvocation: null,
    });
    expect(fs.readFileSync(path.join(tempRoot, "a.txt"), "utf8")).toBe("world");

    const globResponse = await app.inject({
      method: "POST",
      url: "/mcp/invocations",
      payload: {
        toolId: "glob",
        args: {
          pattern: "*a*",
          path: ".",
        },
      },
    });
    expect(globResponse.statusCode).toBe(200);

    const globInvocationId = (
      globResponse.json() as { data: { id: string } }
    ).data.id;
      const traceResponse = await app.inject({
        method: "GET",
        url: `/mcp/invocations/${globInvocationId}/trace`,
      });
      expect(traceResponse.statusCode).toBe(200);
      expect((traceResponse.json() as {
        data: {
          invocationId: string;
          spans: unknown[];
          debugView?: {
            invocationId: string;
            spanCount: number;
          };
        };
      }).data)
        .toMatchObject({
          invocationId: globInvocationId,
          debugView: {
            invocationId: globInvocationId,
          },
        });

    await app.close();
  }, 15_000);

  it("resets Tool Lab fixtures and freezes the managed workspace across approval replay", async () => {
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    const appDataRoot = path.join(tempRoot, "tool-lab-app-data");
    process.env.UI_CHAT_DATABASE_DIR = appDataRoot;

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const managedWorkspaceResponse = await app.inject({
      method: "GET",
      url: "/mcp/tool-lab/workspace/managed",
    });
    expect(managedWorkspaceResponse.statusCode).toBe(200);
    expect(
      (
        managedWorkspaceResponse.json() as {
          data: { rootPath: string; source: string };
        }
      ).data.source,
    ).toBe("managed");

    const resetResponse = await app.inject({
      method: "POST",
      url: "/mcp/tool-lab/fixtures/platform-read-success/reset",
    });
    expect(resetResponse.statusCode).toBe(200);
    const resetData = (
      resetResponse.json() as {
        data: {
          fixtureId: string;
          workspace: { rootPath: string; source: string };
          fixtureRoot: string;
        };
      }
    ).data;
    expect(resetData.fixtureId).toBe("platform-read-success");
    expect(resetData.workspace.source).toBe("managed");
    expect(fs.statSync(resetData.workspace.rootPath).isDirectory()).toBe(true);

    const fixturePath = ".tool-lab-fixtures/platform-read-success/input.txt";
    const readResponse = await app.inject({
      method: "POST",
      url: "/mcp/invocations",
      payload: {
        toolId: "read",
        args: { path: fixturePath },
        workspaceContext: "tool_lab_managed",
      },
    });
    expect(readResponse.statusCode).toBe(200);
    expect(
      (readResponse.json() as { data: { status: string } }).data.status,
    ).toBe("completed");

    const missingResetResponse = await app.inject({
      method: "POST",
      url: "/mcp/tool-lab/fixtures/platform-read-missing/reset",
    });
    expect(missingResetResponse.statusCode).toBe(200);

    const missingReadResponse = await app.inject({
      method: "POST",
      url: "/mcp/invocations",
      payload: {
        toolId: "read",
        args: {
          path: ".tool-lab-fixtures/platform-read-missing/missing.txt",
        },
        workspaceContext: "tool_lab_managed",
      },
    });
    expect(missingReadResponse.statusCode).toBe(200);
    expect(
      (missingReadResponse.json() as {
        data: {
          status: string;
          error?: { message?: string; failureCode?: string };
        };
      }).data,
    ).toMatchObject({
      status: "failed",
      error: {
        message: expect.any(String),
        failureCode: expect.any(String),
      },
    });

    const approvalStream = await app.inject({
      method: "POST",
      url: "/mcp/invocations/stream",
      payload: {
        toolId: "edit_file",
        args: {
          path: fixturePath,
          operation: "replace_block",
          expectedOldText: "Mira Tool Lab deterministic read fixture.",
          newText: "Mira Tool Lab deterministic read fixture approved.",
        },
        workspaceContext: "tool_lab_managed",
      },
    });
    expect(approvalStream.body).toContain("invocation:approval_required");

    const approvalEvents = approvalStream.body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; invocationId?: string });
    const approvalInvocationId = approvalEvents.find(
      (event) => event.type === "invocation:start",
    )?.invocationId;
    expect(approvalInvocationId).toBeTruthy();

    const otherRoot = path.join(tempRoot, "other-workspace");
    fs.mkdirSync(otherRoot, { recursive: true });
    const selectResponse = await app.inject({
      method: "POST",
      url: "/mcp/workspace/select",
      payload: { rootPath: otherRoot },
    });
    expect(selectResponse.statusCode).toBe(200);

    const approvalResponse = await app.inject({
      method: "POST",
      url: `/mcp/invocations/${approvalInvocationId}/approval`,
      payload: {
        decision: "approved",
        toolId: "edit_file",
        args: {
          path: fixturePath,
          operation: "replace_block",
          expectedOldText: "Mira Tool Lab deterministic read fixture.",
          newText: "Mira Tool Lab deterministic read fixture approved.",
        },
      },
    });
    expect(approvalResponse.statusCode).toBe(200);
    expect(
      fs.readFileSync(path.join(resetData.workspace.rootPath, fixturePath), "utf8"),
    ).toContain("Mira Tool Lab deterministic read fixture approved.");
    expect(fs.readdirSync(otherRoot)).toEqual([]);

    const secondReset = await app.inject({
      method: "POST",
      url: "/mcp/tool-lab/fixtures/platform-read-success/reset",
    });
    expect(secondReset.statusCode).toBe(200);
    expect(
      fs.readFileSync(path.join(resetData.workspace.rootPath, fixturePath), "utf8"),
    ).toContain("This file is reset before every case run.");

    const unknownFixture = await app.inject({
      method: "POST",
      url: "/mcp/tool-lab/fixtures/not-registered/reset",
    });
    expect(unknownFixture.statusCode).toBe(400);

    await app.close();
  });

  it("allows selecting workspace root explicitly", async () => {
    const manualRoot = path.join(tempRoot, "manual-root");
    fs.mkdirSync(manualRoot, { recursive: true });

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const selectResponse = await app.inject({
      method: "POST",
      url: "/mcp/workspace/select",
      payload: {
        rootPath: manualRoot,
      },
    });

    expect(selectResponse.statusCode).toBe(200);
    expect((selectResponse.json() as { data: { rootPath: string; source: string } }).data).toMatchObject({
      rootPath: manualRoot,
      source: "selected",
    });

    await app.close();
  });

  it("persists web search config through mcp routes", async () => {
    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const initialResponse = await app.inject({
      method: "GET",
      url: "/mcp/web-search/config",
    });
    expect(initialResponse.statusCode).toBe(200);
    expect((initialResponse.json() as { data: { apiKey: string; baseUrl: string; maxResults: number } }).data).toEqual({
      apiKey: "",
      baseUrl: "",
      maxResults: 4,
    });

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/mcp/web-search/config",
      payload: {
        apiKey: "tavily-key",
        baseUrl: "http://localhost:8080/",
      },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect((saveResponse.json() as { data: { apiKey: string; baseUrl: string; maxResults: number } }).data).toEqual({
      apiKey: "tavily-key",
      baseUrl: "http://localhost:8080",
      maxResults: 4,
    });

    const reloadedResponse = await app.inject({
      method: "GET",
      url: "/mcp/web-search/config",
    });
    expect(reloadedResponse.statusCode).toBe(200);
    expect((reloadedResponse.json() as { data: { apiKey: string; baseUrl: string; maxResults: number } }).data).toEqual({
      apiKey: "tavily-key",
      baseUrl: "http://localhost:8080",
      maxResults: 4,
    });

    await app.close();
  });

  it("persists WeCom config through instance and capability resources", async () => {
    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const initialResponse = await app.inject({
      method: "GET",
      url: "/mcp/wecom/config",
    });
    expect(initialResponse.statusCode).toBe(200);

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/mcp/wecom/config",
      payload: {
        corpId: "ww-demo",
        agentId: "1000001",
        appSecret: "app-secret",
        contactsSecret: "contacts-secret",
        robotWebhookUrl:
          "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
        robotWebhookSecret: "webhook-secret",
        smartRobotBotId: "bot-123",
        smartRobotSecret: "bot-secret",
        smartRobotKnowledgeBaseId: "default",
        smartRobotReplyMode: "send",
      },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(
      (saveResponse.json() as {
        data: {
          corpId: string;
          robotWebhookUrl: string;
          smartRobotBotId: string;
          smartRobotReplyMode: string;
        };
      }).data,
    ).toMatchObject({
      corpId: "ww-demo",
      robotWebhookUrl:
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
      smartRobotBotId: "bot-123",
      smartRobotReplyMode: "send",
    });

    const resolved = resolveWecomConfig();
    expect(resolved).toMatchObject({
      corpId: "ww-demo",
      agentId: "1000001",
      appSecret: "app-secret",
      contactsSecret: "contacts-secret",
      robotWebhookUrl:
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
      robotWebhookSecret: "webhook-secret",
      smartRobotBotId: "bot-123",
      smartRobotSecret: "bot-secret",
      smartRobotKnowledgeBaseId: "default",
      smartRobotReplyMode: "send",
    });

    const defaultInstance = integrationInstancesRepository.getDefault("wecom");
    expect(defaultInstance).toBeTruthy();
    expect(defaultInstance).toMatchObject({
      externalTenantId: "ww-demo",
      config: {
        corpId: "ww-demo",
        agentId: "1000001",
        appSecret: "app-secret",
        contactsSecret: "contacts-secret",
      },
    });

    const capabilities = integrationCapabilitiesRepository.listByInstance(
      defaultInstance!.id,
    );
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "wecom.webhook_robot",
          config: {
            webhookUrl:
              "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
            webhookSecret: "webhook-secret",
          },
        }),
        expect.objectContaining({
          type: "wecom.smart_robot",
          knowledgeBaseId: "default",
          config: {
            botId: "bot-123",
            secret: "bot-secret",
            replyMode: "send",
          },
        }),
      ]),
    );

    await app.close();
  });

  it("lists marketplace MCP servers through the registry adapter", async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => {
      seenUrls.push(String(url));
      return new Response(
        JSON.stringify({
          servers: [
            {
              server: {
                name: "example.com/search",
                title: "Example Search",
                description: "Search remote data",
                version: "1.0.0",
                remotes: [
                  {
                    type: "streamable-http",
                    url: "https://example.com/mcp",
                  },
                ],
              },
              _meta: {
                "io.modelcontextprotocol.registry/official": {
                  status: "active",
                  isLatest: true,
                },
              },
            },
          ],
          metadata: {
            count: 1,
          },
        }),
        { status: 200 },
      );
    });

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/mcp/marketplace/servers?limit=5&query=search",
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() =>
      expect(seenUrls).toEqual([
        "https://registry.modelcontextprotocol.io/v0.1/servers?limit=100&search=search&version=latest",
        "https://registry.modelcontextprotocol.io/v0.1/servers?limit=100&version=latest",
      ]),
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        servers: [],
        metadata: {
          count: 0,
          cache: { hit: true },
          sync: { status: "syncing" },
        },
      },
    });

    await app.close();
  });

  it("creates, connects, discovers, and invokes an external MCP capability", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://registry.modelcontextprotocol.io/")) {
        return new Response(
          JSON.stringify({
            servers: [],
            metadata: {
              count: 0,
              nextCursor: null,
            },
          }),
          { status: 200 },
        );
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        params?: Record<string, unknown>;
      };

      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "init-1",
            result: {
              protocolVersion: "2025-06-18",
              serverInfo: {
                name: "demo-remote",
                title: "Demo Remote",
                version: "1.0.0",
              },
              capabilities: {
                tools: {},
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "session-demo-1",
              "mcp-protocol-version": "2025-06-18",
            },
          },
        );
      }

      if (body.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }

      if (body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "list-1",
            result: {
              tools: [
                {
                  name: "search_docs",
                  title: "Search Docs",
                  description: "Search external docs",
                  inputSchema: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                    required: ["query"],
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "session-demo-1",
            },
          },
        );
      }

      if (body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "call-1",
            result: {
              content: [
                {
                  type: "text",
                  text: `remote:${String(body.params?.name)}:${String((body.params?.arguments as Record<string, unknown>)?.query)}`,
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "session-demo-1",
            },
          },
        );
      }

      throw new Error(`Unexpected fetch call: ${url} ${body.method ?? "unknown"}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const rejectedCreate = await app.inject({
      method: "POST",
      url: "/mcp/external/servers",
      payload: {
        displayName: "Remote Docs",
        transport: {
          kind: "streamable-http",
          url: "https://remote.example/mcp",
        },
        disclaimerAccepted: false,
      },
    });
    expect(rejectedCreate.statusCode).toBe(400);

    const createResponse = await app.inject({
      method: "POST",
      url: "/mcp/external/servers",
      payload: {
        displayName: "Remote Docs",
        description: "Third-party docs capability",
        transport: {
          kind: "streamable-http",
          url: "https://remote.example/mcp",
        },
        disclaimerAccepted: true,
      },
    });
    expect(createResponse.statusCode).toBe(200);
    const createdServer = (createResponse.json() as { data: { id: string; status: string } }).data;
    expect(createdServer.id).toBe("remote-docs");
    expect(createdServer.status).toBe("configured");

    const agentAccessEnabledResponse = await app.inject({
      method: "PATCH",
      url: `/mcp/external/servers/${createdServer.id}/access`,
      payload: { agentEnabled: true },
    });
    expect(agentAccessEnabledResponse.statusCode).toBe(200);
    expect((agentAccessEnabledResponse.json() as { data: { agentEnabled: boolean } }).data.agentEnabled).toBe(true);

    const agentAccessRevokedResponse = await app.inject({
      method: "PATCH",
      url: `/mcp/external/servers/${createdServer.id}/access`,
      payload: { agentEnabled: false },
    });
    expect(agentAccessRevokedResponse.statusCode).toBe(200);
    expect((agentAccessRevokedResponse.json() as { data: { agentEnabled: boolean } }).data.agentEnabled).toBe(false);

    const invalidAgentAccessResponse = await app.inject({
      method: "PATCH",
      url: `/mcp/external/servers/${createdServer.id}/access`,
      payload: {},
    });
    expect(invalidAgentAccessResponse.statusCode).toBe(400);

    const invalidEnabledResponse = await app.inject({
      method: "PATCH",
      url: `/mcp/external/servers/${createdServer.id}/enabled`,
      payload: { enabled: "yes" },
    });
    expect(invalidEnabledResponse.statusCode).toBe(400);

    const connectResponse = await app.inject({
      method: "POST",
      url: `/mcp/external/servers/${createdServer.id}/connect`,
    });
    expect(connectResponse.statusCode).toBe(200);
    expect((connectResponse.json() as { data: { status: string; sessionId: string } }).data).toMatchObject({
      status: "connected",
      sessionId: "session-demo-1",
    });
    expect((connectResponse.json() as {
      data: {
        protocolVersion: string;
        remoteServerInfo: { name: string; title: string; version: string };
        remoteCapabilities: { hasTools: boolean; hasResources: boolean; hasPrompts: boolean };
      };
    }).data).toMatchObject({
      protocolVersion: "2025-06-18",
      remoteServerInfo: {
        name: "demo-remote",
        title: "Demo Remote",
        version: "1.0.0",
      },
      remoteCapabilities: {
        hasTools: true,
        hasResources: false,
        hasPrompts: false,
      },
    });

    const discoverResponse = await app.inject({
      method: "POST",
      url: `/mcp/external/servers/${createdServer.id}/discover`,
    });
    expect(discoverResponse.statusCode).toBe(200);
    expect(
      (discoverResponse.json() as { data: { discoveredTools: Array<{ projectedCapabilityId: string }> } }).data
        .discoveredTools,
    ).toMatchObject([
      {
        projectedCapabilityId: "mcp:remote-docs:tool:search_docs",
      },
    ]);

    const externalServerListResponse = await app.inject({
      method: "GET",
      url: "/mcp/external/servers",
    });
    expect(externalServerListResponse.statusCode).toBe(200);
    expect(
      (externalServerListResponse.json() as {
        data: Array<{
          discoveredTools: Array<{ projectedCapabilityId: string }>;
        }>;
      }).data[0]?.discoveredTools,
    ).toMatchObject([{ projectedCapabilityId: "mcp:remote-docs:tool:search_docs" }]);

    const toolsResponse = await app.inject({
      method: "GET",
      url: "/mcp/tools",
    });
    expect(toolsResponse.statusCode).toBe(200);
    expect(
      (toolsResponse.json() as { data: Array<{ id: string }> }).data.some(
        (tool) => tool.id === "mcp:remote-docs:tool:search_docs",
      ),
    ).toBe(false);

    const internalToolDefinitions = (toolsResponse.json() as {
      data: Array<{ id: string; source: "internal" | "external"; domain: string }>;
    }).data;
    expect(internalToolDefinitions.every((tool) => tool.source === "internal")).toBe(true);

    const projectedToolImplementation = getToolImplementation("mcp:remote-docs:tool:search_docs");
    expect(projectedToolImplementation?.definition).toMatchObject({
      id: "mcp:remote-docs:tool:search_docs",
      source: "external",
      domain: "external_mcp",
    });

    const invocationResponse = await app.inject({
      method: "POST",
      url: "/mcp/invocations",
      payload: {
        toolId: "mcp:remote-docs:tool:search_docs",
        args: {
          query: "pricing",
        },
      },
    });
    expect(invocationResponse.statusCode).toBe(200);
    expect((invocationResponse.json() as {
      data: {
        status: string;
        result?: { content: Array<{ text: string }> };
        approval?: { required: boolean; scope?: string };
      };
    }).data).toMatchObject({
      status: "awaiting_approval",
      approval: {
        required: true,
        scope: "external_mcp",
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/mcp/external/servers",
    });
    expect(listResponse.statusCode).toBe(200);
    expect((listResponse.json() as { data: Array<{ id: string; discoveredTools: unknown[] }> }).data).toHaveLength(1);
    expect(
      (listResponse.json() as {
        data: Array<{
          id: string;
          remoteServerInfo?: { name: string };
          remoteCapabilities?: { hasTools: boolean };
        }>;
      }).data[0],
    ).toMatchObject({
      id: "remote-docs",
      remoteServerInfo: {
        name: "demo-remote",
      },
      remoteCapabilities: {
        hasTools: true,
      },
    });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/mcp/external/servers/${createdServer.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect((detailResponse.json() as {
      data: {
        id: string;
        transport: { kind: string; url: string };
        disclaimerAcceptedAt?: string;
        disclaimerTextHash?: string;
        remoteServerInfo?: { name: string; title: string; version: string };
        remoteCapabilities?: { hasTools: boolean; hasResources: boolean; hasPrompts: boolean };
        discoveredTools: Array<{ projectedCapabilityId: string }>;
      };
    }).data).toMatchObject({
      id: "remote-docs",
      transport: {
        kind: "streamable-http",
        url: "https://remote.example/mcp",
      },
      disclaimerTextHash: "external-mcp-disclaimer-v1",
      remoteServerInfo: {
        name: "demo-remote",
        title: "Demo Remote",
        version: "1.0.0",
      },
      remoteCapabilities: {
        hasTools: true,
        hasResources: false,
        hasPrompts: false,
      },
      discoveredTools: [{ projectedCapabilityId: "mcp:remote-docs:tool:search_docs" }],
    });
    expect(
      (detailResponse.json() as { data: { disclaimerAcceptedAt?: string } }).data.disclaimerAcceptedAt,
    ).toEqual(expect.any(String));

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/mcp/external/servers/${createdServer.id}`,
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect((deleteResponse.json() as { data: { id: string } }).data.id).toBe("remote-docs");

    const listAfterDeleteResponse = await app.inject({
      method: "GET",
      url: "/mcp/external/servers",
    });
    expect(listAfterDeleteResponse.statusCode).toBe(200);
    expect((listAfterDeleteResponse.json() as { data: Array<unknown> }).data).toHaveLength(0);

    await app.close();
  });

  it("updates external MCP config and injects auth, headers, and endpoint into connect", async () => {
    const remoteCalls: Array<{
      url: string;
      method?: string;
      headers: Headers;
      body: {
        method?: string;
        params?: Record<string, unknown>;
      };
    }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith("https://registry.modelcontextprotocol.io/")) {
        return new Response(
          JSON.stringify({
            servers: [],
            metadata: {
              count: 0,
              nextCursor: null,
            },
          }),
          { status: 200 },
        );
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      remoteCalls.push({
        url,
        method: init?.method,
        headers: new Headers(init?.headers),
        body,
      });

      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "init-1",
            result: {
              protocolVersion: "2025-06-18",
              serverInfo: {
                name: "demo-remote",
                title: "Demo Remote",
                version: "1.0.0",
              },
              capabilities: {
                tools: {},
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "session-demo-2",
              "mcp-protocol-version": "2025-06-18",
            },
          },
        );
      }

      if (body.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }

      throw new Error(`Unexpected fetch call: ${url} ${body.method ?? "unknown"}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const createResponse = await app.inject({
      method: "POST",
      url: "/mcp/external/servers",
      payload: {
        displayName: "Secure Remote",
        documentationUrl: "https://docs.example.dev/mcp",
        repositoryUrl: "https://github.com/example/secure-remote",
        transport: {
          kind: "streamable-http",
          url: "https://remote.example/mcp",
        },
        disclaimerAccepted: true,
      },
    });
    expect(createResponse.statusCode).toBe(200);
    const createdServer = (createResponse.json() as {
      data: { id: string; documentationUrl?: string; repositoryUrl?: string };
    }).data;
    expect(createdServer).toMatchObject({
      documentationUrl: "https://docs.example.dev/mcp",
      repositoryUrl: "https://github.com/example/secure-remote",
    });

    const schemaResponse = await app.inject({
      method: "GET",
      url: `/mcp/external/servers/${createdServer.id}/config-schema`,
    });
    expect(schemaResponse.statusCode).toBe(200);
    expect((schemaResponse.json() as { data: { completeness: string; fields: Array<{ key: string }> } }).data)
      .toMatchObject({
        completeness: "known-partial",
        fields: [
          { key: "endpointUrl" },
          { key: "bearerToken" },
          { key: "customHeadersJson" },
          { key: "timeoutMs" },
        ],
      });

    const initialConfigResponse = await app.inject({
      method: "GET",
      url: `/mcp/external/servers/${createdServer.id}/config`,
    });
    expect(initialConfigResponse.statusCode).toBe(200);
    expect((initialConfigResponse.json() as { data: { endpointUrl: string; authType: string; hasBearerToken: boolean } }).data)
      .toMatchObject({
        endpointUrl: "https://remote.example/mcp",
        authType: "none",
        hasBearerToken: false,
      });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/mcp/external/servers/${createdServer.id}/config`,
      payload: {
        endpointUrl: "https://secure.example/mcp",
        authType: "bearer",
        timeoutMs: 45000,
        customHeadersJson: '{\n  "X-Org-Id": "demo-org"\n}',
        bearerToken: "secret-token",
      },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect((patchResponse.json() as { data: { endpointUrl: string; authType: string; timeoutMs: number; customHeadersJson: string; hasBearerToken: boolean } }).data)
      .toMatchObject({
        endpointUrl: "https://secure.example/mcp",
        authType: "bearer",
        timeoutMs: 45000,
        customHeadersJson: '{\n  "X-Org-Id": "demo-org"\n}',
        hasBearerToken: true,
      });

    const connectResponse = await app.inject({
      method: "POST",
      url: `/mcp/external/servers/${createdServer.id}/connect`,
    });
    expect(connectResponse.statusCode).toBe(200);

    expect(remoteCalls).toHaveLength(2);
    expect(remoteCalls[0]).toMatchObject({
      url: "https://secure.example/mcp",
      method: "POST",
      body: {
        method: "initialize",
      },
    });
    expect(remoteCalls[0].headers.get("authorization")).toBe("Bearer secret-token");
    expect(remoteCalls[0].headers.get("x-org-id")).toBe("demo-org");
    expect(remoteCalls[0].headers.get("mcp-protocol-version")).toBe("2025-06-18");

    expect(remoteCalls[1]).toMatchObject({
      url: "https://secure.example/mcp",
      method: "POST",
      body: {
        method: "notifications/initialized",
      },
    });
    expect(remoteCalls[1].headers.get("authorization")).toBe("Bearer secret-token");
    expect(remoteCalls[1].headers.get("x-org-id")).toBe("demo-org");
    expect(remoteCalls[1].headers.get("mcp-session-id")).toBe("session-demo-2");

    await app.close();
  });

  it("updates stdio server config with command and args", async () => {
    stdioMockHandlers.push(({ method, params }) => {
      if (method === "initialize") {
        return {
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: {
              name: "demo-stdio",
              title: "Demo Stdio",
              version: "0.2.0",
            },
            capabilities: {
              tools: {},
            },
          },
        };
      }

      if (method === "tools/list") {
        return {
          result: {
            tools: [],
          },
        };
      }

      return null;
    });

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const createResponse = await app.inject({
      method: "POST",
      url: "/mcp/external/servers",
      payload: {
        displayName: "Local Docs",
        packageName: "@demo/local-docs-mcp",
        transport: {
          kind: "stdio",
          command: "npx",
          args: ["-y", "@demo/local-docs-mcp"],
        },
        disclaimerAccepted: true,
        disclaimerTextHash: "external-mcp-disclaimer-v1",
      },
    });
    expect(createResponse.statusCode).toBe(200);
    const createdServer = (createResponse.json() as { data: { id: string } }).data;

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/mcp/external/servers/${createdServer.id}/config`,
      payload: {
        command: "uvx",
        argsText: '["mcparmory-github"]',
        authType: "none",
        timeoutMs: 30000,
        customHeadersJson: "",
        bearerToken: null,
      },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect((patchResponse.json() as { data: { command: string; argsText: string } }).data).toMatchObject(
      {
        command: "uvx",
        argsText: '[\n  "mcparmory-github"\n]',
      },
    );

    const configResponse = await app.inject({
      method: "GET",
      url: `/mcp/external/servers/${createdServer.id}/config`,
    });
    expect(configResponse.statusCode).toBe(200);
    expect((configResponse.json() as { data: { packageName?: string } }).data.packageName).toBe(
      "@demo/local-docs-mcp",
    );

    await app.close();
  });

  it(
    "creates, connects, discovers, and invokes a stdio external MCP capability",
    async () => {
    stdioMockHandlers.push(({ method, params }) => {
      if (method === "initialize") {
        return {
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: {
              name: "demo-stdio",
              title: "Demo Stdio",
              version: "0.2.0",
            },
            capabilities: {
              tools: {},
            },
          },
        };
      }

      if (method === "tools/list") {
        return {
          result: {
            tools: [
              {
                name: "read_local_docs",
                title: "Read Local Docs",
                description: "Read from local stdio MCP",
                inputSchema: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                  },
                  required: ["path"],
                },
              },
            ],
          },
        };
      }

      if (method === "tools/call") {
        return {
          result: {
            content: [
              {
                type: "text",
                text: `stdio:${String(params?.name)}:${String((params?.arguments as Record<string, unknown>)?.path)}`,
              },
            ],
          },
        };
      }

      return null;
    });

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const createResponse = await app.inject({
      method: "POST",
      url: "/mcp/external/servers",
      payload: {
        displayName: "Local Docs",
        transport: {
          kind: "stdio",
          command: "npx",
          args: ["-y", "@demo/local-docs-mcp"],
        },
        disclaimerAccepted: true,
      },
    });
    expect(createResponse.statusCode).toBe(200);
    expect((createResponse.json() as { data: { transport: { kind: string; command: string } } }).data)
      .toMatchObject({
        transport: {
          kind: "stdio",
          command: "npx",
        },
      });

    const createdServer = (createResponse.json() as { data: { id: string } }).data;

    const configSchemaResponse = await app.inject({
      method: "GET",
      url: `/mcp/external/servers/${createdServer.id}/config-schema`,
    });
    expect(configSchemaResponse.statusCode).toBe(200);
    expect(
      (configSchemaResponse.json() as { data: { fields: Array<{ key: string }> } }).data.fields.map(
        (field) => field.key,
      ),
    ).toEqual(expect.arrayContaining(["command", "argsText", "cwd", "envJson", "timeoutMs"]));

    const connectResponse = await app.inject({
      method: "POST",
      url: `/mcp/external/servers/${createdServer.id}/connect`,
    });
    expect(connectResponse.statusCode).toBe(200);
    expect((connectResponse.json() as { data: { status: string; sessionId: string } }).data).toMatchObject({
      status: "connected",
      sessionId: "stdio:local-docs",
    });

    const discoverResponse = await app.inject({
      method: "POST",
      url: `/mcp/external/servers/${createdServer.id}/discover`,
    });
    expect(discoverResponse.statusCode).toBe(200);
    expect(
      (discoverResponse.json() as { data: { discoveredTools: Array<{ projectedCapabilityId: string }> } }).data
        .discoveredTools,
    ).toMatchObject([{ projectedCapabilityId: "mcp:local-docs:tool:read_local_docs" }]);

    expect(getToolImplementation("mcp:local-docs:tool:read_local_docs")?.definition).toMatchObject({
      id: "mcp:local-docs:tool:read_local_docs",
      domain: "external_mcp",
      source: "external",
      tags: expect.arrayContaining(["mcp", "external", "local-docs"]),
      capabilities: {
        sideEffect: "network",
        requiresApproval: true,
        networkAccess: true,
        longRunning: true,
      },
    });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/mcp/external/servers/${createdServer.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect((detailResponse.json() as {
      data: {
        id: string;
        transport: { kind: string; command: string; args: string[] };
        sessionId?: string;
        protocolVersion?: string;
        disclaimerTextHash?: string;
        discoveredTools: Array<{ projectedCapabilityId: string }>;
      };
    }).data).toMatchObject({
      id: "local-docs",
      transport: {
        kind: "stdio",
        command: "npx",
        args: ["-y", "@demo/local-docs-mcp"],
      },
      sessionId: "stdio:local-docs",
      protocolVersion: "2025-06-18",
      disclaimerTextHash: "external-mcp-disclaimer-v1",
      discoveredTools: [{ projectedCapabilityId: "mcp:local-docs:tool:read_local_docs" }],
    });

    const invocationResponse = await app.inject({
      method: "POST",
      url: "/mcp/invocations",
      payload: {
        toolId: "mcp:local-docs:tool:read_local_docs",
        args: {
          path: "README.md",
        },
      },
    });
    expect(invocationResponse.statusCode).toBe(200);
    expect((invocationResponse.json() as {
      data: {
        status: string;
        result?: { content: Array<{ text: string }> };
        approval?: { required: boolean; scope?: string };
      };
    }).data).toMatchObject({
      status: "awaiting_approval",
      approval: {
        required: true,
        scope: "external_mcp",
      },
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/mcp/external/servers/${createdServer.id}`,
    });
    expect(deleteResponse.statusCode).toBe(200);

    await app.close();
    },
    20000,
  );

  it("clears projected capabilities after config update and replaces them on rediscover", async () => {
    let toolsListRound = 0;

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
      };

      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "init-1",
            result: {
              protocolVersion: "2025-06-18",
              serverInfo: {
                name: "demo-remote",
                title: "Demo Remote",
                version: "1.0.0",
              },
              capabilities: {
                tools: {},
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "session-demo-3",
              "mcp-protocol-version": "2025-06-18",
            },
          },
        );
      }

      if (body.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }

      if (body.method === "tools/list") {
        toolsListRound += 1;
        const toolName = toolsListRound === 1 ? "search_docs" : "lookup_docs";
        const toolTitle = toolsListRound === 1 ? "Search Docs" : "Lookup Docs";
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: `list-${toolsListRound}`,
            result: {
              tools: [
                {
                  name: toolName,
                  title: toolTitle,
                  description: `${toolTitle} from remote`,
                  inputSchema: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "session-demo-3",
            },
          },
        );
      }

      throw new Error(`Unexpected fetch call: ${body.method ?? "unknown"}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(mcpRoutes);

    const createResponse = await app.inject({
      method: "POST",
      url: "/mcp/external/servers",
      payload: {
        displayName: "Mutable Remote",
        transport: {
          kind: "streamable-http",
          url: "https://remote.example/mcp",
        },
        disclaimerAccepted: true,
      },
    });
    const createdServer = (createResponse.json() as { data: { id: string } }).data;

    const firstDiscoverResponse = await app.inject({
      method: "POST",
      url: `/mcp/external/servers/${createdServer.id}/discover`,
    });
    expect(firstDiscoverResponse.statusCode).toBe(200);
    expect(
      (firstDiscoverResponse.json() as { data: { discoveredTools: Array<{ projectedCapabilityId: string }> } }).data
        .discoveredTools,
    ).toMatchObject([{ projectedCapabilityId: "mcp:mutable-remote:tool:search_docs" }]);

    expect(getToolImplementation("mcp:mutable-remote:tool:search_docs")?.definition).toMatchObject({
      id: "mcp:mutable-remote:tool:search_docs",
      domain: "external_mcp",
      source: "external",
      tags: expect.arrayContaining(["mcp", "external", "mutable-remote"]),
      capabilities: {
        sideEffect: "network",
        requiresApproval: true,
        networkAccess: true,
        longRunning: true,
      },
    });

    const toolsAfterFirstDiscover = await app.inject({
      method: "GET",
      url: "/mcp/tools",
    });
    expect(
      (toolsAfterFirstDiscover.json() as { data: Array<{ id: string }> }).data.some(
        (tool) => tool.id === "mcp:mutable-remote:tool:search_docs",
      ),
    ).toBe(false);

    const configPatchResponse = await app.inject({
      method: "PATCH",
      url: `/mcp/external/servers/${createdServer.id}/config`,
      payload: {
        endpointUrl: "https://remote.example/v2/mcp",
        authType: "none",
        timeoutMs: 30000,
        customHeadersJson: "",
      },
    });
    expect(configPatchResponse.statusCode).toBe(200);

    const listAfterPatch = await app.inject({
      method: "GET",
      url: `/mcp/external/servers`,
    });
    const patchedServer = (listAfterPatch.json() as {
      data: Array<{
        id: string;
        discoveredTools: unknown[];
        status: string;
        remoteServerInfo?: unknown;
        remoteCapabilities?: unknown;
      }>;
    }).data[0];
    expect(patchedServer).toMatchObject({
      id: "mutable-remote",
      discoveredTools: [],
      status: "configured",
    });
    expect(patchedServer.remoteServerInfo).toBeUndefined();
    expect(patchedServer.remoteCapabilities).toBeUndefined();

    const toolsAfterPatch = await app.inject({
      method: "GET",
      url: "/mcp/tools",
    });
    expect(
      (toolsAfterPatch.json() as { data: Array<{ id: string }> }).data.some(
        (tool) => tool.id === "mcp:mutable-remote:tool:search_docs",
      ),
    ).toBe(false);

    const secondDiscoverResponse = await app.inject({
      method: "POST",
      url: `/mcp/external/servers/${createdServer.id}/discover`,
    });
    expect(secondDiscoverResponse.statusCode).toBe(200);
    expect(
      (secondDiscoverResponse.json() as { data: { discoveredTools: Array<{ projectedCapabilityId: string }> } }).data
        .discoveredTools,
    ).toMatchObject([{ projectedCapabilityId: "mcp:mutable-remote:tool:lookup_docs" }]);

    expect(getToolImplementation("mcp:mutable-remote:tool:lookup_docs")?.definition).toMatchObject({
      id: "mcp:mutable-remote:tool:lookup_docs",
      domain: "external_mcp",
      source: "external",
      tags: expect.arrayContaining(["mcp", "external", "mutable-remote"]),
      capabilities: {
        sideEffect: "network",
        requiresApproval: true,
        networkAccess: true,
        longRunning: true,
      },
    });

    const toolsAfterSecondDiscover = await app.inject({
      method: "GET",
      url: "/mcp/tools",
    });
    const projectedToolIds = (toolsAfterSecondDiscover.json() as { data: Array<{ id: string }> }).data.map(
      (tool) => tool.id,
    );
    expect(projectedToolIds).not.toContain("mcp:mutable-remote:tool:lookup_docs");
    expect(projectedToolIds).not.toContain("mcp:mutable-remote:tool:search_docs");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/mcp/external/servers/${createdServer.id}`,
    });
    expect(deleteResponse.statusCode).toBe(200);

    const toolsAfterDelete = await app.inject({
      method: "GET",
      url: "/mcp/tools",
    });
    expect(
      (toolsAfterDelete.json() as { data: Array<{ id: string }> }).data.some(
        (tool) => tool.id === "mcp:mutable-remote:tool:lookup_docs",
      ),
    ).toBe(false);

    await app.close();
  });
});
