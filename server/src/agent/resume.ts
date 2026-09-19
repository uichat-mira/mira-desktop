import { agentGraph } from "./graph";
import { agentRunStore } from "./run-store";
import { getAgentRunById } from "./run-read";
import { toAgentErrorExecutionNode, toAgentResumeExecutionNode } from "./trace";
import type {
  AgentApprovalRequest,
  AgentApprovedInvocation,
  AgentRun,
  AgentToolCallRequest,
} from "./types";
import { persistAssistantMessage } from "@/routes/proxy-provider/message-persistence";
import { threadService } from "@/services/thread.service";
import {
  ConversationWorkdirError,
  conversationWorkdirService,
} from "@/services/conversation-workdir.service.js";
import type { AssistantExecutionNodeEvent } from "@/services/chat-stream-events";
import {
  finishAgentRunControl,
  startAgentRunControlLease,
} from "./run-control";
import { registerConversationWorkdirOutputs } from "./conversation-artifact-registration";
import type { ConversationArtifactReference } from "@/services/conversation-artifact.service.js";
import { getAgentRuntimeCheckpoint } from "./runtime-checkpoint";

const buildAssistantMetadata = (input: {
  runId: string;
  traceId: string;
  status:
    | "running"
    | "completed"
    | "failed"
    | "blocked"
    | "waiting_approval"
    | "waiting_user"
    | "cancelled";
  pendingApproval?: {
    id: string;
    stepId: string;
    toolId: string;
    toolCallId?: string;
    reason: string;
    input?: Record<string, unknown>;
    inputHash?: string;
    createdAt: string;
  };
  blockedReason?: string;
  terminalReason?: string;
  errorMessage?: string;
  errorSourceNodeId?: string;
  conversationArtifacts?: ConversationArtifactReference[];
}) => ({
  agent: {
    status: input.status,
    runId: input.runId,
    traceId: input.traceId,
    ...(input.pendingApproval
      ? {
          pendingApproval: input.pendingApproval,
        }
      : {}),
    ...(input.errorMessage
      ? {
          errorMessage: input.errorMessage,
        }
      : {}),
    ...(input.blockedReason
      ? {
          blockedReason: input.blockedReason,
        }
      : {}),
    ...(input.terminalReason
      ? {
          terminalReason: input.terminalReason,
        }
      : {}),
    ...(input.errorSourceNodeId
      ? {
          errorSourceNodeId: input.errorSourceNodeId,
        }
      : {}),
    ...(input.conversationArtifacts?.length
      ? { conversationArtifacts: input.conversationArtifacts }
      : {}),
  },
});

const getExistingAssistantMessage = (input: {
  assistantMessageId?: string;
  userId: number;
}) => {
  if (!input.assistantMessageId) {
    return null;
  }

  return threadService.getMessageById(input.assistantMessageId, input.userId);
};

const toApprovedInvocation = (input: {
  pendingApproval: AgentApprovalRequest;
  pendingToolCall: AgentToolCallRequest;
}): AgentApprovedInvocation => ({
  toolId: input.pendingToolCall.toolId,
  input: input.pendingToolCall.args,
  inputHash: input.pendingToolCall.inputHash,
  approvedAt: new Date().toISOString(),
  approvalId: input.pendingApproval.id,
});

const getApprovalResumeMismatchReason = (input: {
  pendingApproval: AgentApprovalRequest;
  pendingToolCall: AgentToolCallRequest;
}) => {
  if (input.pendingApproval.toolId !== input.pendingToolCall.toolId) {
    return `Approval resume mismatch: approved toolId ${input.pendingApproval.toolId} does not match frozen pendingToolCall.toolId ${input.pendingToolCall.toolId}.`;
  }

  if (
    input.pendingApproval.inputHash &&
    input.pendingApproval.inputHash !== input.pendingToolCall.inputHash
  ) {
    return `Approval resume mismatch: approved inputHash ${input.pendingApproval.inputHash} does not match frozen pendingToolCall.inputHash ${input.pendingToolCall.inputHash}.`;
  }

  if (
    input.pendingApproval.toolCallId &&
    "id" in input.pendingToolCall &&
    input.pendingApproval.toolCallId !== input.pendingToolCall.id
  ) {
    return `Approval resume mismatch: approved toolCallId ${input.pendingApproval.toolCallId} does not match frozen pendingToolCall.id ${input.pendingToolCall.id}.`;
  }

  return null;
};

