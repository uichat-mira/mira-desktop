import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { adaptPlannerProviderOutput } from "./decision-adapter";
import { validateNextAction } from "./validate";

describe("Planner decision adapter", () => {
  test.each([
    {
      name: "answer",
      output: JSON.stringify({
        type: "answer",
        reason: "The evidence is sufficient.",
        completionProof: [
          {
            criterion: "Answer the user",
            evidenceRefs: ["observation:0"],
          },
        ],
        unresolvedGaps: [],
      }),
    },
    {
      name: "ask_user",
      output: JSON.stringify({
        type: "ask_user",
        question: "Which repository should I inspect?",
        reason: "The target is ambiguous.",
      }),
    },
    {
      name: "retrieve",
      output: JSON.stringify({
        type: "retrieve",
        query: "deployment process",
        reason: "Repository evidence is required.",
      }),
    },
    {
      name: "use_tool",
      output: JSON.stringify({
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "The file must be inspected.",
      }),
    },
  ])("returns a typed $name decision through the same boundary", ({ output }) => {
    const adapted = adaptPlannerProviderOutput({ kind: "text", text: output });

    assert.equal(adapted.source, "text-json-compatibility");
    assert.equal(adapted.codec, "text-json");
    assert.notEqual(adapted.decision, null);
    assert.equal(adapted.diagnostics.parseErrorReason, null);
  });

  test("keeps invalid provider output typed as no decision with codec diagnostics", () => {
    const adapted = adaptPlannerProviderOutput("not-json");

    assert.equal(adapted.decision, null);
    assert.match(
      adapted.diagnostics.parseErrorReason ?? "",
      /did not contain a complete JSON object/i,
    );
    assert.equal(adapted.source, "text-json-compatibility");
  });

  test("normalizes a native structured envelope through the same typed boundary", () => {
    const adapted = adaptPlannerProviderOutput({
      kind: "native",
      value: {
        type: "retrieve",
        reason: "Repository evidence is required.",
        query: "README",
        toolId: null,
        args: null,
        question: null,
        completionProof: [],
        unresolvedGaps: [],
        planPatch: { addItems: [], completeIds: [] },
      },
    });

    assert.equal(adapted.source, "native-structured");
    assert.equal(adapted.codec, "native-json-schema");
    assert.deepEqual(adapted.decision, {
      type: "retrieve",
      query: "README",
      reason: "Repository evidence is required.",
    });
    assert.equal(adapted.diagnostics.parseErrorReason, null);
  });

  test("keeps invalid native output on the native codec path", () => {
    const adapted = adaptPlannerProviderOutput({
      kind: "native",
      value: "not-json",
    });

    assert.equal(adapted.source, "native-structured");
    assert.equal(adapted.codec, "native-json-schema");
    assert.equal(adapted.decision, null);
    assert.match(
      adapted.diagnostics.parseErrorReason ?? "",
      /native Planner structured output must be one JSON object/i,
    );
  });

  test("passes the typed adapter result directly into existing validation", () => {
    const adapted = adaptPlannerProviderOutput(
      JSON.stringify({
        type: "read_open",
        path: "README.md",
        reason: "The file must be inspected.",
      }),
    );

    const validated = validateNextAction(adapted, ["read_open"]);

    assert.deepEqual(validated.action, {
      type: "use_tool",
      toolId: "read_open",
      args: { path: "README.md" },
      reason: "The file must be inspected.",
    });
  });

  test("does not expose approval, checkpoint, or evidence authority on the typed decision", () => {
    const adapted = adaptPlannerProviderOutput(
      JSON.stringify({
        type: "answer",
        reason: "The evidence is sufficient.",
        completionProof: [
          {
            criterion: "Answer the user",
            evidenceRefs: ["observation:0"],
          },
        ],
        unresolvedGaps: [],
        approval: { approved: true },
        checkpoint: { status: "complete" },
        evidence: { authoritative: true },
      }),
    );

    assert.deepEqual(adapted.decision, {
      type: "answer",
      reason: "The evidence is sufficient.",
      completionProof: [
        {
          criterion: "Answer the user",
          evidenceRefs: ["observation:0"],
        },
      ],
      unresolvedGaps: [],
    });
  });
});
