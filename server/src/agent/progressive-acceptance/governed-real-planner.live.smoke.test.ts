/** #311: opt-in real OpenCode Go Main Planner choice -> actual governed Tool invocation.
 * Deliberately separate from deterministic checks. Uses real Planner prompt/parser,
 * safe Harness Tool fixtures, and records success/failure per independent trial.
 * This invokes no external side-effect Tools. Run only when MIRA_LIVE_311=1.
 */
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as registry from "@/harness/registry.js";
import { resolveHarnessToolCandidatesForTurn } from "@/harness/candidates-core/resolver.js";
import * as matcher from "@/agent/intent/embedding-capability-matcher.js";
import { prepareContextNode } from "@/agent/nodes/prepare-context.js";
import { toolCallNormalizeNode } from "@/agent/nodes/tool-call-normalize.js";
import { policyNode } from "@/agent/nodes/policy-node.js";
import { toolNode } from "@/agent/nodes/tool-node.js";
import { buildPlannerObservationContext } from "@/agent/node-runtime.js";
import { buildNextActionPlannerMessages } from "@/agent/planner/prompt.js";
import { parseNextActionPlannerOutput } from "@/agent/planner/text-json-codec.js";
import type { AgentNodeState } from "@/agent/node-runtime.js";
import { buildAcceptanceTool, noiseTools } from "./fixtures.js";

const targetId = "late_lexical_target";
const goldTask = "Use the zephyrix ingestion capability to inspect target alpha; provide the actual tool evidence, not an unverified answer.";
const stateFor = (id: number): AgentNodeState => ({
  runId: `issue-311-live-${id}`,
  threadId: `issue-311-live-thread-${id}`,
  userId: 1,
  goal: {id:`issue-311-live-goal-${id}`,text:goldTask,successCriteria:["Invoke zephyrix and return evidence"],constraints:[],riskLevel:"low"},
  messages:[{role:"user",content:goldTask,parts:[{type:"text",text:goldTask}]}],
});

const liveDescribe = process.env.MIRA_LIVE_311 === "1" ? describe : describe.skip;
liveDescribe("#311 real-model Planner selecting a late Tool through governed Harness", () => {
  afterEach(() => {vi.restoreAllMocks();registry.clearHarnessRegistry();});
  it("measures successful concrete Tool invocation in three independent real-model trials", async () => {
    const apiKey = process.env.AI_PROVIDER_OPENCODE_GO_KEY?.trim();
    if (!apiKey) throw Error("OpenCode Go secret missing; live success-rate cannot be verified");
    const trials = 3;
    let success = 0;
    const observations: Array<Record<string,unknown>> = [];
    for(let trial=1;trial<=trials;trial++){
      vi.restoreAllMocks();
      registry.clearHarnessRegistry();
      const specs=[...noiseTools(24),{id:targetId,description:"Use this capability to inspect any zephyrix ingestion target and return validated results",tags:["noise"]}];
      let actualInvocations=0;
      for(const spec of specs){
        const impl=buildAcceptanceTool(spec);
        registry.registerTool(spec.id===targetId
          ? {...impl,execute:async (args:unknown)=>{actualInvocations++;return {verified:true,target:(args as {target?:string})?.target??"unknown"};}}
          : impl);
      }
      const definitions=registry.listToolDefinitions();
      const resolved=await resolveHarnessToolCandidatesForTurn({query:goldTask,source:"agent_intent",semanticResolver:async()=>undefined});
      const selected=resolved.resolution?.selectedCapabilityId??null;
      vi.spyOn(registry,"listToolDefinitions").mockReturnValue(definitions);
      vi.spyOn(matcher,"matchToolCandidatesByEmbedding").mockResolvedValue({
        query:goldTask,topCandidates:[],toolCandidates:resolved.toolCandidates,
        toolExposure:resolved.toolExposure,eligibleToolIds:resolved.eligibleToolIds,
        exposureReasons:["actual resolver"],
        ...(resolved.resolution?{resolution:resolved.resolution}:{}),
      });
      const base=stateFor(trial);
      const patch=await prepareContextNode(base);
      const exposed=patch.toolExposure?.exposedTools??[];
      const frame={
        globalGoal:goldTask,currentGoal:goldTask,
        completionCriteria:["Invoke the zephyrix capability and return observed evidence"],
      };
      const observationContext=buildPlannerObservationContext({
        currentTaskFrame:frame,observations:[],
        evidence:{observations:[],retrievals:[],toolExecutions:[]},
      } as unknown as Parameters<typeof buildPlannerObservationContext>[0]);
      const plannerMessages=buildNextActionPlannerMessages({
        question:goldTask,
        messages:[{role:"user",content:goldTask}],
        observationContext,
        toolExposure:patch.toolExposure??{exposedTools:[],toolMeta:[]},
        iteration:0,maxIterations:4,
      });
      const t0=Date.now();
      const response=await fetch("https://opencode.ai/zen/go/v1/chat/completions",{
        method:"POST",headers:{
          Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json",
          "User-Agent":"mira-acceptance/311","x-opencode-session":crypto.randomUUID(),
        },
        body:JSON.stringify({
          model:"deepseek-v4.1-flash",
          messages:plannerMessages.map(m=>({role:m.role,content:m.content})),
          max_tokens:4096,thinking:{type:"disabled"},
        }),
      });
      if(!response.ok) throw Error(`Real Planner model HTTP ${response.status}`);
      const payload=await response.json() as {
        choices?:Array<{message?:{content?:string}}>,
        usage?:{prompt_tokens?:number,completion_tokens?:number,total_tokens?:number}
      };
      const action=parseNextActionPlannerOutput(payload.choices?.[0]?.message?.content??"");
      let invocationStatus="NOT_INVOKED";
      if(action?.type==="use_tool" && action.toolId===targetId){
        const normalized=await toolCallNormalizeNode({...base,...patch,nextAction:action});
        if(normalized.pendingToolCall?.status==="frozen"){
          const pol=await policyNode({...base,...patch,...normalized});
          if(pol.policyDecision?.type==="allow"){
            const executed=await toolNode({...base,...patch,...normalized,...pol});
            invocationStatus=executed.lastToolExecution?.status??"NOT_INVOKED";
          }else{invocationStatus=`POLICY_${pol.policyDecision?.type??"UNKNOWN"}`;}
        }else{invocationStatus=`NORMALIZE_FAILED:${normalized.errorMessage??"unknown"}`;}
      }
      const passed=selected===targetId && exposed.includes(targetId) && action?.type==="use_tool" && action.toolId===targetId && invocationStatus==="completed" && actualInvocations===1;
      if(passed)success++;
      const observation={
        trial,
        capabilityResolved:selected,
        resolutionPath:resolved.resolution?.path??null,
        targetExposed:exposed.includes(targetId),
        plannerAction:action?.type??"INVALID",
        plannerToolId:action?.type==="use_tool"?action.toolId:null,
        invocationStatus,actualInvocations,
        passed,latencyMs:Date.now()-t0,
        tokens:payload.usage?.total_tokens??null,
      };
      observations.push(observation);
      console.log(JSON.stringify({phase:"issue311_real_model_governed_tool_trial",...observation}));
    }
    console.log(JSON.stringify({phase:"issue311_live_model_success_summary",passed:success,total:trials,successRate:`${success}/${trials}`,scope:"production Planner prompt/parser + isolated real resolver + real prepareContext projection + Normalize/Policy/Harness; NOT full Agent graph"}));
    expect(success,JSON.stringify(observations)).toBe(trials);
  },180000);
});
