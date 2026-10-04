import type { ToolImplementation } from "../core/definitions.js";
import { executeReadLocateRuntime } from "../read/runtime.js";
import { mcpBadRequest } from "../core/errors.js";
import { emitArtifacts } from "./artifact-utils.js";

export const readLocateTool: ToolImplementation = {
  definition: {
    id: "read_locate",
    title: "Read Locate",
    description: "Locate files or matching content inside the authorized workspace.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        searchMode: {
          type: "string",
          enum: ["auto", "path", "content"],
        },
        extensions: {
          type: "array",
          items: { type: "string" },
        },
        limit: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
    },
    tags: ["read", "workspace", "locate", "search"],
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
    const queryValue = context.args.query;
    if (typeof queryValue !== "string" || !queryValue.trim()) {
      throw mcpBadRequest("query is required");
    }

    const result = await executeReadLocateRuntime({
      args: context.args,
      environment: context.environment,
      pushEvent: context.pushEvent,
    });

    emitArtifacts(context, result.artifacts);

    return {
      structuredContent: result.contents,
    };
  },
};