const buildAssistantParts = (input: {
  content: string;
  existingParts?: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        image: string;
        filename?: string;
        fileId?: string;
        mediaType?: string;
      }
    | {
        type: "file";
        data: string;
        filename: string;
        fileId?: string;
        mimeType: string;
      }
    | {
        type: "data";
        name: string;
        value: unknown;
      }
  >;
  executionNodes: AssistantExecutionNodeEvent[];
}) => {
  const baseParts = input.content.trim()
    ? [
        {
          type: "text" as const,
          text: input.content,
        },
      ]
    : [];
  const persistedDataParts = (input.existingParts ?? []).filter(
    (part): part is { type: "data"; name: string; value: unknown } =>
      part.type === "data",
  );
  const appendedDataParts = input.executionNodes.map((node) => ({
    type: "data" as const,
    name: "execution-node",
    value: node,
  }));
  const dedupedDataParts = new Map<
    string,
    { type: "data"; name: string; value: unknown }
  >();

  for (const part of [...persistedDataParts, ...appendedDataParts]) {
    dedupedDataParts.set(`${part.name}:${JSON.stringify(part.value)}`, part);
  }

  return [...baseParts, ...dedupedDataParts.values()];
};

export const persistAgentAssistantState = (input: {
  run: {
    id: string;
    traceId: string;
    threadId: string;
    userId: number;
    assistantMessageId?: string;
    assistantParentId?: string | null;
  };
  status:
    | "running"
    | "completed"
    | "failed"
    | "blocked"
    | "waiting_approval"
    | "waiting_user"
    | "cancelled";
  content: string;
  pendingApproval?: AgentApprovalRequest;
  blockedReason?: string;
  terminalReason?: string;
  errorMessage?: string;
  errorSourceNodeId?: string;
  conversationArtifacts?: ConversationArtifactReference[];
  executionNodes?: AssistantExecutionNodeEvent[];
}) => {
  if (
    !input.run.assistantMessageId ||
    typeof input.run.assistantParentId === "undefined"
  ) {
    return;
  }

  const existingAssistantMessage = getExistingAssistantMessage({
    assistantMessageId: input.run.assistantMessageId,
    userId: input.run.userId,
  });
  const content =
    input.content.trim() || existingAssistantMessage?.content?.trim() || "";
  const parts = buildAssistantParts({
    content,
    existingParts: existingAssistantMessage?.parts,
    executionNodes: input.executionNodes ?? [],
  });

  persistAssistantMessage({
    threadId: input.run.threadId,
    userId: input.run.userId,
    assistantMessageId: input.run.assistantMessageId,
    parentId: input.run.assistantParentId ?? null,
    content,
    parts,
    metadata: buildAssistantMetadata({
      runId: input.run.id,
      traceId: input.run.traceId,
      status: input.status,
      pendingApproval: input.pendingApproval,
      blockedReason: input.blockedReason,
      terminalReason: input.terminalReason,
      errorMessage: input.errorMessage,
      errorSourceNodeId: input.errorSourceNodeId,
      conversationArtifacts: input.conversationArtifacts,
    }),
  });
};

type PreparedApprovedAgentRunResume = {
  run: AgentRun;
  runtimeInput: NonNullable<AgentRun["runtimeInput"]>;
  conversationWorkdir: NonNullable<AgentRun["runtimeInput"]>["conversationWorkdir"];
  pendingApproval: AgentApprovalRequest;
  pendingToolCall: AgentToolCallRequest;
  approvedInvocations: AgentApprovedInvocation[];
  resumeExecutionNode: AssistantExecutionNodeEvent;
};

