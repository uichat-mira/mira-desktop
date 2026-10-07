import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  createFileMutationStructuredResult,
  emitFileMutationArtifact,
} from "./file-mutation-artifact.js";
import { executeDeleteMutation } from "../file-mutation/runtime.js";

export const deleteTool: ToolImplementation = {
  definition: {
    id: "delete",
    title: "Delete",
    description:
      "Remove a workspace file or directory. Use move when the path should continue to exist elsewhere, and write/edit when content should remain. Non-empty directory deletion requires recursive=true.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Existing workspace file or directory to remove.",
        },
        recursive: {
          type: "boolean",
          description: "Required to remove a non-empty directory; unnecessary for files or empty directories.",
        },
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

    const result = await executeDeleteMutation(
      {
        path: context.args.path,
        recursive: context.args.recursive === true,
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
