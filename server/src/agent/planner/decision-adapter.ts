import type { AgentNextAction } from "../types";
import {
  parseNextActionPlannerOutputWithDiagnostics,
  type PlannerOutputParseResult,
} from "./text-json-codec";

/**
 * Provider output accepted by the Planner decision boundary.
 *
 * The string shorthand keeps the current stream consumer small. The tagged
 * form makes the provider-facing seam explicit for future provider adapters
 * without changing the downstream AgentNextAction contract.
 */
export type PlannerProviderOutput =
  | string
  | {
      kind: "text";
      text: string;
    };

export type PlannerDecisionAdapterResult = {
  /** Canonical typed decision consumed by Planner validation/normalization. */
  decision: AgentNextAction | null;
  /** Compatibility diagnostics and raw object retained for existing validation. */
  diagnostics: Omit<PlannerOutputParseResult, "action">;
  codec: "text-json";
  source: "text-json-compatibility";
};

const getProviderText = (output: PlannerProviderOutput) =>
  typeof output === "string" ? output : output.text;

/**
 * Decode any current Planner provider output through one typed boundary.
 *
 * All current providers expose text to the Planner stream. The explicit source
 * marker prevents that compatibility path from being mistaken for a future
 * native structured-provider contract.
 */
export const adaptPlannerProviderOutput = (
  output: PlannerProviderOutput,
): PlannerDecisionAdapterResult => {
  const parseResult = parseNextActionPlannerOutputWithDiagnostics(
    getProviderText(output),
  );
  const { action: decision, ...diagnostics } = parseResult;

  return {
    decision,
    diagnostics,
    codec: "text-json",
    source: "text-json-compatibility",
  };
};
