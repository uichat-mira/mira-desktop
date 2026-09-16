import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { parseNextActionPlannerOutputWithDiagnostics } from "../planner/parse";
import { validateNextAction } from "../planner/validate";

const decodePlannerDecision = (
  output: string,
  exposedTools: string[] = ["read_open"],
) => validateNextAction(parseNextActionPlannerOutputWithDiagnostics(output), exposedTools);

describe("Planner decision characterization", () => {
  test.each([
    {
      name: "direct answer",
      output: JSON.stringify({
        type: "answer",
        reason: "The requested result is supported by the available evidence.",
        completionProof: [
          {
            criterion: "Answer the user",
            evidenceRefs: ["observation:0"],
          },
        ],
        unresolvedGaps: [],
      }),
      expected: {
        type: "answer",
        reason: "The requested result is supported by the available evidence.",
        completionProof: [
          {
            criterion: "Answer the user",
            evidenceRefs: ["observation:0"],
          },
        ],
        unresolvedGaps: [],
      },
    },
    {
      name: "ask_user",
      output: JSON.stringify({
        type: "ask_user",
        question: "Which repository should I inspect?",
        reason: "The target repository is ambiguous.",
      }),
      expected: {
        type: "ask_user",
        question: "Which repository should I inspect?",
        reason: "The target repository is ambiguous.",
      },
    },
    {
      name: "retrieve",
      output: JSON.stringify({
        type: "retrieve",
        query: "deployment process",
        reason: "Knowledge-base evidence is required.",
      }),
      expected: {
        type: "retrieve",
        query: "deployment process",
        reason: "Knowledge-base evidence is required.",
      },
    },
    {
      name: "canonical concrete tool action",
      output: JSON.stringify({
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "The requested file must be inspected.",
      }),
      expected: {
        type: "use_tool",
        toolId: "read_open",
        args: { path: "README.md" },
        reason: "The requested file must be inspected.",
      },
    },
  ])("preserves the current $name outcome", ({ output, expected }) => {
    const result = decodePlannerDecision(output);

    assert.deepEqual(result.action, expected);
    assert.equal(result.parseErrorReason, undefined);
  });

  test("normalizes the current exposed direct-tool output into canonical use_tool", () => {
    const result = decodePlannerDecision(
      JSON.stringify({
        type: "read_open",
        path: "README.md",
        reason: "The requested file must be inspected.",
      }),
    );

    assert.deepEqual(result.action, {
      type: "use_tool",
      toolId: "read_open",
      args: { path: "README.md" },
      reason: "The requested file must be inspected.",
    });
    assert.equal(result.parseErrorReason, undefined);
  });

  test.each([
    {
      name: "plain prose",
      output: "not-json",
      expectedDiagnostic: /did not contain a complete JSON object/i,
    },
    {
      name: "malformed JSON object",
      output: '{"type":"retrieve","query":}',
      expectedDiagnostic: /JSON parse failed/i,
    },
    {
      name: "multiple decision objects",
      output:
        '{"type":"retrieve","query":"first"}\n{"type":"error","reason":"second"}',
      expectedDiagnostic: /multiple JSON objects/i,
    },
    {
      name: "schema-invalid tool arguments",
      output:
        '{"type":"use_tool","toolId":"read_open","args":[],"reason":"Inspect the file."}',
      expectedDiagnostic: /object-valued "args" field/i,
    },
  ])(
    "maps $name to the current terminal Planner error outcome",
    ({ output, expectedDiagnostic }) => {
      const result = decodePlannerDecision(output);

      assert.deepEqual(result.action, {
        type: "error",
        reason:
          "Planner output was invalid JSON; planner must stop instead of pretending an answer is ready.",
      });
      assert.match(result.parseErrorReason ?? "", expectedDiagnostic);
    },
  );

  test("stops when a canonical tool action selects an unexposed tool", () => {
    const result = decodePlannerDecision(
      JSON.stringify({
        type: "use_tool",
        toolId: "terminal_session",
        args: { command: "dir" },
        reason: "Inspect the workspace through a terminal.",
      }),
    );

    assert.deepEqual(result.action, {
      type: "error",
      reason:
        "Planner selected a tool that was not exposed for this turn; planner must stop.",
    });
    assert.equal(result.parseErrorReason, undefined);
  });

  test.each([
    {
      name: "fenced JSON",
      output:
        '```json\n{"type":"retrieve","query":"README","reason":"Need repository evidence."}\n```',
    },
    {
      name: "prose-prefixed JSON",
      output:
        'Here is the decision:\n{"type":"retrieve","query":"README","reason":"Need repository evidence."}',
    },
    {
      name: "think-prefixed JSON",
      output:
        '<think>Choose the next action.</think>\n{"type":"retrieve","query":"README","reason":"Need repository evidence."}',
    },
  ])("keeps the current text-JSON codec behavior for $name", ({ output }) => {
    const result = decodePlannerDecision(output);

    assert.deepEqual(result.action, {
      type: "retrieve",
      query: "README",
      reason: "Need repository evidence.",
    });
    assert.equal(result.parseErrorReason, undefined);
  });
});
