import assert from "node:assert/strict";
import { test } from "vitest";
import { projectHarnessResultForLlm } from "@/harness/llm-content";
import type { AgentExecutionObservation } from "../types";
import type { AgentGraphState } from "../node-runtime";
import {
  buildPlannerAccumulatedActionLedger,
  buildPlannerLatestEvidenceContent,
} from "../planner/runtime-memory";

const createReadObservation = (input: {
  id: string;
  path: string;
  inputHash: string;
  createdAt: string;
}): AgentExecutionObservation => ({
  id: input.id,
  source: "tool_execution",
  actionType: "tool",
  status: "completed",
  createdAt: input.createdAt,
  toolId: "read_open",
  toolCallId: input.id,
  inputHash: input.inputHash,
  argsPreview: { path: input.path },
  summary: {
    source: "tool",
    status: "completed",
    toolId: "read_open",
    inputHash: input.inputHash,
    actionTaken: `Opened file ${input.path}.`,
    keyFindings: [`contentLength=${100 + Number(input.id.replace(/\D/g, "") || 0)}`],
  },
});

test("planner accumulated action ledger survives the recent execution window and collapses repeated semantic targets", () => {
  const observations: AgentExecutionObservation[] = [];

  for (let index = 0; index < 15; index += 1) {
    observations.push(
      createReadObservation({
        id: `call-${index}`,
        path: index === 0 || index === 14 ? "src/entry.ts" : `src/file-${index}.ts`,
        inputHash: `hash-${index}`,
        createdAt: `2026-07-19T00:00:${String(index).padStart(2, "0")}.000Z`,
      }),
    );
  }

  const ledger = buildPlannerAccumulatedActionLedger(observations);
  const entry = ledger.entries.find(
    (item) => item.toolId === "read_open" && item.target === "src/entry.ts",
  );

  assert.equal(ledger.totalExecutionObservations, 15);
  assert.equal(ledger.uniqueSemanticActions, 14);
  assert.equal(ledger.repeatedSemanticActions, 1);
  assert.ok(entry);
  assert.equal(entry.attempts, 2);
  assert.deepEqual(entry.inputHashes, ["hash-0", "hash-14"]);
});

test("planner recent evidence content keeps multiple canonical tool outputs beyond Evidence previews", () => {
  const firstSource = `${"A".repeat(600)}\nFIRST_REAL_TOOL_MARKER`;
  const secondSource = `${"B".repeat(600)}\nSECOND_REAL_TOOL_MARKER`;
  const firstResult = {
    type: "open",
    path: "src/first.ts",
    source: { text: firstSource },
  };
  const secondResult = {
    type: "open",
    path: "src/second.ts",
    source: { text: secondSource },
  };
  const state = {
    evidence: {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolCallId: "call-first",
          toolId: "read_open",
          inputHash: "hash-first",
          args: { path: "src/first.ts" },
          status: "completed",
          result: firstResult,
          llmContent: projectHarnessResultForLlm(firstResult),
          startedAt: "2026-07-19T00:00:00.000Z",
          finishedAt: "2026-07-19T00:00:01.000Z",
        },
        {
          toolCallId: "call-second",
          toolId: "read_open",
          inputHash: "hash-second",
          args: { path: "src/second.ts" },
          status: "completed",
          result: secondResult,
          llmContent: projectHarnessResultForLlm(secondResult),
          startedAt: "2026-07-19T00:00:02.000Z",
          finishedAt: "2026-07-19T00:00:03.000Z",
        },
      ],
    },
  } as AgentGraphState;

  const content = buildPlannerLatestEvidenceContent(state, undefined);

  assert.equal(content?.source, "continuous");
  assert.equal(content?.itemCount, 2);
  assert.match(content?.content ?? "", /FIRST_REAL_TOOL_MARKER/);
  assert.match(content?.content ?? "", /SECOND_REAL_TOOL_MARKER/);
});

