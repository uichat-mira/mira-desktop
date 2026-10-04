import type {
  ToolInvocation,
  ToolTrace,
  ToolInvocationEvent,
  ToolContentBlock,
} from "../mcp/core/definitions.js";
import {
  clearInvocations,
  executeInvocation,
  getInvocation,
  getInvocationTraceRecord,
  listInvocationEvents,
  type ExecuteInvocationInput,
} from "../mcp/core/invocations.js";
import { getHarnessEnvironmentSnapshot } from "./environment.js";
import {
  projectHarnessResultForLlm,
  projectHarnessContentForLlm,
  type HarnessLlmContent,
} from "./llm-content.js";

export type HarnessInvocationRecord = ToolInvocation & {
  llmContent?: HarnessLlmContent;
};

export const executeHarnessInvocation = async (
  input: ExecuteInvocationInput,
): Promise<HarnessInvocationRecord> => {
  let modelContent: ToolContentBlock[] | undefined;
  let toolIsError = false;
  const record = await executeInvocation({
    ...input,
    environment: input.environment ?? getHarnessEnvironmentSnapshot(),
    onResultContent: (content, isError) => {
      modelContent = content;
      toolIsError = isError;
    },
  });

  if (record.status !== "completed") {
    return record;
  }

  const projected =
    projectHarnessContentForLlm(modelContent) ??
    projectHarnessResultForLlm(record.result);
  const llmContent =
    projected && toolIsError
      ? {
          ...projected,
          blocks: projected.blocks.map((block, index) =>
            index === 0
              ? { ...block, text: `toolOutcome=error\n${block.text}` }
              : block,
          ),
        }
      : projected;
  return llmContent ? { ...record, llmContent } : record;
};

export const getHarnessInvocation = (invocationId: string) =>
  getInvocation(invocationId);

export const listHarnessInvocationEvents = (
  invocationId: string,
): ToolInvocationEvent[] => listInvocationEvents(invocationId);

export const getHarnessInvocationTrace = (
  invocationId: string,
): ToolTrace | undefined => getInvocationTraceRecord(invocationId);

export const clearHarnessInvocations = () => {
  clearInvocations();
};
