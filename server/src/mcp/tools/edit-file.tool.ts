import type { ToolImplementation } from "../core/definitions.js";
import { executeEditFileRuntime } from "../edit/runtime.js";
import { mcpBadRequest } from "../core/errors.js";
import { emitArtifacts } from "./artifact-utils.js";

export const editFileTool: ToolImplementation = {
  definition: {
    id: "edit_file",
    title: "Edit File",
    description: "Apply write or replace operations to a workspace file.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "operation"],
      properties: {
        path: { type: "string" },
        operation: {
          type: "string",
          enum: ["write_file", "replace_block"],
        },
        content: { type: "string" },
        expectedOldText: { type: "string" },
        newText: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
    tags: ["edit", "workspace"],
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
    const pathValue = context.args.path;
    if (typeof pathValue !== "string" || !pathValue.trim()) {
      throw mcpBadRequest("path is required");
    }

    const result = await executeEditFileRuntime({
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
