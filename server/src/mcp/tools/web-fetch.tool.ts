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
      "Retrieve the content of a known public http/https URL. Use this when a concrete URL is already known and the task is to read that resource. Use web_search to discover sources when the URL is not yet known, and use the browser capabilities for interactive, authenticated, or JavaScript-driven pages. Only public destinations are allowed, and the returned body is bounded text that may be truncated.",
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
    tags: ["fetch", "web", "url", "retrieve", "public"],
    outputSchema: {
      type: "object",
      required: [
        "url",
        "finalUrl",
        "status",
        "contentType",
        "content",
        "byteLength",
        "truncated",
      ],
      properties: {
        url: { type: "string" },
        finalUrl: { type: "string" },
        status: { type: "number" },
        contentType: { type: "string" },
        content: { type: "string" },
        byteLength: { type: "number" },
        truncated: { type: "boolean" },
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

    return {
      structuredContent: {
        url: execution.url,
        finalUrl: execution.finalUrl,
        status: execution.status,
        contentType: execution.contentType,
        content: execution.content,
        byteLength: execution.byteLength,
        truncated: execution.truncated,
      },
    };
  },
};
