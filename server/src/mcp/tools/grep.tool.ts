import type { ToolImplementation } from "../core/definitions.js";
import { executeGrep } from "../read/grep.js";
import { emitArtifacts } from "./artifact-utils.js";

export const grepTool: ToolImplementation = {
  definition: {
    id: "grep",
    title: "Grep",
    description:
      "Search file contents by regex or literal text. Returns matching paths and line locations; use glob to search filenames.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      additionalProperties: false,
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        include: { type: "string" },
        literal: { type: "boolean" },
        caseSensitive: { type: "boolean" },
        context: { type: "integer", minimum: 0 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        includeIgnored: { type: "boolean" },
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
