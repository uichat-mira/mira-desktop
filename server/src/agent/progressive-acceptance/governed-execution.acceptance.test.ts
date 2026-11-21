/** #311 acceptance: real deterministic capability resolution followed by governed Harness invocation.
 * The Planner action is scripted, not an LLM decision; report that boundary honestly.
 * Fixture has no filesystem/network/process side effects.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as registry from "@/harness/registry.js";
import { resolveHarnessToolCandidatesForTurn } from "@/harness/candidates-core/resolver.js";
import * as matcher from "@/agent/intent/embedding-capability-matcher.js";
import { prepareContextNode } from "@/agent/nodes/prepare-context.js";
import { toolCallNormalizeNode } from "@/agent/nodes/tool-call-normalize.js";
import { policyNode } from "@/agent/nodes/policy-node.js";
import { toolNode } from "@/agent/nodes/tool-node.js";
import type { AgentNodeState } from "@/agent/node-runtime.js";
import { buildAcceptanceTool, noiseTools } from "./fixtures.js";

const targetId = "late_lexical_target";
const query = "zephyrix";
const createState = (): AgentNodeState => ({
  runId: "issue-311-governed-run",
  threadId: "issue-311-governed-thread",
  userId: 1,
  goal: {id:"issue-311-governed-goal",text:query,successCriteria:["return zephyrix probe result"],constraints:[],riskLevel:"low"},
  messages: [{role:"user",content:query,parts:[{type:"text",text:query}]}],
});

describe("#311 real resolution -> disclosure -> Normalize -> Policy -> Harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    registry.clearHarnessRegistry();
  });

  it("executes the right Tool after old first20 and refuses an undisclosed decoy", async () => {
    const specs = [
      ...noiseTools(24),
      {id:targetId,description:"Handles the zephyrix ingestion pipeline",tags:["noise"]},
    ];
    let realExecutions = 0;
    for (const spec of specs) {
      const original = buildAcceptanceTool(spec);
      registry.registerTool(spec.id === targetId
        ? {...original, execute: async () => {realExecutions++; return {answer:"zephyrix verified"};}}
        : original);
    }
    const definitions = registry.listToolDefinitions();
    expect(definitions.findIndex(def => def.id === targetId)).toBeGreaterThan(19);
    let semanticCalls = 0;
    const resolved = await resolveHarnessToolCandidatesForTurn({
      query,
      source:"agent_intent",
      semanticResolver: async () => {semanticCalls++; return undefined;},
    });
    expect(resolved.resolution?.selectedCapabilityId).toBe(targetId);
    expect(resolved.eligibleToolIds).toContain(targetId);
    expect(resolved.resolution?.path).toBe("lexical");

    vi.spyOn(registry,"listToolDefinitions").mockReturnValue(definitions);
    vi.spyOn(matcher,"matchToolCandidatesByEmbedding").mockResolvedValue({
      query,
      topCandidates:[],
      toolCandidates:resolved.toolCandidates,
      toolExposure:resolved.toolExposure,
      eligibleToolIds:resolved.eligibleToolIds,
      exposureReasons:["real deterministic capability resolution"],
      ...(resolved.resolution?{resolution:resolved.resolution}:{}),
    });
    const base = createState();
    const prepared = await prepareContextNode(base);
    expect(prepared.toolExposure?.exposedTools).toContain(targetId);
    expect(prepared.toolExposure?.toolMeta.find(item=>item.toolId===targetId)?.inputSchema).toBeDefined();
    expect(prepared.toolExposure?.exposedTools).not.toContain("noise_tool_0");

    const unexposed = await toolCallNormalizeNode({
      ...base,...prepared,
      nextAction:{type:"use_tool",toolId:"noise_tool_0",args:{target:"probe"},reason:"negative unauthorized test"},
    });
    expect(unexposed.errorMessage).toMatch(/not exposed/i);
    expect(realExecutions).toBe(0);

    // Planner action is scripted here; real-model Planner selection is a SEPARATE acceptance gate.
    const normalized = await toolCallNormalizeNode({
      ...base,...prepared,
      nextAction:{type:"use_tool",toolId:targetId,args:{target:"probe"},reason:"invoke correct zephyrix handler"},
    });
    expect(normalized.pendingToolCall?.status).toBe("frozen");
    expect(normalized.errorMessage).toBeUndefined();
    const policy = await policyNode({...base,...prepared,...normalized});
    expect(policy.policyDecision?.type).toBe("allow");
    const execution = await toolNode({...base,...prepared,...normalized,...policy});
    expect(execution.lastToolExecution?.status).toBe("completed");
    expect(execution.lastToolExecution?.toolId).toBe(targetId);
    expect(realExecutions).toBe(1);
    console.log(JSON.stringify({
      acceptance:"REAL_HARNESS_EXECUTION_PASS",
      resolution:resolved.resolution?.path,
      goldToolId:targetId,
      plannerAction:"SCRIPTED_NOT_LIVE",
      schemaDisclosed:true,
      normalized:"frozen",
      policy:policy.policyDecision?.type,
      invokedToolId:execution.lastToolExecution?.toolId,
      invocationStatus:execution.lastToolExecution?.status,
      deniedUndisclosedTool:true,
      semanticCalls,
      realExecutions,
    }));
  },30000);
});
