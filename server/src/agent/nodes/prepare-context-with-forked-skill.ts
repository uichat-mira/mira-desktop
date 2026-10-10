import crypto from "node:crypto";
import { getSkillAgentExecutionProfile } from "@/skills/agent/profiles.js";
import type { SkillContext } from "@/skills/context/types.js";
import type { SkillRequirement } from "@/skills/flow/types.js";
import {
  emitStepNode,
  type AgentNodeState,
  type EmitAgentExecutionNode,
} from "../node-runtime.js";
import type {
  AgentEvidenceReference,
  AgentFinalizationPacket,
  AgentObservation,
  AgentToolExposureState,
} from "../types.js";
import { evidenceNode } from "./evidence.js";
import { forkedSkillAgentNode } from "./forked-skill-agent.js";
import { prepareContextNode as basePrepareContextNode } from "./prepare-context.js";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const readDelegatedResult = (state: {
  summary?: { data?: unknown };
}) => {
  const data = asRecord(state.summary?.data);
  const preview = asRecord(data?.preview);
  const status = typeof preview?.status === "string" ? preview.status : undefined;
  const requirements = Array.isArray(preview?.requirements)
    ? preview.requirements
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return { status, requirements };
};

const buildNeedsInputQuestion = (
  requirements: Record<string, unknown>[],
): string | undefined => {
  const questions = requirements
    .filter((requirement) => requirement.kind === "user_input")
    .map((requirement) => {
      const userPrompt =
        typeof requirement.userPrompt === "string"
          ? requirement.userPrompt.trim()
          : "";
      const description =
        typeof requirement.description === "string"
          ? requirement.description.trim()
          : "";
      return userPrompt || description;
    })
    .filter(Boolean);

  return questions.length > 0 ? questions.join("\n") : undefined;
};

const narrowParentRecoveryToolExposure = (input: {
  skillId: string;
  toolExposure?: AgentToolExposureState;
}): AgentToolExposureState | undefined => {
  if (!input.toolExposure) return undefined;
  const profile = getSkillAgentExecutionProfile(input.skillId);
  const allowed = new Set(profile.allowedHarnessToolIds);
  return {
    exposedTools: input.toolExposure.exposedTools.filter((toolId) => allowed.has(toolId)),
    toolMeta: input.toolExposure.toolMeta.filter((tool) => allowed.has(tool.toolId)),
    // Recovery narrowing is an authority boundary for the active Skill, so the
    // delegated envelope narrows with it instead of staying broad.
    ...(input.toolExposure.eligibleTools
      ? {
          eligibleTools: input.toolExposure.eligibleTools.filter((toolId) =>
            allowed.has(toolId),
          ),
        }
      : {}),
  };
};

type SkillRuntimeProjection = {
  skillId: string;
  sessionId: string;
  phase: string;
  status: "running" | "interrupted" | "completed";
  flowCompleted: boolean;
  deliveryReady: boolean;
  interruptionReason?: string;
  round?: number;
  maxRounds?: number;
  requirements: SkillRequirement[];
};

type SkillAwareTaskFrame = NonNullable<AgentNodeState["currentTaskFrame"]> & {
  skillContext?: SkillContext;
  skillRuntime?: SkillRuntimeProjection;
};

