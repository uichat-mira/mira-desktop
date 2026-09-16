import type { AgentNextAction, AgentToolExposureState } from "../types";
import {
  parseNextActionPlannerObject,
  parseNextActionPlannerOutputWithDiagnostics,
  type PlannerOutputParseResult,
} from "./text-json-codec";
import {
  normalizePlannerStructuredDecision,
  type PlannerStructuredDecisionEnvelope,
} from "./structured-output";

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
    }
  | {
      kind: "native";
      value: unknown;
    };

export type PlannerDecisionAdapterResult = {
  /** Canonical typed decision consumed by Planner validation/normalization. */
  decision: AgentNextAction | null;
  /** Compatibility diagnostics and raw object retained for existing validation. */
  diagnostics: Omit<PlannerOutputParseResult, "action">;
  codec: "text-json" | "native-json-schema";
  source: "text-json-compatibility" | "native-structured";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const nativeToolExposureByDecision = new WeakMap<object, AgentToolExposureState>();

/**
 * Bind the exact tool exposure used to build the native Planner schema to the
 * returned structured decision object without mutating or serializing model
 * output. This keeps optional/null cleanup tied to the schema that generated it.
 */
export const bindPlannerNativeToolExposure = (
  value: unknown,
  toolExposure: AgentToolExposureState,
): unknown => {
  if (isRecord(value)) {
    nativeToolExposureByDecision.set(value, toolExposure);
  }
  return value;
};

const getProviderText = (output: PlannerProviderOutput) => {
  if (typeof output === "string") {
    return output;
  }
  return output.kind === "text" ? output.text : "";
};

export type PlannerProviderOutputKind = "text" | "native";

export interface PlannerProviderStream extends AsyncIterable<string> {
  getOutputKind: () => PlannerProviderOutputKind;
  getStructuredOutput?: () => unknown;
}

export const getPlannerProviderOutputKind = (
  stream: AsyncIterable<string>,
): PlannerProviderOutputKind => {
  const candidate = stream as Partial<PlannerProviderStream>;
  return candidate.getOutputKind?.() ?? "text";
};

export const getPlannerProviderStructuredOutput = (
  stream: AsyncIterable<string>,
): unknown => {
  const candidate = stream as Partial<PlannerProviderStream>;
  return candidate.getStructuredOutput?.();
};

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
  if (typeof output !== "string" && output.kind === "native") {
    const nativeToolExposure = isRecord(output.value)
      ? nativeToolExposureByDecision.get(output.value)
      : undefined;
    const rawDecision = isRecord(output.value)
      ? normalizePlannerStructuredDecision(
          output.value as PlannerStructuredDecisionEnvelope,
          nativeToolExposure,
        )
      : output.value;
    const parseResult =
      rawDecision && typeof rawDecision === "object" && !Array.isArray(rawDecision)
        ? parseNextActionPlannerObject(rawDecision as Record<string, unknown>)
        : {
            action: null,
            sanitizedOutput: "",
            parseErrorReason: "Native Planner structured output must be one JSON object.",
            parseWarnings: [],
          };
    const { action: decision, ...diagnostics } = parseResult;
    return {
      decision,
      diagnostics,
      codec: "native-json-schema",
      source: "native-structured",
    };
  }

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
