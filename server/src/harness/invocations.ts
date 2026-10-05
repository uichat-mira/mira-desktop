import type {
  ToolInvocation,
  ToolTrace,
  ToolInvocationEvent,
  ToolContentBlock,
} from "../mcp/core/definitions.js";
import {
  claimInvocationApproval,
  clearInvocations,
  executeInvocation,
  finalizeClaimedInvocationApproval,
  getInvocation,
  getInvocationTraceRecord,
  getInvocationWorkspaceSnapshot,
  listInvocationEvents,
  resolveInvocationApproval,
  type ExecuteInvocationInput,
} from "../mcp/core/invocations.js";
import { mcpBadRequest, mcpNotFound } from "../mcp/core/errors.js";
import { createInvocationInputHash } from "../agent/approval-fingerprint.js";
import {
  createHarnessEnvironmentSnapshot,
  getHarnessEnvironmentSnapshot,
} from "./environment.js";
import {
  projectHarnessResultForLlm,
  projectHarnessContentForLlm,
  type HarnessLlmContent,
} from "./llm-content.js";
import { runWithWorkspaceRootOverride } from "../mcp/workspace.js";

export type HarnessInvocationRecord = ToolInvocation & {
  llmContent?: HarnessLlmContent;
};

export const executeHarnessInvocation = async (
  input: ExecuteInvocationInput,
): Promise<HarnessInvocationRecord> => {
  let modelContent: ToolContentBlock[] | undefined;
  let toolIsError = false;
  const environment = input.environment ?? getHarnessEnvironmentSnapshot();
  const execute = () =>
    executeInvocation({
      ...input,
      environment,
      onResultContent: (content, isError) => {
        modelContent = content;
        toolIsError = isError;
      },
    });
  const record = environment.workspace.rootPath
    ? await runWithWorkspaceRootOverride(environment.workspace.rootPath, execute)
    : await execute();

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
            index === 0
              ? { ...block, text: `toolOutcome=error\n${block.text}` }
              : block,
          ),
        }
      : projected;
  return llmContent ? { ...record, llmContent } : record;
};

export const resolveHarnessInvocationApproval = async (input: {
  invocationId: string;
  decision: "approved" | "rejected";
  toolId: string;
  args?: Record<string, unknown>;
  userId?: number;
}) => {
  const original = getInvocation(input.invocationId);
  if (!original) {
    throw mcpNotFound("Tool invocation was not found");
  }
  if (
    typeof original.userId === "number" &&
    original.userId !== input.userId
  ) {
    throw mcpNotFound("Tool invocation was not found");
  }
  if (original.status !== "awaiting_approval") {
    throw mcpBadRequest("Tool invocation is not awaiting approval");
  }
  if (original.toolId !== input.toolId) {
    throw mcpBadRequest("Tool approval does not match the original tool");
  }

  if (input.decision === "rejected") {
    return {
      originalInvocation: resolveInvocationApproval({
        invocationId: input.invocationId,
        decision: "rejected",
        reason: "Rejected from Tool Lab",
      }),
      resumedInvocation: null,
    };
  }

  const args = input.args ?? {};
  const inputHash = createInvocationInputHash(args);
  const originalWorkspace = getInvocationWorkspaceSnapshot(original.id);
  if (!originalWorkspace) {
    throw mcpBadRequest(
      "Tool invocation workspace snapshot is unavailable",
    );
  }
  if (!original.inputHash || original.inputHash !== inputHash) {
    throw mcpBadRequest(
      "Tool approval does not match the original invocation arguments",
    );
  }

  claimInvocationApproval({
    invocationId: input.invocationId,
    userId: input.userId,
    reason: "Approved from Tool Lab",
  });

  let resumed: HarnessInvocationRecord;
  try {
    resumed = await executeHarnessInvocation({
      toolId: input.toolId,
      args,
      userId: input.userId,
      approvedInvocations: [{ toolId: input.toolId, inputHash }],
      environment: createHarnessEnvironmentSnapshot({
        workspace: originalWorkspace,
      }),
    });
  } catch (error) {
    finalizeClaimedInvocationApproval({
      invocationId: input.invocationId,
      status: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "Approved tool invocation failed.",
    });
    throw error;
  }

  const originalInvocation = finalizeClaimedInvocationApproval({
    invocationId: input.invocationId,
    resolutionInvocationId: resumed.id,
    status:
      resumed.status === "completed"
        ? "completed"
        : resumed.status === "cancelled"
          ? "cancelled"
          : "failed",
    reason: resumed.error?.message,
  });

  return {
    originalInvocation,
    resumedInvocation: resumed,
  };
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
