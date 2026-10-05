import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeGrep } from "../read/grep.js";
import { emitArtifacts } from "./artifact-utils.js";

export const grepTool: ToolImplementation = {
  definition: {
    id: "grep",
    title: "Grep",
    description:
      "Search workspace text with a bounded ripgrep-first runtime. Returns matching workspace-relative files, line/column locations, and previews; falls back deterministically when ripgrep is unavailable.",
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

    const result = await executeGrep({
      args: context.args,
      environment: context.environment,
      signal: context.signal,
      pushEvent: context.pushEvent,
    });

    emitArtifacts(context, result.artifacts);
    return {
      structuredContent: result.contents,
    };
  },
};
