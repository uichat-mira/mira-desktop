import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  createFileMutationStructuredResult,
  emitFileMutationArtifact,
} from "./file-mutation-artifact.js";
import { executeMoveMutation } from "../file-mutation/runtime.js";

export const moveTool: ToolImplementation = {
  definition: {
    id: "move",
    title: "Move",
    description:
      "Move or rename a workspace file or directory when its content should remain semantically unchanged and only path identity changes. Use write/edit to change contents and delete to remove a path. Destination replacement requires overwrite=true.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "destinationPath"],
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Existing workspace file or directory to move.",
        },
        destinationPath: {
          type: "string",
          description: "New workspace path for the same file or directory identity.",
        },
        overwrite: {
          type: "boolean",
          description: "Must be true to replace an existing compatible destination.",
        },
      },
    },
    outputSchema: { type: "object" },
    tags: ["workspace", "edit", "move", "rename"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path", "destinationPath"],
      },
    },
  },
  execute: async (context) => {
    if (typeof context.args.path !== "string") {
      throw mcpBadRequest("path is required");
    }
    if (typeof context.args.destinationPath !== "string") {
      throw mcpBadRequest("destinationPath is required");
    }

    const result = await executeMoveMutation(
      {
        path: context.args.path,
        destinationPath: context.args.destinationPath,
        overwrite: context.args.overwrite === true,
      },
      {
        signal: context.signal,
        pushEvent: context.pushEvent,
      },
    );
    const artifact = emitFileMutationArtifact(context, result);

    return {
      structuredContent: createFileMutationStructuredResult(
        result,
        artifact.id,
      ),
    };
  },
};
