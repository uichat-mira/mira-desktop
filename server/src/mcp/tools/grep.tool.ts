import type { ToolImplementation } from "../core/definitions.js";
import { executeGrep } from "../read/grep.js";
import { emitArtifacts } from "./artifact-utils.js";

export const grepTool: ToolImplementation = {
  definition: {
    id: "grep",
    title: "Grep",
    description:
      "Search workspace file contents and return matching locations. Use glob for path-name discovery and read for full or contextual inspection after a match. pattern is regex by default; set literal=true for exact text.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      additionalProperties: false,
      properties: {
        pattern: {
          type: "string",
          description: "Regex search pattern by default; interpreted literally when literal=true.",
        },
        path: {
          type: "string",
          description: "Optional directory to search; defaults to the workspace root.",
        },
        include: {
          type: "string",
          description: "Optional glob that limits candidate file paths inside path.",
        },
        literal: {
          type: "boolean",
          description: "Treat pattern as literal text instead of a regular expression.",
        },
        caseSensitive: {
          type: "boolean",
          description: "Explicit case sensitivity. When omitted, smart-case is used.",
        },
        context: {
          type: "integer",
          minimum: 0,
          description: "Number of surrounding lines to return before and after each match.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Number of ordered matches to skip.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum matches to return in this call.",
        },
        includeIgnored: {
          type: "boolean",
          description: "Include paths hidden by default workspace ignore rules; does not expand workspace authority.",
        },
      },
    },
    outputSchema: { type: "object" },
    tags: ["grep", "content", "search"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
        argTypes: { path: "directory" },
      },
    },
  },
  execute: async (context) => {
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
