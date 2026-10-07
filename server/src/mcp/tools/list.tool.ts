import type { ToolImplementation } from "../core/definitions.js";
import { executeList } from "../read/list.js";
import { emitArtifacts } from "./artifact-utils.js";

export const listTool: ToolImplementation = {
  definition: {
    id: "list",
    title: "List",
    description:
      "List direct children of a known directory. Use glob for recursive or pattern-based path discovery; use read to inspect a file. This tool does not recurse.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Known directory path; defaults to the workspace root.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Number of sorted directory entries to skip.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum direct children to return in this call.",
        },
        includeIgnored: {
          type: "boolean",
          description: "Include paths hidden by default workspace ignore rules; does not expand workspace authority.",
        },
      },
    },
    outputSchema: { type: "object" },
    tags: ["list", "directory"],
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
    const result = await executeList({
      args: context.args,
      environment: context.environment,
      pushEvent: context.pushEvent,
    });
    emitArtifacts(context, result.artifacts);
    return { structuredContent: result.contents };
  },
};
