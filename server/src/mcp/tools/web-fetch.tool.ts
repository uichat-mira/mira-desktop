import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeWebFetch } from "../web/fetch.js";

const normalizeUrl = (value: unknown): string => {
  if (typeof value !== "string") {
    throw mcpBadRequest("url must be a string");
  }
  const url = value.trim();
  if (!url) {
    throw mcpBadRequest("url must be a non-empty string");
  }
  return url;
};

export const webFetchTool: ToolImplementation = {
  definition: {
    id: "web_fetch",
    title: "Web Fetch",
    description:
      "Retrieve and extract the readable content of a known public http/https URL. Use this when a concrete URL is already known and the task is to read that resource. Use web_search to discover sources when the URL is not yet known, and use the browser capabilities for interactive, authenticated, or JavaScript-rendered pages. Only public destinations are allowed; HTML is converted to readable text, the returned content may be truncated, and pages that require a browser report browser_required instead of returning an empty shell.",
    domain: "web_search",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          minLength: 1,
          description: "Absolute http/https URL of the resource to retrieve.",
        },
      },
      additionalProperties: false,
    },
    tags: ["fetch", "web", "url", "retrieve", "public", "content"],
    outputSchema: {
      type: "object",
      required: [
        "url",
        "finalUrl",
        "status",
        "contentType",
        "byteLength",
        "truncated",
        "kind",
      ],
      properties: {
        url: { type: "string" },
        finalUrl: { type: "string" },
        status: { type: "number" },
        contentType: { type: "string" },
        byteLength: { type: "number" },
        truncated: { type: "boolean" },
        kind: {
          type: "string",
          enum: ["html", "text", "browser_required", "unsupported"],
        },
        title: { type: "string" },
        content: { type: "string" },
        reason: { type: "string" },
      },
    },
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
  },
  execute: async (context) => {
    const url = normalizeUrl(context.args.url);
    const execution = await executeWebFetch({
      url,
      signal: context.signal,
      pushEvent: context.pushEvent,
      trace: context.trace,
    });

    const structuredContent: Record<string, unknown> = {
      url: execution.url,
      finalUrl: execution.finalUrl,
      status: execution.status,
      contentType: execution.contentType,
      byteLength: execution.byteLength,
      truncated: execution.truncated,
      kind: execution.kind,
    };
    if (execution.title !== undefined) {
      structuredContent.title = execution.title;
    }
    if (execution.content !== undefined) {
      structuredContent.content = execution.content;
    }
    if (execution.reason !== undefined) {
      structuredContent.reason = execution.reason;
    }

    const isError =
      execution.kind === "browser_required" || execution.kind === "unsupported";

    return {
      structuredContent,
      ...(isError ? { isError: true } : {}),
    };
  },
};
