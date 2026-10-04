import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import {
  getBoundWecomUserForThread,
  getBoundWecomUserForUser,
} from "@/integrations/wecom/bind-store.js";
import {
  hasWecomAppConfig,
  hasWecomRobotConfig,
} from "@/integrations/wecom/config.js";
import {
  sendWecomTextMessageToUser,
} from "@/integrations/wecom/client.js";
import { sendWecomRobotMarkdownMessage } from "@/integrations/wecom/robot.js";

const normalizeContent = (value: unknown) => {
  const content = typeof value === "string" ? value.trim() : "";
  if (!content) {
    throw mcpBadRequest("content is required");
  }

  return content;
};

const normalizeTitle = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const wecomNotifySendTool: ToolImplementation = {
  definition: {
    id: "wecom_notify_send",
    title: "WeCom Notify Send",
    description: "Send a WeCom notification to the currently bound user.",
    domain: "terminal",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string" },
        title: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        target: { type: "string" },
        summary: { type: "string" },
      },
      required: ["success", "target", "summary"],
      additionalProperties: false,
    },
    tags: ["wecom", "notify", "chat-plugin"],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
  },
  execute: async (context) => {
    const content = normalizeContent(context.args.content);
    const title = normalizeTitle(context.args.title);
    let target = "";
    let summary = "";
    if (!context.threadId && !context.userId) {
      throw mcpInternalError(
        "WeCom notify requires a chat user or thread context.",
      );
    }

    const planningSpan = context.trace.startSpan({
      name: "Validate WeCom notify prerequisites",
      kind: "strategy_selection",
    });

    context.pushEvent({
      type: "invocation:progress",
      message: "Checking WeCom plugin prerequisites",
    });

    if (!hasWecomAppConfig() && !hasWecomRobotConfig()) {
      planningSpan.end({
        status: "failed",
      });
      throw mcpInternalError(
        "WeCom config is incomplete. Configure app credentials or robot webhook first.",
      );
    }

    if (hasWecomRobotConfig()) {
      target = "robot-webhook";
      summary = "WeCom robot notification sent";
      planningSpan.end({
        metadata: {
          hasTitle: Boolean(title),
          contentLength: content.length,
          threadId: context.threadId,
          target,
        },
      });

      context.pushEvent({
        type: "invocation:progress",
        message: "Sending WeCom notification through robot webhook",
      });

      await sendWecomRobotMarkdownMessage({
        title: title || "WeCom notification",
        content,
      });
    } else {
      const boundUserId =
        (typeof context.userId === "number"
          ? getBoundWecomUserForUser(context.userId)
          : null) ?? (context.threadId ? getBoundWecomUserForThread(context.threadId) : null);
      if (!boundUserId) {
        planningSpan.end({
          status: "failed",
        });
        throw mcpInternalError(
          "No WeCom user is bound to the current chat thread yet.",
        );
      }

      planningSpan.end({
        metadata: {
          hasTitle: Boolean(title),
          contentLength: content.length,
          threadId: context.threadId,
          boundUserId,
        },
      });

      context.pushEvent({
        type: "invocation:progress",
        message: `Sending WeCom notification to ${boundUserId}`,
      });

      const messageContent = title ? `${title}\n\n${content}` : content;
      target = boundUserId;
      summary = `WeCom notification sent to ${boundUserId}`;
      await sendWecomTextMessageToUser({
        userId: boundUserId,
        content: messageContent,
      });
    }

    return {
      result: {
        success: true,
        target,
        summary,
      },
    };
  },
};
