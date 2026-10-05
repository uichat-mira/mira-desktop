import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeList } from "../read/list.js";
import { emitArtifacts } from "./artifact-utils.js";

export const listTool: ToolImplementation = {
  definition: {
    id: "list",
    title: "List",
    description:
      "List direct children of one authorized workspace directory with deterministic ordering, shared ignore rules, and bounded results.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        maxResults: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
    outputSchema: { type: "object" },
    tags: ["read", "workspace", "directory", "list"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => {
    if (typeof context.args.path !== "string" || !context.args.path.trim()) {
      throw mcpBadRequest("path is required");
    }

    const result = await executeList({
      args: context.args,
      environment: context.environment,
      pushEvent: context.pushEvent,
    });
    emitArtifacts(context, result.artifacts);
    return { structuredContent: result.contents };
  },
};
