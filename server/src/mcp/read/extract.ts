import type { ToolExecutionEnvironment, ToolInvocationEventInput } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { assertReadEnvironment, assertPathExists, readStructuredDocument, sliceExtractedText } from "../document-readers.js";
import { resolveWorkspacePath } from "../workspace.js";
import type { ReadExtractResult } from "./types.js";

export type ReadExtractArgs = {
  path: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
};

export const describeExtractPlan = (
  environment: ToolExecutionEnvironment | undefined,
  targetPath: string,
) => {
  const harnessEnvironment = assertReadEnvironment(environment);
  const plan = harnessEnvironment.read.capabilities
    .filter((capability) => capability.available)
    .filter((capability) => capability.kind === "extract")
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .map((capability) => ({
      id: capability.id,
      priority: capability.priority,
      selected: capability.extensions?.length
        ? capability.extensions.includes(targetPath.slice(targetPath.lastIndexOf(".")))
        : true,
    }));

  return {
    chain: plan,
  };
};

export const executeReadExtract = async (
  environment: ToolExecutionEnvironment | undefined,
  rawArgs: ReadExtractArgs,
  pushEvent?: (event: ToolInvocationEventInput) => void,
) => {
  const harnessEnvironment = assertReadEnvironment(environment);
  const pathValue = typeof rawArgs.path === "string" ? rawArgs.path.trim() : "";
  if (!pathValue) {
    throw mcpBadRequest("path is required");
  }

  const targetPath = resolveWorkspacePath(pathValue);
  assertPathExists(targetPath);

  const plan = describeExtractPlan(harnessEnvironment, targetPath);
  pushEvent?.({
    type: "invocation:progress",
    message: `Extract plan: ${plan.chain.map((step) => step.id).join(" -> ")}`,
  });

  const result = await readStructuredDocument(harnessEnvironment, targetPath);
  const sliced = sliceExtractedText(result.text, {
    startLine: rawArgs.startLine,
    endLine: rawArgs.endLine,
    maxLines: rawArgs.maxLines,
  });

  const contents: ReadExtractResult = {
    type: "extract",
    path: pathValue,
    source: result,
    slice: sliced,
  };

  return {
    contents,
    artifacts: [
      {
        kind: result.kind === "table" ? "table" : "document",
        title: `Extract ${pathValue}`,
        mimeType: result.mimeType,
        data: sliced.text,
        metadata: {
          readerStrategy: result.metadata.readerStrategy,
          readerProvider: result.metadata.readerProvider,
          slice: sliced,
        },
      },
    ],
  };
};
