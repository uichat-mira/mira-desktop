import type { ToolImplementation } from "../core/definitions.js";
import { executeGlob } from "../read/glob.js";
import { emitArtifacts } from "./artifact-utils.js";

export const globTool: ToolImplementation = {
  definition: {
    id: "glob",
    title: "Glob",
    description:
      "Find file paths matching a glob pattern. Does not search file contents.",
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
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        includeIgnored: { type: "boolean" },
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
