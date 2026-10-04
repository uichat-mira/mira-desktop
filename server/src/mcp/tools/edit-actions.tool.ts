import type { ToolImplementation } from "../core/definitions.js";
import { editFileTool } from "./edit-file.tool.js";
import { workspaceMutationTool } from "./workspace-mutation.tool.js";

const delegateReplaceBlock = (
  context: Parameters<ToolImplementation["execute"]>[0],
) =>
  editFileTool.execute({
    ...context,
    args: {
      ...context.args,
      operation: "replace_block",
    },
  });

const delegateWorkspaceMutation = (
  context: Parameters<ToolImplementation["execute"]>[0],
  operation: "write" | "delete" | "move",
) =>
  workspaceMutationTool.execute({
    ...context,
    args: {
      operation,
      targetPath: context.args.path,
      destinationPath: context.args.destinationPath,
      content: context.args.content,
      recursive: context.args.recursive,
      overwrite: context.args.overwrite,
      dryRun: context.args.dryRun,
    },
  });

export const writeFileTool: ToolImplementation = {
  definition: {
    id: "write_file",
    title: "Write File",
    description:
      "Create a workspace file or replace its full contents when overwrite=true is explicitly provided.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        overwrite: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      additionalProperties: false,
    },
    tags: ["edit", "write", "create", "overwrite", "file", "workspace"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => delegateWorkspaceMutation(context, "write"),
};

export const replaceBlockTool: ToolImplementation = {
  definition: {
    id: "replace_block",
    title: "Replace Block",
    description: "Replace one exact text block inside a workspace file.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "expectedOldText", "newText"],
      properties: {
        path: { type: "string" },
        expectedOldText: { type: "string" },
        newText: { type: "string" },
        dryRun: { type: "boolean" },
      },
      additionalProperties: false,
    },
    tags: ["edit", "replace", "patch", "file", "workspace"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => delegateReplaceBlock(context),
};

export const deletePathTool: ToolImplementation = {
  definition: {
    id: "delete_path",
    title: "Delete Path",
    description: "Delete a workspace file or directory; directories require recursive=true.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      additionalProperties: false,
    },
    tags: ["edit", "delete", "remove", "file", "directory", "workspace"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => delegateWorkspaceMutation(context, "delete"),
};

export const movePathTool: ToolImplementation = {
  definition: {
    id: "move_path",
    title: "Move Path",
    description: "Move or rename a workspace file or directory.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path", "destinationPath"],
      properties: {
        path: { type: "string" },
        destinationPath: { type: "string" },
        overwrite: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      additionalProperties: false,
    },
    tags: ["edit", "move", "rename", "file", "directory", "workspace"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path", "destinationPath"],
      },
    },
  },
  execute: async (context) => delegateWorkspaceMutation(context, "move"),
};

export const directEditTools = [
  writeFileTool,
  replaceBlockTool,
  deletePathTool,
  movePathTool,
] as const;
