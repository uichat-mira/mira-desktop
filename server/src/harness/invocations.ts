import type {
  ToolInvocation,
  ToolTrace,
  ToolInvocationEvent,
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
  type HarnessLlmContent,
} from "./llm-content.js";

export type HarnessInvocationRecord = ToolInvocation & {
  llmContent?: HarnessLlmContent;
};

export const executeHarnessInvocation = async (
  input: ExecuteInvocationInput,
): Promise<HarnessInvocationRecord> => {
  const record = await executeInvocation({
    ...input,
    environment: input.environment ?? getHarnessEnvironmentSnapshot(),
  });

  if (record.status !== "completed") {
    return record;
  }

  const llmContent = projectHarnessResultForLlm(record.result);
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

export const clearHarnessInvocations = () => clearInvocations();
