import { runAgentRuntime } from "./runtime";
import { createAgentGoal } from "./nodes/index";
import { agentRunStore, configureAgentRunPersistence } from "./run-store";
import type { AgentGraphInput, AgentGraphOutput, AgentRun } from "./types";
import { agentRunRepository } from "@/db/repositories/agent-run.repository";
import { prepareSkillConversationFlow } from "@/skills/flow/coordinator.js";
import { buildSkillFlowRequestContextMessages } from "@/skills/flow/context.js";
import {
  buildAgentAttachmentGoalContext,
  materializeAgentTaskFileAttachments,
} from "@/services/chat-file-context.service.js";
import { persistAgentAssistantState } from "./resume";
import { conversationWorkdirService } from "@/services/conversation-workdir.service.js";
import {
  finishAgentRunControl,
  startAgentRunControlLease,
} from "./run-control";

configureAgentRunPersistence({
  create: (run) => {
    agentRunRepository.createPersistedRun(run);
  },
  get: agentRunRepository.get.bind(agentRunRepository),
  update: agentRunRepository.update.bind(agentRunRepository),
  addObservation: agentRunRepository.addObservation.bind(agentRunRepository),
  complete: agentRunRepository.complete.bind(agentRunRepository),
});

const getAgentAssistantContent = (output: AgentGraphOutput): string => {
  if (output.status === "waiting_approval") return "等待审批";
  if (output.status === "waiting_user") {
    return output.answer.trim() || "Agent 正在等待你的输入。";
  }
  if (output.status === "blocked") {
    return output.answer.trim() || "Agent 已阻断，请检查运行状态。";
  }
  if (output.status === "failed") {
    return output.answer.trim() || output.errorMessage?.trim() || "Agent 运行失败。";
  }
  return output.answer.trim() || "Agent 已完成。";
};

const persistRunningAgentState = (
  run: AgentRun,
  executionNodes: Parameters<typeof persistAgentAssistantState>[0]["executionNodes"] = [],
) => {
  persistAgentAssistantState({
    run,
    status: "running",
    content: "Agent 正在运行…",
    executionNodes,
  });
};

export const createAndRunAgent = async (
  input: Omit<AgentGraphInput, "runId" | "goal"> & {
    goalText: string;
    userMessageId?: string;
    assistantMessageId?: string;
    assistantParentId?: string | null;
  },
) => {
  const conversationWorkdir = conversationWorkdirService.ensure({
    threadId: input.threadId,
    userId: input.userId,
  });

  const materializedAttachments = await materializeAgentTaskFileAttachments({
    messages: input.messages,
    workspaceRoot: input.workspaceRoot,
  });
  const attachmentGoalContext = buildAgentAttachmentGoalContext(
    materializedAttachments,
  );
  const goal = createAgentGoal(
    attachmentGoalContext
      ? `${input.goalText}\n\n${attachmentGoalContext}`
      : input.goalText,
  );
  const latestUserMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "user");
  const flowUserMessageId =
    input.userMessageId ?? input.assistantParentId ?? latestUserMessage?.id;
  const preparedSkillFlow =
    flowUserMessageId && latestUserMessage
      ? await prepareSkillConversationFlow({
          threadId: input.threadId,
          userId: input.userId,
          userMessageId: flowUserMessageId,
          query: latestUserMessage.content.trim() || input.goalText,
          messages: input.messages,
        })
      : undefined;
  const mergedRequestContextMessages = [
    ...(input.requestContextMessages ?? []),
    ...buildSkillFlowRequestContextMessages(preparedSkillFlow?.directive),
    ...(preparedSkillFlow?.requestContextMessages ?? []),
  ];
  const requestContextMessages =
    mergedRequestContextMessages.length > 0
      ? mergedRequestContextMessages
      : undefined;

  const run = agentRunStore.create({
    threadId: input.threadId,
    userId: input.userId,
    goal,
    assistantMessageId: input.assistantMessageId,
    assistantParentId: input.assistantParentId,
    runtimeInput: {
      messages: input.messages,
      requestContextMessages,
      params: input.params,
      knowledgeBaseId: input.knowledgeBaseId,
      intentConfig: input.intentConfig,
      workspaceRoot: input.workspaceRoot,
      conversationWorkdir,
      requestedToolGroupIds: input.requestedToolGroupIds,
    },
  });

  const runningRun = agentRunStore.update(run.id, {
    status: "running",
  });
  const runControl = startAgentRunControlLease(run.id);

  try {
    persistRunningAgentState(runningRun);

    const output = await runAgentRuntime({
      ...input,
      conversationWorkdir,
      requestContextMessages,
      runId: run.id,
      runControlLeaseId: runControl.leaseId,
      goal,
      approvedInvocations: [],
      onExecutionNode: async (event) => {
        const current = agentRunStore.get(run.id);
        if (current?.status !== "cancelled") {
          persistRunningAgentState(current ?? runningRun, [event]);
        }
        await input.onExecutionNode?.(event);
      },
    });

    const afterExecution = agentRunStore.get(run.id);
    if (afterExecution?.status === "cancelled") {
      persistAgentAssistantState({
        run: afterExecution,
        status: "cancelled",
        content: "Agent 运行已取消。",
        terminalReason: "cancelled",
      });
      return { run: afterExecution, output };
    }

    for (const observation of output.observations) {
      agentRunStore.addObservation(run.id, observation);
    }

    const completedRun = agentRunStore.complete(run.id, {
      status: output.status,
      contextBudget: output.contextBudget,
      blockedReason: output.blockedReason,
      terminalReason: output.terminalReason,
      finalizationPacket: output.finalizationPacket,
      selectedToolId: output.selectedToolId ?? output.pendingApproval?.toolId,
      pendingToolCall: output.pendingToolCall,
      lastToolExecution: output.lastToolExecution,
      ...(output.pendingApproval
        ? { pendingApproval: output.pendingApproval }
        : { pendingApproval: undefined }),
    });

    persistAgentAssistantState({
      run: completedRun,
      status: output.status,
      content: getAgentAssistantContent(output),
      pendingApproval: output.pendingApproval,
      blockedReason: output.blockedReason,
      terminalReason: output.terminalReason,
      errorMessage: output.errorMessage,
      errorSourceNodeId: output.errorSourceNodeId,
    });

    return {
      run: completedRun,
      output,
    };
  } catch (error) {
    const current = agentRunStore.get(run.id);
    if (current?.status === "cancelled") {
      persistAgentAssistantState({
        run: current,
        status: "cancelled",
        content: "Agent 运行已取消。",
        terminalReason: "cancelled",
      });
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedRun = agentRunStore.complete(run.id, {
      status: "failed",
      blockedReason: errorMessage,
      terminalReason: "agent_runtime_failed",
    });
    persistAgentAssistantState({
      run: failedRun,
      status: "failed",
      content: "Agent 运行失败，请检查运行状态后重试。",
      blockedReason: errorMessage,
      terminalReason: "agent_runtime_failed",
      errorMessage,
    });
    throw error;
  } finally {
    finishAgentRunControl(run.id, runControl.leaseId);
  }
};

export { agentRunStore } from "./run-store";
export { configureAgentRunPersistence } from "./run-store";
export type * from "./types";
