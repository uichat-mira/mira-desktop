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
      "Move or rename a workspace file or directory. Existing destination replacement is explicit and never delete-first.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "destinationPath"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        destinationPath: { type: "string" },
        overwrite: { type: "boolean" },
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