const getFlowBackedDelegation = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState> | null> => {
  const frame = state.currentTaskFrame as SkillAwareTaskFrame | undefined;
  const runtime = frame?.skillRuntime;
  const primary = frame?.skillContext?.primary;
  if (
    !runtime ||
    !primary ||
    runtime.skillId !== primary.id ||
    runtime.status === "running"
  ) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const timestamp = Date.now();
  const subAgentRunId = `skill-flow:${runtime.sessionId}`;
  const baseSeq = Math.max(1, (runtime.round ?? 0) * 10 + 1);
  const completed = runtime.status === "completed";
  const title = completed
    ? `${primary.name} subAgent 已完成`
    : `${primary.name} subAgent 等待补充信息`;
  const currentJudgement = completed
    ? runtime.deliveryReady
      ? "确定性 Skill Flow 已完成全部阶段，结构化交付已准备好。"
      : "确定性 Skill Flow 已达到完成状态，正在交还最终结果。"
    : `确定性 Skill Flow 已完成第 ${runtime.round ?? 0} 轮判断，当前仍有 ${runtime.requirements.length} 项必要信息缺失。`;
  const currentAction = completed
    ? "准备向用户交付本次 Skill 结果"
    : "等待用户补充当前阶段所需信息";
  const nextAction = completed
    ? "由 Main Agent 按冻结交付合同直接返回结果"
    : "收到补充后继续同一 Skill Flow 会话";
  const blockingReason = completed
    ? undefined
    : runtime.requirements.map((item) => item.description).join("；") ||
      runtime.interruptionReason;

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: `subagent-trace:${subAgentRunId}:${baseSeq}`,
    nodeType: "reason",
    phase: "done",
    label: title,
    emittedAt: createdAt,
    details: {
      subAgentTraceEvent: true,
      subAgentRunId,
      subAgentSeq: baseSeq,
      subAgentEventId: crypto.randomUUID(),
      subAgentEventType: completed ? "subagent.completed" : "input.required",
      skillId: primary.id,
      traceDetails: {
        controller: "skill-flow-runtime",
        sessionId: runtime.sessionId,
        phase: runtime.phase,
        round: runtime.round ?? null,
        maxRounds: runtime.maxRounds ?? null,
        deliveryReady: runtime.deliveryReady,
        flowCompleted: runtime.flowCompleted,
      },
    },
  });

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: `subagent-working-state:${subAgentRunId}:${timestamp}`,
    nodeType: "reason",
    phase: "done",
    label: "subAgent 当前工作",
    emittedAt: createdAt,
    details: {
      subAgentWorkingState: true,
      subAgentRunId,
      skillId: primary.id,
      workingState: {
        runId: subAgentRunId,
        skillId: primary.id,
        phase: completed ? "completed" : "waiting_input",
        currentJudgement,
        currentAction,
        nextAction,
        ...(blockingReason ? { blockingReason } : {}),
        updatedAt: timestamp,
      },
    },
  });

  const facts = [
    `Stateful Skill Flow is the single subAgent controller for ${primary.id}.`,
    `Flow session: ${runtime.sessionId}`,
    `Flow phase: ${runtime.phase}`,
    `Flow status: ${runtime.status}`,
    `Flow completed: ${runtime.flowCompleted}`,
    `Delivery ready: ${runtime.deliveryReady}`,
    ...(runtime.round !== undefined
      ? [`Round: ${runtime.round}/${runtime.maxRounds ?? "unknown"}`]
      : []),
    ...(runtime.requirements.length > 0
      ? [
          `Requirements: ${JSON.stringify(
            runtime.requirements.map((item) => ({
              id: item.id,
              kind: item.kind,
              description: item.description,
              requiredFor: item.requiredFor,
              ...(item.userPrompt ? { userPrompt: item.userPrompt } : {}),
            })),
          )}`,
        ]
      : []),
  ];

  const observation: AgentObservation = {
    id: crypto.randomUUID(),
    runId: state.runId,
    stepId: `subagent:${primary.id}`,
    status: completed ? "ok" : "partial",
    facts,
    summary: {
      source: "observation",
      status: completed ? "completed" : "partial",
      actionTaken: completed
        ? `Completed ${primary.id} through its deterministic Skill Flow subAgent controller`
        : `Paused ${primary.id} through its deterministic Skill Flow subAgent controller`,
      keyFindings: facts,
      ...(completed
        ? {}
        : { gaps: runtime.requirements.map((item) => item.description) }),
      data: {
        kind: "generic_structured",
        preview: {
          skillId: primary.id,
          skillVersion: primary.version,
          engine: "skill-flow-runtime",
          status: completed ? "completed" : "needs_input",
          sessionId: runtime.sessionId,
          phase: runtime.phase,
          round: runtime.round ?? null,
          maxRounds: runtime.maxRounds ?? null,
          deliveryReady: runtime.deliveryReady,
          flowCompleted: runtime.flowCompleted,
          requirements: runtime.requirements,
          trace: {
            engine: "skill-flow-runtime",
            skillId: primary.id,
            runId: subAgentRunId,
            nextSeq: baseSeq + 1,
          },
        },
        truncated: false,
        redacted: false,
        unsupported: false,
      },
    },
    createdAt,
  };

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-forked-skill-agent",
    nodeType: "reason",
    phase: "done",
    label: "subAgent 委派",
    summary: completed
      ? `确定性 Skill Flow subAgent 已完成：${primary.id}`
      : `确定性 Skill Flow subAgent 等待输入：${primary.id}`,
    details: {
      skillId: primary.id,
      skillVersion: primary.version,
      controller: "skill-flow-runtime",
      sessionId: runtime.sessionId,
      status: completed ? "completed" : "needs_input",
      requirementCount: runtime.requirements.length,
      deliveryReady: runtime.deliveryReady,
      flowCompleted: runtime.flowCompleted,
    },
  });

  return { pendingEvidenceObservation: observation };
};

