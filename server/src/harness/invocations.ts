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
  projectHarnessTextOnlyContent,
  type HarnessLlmContent,
} from "./llm-content.js";

export type HarnessInvocationRecord = ToolInvocation & {
  llmContent?: HarnessLlmContent;
};

const modelContentByInvocation = new WeakMap<ToolInvocation, HarnessLlmContent>();

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
    projectHarnessResultForLlm(record.result) ??
    (toolIsError
      ? projectHarnessResultForLlm("Tool returned an error outcome without content.")
      : undefined);
  const llmContent =
    projected && toolIsError
      ? {
          ...projected,
          blocks: projected.blocks.map((block, index) =>
            index === 0 && block.type === "text"
              ? { ...block, text: `toolOutcome=error\n${block.text}` }
              : block,
          ),
        }
      : projected;
  if (llmContent) {
    modelContentByInvocation.set(record, llmContent);
  }
  const serializableLlmContent = projectHarnessTextOnlyContent(llmContent);
  return serializableLlmContent
    ? { ...record, llmContent: serializableLlmContent }
    : record;
};

export const getHarnessInvocation = (invocationId: string) =>
  getInvocation(invocationId);

export const getHarnessInvocationModelContent = (
  invocationId: string,
): HarnessLlmContent | undefined => {
  const record = getInvocation(invocationId);
  return record ? modelContentByInvocation.get(record) : undefined;
};

export const listHarnessInvocationEvents = (
  invocationId: string,
): ToolInvocationEvent[] => listInvocationEvents(invocationId);

export const getHarnessInvocationTrace = (
  invocationId: string,
): ToolTrace | undefined => getInvocationTraceRecord(invocationId);

export const clearHarnessInvocations = () => {
  clearInvocations();
};
