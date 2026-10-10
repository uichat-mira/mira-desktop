import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  clearHarnessRegistry,
  registerTool,
} from "@/harness/registry.js";
import { readTool } from "@/mcp/tools/read.tool.js";
import { writeTool } from "@/mcp/tools/write.tool.js";
import * as intentMatcherModule from "../intent/embedding-capability-matcher";
import type { AgentNodeState } from "../node-runtime.js";
import { prepareContextNode } from "./prepare-context.js";

const createBaseState = (
  overrides: Partial<AgentNodeState> = {},
): AgentNodeState => ({
  runId: "run-disclosure",
  threadId: "thread-disclosure",
  userId: 1,
  goal: {
    id: "goal-disclosure",
    text: "inspect and update",
    successCriteria: ["change verified"],
    constraints: [],
    riskLevel: "low",
  },
  plan: {
    id: "plan-disclosure",
    goalId: "goal-disclosure",
    version: 1,
    steps: [],
  },
  messages: [],
  ...overrides,
});

type CapturedEvent = {
  nodeId: string;
  phase: string;
  details?: Record<string, unknown>;
};

afterEach(() => {
  clearHarnessRegistry();
  vi.restoreAllMocks();
});

test("Main Agent projects a metadata-first capability view and materializes schema only for the selected Tool", async () => {
  registerTool(readTool);
  registerTool(writeTool);
  vi.spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding").mockResolvedValue(
    {
      query: "inspect and update",
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: ["read"],
        exposedDefinitions: [readTool.definition],
        reason: ["matched read"],
      },
      // The authority+readiness envelope is broader than the ranked disclosure.
      eligibleToolIds: ["read", "write"],
      exposureReasons: ["matched read"],
    },
  );

  const events: CapturedEvent[] = [];
  const patch = await prepareContextNode(createBaseState(), async (event) => {
    events.push({
      nodeId: event.nodeId,
      phase: event.phase,
      details: event.details,
    });
  });

  const done = events.find(
    (event) =>
      event.nodeId === "agent-prepare-context" && event.phase === "done",
  );
  const details = done?.details;
  assert.ok(details, "expected prepare-context done trace");

  // Two discoverable Tools share the compact metadata stage; only the selected
  // Tool reaches the full schema stage.
  assert.equal(details.capabilityMetadataDisclosedCount, 2);
  assert.equal(details.capabilitySchemaDisclosedCount, 1);
  assert.deepEqual(details.capabilitySchemaDisclosedIds, ["read"]);
  assert.deepEqual(
    (details.capabilityMetadataToolIds as string[]).sort(),
    ["read", "write"],
  );

  const transitions = details.capabilityDisclosureTransitions as Array<{
    capabilityId: string;
    reason: string;
    schemaMaterialized: boolean;
  }>;
  assert.deepEqual(transitions, [
    {
      capabilityId: "read",
      from: "metadata",
      to: "schema",
      reason: "promoted",
      schemaMaterialized: true,
    },
  ]);

  // The Planner-facing exposure is still the selected set with its schema, and
  // no metadata-only Tool leaks into the callable list.
  assert.deepEqual(patch.toolExposure?.exposedTools, ["read"]);
  assert.equal(
    patch.toolExposure?.toolMeta[0]?.inputSchema,
    readTool.definition.inputSchema,
  );
});

test("Main Agent does not schema-disclose a Tool outside the authority envelope", async () => {
  registerTool(readTool);
  registerTool(writeTool);
  vi.spyOn(intentMatcherModule, "matchToolCandidatesByEmbedding").mockResolvedValue(
    {
      query: "inspect and update",
      topCandidates: [],
      toolCandidates: [],
      toolExposure: {
        exposedToolIds: ["read"],
        exposedDefinitions: [readTool.definition],
        reason: ["matched read"],
      },
      eligibleToolIds: ["read"],
      exposureReasons: ["matched read"],
    },
  );

  const events: CapturedEvent[] = [];
  await prepareContextNode(createBaseState(), async (event) => {
    events.push({
      nodeId: event.nodeId,
      phase: event.phase,
      details: event.details,
    });
  });

  const done = events.find(
    (event) =>
      event.nodeId === "agent-prepare-context" && event.phase === "done",
  );
  const details = done?.details;
  assert.ok(details);
  assert.deepEqual(details.capabilitySchemaDisclosedIds, ["read"]);
  assert.deepEqual(details.capabilityMetadataToolIds, ["read"]);
});
