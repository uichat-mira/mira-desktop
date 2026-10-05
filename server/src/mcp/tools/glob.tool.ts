import type { ToolImplementation } from "../core/definitions.js";
import { executeGlob } from "../read/glob.js";
import { emitArtifacts } from "./artifact-utils.js";

export const globTool: ToolImplementation = {
  definition: {
    id: "glob",
    title: "Glob",
    description:
      "Discover workspace files with a real glob pattern under an optional workspace root. Results are deterministic, bounded, ignore-aware, and never follow symlinked directories.",
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
        maxResults: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
    outputSchema: { type: "object" },
    tags: ["read", "workspace", "glob", "path", "discover"],
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
    const result = await executeGlob({
      args: context.args,
      environment: context.environment,
      pushEvent: context.pushEvent,
    });
    emitArtifacts(context, result.artifacts);
    return { structuredContent: result.contents };
  },
};
