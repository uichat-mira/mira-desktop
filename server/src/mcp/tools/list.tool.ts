import type { ToolImplementation } from "../core/definitions.js";
import { executeList } from "../read/list.js";
import { emitArtifacts } from "./artifact-utils.js";

export const listTool: ToolImplementation = {
  definition: {
    id: "list",
    title: "List",
    description:
      "List the direct children of a known directory. Does not recurse.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        includeIgnored: { type: "boolean" },
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
