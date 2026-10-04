import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import {
  getBoundWecomUserForThread,
  getBoundWecomUserForUser,
} from "@/integrations/wecom/bind-store.js";
import { getWecomUserByUserId, listWecomDepartments } from "@/integrations/wecom/client.js";
import { hasWecomAppConfig } from "@/integrations/wecom/config.js";

const normalizeMode = (value: unknown) => {
  if (value === undefined) {
    return "self";
  }

  if (value === "self" || value === "user") {
    return value;
  }

  throw mcpBadRequest("mode must be either 'self' or 'user'");
};

const normalizeQuery = (value: unknown, mode: "self" | "user") => {
  const query = typeof value === "string" ? value.trim() : "";
  if (mode === "user" && !query) {
    throw mcpBadRequest("query is required when mode is 'user'");
  }

  return query;
};

export const wecomOrgLookupTool: ToolImplementation = {
  definition: {
    id: "wecom_org_lookup",
    title: "WeCom Org Lookup",
    description:
      "Look up the organization summary for the current user or one target user.",
    domain: "terminal",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["self", "user"] },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        departments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            required: ["id", "name"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
      },
      required: ["success", "departments", "summary"],
      additionalProperties: false,
    },
    tags: ["wecom", "org", "chat-plugin"],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
  },
  execute: async (context) => {
    const mode = normalizeMode(context.args.mode);
    const query = normalizeQuery(context.args.query, mode);
    if (!context.threadId && !context.userId) {
      throw mcpInternalError(
        "WeCom organization lookup requires a chat user or thread context.",
      );
    }

    const planningSpan = context.trace.startSpan({
      name: "Validate WeCom org lookup prerequisites",
      kind: "strategy_selection",
    });

    context.pushEvent({
      type: "invocation:progress",
      message: "Checking WeCom organization lookup prerequisites",
    });

    if (!hasWecomAppConfig()) {
      planningSpan.end({
        status: "failed",
      });
      throw mcpInternalError(
        "WeCom app config is incomplete. Configure corpId, agentId, and appSecret first.",
      );
    }

    const targetUserId =
      mode === "self"
        ? (typeof context.userId === "number"
            ? getBoundWecomUserForUser(context.userId)
            : null) ?? (context.threadId ? getBoundWecomUserForThread(context.threadId) : null)
        : query;
    if (!targetUserId) {
      planningSpan.end({
        status: "failed",
      });
      throw mcpInternalError(
        mode === "self"
          ? "No WeCom user is bound to the current chat thread yet."
          : "No WeCom target user was provided.",
      );
    }

    planningSpan.end({
      metadata: {
        mode,
        hasQuery: Boolean(query),
        threadId: context.threadId,
        targetUserId,
      },
    });

    context.pushEvent({
      type: "invocation:progress",
      message: `Looking up WeCom organization for ${targetUserId}`,
    });

    const user = await getWecomUserByUserId(targetUserId);
    const departments = await listWecomDepartments();
    const departmentMap = new Map(
      departments
        .filter((department) => typeof department.id === "number")
        .map((department) => [
          String(department.id),
          department.name ?? String(department.id),
        ]),
    );
    const departmentSummaries = (user.department ?? []).map((departmentId) => ({
      id: String(departmentId),
      name: departmentMap.get(String(departmentId)) ?? String(departmentId),
    }));

    return {
      structuredContent: {
        success: true,
        departments: departmentSummaries,
        summary:
          departmentSummaries.length > 0
            ? `${user.name ?? targetUserId} belongs to ${departmentSummaries
                .map((department) => department.name)
                .join(", ")}`
            : `${user.name ?? targetUserId} has no department summary available`,
      },
    };
  },
};
