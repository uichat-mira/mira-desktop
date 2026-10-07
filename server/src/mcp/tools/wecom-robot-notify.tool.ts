import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { hasWecomRobotConfig } from "@/integrations/wecom/config.js";
import { sendWecomRobotMarkdownMessage } from "@/integrations/wecom/robot.js";

const normalizeText = (value: unknown, fallback = "") => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
};

export const wecomRobotNotifyTool: ToolImplementation = {
  definition: {
    id: "wecom_robot_notify",
    title: "WeCom Robot Notify",
    description: "Send a markdown notification to a configured WeCom robot webhook.",
    domain: "browser_action",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        title: { type: "string" },
        content: { type: "string" },
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
    tags: ["wecom", "notify", "robot"],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
  },
  execute: async (context) => {
    const title = normalizeText(context.args.title, "WeCom Notification");
    const content = normalizeText(context.args.content);
    if (!content) {
      throw mcpBadRequest("content is required");
    }

    if (!hasWecomRobotConfig()) {
      throw mcpInternalError("WeCom robot webhook is not configured.");
    }

    context.pushEvent({
      type: "invocation:progress",
      message: "Sending WeCom robot markdown message",
    });

    await sendWecomRobotMarkdownMessage({ title, content });

    return {
      structuredContent: {
        success: true,
        target: "robot-webhook",
        summary: `WeCom robot notification sent: ${title}`,
      },
    };
  },
};
