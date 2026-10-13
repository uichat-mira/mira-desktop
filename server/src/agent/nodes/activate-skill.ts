import { prepareSkillContext } from "@/skills/context/index.js";
import type { SkillContext } from "@/skills/context/types.js";
import { getSkillAgentExecutionProfile } from "@/skills/agent/profiles.js";
import type { AgentFinalizationPacket, AgentObservation, AgentToolExposureState } from "../types.js";
import {
  emitStepNode,
  type AgentNodeState,
  type EmitAgentExecutionNode,
} from "../node-runtime.js";
import { getLatestUserQuestion } from "./shared.js";
import { forkedSkillAgentNode } from "./forked-skill-agent.js";

type SkillAwareFrame = NonNullable<AgentNodeState["currentTaskFrame"]> & {
  skillContext?: SkillContext;
};

/**
 * Select a summary-stage Skill and hand it to the existing Skill Child.
 *
 * This is a model-visible disclosure request, not a Tool grant. The selected
 * Child still uses canonical execution profile, readiness, Harness, Policy and
 * Approval rules. No new runtime or authority surface is created here.
 */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

// The same recovery authority rule as matched Skill Child delegation:
// a Child failure cannot widen Main to tools outside that Skill's profile.
const narrowRecoveryExposure = (
  skillId: string,
  exposure?: AgentToolExposureState,
): AgentToolExposureState | undefined => {
  if (!exposure) return undefined;
  const allowed = new Set(getSkillAgentExecutionProfile(skillId).allowedHarnessToolIds);
  return {
    exposedTools: exposure.exposedTools.filter(id => allowed.has(id)),
    toolMeta: exposure.toolMeta.filter(tool => allowed.has(tool.toolId)),
    ...(exposure.eligibleTools
      ? { eligibleTools: exposure.eligibleTools.filter(id => allowed.has(id)) }
      : {}),
  };
};

const readChildHandoff = (observation: AgentObservation) => {
  const preview = asRecord(asRecord(observation.summary?.data)?.preview);
  const requirements = Array.isArray(preview?.requirements) ? preview.requirements : [];
  const questions = requirements
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter(item => item.kind === "user_input")
    .map(item => (
      typeof item.userPrompt === "string" && item.userPrompt.trim()
        ? item.userPrompt.trim()
        : typeof item.description === "string" ? item.description.trim() : ""
    ))
    .filter(Boolean)
    .slice(0, 3);
  return { status: preview?.status, question: questions.join("\n") };
};

export const activateSkillNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  const action = state.nextAction;
  if (action?.type !== "activate_skill") return {};
  const frame = state.currentTaskFrame as SkillAwareFrame | undefined;
  const snapshot = frame?.skillContext?.skillVisibility;
  const selected = snapshot?.skills.find(
    (item) =>
      item.skillId === action.skillId &&
      item.discoverable &&
      item.disclosure === "summary",
  );
  if (!selected) {
    return {
      errorMessage: `Skill ${action.skillId} is not discoverable at the summary stage in this Agent scope.`,
      errorSourceNodeId: "agent-activate-skill",
    };
  }

  const query =
    state.question?.trim() ||
    getLatestUserQuestion(state.messages) ||
    state.goal.text;
  // Exact named selection, still validated against the current Skill Registry.
  const context = await prepareSkillContext({
    query: `$${action.skillId} ${query}`,
    messages: state.messages,
  });
  if (context?.primary?.id !== action.skillId) {
    return {
      errorMessage: `Skill ${action.skillId} is not currently available for activation.`,
      errorSourceNodeId: "agent-activate-skill",
    };
  }

  const currentTaskFrame = {
    ...frame,
    skillContext: context,
  } as SkillAwareFrame;

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-activate-skill",
    nodeType: "reason",
    phase: "done",
    label: "披露技能正文",
    summary: `Skill ${action.skillId} summary -> body; entered the governed Skill Child`,
    details: {
      skillId: action.skillId,
      from: "summary",
      to: "body",
      toolExposureMutation: false,
    },
  });

  const delegated = await forkedSkillAgentNode(
    { ...state, currentTaskFrame },
    emit,
  );
  const patch: Partial<AgentNodeState> = { currentTaskFrame, ...delegated };
  const observation = delegated.pendingEvidenceObservation;
  if (!observation && !delegated.errorMessage) {
    return {
      ...patch,
      errorMessage: "Skill activation produced no Child execution evidence.",
      errorSourceNodeId: "agent-activate-skill",
    };
  }
  // A frozen approval is always controlled by Parent; never re-plan or
  // execute the selected Tool before the user authorizes its exact invocation.
  if (!observation || delegated.pendingApproval) return patch;

  const handoff = readChildHandoff(observation);
  if (observation.status === "partial" && handoff.status === "needs_input") {
    if (!handoff.question) {
      return {
        ...patch,
        errorMessage: "Activated Skill Child requested input without a user question.",
        errorSourceNodeId: "agent-activate-skill",
      };
    }
    return {
      ...patch,
      nextAction: {
        type: "ask_user",
        question: handoff.question,
        reason: "Skill Child reached a governed needs_input boundary.",
      },
    };
  }
  if (observation.status === "blocked") {
    return {
      ...patch,
      errorMessage: observation.errorMessage ?? "Activated Skill Child reported terminal failure.",
      errorSourceNodeId: "agent-activate-skill",
      terminalReason: "skill_agent_terminal_failure",
    };
  }
  if (observation.status !== "ok") {
    return {
      ...patch,
      toolExposure: narrowRecoveryExposure(action.skillId, state.toolExposure),
    };
  }

  // A completed Child has finished task-local construction. Parent owns only
  // final delivery, not another round of the same construction.
  const evidenceRef = `observation:${state.evidence?.observations.length ?? 0}` as const;
  const finalizationPacket: AgentFinalizationPacket = {
    type: "answer",
    reason: `Activated Skill ${action.skillId} completed delegated execution; Parent can deliver its evidence.`,
    completionProof: [{
      criterion: `Complete ${action.skillId} Skill execution within its isolated Child scope.`,
      evidenceRefs: [evidenceRef],
    }],
    unresolvedGaps: [],
  };
  return {
    ...patch,
    nextAction: finalizationPacket,
    finalizationPacket,
  };
};
