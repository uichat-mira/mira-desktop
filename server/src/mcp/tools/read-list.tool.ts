import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeReadList } from "../read/runtime.js";
import { emitArtifacts } from "./artifact-utils.js";

export const readListTool: ToolImplementation = {
  definition: {
    id: "read_list",
    title: "Read List",
    description: "List the directory structure under an authorized workspace path.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
    },
    tags: ["read", "workspace", "directory"],
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
    const pathValue = context.args.path;
    if (typeof pathValue !== "string" || !pathValue.trim()) {
      throw mcpBadRequest("path is required");
    }

    const result = await executeReadList({
      args: {
        path: pathValue,
      },
      environment: context.environment,
      pushEvent: context.pushEvent,
    });

    emitArtifacts(context, result.artifacts);

    return {
      result: result.contents,
    };
  },
};
