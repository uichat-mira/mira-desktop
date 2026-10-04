import type { ToolExecutionEnvironment, ToolInvocationEventInput } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { assertReadEnvironment, sliceExtractedText } from "../document-readers.js";
import type { ReadSliceResult } from "./types.js";

export type ReadSliceArgs = {
  text: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
};

export const executeReadSlice = async (
  environment: ToolExecutionEnvironment | undefined,
  rawArgs: ReadSliceArgs,
  pushEvent?: (event: ToolInvocationEventInput) => void,
) => {
  const harnessEnvironment = assertReadEnvironment(environment);

  if (typeof rawArgs.text !== "string" || !rawArgs.text.trim()) {
    throw mcpBadRequest("text is required");
  }

  const sliceCapabilities = harnessEnvironment.read.capabilities
    .filter((capability) => capability.available && capability.kind === "slice")
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  pushEvent?.({
    type: "invocation:progress",
    message: `Slice plan: ${sliceCapabilities.map((capability) => capability.id).join(" -> ") || "text-slice"}`,
  });

  const slice = sliceExtractedText(rawArgs.text, {
    startLine: rawArgs.startLine,
    endLine: rawArgs.endLine,
    maxLines: rawArgs.maxLines,
  });

  const contents: ReadSliceResult = {
    type: "slice",
    slice,
  };

  return {
    contents,
    artifacts: [
      {
        kind: "text",
        title: "Slice Extracted Text",
        mimeType: "text/plain",
        data: slice.text,
        metadata: {
          startLine: slice.startLine,
          endLine: slice.endLine,
          totalLines: slice.totalLines,
        },
      },
    ],
  };
};
