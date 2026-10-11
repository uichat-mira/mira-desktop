import type { AgentNextAction } from "../types";

export const NEXT_ACTION_PLANNER_FALLBACK_REASON =
  "Planner fallback: unable to safely determine next action.";
export const PLANNER_OUTPUT_PREVIEW_LIMIT = 500;
export const ALLOWED_ACTION_TYPES = [
  "answer",
  "retrieve",
  "use_tool",
  "activate_skill",
  "ask_user",
  "error",
] as const;
export const INVALID_PLANNER_OUTPUT_REASON =
  "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.";
export const SCHEMA_REPLAN_ATTEMPT_LIMIT = 1;

export const toPreview = (value: string) =>
  value.trim().slice(0, PLANNER_OUTPUT_PREVIEW_LIMIT);

export const toNextActionFallback = (
  reason = NEXT_ACTION_PLANNER_FALLBACK_REASON,
): AgentNextAction => ({
  type: "error",
  reason,
});
