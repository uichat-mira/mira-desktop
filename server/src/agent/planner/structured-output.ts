import type { AgentToolExposureState } from "../types";

export type PlannerStructuredPlanPatch = {
  addItems: Array<{ id: string; text: string }>;
  completeIds: string[];
};

export type PlannerStructuredDecisionEnvelope = {
  type: "answer" | "retrieve" | "use_tool" | "activate_skill" | "ask_user" | "error";
  reason: string;
  query: string | null;
  toolId: string | null;
  skillId: string | null;
  args: Record<string, unknown> | null;
  question: string | null;
  completionProof: Array<{
    criterion: string;
    evidenceRefs: string[];
  }>;
  unresolvedGaps: string[];
  planPatch: PlannerStructuredPlanPatch;
};

type JsonSchema = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const nullableSchema = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});

/**
 * OpenAI strict JSON Schema requires every declared object property to be
 * required and every object to set additionalProperties=false. Tool schemas
 * use normal optional-property semantics, so optional fields are represented
 * as required-but-nullable for generation and stripped back to omission before
 * the existing Harness schema validator sees the args.
 */
const toStrictGenerationSchema = (
  value: unknown,
  requiredByParent = true,
): JsonSchema => {
  if (!isRecord(value)) {
    return requiredByParent ? {} : nullableSchema({});
  }

  if (Array.isArray(value.anyOf)) {
    const schema = {
      ...value,
      anyOf: value.anyOf.map((item) => toStrictGenerationSchema(item, true)),
    };
    return requiredByParent ? schema : nullableSchema(schema);
  }

  if (Array.isArray(value.oneOf)) {
    const schema = {
      ...value,
      oneOf: value.oneOf.map((item) => toStrictGenerationSchema(item, true)),
    };
    return requiredByParent ? schema : nullableSchema(schema);
  }

  if (value.type === "object" || isRecord(value.properties)) {
    const properties = isRecord(value.properties) ? value.properties : {};
    const originalRequired = new Set(
      Array.isArray(value.required)
        ? value.required.filter((item): item is string => typeof item === "string")
        : [],
    );
    const strictProperties = Object.fromEntries(
      Object.entries(properties).map(([key, schema]) => [
        key,
        toStrictGenerationSchema(schema, originalRequired.has(key)),
      ]),
    );
    const schema: JsonSchema = {
      ...value,
      type: "object",
      properties: strictProperties,
      required: Object.keys(strictProperties),
      additionalProperties: false,
    };
    return requiredByParent ? schema : nullableSchema(schema);
  }

  if (value.type === "array" && value.items) {
    const schema: JsonSchema = {
      ...value,
      items: toStrictGenerationSchema(value.items, true),
    };
    return requiredByParent ? schema : nullableSchema(schema);
  }

  const schema = { ...value };
  return requiredByParent ? schema : nullableSchema(schema);
};

const buildToolArgsSchema = (toolExposure: AgentToolExposureState): JsonSchema => {
  if (toolExposure.exposedTools.length === 0) {
    return { type: "null" };
  }

  return {
    anyOf: [
      ...toolExposure.exposedTools.map((toolId) => {
        const meta = toolExposure.toolMeta.find((item) => item.toolId === toolId);
        return toStrictGenerationSchema(
          meta?.inputSchema ?? {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          true,
        );
      }),
      { type: "null" },
    ],
  };
};

export const buildPlannerStructuredOutputJsonSchema = (
  toolExposure: AgentToolExposureState,
): JsonSchema => ({
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["answer", "retrieve", "use_tool", "activate_skill", "ask_user", "error"],
    },
    reason: { type: "string" },
    query: nullableSchema({ type: "string" }),
    skillId: nullableSchema({ type: "string" }),
    toolId:
      toolExposure.exposedTools.length > 0
        ? {
            anyOf: [
              { type: "string", enum: toolExposure.exposedTools },
              { type: "null" },
            ],
          }
        : { type: "null" },
    args: buildToolArgsSchema(toolExposure),
    question: nullableSchema({ type: "string" }),
    completionProof: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" },
          evidenceRefs: {
            type: "array",
            items: {
              type: "string",
              pattern: "^(tool|retrieval|observation):[0-9]+$",
            },
          },
        },
        required: ["criterion", "evidenceRefs"],
        additionalProperties: false,
      },
    },
    unresolvedGaps: {
      type: "array",
      items: { type: "string" },
    },
    planPatch: {
      type: "object",
      properties: {
        addItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
            },
            required: ["id", "text"],
            additionalProperties: false,
          },
        },
        completeIds: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["addItems", "completeIds"],
      additionalProperties: false,
    },
  },
  required: [
    "type",
    "reason",
    "query",
    "toolId",
    "skillId",
    "args",
    "question",
    "completionProof",
    "unresolvedGaps",
    "planPatch",
  ],
  additionalProperties: false,
});

const stripSyntheticOptionalNulls = (
  value: unknown,
  originalSchema: unknown,
): unknown => {
  if (Array.isArray(value)) {
    const itemSchema = isRecord(originalSchema) ? originalSchema.items : undefined;
    return value.map((item) => stripSyntheticOptionalNulls(item, itemSchema));
  }

  if (!isRecord(value) || !isRecord(originalSchema)) {
    return value;
  }

  const properties = isRecord(originalSchema.properties)
    ? originalSchema.properties
    : {};
  const required = new Set(
    Array.isArray(originalSchema.required)
      ? originalSchema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  );

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (child === null && !required.has(key)) {
        return [];
      }
      return [[key, stripSyntheticOptionalNulls(child, properties[key])]];
    }),
  );
};

export const normalizePlannerStructuredDecision = (
  envelope: PlannerStructuredDecisionEnvelope,
  toolExposure?: AgentToolExposureState,
): Record<string, unknown> => {
  const decision: Record<string, unknown> = {
    type: envelope.type,
    reason: envelope.reason,
  };

  if (envelope.query !== null) {
    decision.query = envelope.query;
  }
  if (envelope.toolId !== null) {
    decision.toolId = envelope.toolId;
  }
  if (typeof envelope.skillId === "string" && envelope.skillId.trim()) {
    decision.skillId = envelope.skillId.trim();
  }
  if (envelope.args !== null) {
    const toolSchema = toolExposure?.toolMeta.find(
      (item) => item.toolId === envelope.toolId,
    )?.inputSchema;
    decision.args = toolSchema
      ? stripSyntheticOptionalNulls(envelope.args, toolSchema)
      : envelope.args;
  }
  if (envelope.question !== null) {
    decision.question = envelope.question;
  }
  if (envelope.type === "answer") {
    decision.completionProof = Array.isArray(envelope.completionProof)
      ? envelope.completionProof
      : [];
    decision.unresolvedGaps = Array.isArray(envelope.unresolvedGaps)
      ? envelope.unresolvedGaps
      : [];
  }

  const addItems = Array.isArray(envelope.planPatch?.addItems)
    ? envelope.planPatch.addItems
    : [];
  const completeIds = Array.isArray(envelope.planPatch?.completeIds)
    ? envelope.planPatch.completeIds
    : [];

  if (addItems.length === 0 && completeIds.length === 0) {
    return decision;
  }

  return {
    ...decision,
    planPatch: {
      addItems,
      completeIds,
    },
  };
};