const prepareApprovedAgentRunResume = (
  runId: string,
  options: { persistRunningState: boolean },
): PreparedApprovedAgentRunResume => {
  const run = getAgentRunById(runId);
  if (!run) {
    throw new Error(`AgentRun not found: ${runId}`);
  }

  const runtimeInput = run.runtimeInput;
  if (!runtimeInput) {
    throw new Error(`AgentRun missing runtime input: ${runId}`);
  }

  const pendingApproval = run.pendingApproval;
  const pendingToolCall = run.pendingToolCall;
  if (!pendingApproval || !pendingToolCall) {
    throw new Error(`AgentRun missing frozen approval invocation: ${runId}`);
  }

  const mismatchReason = getApprovalResumeMismatchReason({
    pendingApproval,
    pendingToolCall,
  });
  if (mismatchReason) {
    const blockedRun = agentRunStore.complete(runId, {
      status: "blocked",
      pendingApproval: undefined,
      pendingToolCall: undefined,
      selectedToolId: undefined,
      blockedReason: mismatchReason,
      terminalReason: "approval_resume_mismatch",
    });
    persistAgentAssistantState({
      run: blockedRun,
      status: "blocked",
      content: "审批对象与待执行工具不一致，已阻断本次执行，工具没有运行。",
      blockedReason: mismatchReason,
      terminalReason: "approval_resume_mismatch",
      executionNodes: [
        toAgentErrorExecutionNode({
          runId,
          nodeId: "agent-resume-execution",
          label: "恢复执行",
          summary: "审批对象与待执行工具不一致，已阻断恢复执行",
          details: {
            toolId: pendingToolCall.toolId,
            toolCallId:
              "id" in pendingToolCall ? pendingToolCall.id : null,
            inputHash: pendingToolCall.inputHash,
            reason: mismatchReason,
          },
        }),
      ],
    });
    throw new Error(mismatchReason);
  }

  const approvedInvocation = toApprovedInvocation({
    pendingApproval,
    pendingToolCall,
  });
  const conversationWorkdir = runtimeInput.conversationWorkdir
    ? conversationWorkdirService.reopen({
        threadId: run.threadId,
        userId: run.userId,
        reference: runtimeInput.conversationWorkdir,
      })
    : undefined;
  const checkpoint = getAgentRuntimeCheckpoint(runtimeInput);
  const conversationWorkdirOutputs =
    runtimeInput.conversationWorkdirOutputs ?? checkpoint?.conversationWorkdirOutputs;
  const resumedRuntimeInput = {
    ...runtimeInput,
    ...(conversationWorkdir ? { conversationWorkdir } : {}),
    ...(conversationWorkdirOutputs ? { conversationWorkdirOutputs } : {}),
  };
  const approvedInvocations = [
    ...(run.approvedInvocations ?? []),
    approvedInvocation,
  ];

  const runningRun = agentRunStore.update(runId, {
    status: "running",
    pendingApproval: undefined,
    approvedInvocations,
    // Compatibility field only; graph execution still uses pendingToolCall.
    selectedToolId: pendingToolCall.toolId,
    pendingToolCall,
    runtimeInput: resumedRuntimeInput,
  });
  const resumeExecutionNode = toAgentResumeExecutionNode({
    runId,
    toolId: pendingToolCall.toolId,
    toolCallId: "id" in pendingToolCall ? pendingToolCall.id : undefined,
    inputHash: pendingToolCall.inputHash,
  });

  if (options.persistRunningState) {
    persistAgentAssistantState({
      run: runningRun,
      status: "running",
      content: "",
      executionNodes: [resumeExecutionNode],
    });
  }

  return {
    run: runningRun,
    runtimeInput: resumedRuntimeInput,
    conversationWorkdir,
    pendingApproval,
    pendingToolCall,
    approvedInvocations,
    resumeExecutionNode,
  };
};

