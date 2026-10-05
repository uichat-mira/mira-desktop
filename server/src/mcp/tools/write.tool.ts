import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeWriteMutation } from "../file-mutation/runtime.js";

export const writeTool: ToolImplementation = {
  definition: {
    id: "write",
    title: "Write",
    description:
      "Create a file or intentionally replace its full contents. Existing files require overwrite=true.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "content"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        overwrite: { type: "boolean" },
      },
    },
    outputSchema: { type: "object" },
    tags: ["workspace", "edit", "write", "file"],
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
    if (typeof context.args.content !== "string") {
      throw mcpBadRequest("content is required");
    }

    return {
      structuredContent: await executeWriteMutation(
        {
          path: context.args.path,
          content: context.args.content,
          overwrite: context.args.overwrite === true,
        },
        {
          signal: context.signal,
          pushEvent: context.pushEvent,
        },
      ),
    };
  },
};
