import type { ToolImplementation } from "../core/definitions.js";
import { executeGlob } from "../read/glob.js";
import { emitArtifacts } from "./artifact-utils.js";

export const globTool: ToolImplementation = {
  definition: {
    id: "glob",
    title: "Glob",
    description:
      "Find workspace paths by glob pattern when the exact path is unknown. Use list for direct children of a known directory and grep for file-content search; glob never searches file contents.",
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
          description: "Workspace-relative glob pattern such as **/*.tsx.",
        },
        path: {
          type: "string",
          description: "Optional directory that scopes pattern matching; defaults to the workspace root.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Number of sorted matches to skip.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum matching paths to return in this call.",
        },
        includeIgnored: {
          type: "boolean",
          description: "Include paths hidden by default workspace ignore rules; does not expand workspace authority.",
        },
      },
    },
    outputSchema: { type: "object" },
    tags: ["glob", "path", "file"],
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
    const result = await executeGlob({
      args: context.args,
      environment: context.environment,
      pushEvent: context.pushEvent,
    });
    emitArtifacts(context, result.artifacts);
    return { structuredContent: result.contents };
  },
};