/**
 * Compatibility wrapper for Skill-owned subAgent execution.
 *
 * A matched Skill delegates task-local work to one isolated subAgent. Parent
 * retains approval, recovery and final response governance without taking
 * construction ownership back from the subAgent. Stateful Skills keep their
 * deterministic Flow/Reducer as that Skill's single subAgent controller rather
 * than stacking a second free-form model loop on top.
 */
export const prepareContextWithForkedSkillAgentNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  const prepared = await basePrepareContextNode(state, emit);
  const preparedState: AgentNodeState = { ...state, ...prepared };
  if (preparedState.errorMessage) return prepared;

  const flowDelegated = await getFlowBackedDelegation(preparedState, emit);
  const delegated =
    flowDelegated ?? (await forkedSkillAgentNode(preparedState, emit));
  const delegatedObservation = delegated.pendingEvidenceObservation;
  if (!delegatedObservation) {
    return {
      ...prepared,
      ...delegated,
    };
  }

  const delegatedState: AgentNodeState = { ...preparedState, ...delegated };
  const observationIndex = preparedState.evidence?.observations.length ?? 0;
  const evidence = await evidenceNode(delegatedState, emit);
  const committed = {
    ...prepared,
    ...delegated,
    ...evidence,
  };
  const delegatedResult = readDelegatedResult(delegatedObservation);
  const skillId =
    delegatedObservation.stepId.replace(/^(?:skill_agent|subagent):/, "") || "skill";

  // Approval is Parent-governed and wins over needs_input. The Main runtime
  // pauses immediately, preserving the frozen exact invocation and checkpoint.
  if (delegated.pendingApproval) {
    return committed;
  }

  // needs_input is a terminal handoff from the subAgent, not an invitation for
  // Main Planner to take construction ownership back.
  if (
    delegatedObservation.status === "partial" &&
    delegatedResult.status === "needs_input"
  ) {
    const question = buildNeedsInputQuestion(delegatedResult.requirements);
    if (!question) {
      return {
        ...committed,
        errorMessage: "subAgent returned needs_input without a user_input requirement.",
        errorSourceNodeId: "agent-forked-skill-agent",
      };
    }
    return {
      ...committed,
      nextAction: {
        type: "ask_user",
        question,
        reason:
          "subAgent reached a governed needs_input boundary; Parent must ask for the missing information before replaying delegated execution.",
      },
    };
  }

  // insufficient_evidence and recoverable failure remain Parent recovery paths,
  // but recovery may only use the active Skill profile's declared Harness
  // surface. Parent must not bypass private runtimes through unrelated tools.
  if (
    delegatedObservation.status === "partial" ||
    delegatedObservation.status === "failed"
  ) {
    return {
      ...committed,
      toolExposure: narrowParentRecoveryToolExposure({
        skillId,
        toolExposure: preparedState.toolExposure,
      }),
    };
  }

  // A terminal subAgent failure preserves the existing Main Agent terminal C
  // contract: failed status, error finish path, Generate never runs.
  if (delegatedObservation.status === "blocked") {
    const errorMessage =
      delegatedObservation.errorMessage ??
      "subAgent reported a terminal execution failure.";
    return {
      ...committed,
      errorMessage,
      errorSourceNodeId: "agent-forked-skill-agent",
      terminalReason: "skill_agent_terminal_failure",
    };
  }

  // completed means task-local execution ownership has finished. Freeze a
  // Parent finalization packet over the committed observation so the Main loop
  // can go directly to Generate instead of rebuilding the deliverable.
  const evidenceRef = `observation:${observationIndex}` as AgentEvidenceReference;
  const finalizationPacket: AgentFinalizationPacket = {
    type: "answer",
    reason: `subAgent for Skill ${skillId} completed the delegated task-local execution; Parent finalization may now deliver the grounded result without replanning construction.`,
    completionProof: [
      {
        criterion: `Complete delegated ${skillId} Skill execution and preserve its Evidence/Artifact result.`,
        evidenceRefs: [evidenceRef],
      },
    ],
    unresolvedGaps: [],
  };

  return {
    ...committed,
    nextAction: finalizationPacket,
    finalizationPacket,
  };
};
