import type { ToolInvocationContext, ToolImplementation } from "../core/definitions.js";
import { ToolApprovalRequiredError, mcpBadRequest } from "../core/errors.js";
import {
  createMailCenterService,
  type MailQueryInput,
  type MailQueryResult,
} from "@/microapps/mail-center/index.js";

const MAX_LIMIT = 100;

const normalizeInput = (args: Record<string, unknown>): Omit<MailQueryInput, "userId"> => {
  const input = { ...args } as Omit<MailQueryInput, "userId">;
  if (input.limit !== undefined && (!Number.isFinite(input.limit) || input.limit < 1)) {
    throw mcpBadRequest("limit must be a positive number");
  }
  if (input.includeBody !== undefined && typeof input.includeBody !== "boolean") {
    throw mcpBadRequest("includeBody must be a boolean");
  }
  if (input.sync !== undefined && !["none", "if-stale", "force"].includes(input.sync)) {
    throw mcpBadRequest("sync must be one of none, if-stale, or force");
  }
  return {
    ...input,
    ...(input.limit !== undefined ? { limit: Math.min(Math.floor(input.limit), MAX_LIMIT) } : {}),
  };
};

const safeResult = (result: MailQueryResult): MailQueryResult => ({
  sync: result.sync,
  items: result.items.map((item) => ({
    ...item,
    previewText: item.previewText.slice(0, 4000),
    ...(item.textContent !== undefined ? { textContent: item.textContent.slice(0, 20_000) } : {}),
  })),
  total: result.total,
  nextCursor: result.nextCursor,
});

const getUserId = (context: ToolInvocationContext) => {
  if (context.userId === undefined || !Number.isInteger(context.userId)) {
    throw mcpBadRequest("mail_query requires a trusted authenticated user context");
  }
  return context.userId;
};

export const mailQueryTool: ToolImplementation = {
  definition: {
    id: "mail_query",
    title: "Mail Query",
    description:
      "查询当前用户的邮件。用户询问最近邮件、某封邮件、主题、发件人、收件人、时间、未读、星标、附件或正文时必须调用此工具，不能仅凭上下文回答。默认只查本地缓存并返回最近 20 封摘要；按条件查找使用 query/from/to/subject/since/until 等过滤参数，读取具体正文时使用 messageIds 加 includeBody=true。结果超过一页时使用 nextCursor 继续查询。只有用户明确要求最新邮件时使用 sync=if-stale；只有用户明确要求强制同步时使用 sync=force，该操作需要审批。items 是可直接用于回答用户问题的邮件结果；仅当 items 为空时才说明没有找到匹配邮件。",
    domain: "mail",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        accountId: { type: "string", description: "限定查询到指定邮箱账号；不传则查询当前用户的全部邮箱账号。" },
        messageIds: {
          type: "array",
          description: "按邮件 ID 精确读取；需要查看正文时通常与 includeBody=true 一起使用。",
          items: { type: "string" },
          maxItems: 100,
        },
        query: { type: "string", description: "关键词，搜索主题、发件人、收件人、预览和纯文本正文。" },
        from: { type: "string", description: "按发件人名称或邮箱地址过滤。" },
        to: { type: "string", description: "按收件人名称或邮箱地址过滤。" },
        subject: { type: "string", description: "按主题过滤。" },
        since: { type: "string", description: "收件时间下限，建议使用 ISO 8601 时间。" },
        until: { type: "string", description: "收件时间上限，建议使用 ISO 8601 时间。" },
        unreadOnly: { type: "boolean", description: "为 true 时只返回未读邮件。" },
        flaggedOnly: { type: "boolean", description: "为 true 时只返回星标邮件。" },
        hasAttachments: { type: "boolean", description: "按是否有附件过滤。" },
        includeBody: { type: "boolean", description: "为 true 时返回纯文本正文；默认不返回正文，也不会返回完整 HTML。" },
        sync: {
          type: "string",
          description: "同步策略：none 只查缓存（默认）；if-stale 仅缓存过期时同步；force 强制同步并需要审批。",
          enum: ["none", "if-stale", "force"],
        },
        limit: { type: "integer", description: "返回数量，默认 20，最大 100。", minimum: 1, maximum: MAX_LIMIT },
        cursor: { type: "string", description: "使用上一次结果的 nextCursor 获取下一页；不要自行构造。" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["sync", "items", "total", "nextCursor"],
      properties: {
        sync: {
          type: "object",
          description: "本次查询的同步状态；status 和 syncedCount 用于判断是否实际同步。",
          properties: {
            requested: { type: "string", enum: ["none", "if-stale", "force"] },
            performed: { type: "boolean" },
            status: { type: "string", enum: ["skipped", "succeeded", "failed"] },
            syncedCount: { type: "integer" },
            lastSyncedAt: { type: ["string", "null"] },
            error: { type: ["string", "null"] },
          },
        },
        items: {
          type: "array",
          description: "邮件结果，可直接据此回答用户；为空表示当前条件下没有匹配结果。",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              accountId: { type: "string" },
              subject: { type: "string" },
              from: { type: "object" },
              to: { type: "array" },
              previewText: { type: "string" },
              textContent: { type: "string" },
              sentAt: { type: ["string", "null"] },
              receivedAt: { type: ["string", "null"] },
              isRead: { type: "boolean" },
              isFlagged: { type: "boolean" },
              hasAttachments: { type: "boolean" },
              attachments: { type: "array" },
            },
          },
        },
        total: { type: "integer", description: "符合当前过滤条件的总数量，不只是本页数量。" },
        nextCursor: { type: ["string", "null"], description: "有更多结果时存在；传回 cursor 获取下一页。" },
      },
    },
    tags: ["mail", "email", "private", "inbox", "search"],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
      longRunning: true,
    },
  },
  execute: async (context) => {
    const userId = getUserId(context);
    const input = normalizeInput(context.args);
    if (input.sync === "force" && !context.approval?.granted) {
      throw new ToolApprovalRequiredError(
        "mail_query force sync requires explicit approval for network access and local persistence.",
        { scope: "mail_sync" },
      );
    }
    const ownershipSpan = context.trace.startSpan({
      name: "Validate mail account ownership",
      kind: "permission_check",
      metadata: { accountRequested: typeof input.accountId === "string" },
    });
    try {
      const result = await createMailCenterService().queryMail({ ...input, userId });
      ownershipSpan.end({
        metadata: {
          syncRequested: result.sync.requested,
          syncPerformed: result.sync.performed,
          syncStatus: result.sync.status,
        },
      });
      const normalized = safeResult(result);
      context.trace.startSpan({
        name: "Normalize mail query result",
        kind: "result_normalization",
        metadata: {
          itemCount: normalized.items.length,
          syncStatus: normalized.sync.status,
          bodyIncluded: input.includeBody === true,
        },
      }).end();
      context.addArtifact({
        kind: "table",
        title: "Mail query results",
        data: normalized.items,
        metadata: { resultCount: normalized.items.length, sensitiveFieldsExcluded: true },
      });
      return { result: normalized };
    } catch (error) {
      ownershipSpan.end({ status: "failed" });
      throw error;
    }
  },
};