const persistIncrementalResumeNode = (
  runId: string,
  event: AssistantExecutionNodeEvent,
) => {
  const currentRun = getAgentRunById(runId);
  if (!currentRun || currentRun.status !== "running") {
    return;
  }

  persistAgentAssistantState({
    run: currentRun,
    status: "running",
    content: "",
    executionNodes: [event],
  });
};

const executePreparedApprovedAgentRunResume = async (
  prepared: PreparedApprovedAgentRunResume,
  options: {
    persistIncrementally: boolean;
    runControlLeaseId: string;
  },
) => {
  const { run, runtimeInput, pendingApproval, pendingToolCall, approvedInvocations } =
    prepared;
  const resumedExecutionNodes: AssistantExecutionNodeEvent[] = [
    prepared.resumeExecutionNode,
  ];
  const output = await agentGraph.run({
    runId: run.id,
    runControlLeaseId: options.runControlLeaseId,
    threadId: run.threadId,
    userId: run.userId,
    goal: run.goal,
    messages: runtimeInput.messages,
    requestContextMessages: runtimeInput.requestContextMessages,
    params: runtimeInput.params,
    knowledgeBaseId: runtimeInput.knowledgeBaseId,
    intentConfig: runtimeInput.intentConfig,
    workspaceRoot: runtimeInput.workspaceRoot,
    conversationWorkdir: prepared.conversationWorkdir,
    conversationWorkdirOutputs: runtimeInput.conversationWorkdirOutputs,
    approvedInvocations,
    // Compatibility input only; createInitialAgentGraphState does not store or read it.
    selectedToolId: pendingToolCall.toolId,
    pendingToolCall,
    onExecutionNode: (event) => {
      resumedExecutionNodes.push(event);
      if (options.persistIncrementally) {
        persistIncrementalResumeNode(run.id, event);
      }
    },
  });

  const currentRun = getAgentRunById(run.id);
  if (currentRun?.status === "cancelled") {
    return {
      run: currentRun,
      output,
    };
  }

  const outputDeclarations =
    output.conversationWorkdirOutputs ??
    runtimeInput.conversationWorkdirOutputs;
  const conversationArtifacts =
    output.status === "completed"
      ? registerConversationWorkdirOutputs({
          threadId: run.threadId,
          userId: run.userId,
          declarations: outputDeclarations,
        })
      : [];
  const outputWithArtifacts = conversationArtifacts.length
    ? { ...output, conversationArtifacts }
    : output;

  for (const observation of outputWithArtifacts.observations) {
    agentRunStore.addObservation(run.id, observation);
  }

  agentRunStore.complete(run.id, {
    status: outputWithArtifacts.status,
    contextBudget: outputWithArtifacts.contextBudget,
    blockedReason: outputWithArtifacts.blockedReason,
    terminalReason: outputWithArtifacts.terminalReason,
    finalizationPacket: outputWithArtifacts.finalizationPacket,
    approvedInvocations:
      outputWithArtifacts.approvedInvocations ?? approvedInvocations,
    // Resume output follows the same compatibility rule: no execution may be
    // derived from selectedToolId.
    selectedToolId:
      outputWithArtifacts.selectedToolId ??
      outputWithArtifacts.pendingApproval?.toolId ??
      pendingApproval.toolId,
    pendingToolCall: outputWithArtifacts.pendingToolCall,
    lastToolExecution: outputWithArtifacts.lastToolExecution,
    ...(outputWithArtifacts.pendingApproval
      ? { pendingApproval: outputWithArtifacts.pendingApproval }
      : { pendingApproval: undefined }),
    ...(outputWithArtifacts.status === "completed"
      ? { pendingApproval: undefined }
      : {}),
  });

  const nextRun = getAgentRunById(run.id);

  if (nextRun) {
    persistAgentAssistantState({
      run: nextRun,
      status: outputWithArtifacts.status,
      content: outputWithArtifacts.answer,
      pendingApproval: outputWithArtifacts.pendingApproval,
      blockedReason: outputWithArtifacts.blockedReason,
      terminalReason: outputWithArtifacts.terminalReason,
      errorMessage: outputWithArtifacts.errorMessage,
      errorSourceNodeId: outputWithArtifacts.errorSourceNodeId,
      conversationArtifacts: outputWithArtifacts.conversationArtifacts,
      executionNodes: resumedExecutionNodes,
    });
  }

  return {
    run: nextRun,
    output: outputWithArtifacts,
  };
};

