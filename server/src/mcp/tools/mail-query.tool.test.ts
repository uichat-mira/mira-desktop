import { beforeEach, describe, expect, it, vi } from "vitest";
import { mailQueryTool } from "./mail-query.tool.js";
import { createMailCenterService } from "@/microapps/mail-center/index.js";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { executeInvocation } from "../core/invocations.js";
import { registerTool, unregisterTool } from "../core/registry.js";

vi.mock("@/microapps/mail-center/index.js", () => ({
  createMailCenterService: vi.fn(),
}));

const mockedCreateService = vi.mocked(createMailCenterService);

const createContext = (userId?: number) => {
  const spans: Array<{ name: string; kind: string; end: ReturnType<typeof vi.fn> }> = [];
  const artifacts: unknown[] = [];
  return {
    invocationId: "invocation-mail-test",
    args: {},
    userId,
    approval: { inputHash: "test-hash", granted: false },
    pushEvent: vi.fn(),
    addArtifact: vi.fn((artifact) => {
      artifacts.push(artifact);
      return { id: "artifact-1", ...artifact };
    }),
    trace: {
      startSpan: vi.fn((input: { name: string; kind: string }) => {
        const span = { ...input, end: vi.fn() };
        spans.push(span);
        return span;
      }),
    },
    signal: new AbortController().signal,
    spans,
    artifacts,
  };
};

describe("mailQueryTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes a private internal schema without model-controlled identity or secrets", () => {
    expect(mailQueryTool.definition).toMatchObject({
      id: "mail_query",
      source: "internal",
      domain: "mail",
      mode: "sync",
    });
    expect(mailQueryTool.definition.inputSchema).not.toHaveProperty("userId");
    expect(mailQueryTool.definition.inputSchema).not.toHaveProperty("smtpPassword");
    expect(mailQueryTool.definition.inputSchema).not.toHaveProperty("imapPassword");
    expect(mailQueryTool.definition.capabilities).toMatchObject({
      sideEffect: "network",
      networkAccess: true,
    });
  });

  it("rejects calls without a trusted invocation user", async () => {
    const context = createContext();
    await expect(mailQueryTool.execute(context)).rejects.toThrow("trusted authenticated user context");
    expect(mockedCreateService).not.toHaveBeenCalled();
  });

  it("passes trusted identity, emits a safe artifact, and preserves sync status", async () => {
    const queryMail = vi.fn().mockResolvedValue({
      sync: {
        requested: "none",
        performed: false,
        status: "skipped",
        syncedCount: 0,
        lastSyncedAt: null,
        error: null,
      },
      items: [{
        id: "message-1",
        accountId: "account-1",
        subject: "Subject",
        from: { name: "Sender", address: "sender@example.com" },
        to: [],
        previewText: "Preview",
        sentAt: null,
        receivedAt: null,
        isRead: false,
        isFlagged: false,
        hasAttachments: false,
      }],
      total: 1,
      nextCursor: null,
    });
    mockedCreateService.mockReturnValue({ queryMail } as never);
    const context = createContext(42);

    const result = await mailQueryTool.execute(context);

    expect(queryMail).toHaveBeenCalledWith({ userId: 42 });
    expect(result.structuredContent).toMatchObject({ total: 1, sync: { status: "skipped" } });
    expect(context.addArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: "table",
      metadata: expect.objectContaining({ sensitiveFieldsExcluded: true }),
    }));
    expect(context.spans.map((span) => span.name)).toEqual([
      "Validate mail account ownership",
      "Normalize mail query result",
    ]);
  });

  it("keeps sync failures structured without returning provider errors", async () => {
    mockedCreateService.mockReturnValue({
      queryMail: vi.fn().mockResolvedValue({
        sync: {
          requested: "force",
          performed: true,
          status: "failed",
          syncedCount: 0,
          lastSyncedAt: null,
          error: "邮件同步失败，请检查账号连接状态",
        },
        items: [],
        total: 0,
        nextCursor: null,
      }),
    } as never);
    const context = createContext(42);

    const result = await mailQueryTool.execute(context);

    expect(result.structuredContent).toMatchObject({
      sync: { requested: "force", status: "failed", error: "邮件同步失败，请检查账号连接状态" },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("imap-secret");
  });

  it("requires exact approval for force sync and does not reuse it after args change", async () => {
    const queryMail = vi.fn().mockResolvedValue({
      sync: {
        requested: "force",
        performed: true,
        status: "succeeded",
        syncedCount: 1,
        lastSyncedAt: "2026-07-14T00:00:00.000Z",
        error: null,
      },
      items: [],
      total: 0,
      nextCursor: null,
    });
    mockedCreateService.mockReturnValue({ queryMail } as never);
    registerTool(mailQueryTool);

    const first = await executeInvocation({
      toolId: "mail_query",
      args: { sync: "force", accountId: "account-1" },
      userId: 42,
    });
    expect(first.status).toBe("awaiting_approval");
    expect(queryMail).not.toHaveBeenCalled();

    const approvedArgs = { sync: "force", accountId: "account-1" };
    const approved = await executeInvocation({
      toolId: "mail_query",
      args: approvedArgs,
      userId: 42,
      approvedInvocations: [{
        toolId: "mail_query",
        inputHash: createInvocationInputHash(approvedArgs),
      }],
    });
    expect(approved.status).toBe("completed");
    expect(queryMail).toHaveBeenCalledTimes(1);

    const changed = await executeInvocation({
      toolId: "mail_query",
      args: { sync: "force", accountId: "account-1", limit: 10 },
      userId: 42,
      approvedInvocations: [{
        toolId: "mail_query",
        inputHash: createInvocationInputHash(approvedArgs),
      }],
    });
    expect(changed.status).toBe("awaiting_approval");
    expect(queryMail).toHaveBeenCalledTimes(1);

    unregisterTool("mail_query");
  });

  it("allows cache-only and stale-policy invocations without approval", async () => {
    const queryMail = vi.fn().mockImplementation(async (input: { sync?: string }) => ({
      sync: {
        requested: input.sync ?? "none",
        performed: input.sync === "if-stale",
        status: input.sync === "if-stale" ? "succeeded" : "skipped",
        syncedCount: input.sync === "if-stale" ? 1 : 0,
        lastSyncedAt: null,
        error: null,
      },
      items: [],
      total: 0,
      nextCursor: null,
    }));
    mockedCreateService.mockReturnValue({ queryMail } as never);
    registerTool(mailQueryTool);

    const local = await executeInvocation({
      toolId: "mail_query",
      args: { sync: "none" },
      userId: 42,
    });
    const stale = await executeInvocation({
      toolId: "mail_query",
      args: { sync: "if-stale" },
      userId: 42,
    });

    expect(local.status).toBe("completed");
    expect(stale.status).toBe("completed");
    expect(local.result).toMatchObject({ sync: { requested: "none", performed: false } });
    expect(stale.result).toMatchObject({ sync: { requested: "if-stale", performed: true } });
    expect(queryMail).toHaveBeenCalledTimes(2);

    unregisterTool("mail_query");
  });
});
