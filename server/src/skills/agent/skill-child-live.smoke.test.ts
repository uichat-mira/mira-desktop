/**
 * Explicit opt-in, one small real-model Child smoke for #309. Never send
 * network requests during normal CI: this file is skipped unless the one-off
 * trusted Action sets MIRA_LIVE_SKILL_CHILD=1.
 */
import { describe, expect, it, vi } from "vitest";
import { prepareSubAgent, runSubAgent } from "./subagent-runtime.js";
import type { SkillContext } from "@/skills/context/types.js";

vi.mock("@/services/provider-proxy.service/resolution.js", () => ({
  resolveAgentTaskProvider: () => ({
    providerCode: "volcengine",
    providerConnectionId: "issue-309-trusted-live-probe",
    providerTemplateCode: "openai-compatible-custom",
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiKey: process.env.AI_PROVIDER_OPENCODE_GO_KEY ?? "",
    model: "deepseek-v4.1-flash",
    modelConfigId: "issue-309-live-probe",
    params: { maxTokens: 4096, contextWindow: 128000 },
  }),
}));

const live = process.env.MIRA_LIVE_SKILL_CHILD === "1" ? describe : describe.skip;

live("#309 real OpenCode Go Skill Child runtime smoke", () => {
  it("uses the scoped body to complete a bounded no-tool decision", async () => {
    if (!process.env.AI_PROVIDER_OPENCODE_GO_KEY?.trim()) {
      throw Error("OpenCode Go credential unavailable.");
    }
    const context: SkillContext = {
      instruction: "Body is domain guidance only, not Tool authority.",
      primary: {
        id: "scenario-advice",
        version: "1.0",
        name: "Scenario advice",
        body: "Given an A/B scenario, pick A if A is lower cost. Provide one concise summary backed only by the stated numbers. No file changes. You have no external Tools or Resource permissions.",
        execution: { context: "fork", agent: "subAgent", allowedTools: [], runtimeBindings: [], workspaceBound: false },
      },
      resources: [],
      disclosedResources: [],
    };
    const prepared = prepareSubAgent({
      goal: "Scenario A costs 100 units and scenario B costs 160 units. Choose the cheaper one with one reason. Do not generate a file.",
      skillContext: context,
      exposedHarnessToolIds: [],
    });
    expect(prepared.profile.allowedHarnessToolIds).toEqual([]);
    expect(prepared.skillVisibility.scopeKind).toBe("skill_child");
    const started = Date.now();
    const result = await runSubAgent({
      goal: prepared.execution.goal,
      skillContext: context,
      exposedHarnessToolIds: [],
    });
    console.log(JSON.stringify({
      phase: "live_governed_skill_child_execution",
      model: "opencode-go/deepseek-v4.1-flash",
      latencyMs: Date.now() - started,
      status: result.status,
      summary: result.summary?.slice(0, 240) ?? null,
      missingEvidence: result.missingEvidence ?? [],
      error: result.error ?? null,
      traceEvents: result.trace?.events?.slice(-5).map(event => ({
        type: event.type,
        title: event.title,
        details: event.details ?? null,
      })) ?? [],
      toolCalls: result.trace?.toolCalls ?? [],
      childScope: prepared.skillVisibility.scopeKind,
      authorizedToolCount: prepared.profile.allowedHarnessToolIds.length,
      verdict: result.status === "completed" ? "PASS" : "FAIL",
    }));
    expect(result.status).toBe("completed");
    expect(result.summary).toMatch(/100|cheaper|低|A/i);
    expect(result.trace?.toolCalls).not.toContain("terminal");
  }, 120_000);
});