const failScheduledApprovedAgentRunResume = (
  prepared: PreparedApprovedAgentRunResume,
  error: unknown,
) => {
  const currentRun = getAgentRunById(prepared.run.id);
  if (!currentRun || currentRun.status !== "running") {
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const failedRun = agentRunStore.complete(prepared.run.id, {
    status: "failed",
    pendingApproval: undefined,
    pendingToolCall: undefined,
    selectedToolId: prepared.pendingToolCall.toolId,
    blockedReason: errorMessage,
    terminalReason: "approval_resume_failed",
  });
  persistAgentAssistantState({
    run: failedRun,
    status: "failed",
    content: "审批通过后恢复执行失败，请检查执行过程后重试。",
    blockedReason: errorMessage,
    terminalReason: "approval_resume_failed",
    errorMessage,
    errorSourceNodeId: "agent-resume-execution",
    executionNodes: [
      toAgentErrorExecutionNode({
        runId: prepared.run.id,
        nodeId: "agent-resume-execution",
        label: "恢复执行",
        summary: "审批后的恢复执行失败",
        details: {
          toolId: prepared.pendingToolCall.toolId,
          errorMessage,
        },
      }),
    ],
  });
};

/**
 * Compatibility path used by existing callers and tests that need the resumed
 * result synchronously. The public approve route uses the scheduled variant.
 */
export const resumeApprovedAgentRun = async (runId: string) => {
  const prepared = prepareApprovedAgentRunResume(runId, {
    persistRunningState: false,
  });
  const runControl = startAgentRunControlLease(runId);
  try {
    return await executePreparedApprovedAgentRunResume(prepared, {
      persistIncrementally: false,
      runControlLeaseId: runControl.leaseId,
    });
  } catch (error) {
    failScheduledApprovedAgentRunResume(prepared, error);
    throw error;
  } finally {
    finishAgentRunControl(runId, runControl.leaseId);
  }
};

/**
 * Starts approval resume work without holding the HTTP request open. The run is
 * synchronously moved to `running`; execution continues in the next microtask.
 */
export const scheduleApprovedAgentRunResume = (runId: string) => {
  let prepared: PreparedApprovedAgentRunResume;
  try {
    prepared = prepareApprovedAgentRunResume(runId, {
      persistRunningState: true,
    });
  } catch (error) {
    if (error instanceof ConversationWorkdirError) {
      const run = getAgentRunById(runId);
      if (run) {
        persistAgentAssistantState({
          run,
          status: "waiting_approval",
          content: "工作目录无法恢复，审批仍保留，请修复工作目录后重试。",
          pendingApproval: run.pendingApproval,
          errorMessage: error.message,
          errorSourceNodeId: "agent-resume-workdir",
          executionNodes: [
            toAgentErrorExecutionNode({
              runId,
              nodeId: "agent-resume-workdir",
              label: "恢复工作目录",
              summary: "工作目录恢复失败，未开始恢复执行",
              details: { code: error.code, errorMessage: error.message },
            }),
          ],
        });
      }
    }
    throw error;
  }

  const runControl = startAgentRunControlLease(runId);
  queueMicrotask(() => {
    void executePreparedApprovedAgentRunResume(prepared, {
      persistIncrementally: true,
      runControlLeaseId: runControl.leaseId,
    })
      .catch((error) => {
        failScheduledApprovedAgentRunResume(prepared, error);
      })
      .finally(() => {
        finishAgentRunControl(runId, runControl.leaseId);
      });
  });

  return prepared.run;
};
