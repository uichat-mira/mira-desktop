import type { AgentNextAction } from "../types";
import { INVALID_PLANNER_OUTPUT_REASON, toNextActionFallback } from "./action-types";
import type { PlannerDecisionAdapterResult } from "./decision-adapter";
import type { PlannerOutputParseResult } from "./text-json-codec";

const DIRECT_TOOL_ACTION_NORMALIZED_WARNING = "direct_tool_action_normalized";

type PlannerValidationInput =
  | PlannerOutputParseResult
  | PlannerDecisionAdapterResult;

const unwrapPlannerValidationInput = (
  input: PlannerValidationInput,
): PlannerOutputParseResult =>
  "diagnostics" in input
    ? { action: input.decision, ...input.diagnostics }
    : input;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeDirectToolAction = (
  parseResult: PlannerOutputParseResult,
  exposedTools: string[],
): AgentNextAction | null => {
  const rawDecision = parseResult.rawDecision;
  const directToolId =
    typeof rawDecision?.type === "string" ? rawDecision.type.trim() : "";

  if (!directToolId || !exposedTools.includes(directToolId)) {
    return null;
  }

  const args = isPlainObject(rawDecision?.args)
    ? rawDecision.args
    : Object.fromEntries(
        Object.entries(rawDecision ?? {}).filter(
          ([key]) =>
            !["type", "reason", "toolId", "args", "plan", "planPatch"].includes(
              key,
            ),
        ),
      );
  const reason =
    typeof rawDecision?.reason === "string" && rawDecision.reason.trim()
      ? rawDecision.reason.trim()
      : `Planner selected tool ${directToolId}.`;

  return {
    type: "use_tool",
    toolId: directToolId,
    args,
    reason,
  };
};

export const validateNextAction = (
  input: PlannerValidationInput,
  exposedTools: string[],
): {
  action: AgentNextAction;
  parseErrorReason?: string;
  sanitizedOutput?: string;
  parseWarnings?: string[];
} => {
  const parseResult = unwrapPlannerValidationInput(input);
  if (!parseResult.action) {
    const normalizedDirectToolAction = normalizeDirectToolAction(
      parseResult,
      exposedTools,
    );

    if (normalizedDirectToolAction) {
      return {
        action: normalizedDirectToolAction,
        sanitizedOutput: parseResult.sanitizedOutput,
        parseWarnings: [
          ...parseResult.parseWarnings,
          DIRECT_TOOL_ACTION_NORMALIZED_WARNING,
        ],
      };
    }

    return {
      action: toNextActionFallback(INVALID_PLANNER_OUTPUT_REASON),
      parseErrorReason: parseResult.parseErrorReason ?? INVALID_PLANNER_OUTPUT_REASON,
      sanitizedOutput: parseResult.sanitizedOutput,
      parseWarnings: parseResult.parseWarnings,
    };
  }

  if (
    parseResult.action.type === "use_tool" &&
    !exposedTools.includes(parseResult.action.toolId)
  ) {
    return {
      action: toNextActionFallback(
        "Planner selected a tool that was not exposed for this turn; planner must stop.",
      ),
      sanitizedOutput: parseResult.sanitizedOutput,
      parseWarnings: parseResult.parseWarnings,
    };
  }

  return {
    action: parseResult.action,
    sanitizedOutput: parseResult.sanitizedOutput,
    parseWarnings: parseResult.parseWarnings,
  };
};
