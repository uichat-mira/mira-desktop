import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeDeleteMutation } from "../file-mutation/runtime.js";

export const deleteTool: ToolImplementation = {
  definition: {
    id: "delete",
    title: "Delete",
    description:
      "Delete a workspace file or directory. Non-empty directory deletion requires recursive=true.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
    },
    outputSchema: { type: "object" },
    tags: ["workspace", "edit", "delete", "file", "directory"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => {
    if (typeof context.args.path !== "string") {
      throw mcpBadRequest("path is required");
    }

    return {
      structuredContent: await executeDeleteMutation(
        {
          path: context.args.path,
          recursive: context.args.recursive === true,
        },
        {
          signal: context.signal,
          pushEvent: context.pushEvent,
        },
      ),
    };
  },
};
