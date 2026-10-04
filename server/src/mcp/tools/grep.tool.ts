import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeReadLocateRuntime } from "../read/runtime.js";
import { emitArtifacts } from "./artifact-utils.js";

export const grepTool: ToolImplementation = {
  definition: {
    id: "grep",
    title: "Grep",
    description:
      "Search workspace text for exact strings or ripgrep-style patterns and return matching files, lines, columns, and previews. Prefer this for symbols, references, imports, config keys, error strings, and repeated code search before opening files.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      additionalProperties: false,
      properties: {
        pattern: { type: "string" },
        root: { type: "string" },
        extensions: {
          type: "array",
          items: { type: "string" },
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 100,
        },
      },
    },
    outputSchema: {
      type: "object",
    },
    tags: [
      "read",
      "workspace",
      "grep",
      "search",
      "text",
      "code",
      "symbol",
      "reference",
      "regex",
    ],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["root"],
        argTypes: { root: "directory" },
      },
    },
  },
  execute: async (context) => {
    const pattern = context.args.pattern;
    if (typeof pattern !== "string" || !pattern.trim()) {
      throw mcpBadRequest("pattern is required");
    }

    const maxResults = context.args.maxResults;
    if (
      maxResults !== undefined &&
      (typeof maxResults !== "number" ||
        !Number.isInteger(maxResults) ||
        maxResults < 1 ||
        maxResults > 100)
    ) {
      throw mcpBadRequest("maxResults must be an integer between 1 and 100");
    }

    const extensions = context.args.extensions;
    if (
      extensions !== undefined &&
      (!Array.isArray(extensions) ||
        extensions.some((extension) => typeof extension !== "string" || !extension.trim()))
    ) {
      throw mcpBadRequest("extensions must be a non-empty string array when provided");
    }

    const result = await executeReadLocateRuntime({
      args: {
        query: pattern,
        searchMode: "content",
        ...(typeof context.args.root === "string" ? { path: context.args.root } : {}),
        ...(Array.isArray(extensions) ? { extensions } : {}),
        ...(typeof maxResults === "number" ? { limit: maxResults } : {}),
      },
      environment: context.environment,
      pushEvent: context.pushEvent,
    });

    emitArtifacts(context, result.artifacts);

    return {
      structuredContent: result.contents,
    };
  },
};
