import { describe, expect, it } from "vitest";

import type { AgentToolExposureState } from "../../types";
import {
  buildPlannerStructuredOutputJsonSchema,
  normalizePlannerStructuredDecision,
  type PlannerStructuredDecisionEnvelope,
} from "../structured-output";

const exposure: AgentToolExposureState = {
  exposedTools: ["read_open"],
  toolMeta: [
    {
      toolId: "read_open",
      title: "Read Open",
      description: "Open a known workspace file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          cursor: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          startLine: { type: "number" },
        },
        required: ["path", "cursor"],
        additionalProperties: false,
      },
      domain: "read",
      source: "internal",
    },
  ],
};

describe("planner structured output", () => {
  it("builds one strict root decision schema with exposed tool ids", () => {
    const schema = buildPlannerStructuredOutputJsonSchema(exposure);
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
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
    ]);

    const properties = schema.properties as Record<string, any>;
    expect(properties.type.enum).toContain("use_tool");
    expect(properties.toolId.anyOf[0].enum).toEqual(["read_open"]);

    const argsVariants = properties.args.anyOf as Array<Record<string, any>>;
    const readOpenArgs = argsVariants[0];
    expect(readOpenArgs.additionalProperties).toBe(false);
    expect(readOpenArgs.required).toEqual(["path", "cursor", "startLine"]);
    expect(readOpenArgs.properties.path.type).toBe("string");
    expect(readOpenArgs.properties.startLine.anyOf).toEqual([
      { type: "number" },
      { type: "null" },
    ]);
  });

  it("strips only synthetic optional null placeholders before planner validation", () => {
    const envelope: PlannerStructuredDecisionEnvelope = {
      type: "use_tool",
      reason: "Open the known target.",
      query: null,
      toolId: "read_open",
      args: {
        path: "server/src/agent/planner/node.ts",
        cursor: null,
        startLine: null,
      },
      question: null,
      completionProof: [],
      unresolvedGaps: [],
      planPatch: {
        addItems: [],
        completeIds: [],
      },
    };

    expect(normalizePlannerStructuredDecision(envelope, exposure)).toEqual({
      type: "use_tool",
      reason: "Open the known target.",
      toolId: "read_open",
      args: {
        path: "server/src/agent/planner/node.ts",
        cursor: null,
      },
    });
  });

  it("keeps only the lightweight plan patch when it actually changes", () => {
    const envelope: PlannerStructuredDecisionEnvelope = {
      type: "answer",
      reason: "All requested work is complete.",
      query: null,
      toolId: null,
      args: null,
      question: null,
      completionProof: [
        {
          criterion: "Confirm the call chain",
          evidenceRefs: [],
        },
      ],
      unresolvedGaps: [],
      planPatch: {
        addItems: [{ id: "P1", text: "Confirm the call chain" }],
        completeIds: ["P1"],
      },
    };

    expect(normalizePlannerStructuredDecision(envelope, exposure)).toEqual({
      type: "answer",
      reason: "All requested work is complete.",
      completionProof: [
        {
          criterion: "Confirm the call chain",
          evidenceRefs: [],
        },
      ],
      unresolvedGaps: [],
      planPatch: {
        addItems: [{ id: "P1", text: "Confirm the call chain" }],
        completeIds: ["P1"],
      },
    });
  });
});

it("lets native Planner output name a metadata-only Tool only with an empty schema-request payload", () => {
  const progressiveExposure: AgentToolExposureState = {
    exposedTools: ["read_open"],
    eligibleTools: ["read_open", "later_tool"],
    toolMeta: [
      ...exposure.toolMeta,
      {
        toolId: "later_tool",
        title: "Later Tool",
        description: "A Tool that is discoverable but whose schema is not yet disclosed",
        domain: "read",
        source: "internal",
      },
    ],
  };

  const schema = buildPlannerStructuredOutputJsonSchema(progressiveExposure);
  const properties = schema.properties as Record<string, any>;
  expect(properties.toolId.anyOf[0].enum).toEqual([
    "read_open",
    "later_tool",
  ]);

  const argsVariants = properties.args.anyOf as Array<Record<string, any>>;
  expect(argsVariants).toHaveLength(3);
  expect(argsVariants[1]).toEqual({
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  });
  expect(argsVariants[2]).toEqual({ type: "null" });
});
