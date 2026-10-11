import { prepareSkillContext } from "@/skills/context/index.js";
import type { SkillContext } from "@/skills/context/types.js";
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
  if (!delegated.pendingEvidenceObservation && !delegated.errorMessage) {
    return {
      currentTaskFrame,
      errorMessage: "Skill activation produced no Child execution evidence.",
      errorSourceNodeId: "agent-activate-skill",
    };
  }
  return { currentTaskFrame, ...delegated };
};
