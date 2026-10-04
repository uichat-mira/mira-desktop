import fs from "node:fs";
import type {
  ToolArtifact,
  ToolExecutionEnvironment,
  RuntimeCapability,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { createArtifact } from "../core/artifacts.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { ensureParentDir, resolveWorkspaceWritePath } from "../workspace.js";

type EditExecutionContext = {
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  pushEvent?: (event: ToolInvocationEventInput) => void;
};

type EditExecutionResult = {
  contents: {
    path: string;
    operation: "write_file" | "replace_block";
    dryRun: boolean;
    bytes: number;
  };
  artifacts: ToolArtifact[];
};

type EditOperation = EditExecutionResult["contents"]["operation"];
type EditCapability = ToolExecutionEnvironment["edit"]["capabilities"][number];

const assertEditEnvironment = (environment?: ToolExecutionEnvironment) => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Edit execution requires a harness environment snapshot");
  }

  return environment;
};

const sortCapabilities = (environment: ToolExecutionEnvironment) =>
  [...environment.edit.capabilities]
    .filter((capability) => capability.available)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

const getSelectedOperation = (value: unknown): EditOperation => {
  if (value === "write_file" || value === "replace_block") {
    return value;
  }

  throw mcpBadRequest("Unsupported edit operation");
};

const resolveCapabilityKind = (operation: EditOperation): RuntimeCapability["kind"] =>
  operation === "write_file" ? "write" : "replace";

const selectEditCapability = (
  environment: ToolExecutionEnvironment,
  operation: EditOperation,
) => {
  const kind = resolveCapabilityKind(operation);
  const selected = sortCapabilities(environment).find((capability) => capability.kind === kind);
  if (!selected) {
    throw mcpInternalError(`No edit capability available for operation ${operation}`);
  }

  return selected;
};

const replaceOnce = (input: {
  current: string;
  oldText: string;
  newText: string;
}) => {
  if (!input.oldText.length) {
    throw mcpBadRequest("expectedOldText must not be empty");
  }

  const index = input.current.indexOf(input.oldText);
  if (index < 0) {
    throw mcpBadRequest("expectedOldText does not match current file content");
  }

  const nextIndex = input.current.indexOf(input.oldText, index + input.oldText.length);
  if (nextIndex >= 0) {
    throw mcpBadRequest("expectedOldText must match exactly once");
  }

  return (
    input.current.slice(0, index) +
    input.newText +
    input.current.slice(index + input.oldText.length)
  );
};

const executeNodeWriteFile = (args: Record<string, unknown>) => {
  if (typeof args.content !== "string") {
    throw mcpBadRequest("content is required for write_file");
  }

  return args.content;
};

const executeNodeReplaceBlock = (targetPath: string, args: Record<string, unknown>) => {
  if (typeof args.expectedOldText !== "string" || typeof args.newText !== "string") {
    throw mcpBadRequest("expectedOldText and newText are required for replace_block");
  }

  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : "";
  return replaceOnce({
    current,
    oldText: args.expectedOldText,
    newText: args.newText,
  });
};

const executeCapability = (
  capability: EditCapability,
  targetPath: string,
  args: Record<string, unknown>,
) => {
  if (capability.id === "node-fs-write-file") {
    return executeNodeWriteFile(args);
  }

  if (capability.id === "node-fs-replace-block") {
    return executeNodeReplaceBlock(targetPath, args);
  }

  throw mcpInternalError(`Unsupported edit capability implementation: ${capability.id}`);
};

export const describeEditPlan = (
  environment: ToolExecutionEnvironment | undefined,
  args: Record<string, unknown>,
) => {
  const harnessEnvironment = assertEditEnvironment(environment);
  const operation = getSelectedOperation(args.operation);
  const chain = sortCapabilities(harnessEnvironment)
    .filter((capability) => capability.kind === resolveCapabilityKind(operation))
    .map((capability) => ({
      id: capability.id,
      priority: capability.priority,
    }));

  return {
    operation,
    chain,
  };
};

export const executeEditFileRuntime = async ({
  args,
  environment,
  pushEvent,
}: EditExecutionContext): Promise<EditExecutionResult> => {
  const harnessEnvironment = assertEditEnvironment(environment);
  const operation = getSelectedOperation(args.operation);
  const pathValue = typeof args.path === "string" ? args.path : "";
  if (!pathValue.trim()) {
    throw mcpBadRequest("path is required");
  }
  if (/[\\/]$/.test(pathValue.trim())) {
    throw mcpBadRequest("edit_file does not support directory paths");
  }

  const targetPath = resolveWorkspaceWritePath(pathValue);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    throw mcpBadRequest("edit_file does not support directory targets");
  }
  const targetExists = fs.existsSync(targetPath);
  const overwriteEscalatedToDryRun =
    operation === "write_file" && targetExists && args.dryRun !== true;
  const dryRun = args.dryRun === true || overwriteEscalatedToDryRun;
  const capability = selectEditCapability(harnessEnvironment, operation);

  pushEvent?.({
    type: "invocation:progress",
    message: `Edit plan: ${capability.id}`,
  });

  const nextContent = executeCapability(capability, targetPath, args);

  if (overwriteEscalatedToDryRun) {
    pushEvent?.({
      type: "invocation:progress",
      message: "Escalated existing-file overwrite to dry-run",
    });
  }

  pushEvent?.({
    type: "invocation:progress",
    message: dryRun ? "Prepared dry-run edit" : "Prepared file edit",
  });

  if (!dryRun) {
    try {
      ensureParentDir(targetPath);
      fs.writeFileSync(targetPath, nextContent, "utf-8");
    } catch (error) {
      throw mcpInternalError(`Failed to write file: ${targetPath}`, {
        cause: error,
      });
    }
  }

  return {
    contents: {
      path: pathValue,
      operation,
      dryRun,
      bytes: Buffer.byteLength(nextContent, "utf-8"),
    },
    artifacts: [
      createArtifact({
        kind: "code",
        title: `Edited ${pathValue}`,
        mimeType: "text/plain",
        data: nextContent,
        metadata: {
          dryRun,
          operation,
          strategyId: capability.id,
          provider: capability.provider,
        },
      }),
    ],
  };
};
