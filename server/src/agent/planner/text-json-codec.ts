import type { AgentEvidenceReference, AgentNextAction } from "../types";

/**
 * Compatibility codec for providers that return Planner decisions as text.
 *
 * The current consumer is the Planner task-model stream, including providers
 * that cannot expose a stronger typed response. E01-3 may replace this input
 * path with native structured provider output after the typed adapter boundary
 * is accepted; until then this codec remains the compatibility contract.
 */

const stripThinkBlocks = (value: string) =>
  value.replace(/^\s*(?:<think\b[^>]*>[\s\S]*?<\/think>\s*)+/i, "").trim();

const sanitizePlannerJson = (value: string) =>
  stripThinkBlocks(value)
    .replace(/```json/gi, "```")
    .replace(/```[\r\n]?/g, "")
    .trim();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stripSyntheticNullObjectFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripSyntheticNullObjectFields(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      child === null ? [] : [[key, stripSyntheticNullObjectFields(child)]],
    ),
  );
};

export type PlannerOutputParseResult = {
  action: AgentNextAction | null;
  sanitizedOutput: string;
  parseErrorReason: string | null;
  parseWarnings: string[];
  /**
   * Parsed decision object retained for the validation/normalization boundary.
   * Parser does not need tool exposure knowledge; Validator may normalize a
   * direct tool action whose `type` equals an exposed tool id.
   */
  rawDecision?: Record<string, unknown>;
};

const MISSING_REASON_DEFAULTED_WARNING = "missing_reason_defaulted";
const EVIDENCE_REFERENCE_PATTERN = /^(tool|retrieval|observation):\d+$/;

const parseCompletionProof = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const result: Array<{
    criterion: string;
    evidenceRefs: AgentEvidenceReference[];
  }> = [];
  for (const item of value) {
    if (
      !isPlainObject(item) ||
      typeof item.criterion !== "string" ||
      !item.criterion.trim() ||
      !Array.isArray(item.evidenceRefs) ||
      !item.evidenceRefs.every(
        (ref): ref is AgentEvidenceReference =>
          typeof ref === "string" && EVIDENCE_REFERENCE_PATTERN.test(ref),
      )
    ) {
      return null;
    }
    result.push({
      criterion: item.criterion.trim(),
      evidenceRefs: [...new Set(item.evidenceRefs)],
    });
  }
  return result;
};

const getDefaultPlannerReason = (
  type: AgentNextAction["type"],
  payload: Record<string, unknown>,
) => {
  switch (type) {
    case "answer":
      return "Planner selected final answer.";
    case "retrieve":
      return `Planner requested retrieval for query: ${String(payload.query ?? "").trim()}.`;
    case "use_tool":
      return `Planner selected tool ${String(payload.toolId ?? "").trim()}.`;
    case "ask_user":
      return "Planner needs the user to clarify the missing information.";
    case "error":
      return "Planner returned an error action without a reason.";
  }
};

const extractJsonObjectCandidates = (value: string) => {
  const candidates: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!char) {
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        candidates.push(value.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates;
};

const parseNextActionPlannerObject = (
  parsed: Record<string, unknown>,
): PlannerOutputParseResult => {
  if (typeof parsed.type !== "string") {
    return {
      action: null,
      sanitizedOutput: "",
      parseErrorReason: 'Planner JSON object must include a string "type" field.',
      parseWarnings: [],
      rawDecision: parsed,
    };
  }

  const parseWarnings: string[] = [];
  const reason: string =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : (() => {
          parseWarnings.push(MISSING_REASON_DEFAULTED_WARNING);
          return (
            getDefaultPlannerReason(parsed.type as AgentNextAction["type"], parsed) ??
            "Planner returned an action without a reason."
          );
        })();

  switch (parsed.type) {
    case "answer":
      {
        const completionProof = parseCompletionProof(parsed.completionProof);
        if (!completionProof) {
          return {
            action: null,
            sanitizedOutput: "",
            parseErrorReason:
              'Planner "answer" action must include a non-empty valid "completionProof" array.',
            parseWarnings: [],
            rawDecision: parsed,
          };
        }
        if (
          !Array.isArray(parsed.unresolvedGaps) ||
          !parsed.unresolvedGaps.every((gap) => typeof gap === "string")
        ) {
          return {
            action: null,
            sanitizedOutput: "",
            parseErrorReason:
              'Planner "answer" action must include a string array "unresolvedGaps" field.',
            parseWarnings: [],
            rawDecision: parsed,
          };
        }
        const unresolvedGaps = parsed.unresolvedGaps
          .map((gap) => gap.trim())
          .filter(Boolean);
        if (unresolvedGaps.length > 0) {
          return {
            action: null,
            sanitizedOutput: "",
            parseErrorReason:
              'Planner "answer" action cannot contain unresolved gaps.',
            parseWarnings: [],
            rawDecision: parsed,
          };
        }
      return {
        action: {
          type: "answer",
          reason,
          completionProof,
          unresolvedGaps,
        },
        sanitizedOutput: "",
        parseErrorReason: null,
        parseWarnings,
        rawDecision: parsed,
      };
      }
    case "retrieve":
      if (typeof parsed.query !== "string" || !parsed.query.trim()) {
        return {
          action: null,
          sanitizedOutput: "",
          parseErrorReason:
            'Planner "retrieve" action must include a non-empty string "query" field.',
          parseWarnings: [],
          rawDecision: parsed,
        };
      }
      return {
        action: {
          type: "retrieve",
          query: parsed.query.trim(),
          reason,
        },
        sanitizedOutput: "",
        parseErrorReason: null,
        parseWarnings,
        rawDecision: parsed,
      };
    case "use_tool":
      if (typeof parsed.toolId !== "string" || !parsed.toolId.trim()) {
        return {
          action: null,
          sanitizedOutput: "",
          parseErrorReason:
            'Planner "use_tool" action must include a non-empty string "toolId" field.',
          parseWarnings: [],
          rawDecision: parsed,
        };
      }
      if (!isPlainObject(parsed.args)) {
        return {
          action: null,
          sanitizedOutput: "",
          parseErrorReason:
            'Planner "use_tool" action must include an object-valued "args" field.',
          parseWarnings: [],
          rawDecision: parsed,
        };
      }
      return {
        action: {
          type: "use_tool",
          toolId: parsed.toolId.trim(),
          args: stripSyntheticNullObjectFields(parsed.args) as Record<string, unknown>,
          reason,
        },
        sanitizedOutput: "",
        parseErrorReason: null,
        parseWarnings,
        rawDecision: parsed,
      };
    case "error":
      return {
        action: {
          type: "error",
          reason,
        },
        sanitizedOutput: "",
        parseErrorReason: null,
        parseWarnings,
        rawDecision: parsed,
      };
    case "ask_user":
      if (typeof parsed.question !== "string" || !parsed.question.trim()) {
        return {
          action: null,
          sanitizedOutput: "",
          parseErrorReason:
            'Planner "ask_user" action must include a non-empty string "question" field.',
          parseWarnings: [],
          rawDecision: parsed,
        };
      }
      return {
        action: {
          type: "ask_user",
          question: parsed.question.trim(),
          reason,
        },
        sanitizedOutput: "",
        parseErrorReason: null,
        parseWarnings,
        rawDecision: parsed,
      };
    default:
      return {
        action: null,
        sanitizedOutput: "",
        parseErrorReason: `Planner action type "${parsed.type}" is not a canonical action type.`,
        parseWarnings,
        rawDecision: parsed,
      };
  }
};

export const parseNextActionPlannerOutputWithDiagnostics = (
  value: string,
): PlannerOutputParseResult => {
  const sanitized = sanitizePlannerJson(value);
  if (!sanitized) {
    return {
      action: null,
      sanitizedOutput: sanitized,
      parseErrorReason: "Planner output was empty after sanitization.",
      parseWarnings: [],
    };
  }

  const candidates = extractJsonObjectCandidates(sanitized);
  if (candidates.length === 0) {
    return {
      action: null,
      sanitizedOutput: sanitized,
      parseErrorReason: "Planner output did not contain a complete JSON object.",
      parseWarnings: [],
    };
  }

  if (candidates.length > 1) {
    return {
      action: null,
      sanitizedOutput: sanitized,
      parseErrorReason:
        "Planner output contained multiple JSON objects; planner must return exactly one decision object.",
      parseWarnings: [],
    };
  }

  try {
    const parsed = JSON.parse(candidates[0]!) as unknown;
    if (!isPlainObject(parsed)) {
      return {
        action: null,
        sanitizedOutput: sanitized,
        parseErrorReason: "Planner decision must be a JSON object.",
        parseWarnings: [],
      };
    }

    const result = parseNextActionPlannerObject(parsed);
    return {
      action: result.action,
      sanitizedOutput: sanitized,
      parseErrorReason: result.parseErrorReason,
      parseWarnings: result.parseWarnings,
      rawDecision: result.rawDecision,
    };
  } catch (error) {
    return {
      action: null,
      sanitizedOutput: sanitized,
      parseErrorReason:
        error instanceof Error && error.message.trim()
          ? `Planner JSON parse failed: ${error.message.trim()}`
          : "Planner JSON parse failed.",
      parseWarnings: [],
    };
  }
};

export const parseNextActionPlannerOutput = (value: string): AgentNextAction | null =>
  parseNextActionPlannerOutputWithDiagnostics(value).action;
