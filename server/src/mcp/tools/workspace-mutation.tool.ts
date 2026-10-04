import fs from "node:fs";
import path from "node:path";
import type { ToolArtifact, ToolImplementation } from "../core/definitions.js";
import { createArtifact } from "../core/artifacts.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import {
  ensureParentDir,
  readTextFileSafe,
  resolveWorkspacePath,
} from "../workspace.js";
import { emitArtifacts } from "./artifact-utils.js";

type WorkspaceMutationOperation = "delete" | "move" | "write";

const normalizeOperation = (value: unknown): WorkspaceMutationOperation => {
  if (value === "delete" || value === "move" || value === "write") {
    return value;
  }

  throw mcpBadRequest("operation must be one of: delete, move, write");
};

const requireTargetPath = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest("targetPath is required");
  }

  return value.trim();
};

const requireDestinationPath = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest("destinationPath is required for move");
  }

  return value.trim();
};

const requireContent = (value: unknown) => {
  if (typeof value !== "string") {
    throw mcpBadRequest("content is required for write");
  }

  return value;
};

const safeRelativePath = (value: string) => value.split(path.sep).join("/");

const createResultArtifact = (input: {
  operation: WorkspaceMutationOperation;
  targetPath: string;
  destinationPath?: string;
  dryRun: boolean;
  content?: string;
}): ToolArtifact => {
  const lines = [
    `operation: ${input.operation}`,
    `targetPath: ${input.targetPath}`,
    ...(input.destinationPath ? [`destinationPath: ${input.destinationPath}`] : []),
    `dryRun: ${input.dryRun ? "true" : "false"}`,
    ...(typeof input.content === "string" ? ["content:", input.content] : []),
  ];

  return createArtifact({
    kind: typeof input.content === "string" ? "code" : "markdown",
    title: `Workspace ${input.operation}: ${input.targetPath}`,
    mimeType: "text/plain",
    data: lines.join("\n"),
    metadata: {
      operation: input.operation,
      targetPath: input.targetPath,
      ...(input.destinationPath ? { destinationPath: input.destinationPath } : {}),
      dryRun: input.dryRun,
    },
  });
};

export const workspaceMutationTool: ToolImplementation = {
  definition: {
    id: "workspace_mutation",
    title: "Workspace Mutation",
    description:
      "Perform structured delete, move, or write operations inside the selected workspace.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["operation", "targetPath"],
      properties: {
        operation: {
          type: "string",
          enum: ["delete", "move", "write"],
        },
        targetPath: { type: "string" },
        destinationPath: { type: "string" },
        content: { type: "string" },
        recursive: { type: "boolean" },
        overwrite: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
    },
    tags: ["workspace", "edit", "mutation", "delete", "move", "write"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["targetPath", "destinationPath"],
      },
    },
  },
  execute: async (context) => {
    const operation = normalizeOperation(context.args.operation);
    const targetPath = requireTargetPath(context.args.targetPath);
    const resolvedTargetPath = resolveWorkspacePath(targetPath);
    const recursive = context.args.recursive === true;
    const overwrite = context.args.overwrite === true;
    const dryRun = context.args.dryRun === true;

    context.pushEvent({
      type: "invocation:progress",
      message: `Workspace mutation plan: ${operation}`,
    });

    let result: Record<string, unknown>;
    const artifacts: ToolArtifact[] = [];

    if (operation === "delete") {
      const exists = fs.existsSync(resolvedTargetPath);
      if (!exists) {
        throw mcpBadRequest(`targetPath does not exist: ${targetPath}`);
      }

      const stat = fs.statSync(resolvedTargetPath);
      if (stat.isDirectory() && !recursive) {
        throw mcpBadRequest("recursive=true is required to delete a directory");
      }

      if (!dryRun) {
        try {
          fs.rmSync(resolvedTargetPath, { recursive: stat.isDirectory(), force: false });
        } catch (error) {
          throw mcpInternalError(`Failed to delete workspace target: ${targetPath}`, {
            cause: error,
          });
        }
      }

      result = {
        operation,
        targetPath,
        dryRun,
        deletedType: stat.isDirectory() ? "directory" : "file",
        recursive: stat.isDirectory() ? recursive : false,
      };
      artifacts.push(
        createResultArtifact({
          operation,
          targetPath,
          dryRun,
        }),
      );
    } else if (operation === "move") {
      const destinationPath = requireDestinationPath(context.args.destinationPath);
      const resolvedDestinationPath = resolveWorkspacePath(destinationPath);

      if (!fs.existsSync(resolvedTargetPath)) {
        throw mcpBadRequest(`targetPath does not exist: ${targetPath}`);
      }
      if (fs.existsSync(resolvedDestinationPath) && !overwrite) {
        throw mcpBadRequest(
          "destinationPath already exists; set overwrite=true to replace it",
        );
      }

      if (!dryRun) {
        try {
          ensureParentDir(resolvedDestinationPath);
          if (fs.existsSync(resolvedDestinationPath) && overwrite) {
            const destinationStat = fs.statSync(resolvedDestinationPath);
            fs.rmSync(resolvedDestinationPath, {
              recursive: destinationStat.isDirectory(),
              force: false,
            });
          }
          fs.renameSync(resolvedTargetPath, resolvedDestinationPath);
        } catch (error) {
          throw mcpInternalError(
            `Failed to move workspace target from ${targetPath} to ${destinationPath}`,
            { cause: error },
          );
        }
      }

      result = {
        operation,
        targetPath,
        destinationPath,
        dryRun,
        overwrite,
      };
      artifacts.push(
        createResultArtifact({
          operation,
          targetPath,
          destinationPath,
          dryRun,
        }),
      );
    } else {
      const content = requireContent(context.args.content);
      const existing = fs.existsSync(resolvedTargetPath)
        ? readTextFileSafe(resolvedTargetPath)
        : null;
      if (existing !== null && !overwrite) {
        throw mcpBadRequest(
          "targetPath already exists; set overwrite=true to replace it",
        );
      }

      if (!dryRun) {
        try {
          ensureParentDir(resolvedTargetPath);
          fs.writeFileSync(resolvedTargetPath, content, "utf-8");
        } catch (error) {
          throw mcpInternalError(`Failed to write workspace target: ${targetPath}`, {
            cause: error,
          });
        }
      }

      result = {
        operation,
        targetPath,
        dryRun,
        overwrite,
        bytes: Buffer.byteLength(content, "utf-8"),
      };
      artifacts.push(
        createResultArtifact({
          operation,
          targetPath,
          dryRun,
          content,
        }),
      );
    }

    context.pushEvent({
      type: "invocation:progress",
      message: dryRun
        ? "Prepared dry-run workspace mutation"
        : "Applied workspace mutation",
    });

    emitArtifacts(context, artifacts);

    return {
      result: {
        ...result,
        targetPath: safeRelativePath(String(result.targetPath)),
        ...(typeof result.destinationPath === "string"
          ? { destinationPath: safeRelativePath(result.destinationPath) }
          : {}),
      },
    };
  },
};
