import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  createFileMutationStructuredResult,
  emitFileMutationArtifact,
} from "./file-mutation-artifact.js";
import { executeWriteMutation } from "../file-mutation/runtime.js";

export const writeTool: ToolImplementation = {
  definition: {
    id: "write",
    title: "Write",
    description:
      "Write the complete desired contents of one file. Use this for file creation or intentional whole-file replacement; use edit for localized changes that should preserve unrelated content. Existing files require overwrite=true.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "content"],
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Workspace file path to create or replace.",
        },
        content: {
          type: "string",
          description: "Complete desired file contents, not a patch or fragment.",
        },
        overwrite: {
          type: "boolean",
          description: "Must be true to replace an existing file; omitted/false is create-only.",
        },
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

    const result = await executeWriteMutation(
      {
        path: context.args.path,
        content: context.args.content,
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
