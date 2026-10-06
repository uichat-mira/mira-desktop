import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { contextBudgetService } from "@/services/context-budget/index";
import { providerProxyService } from "@/services/provider-proxy.service/index";
import { generateNode } from "../nodes/generate";
import type { AgentNodeState } from "../node-runtime";

afterEach(() => {
  vi.restoreAllMocks();
});

test("Generate excludes only agent-execution request context", async () => {
  const finalizationPacket = {
    type: "answer" as const,
    reason: "The requested result is ready.",
    completionProof: [
      {
        criterion: "return an answer",
        evidenceRefs: [],
      },
    ],
    unresolvedGaps: [],
  };
  const state: AgentNodeState = {
    runId: "run-generate-context",
    threadId: "thread-generate-context",
    userId: 1,
    goal: {
      id: "goal-generate-context",
      text: "总结已有结果",
      successCriteria: ["return an answer"],
      constraints: [],
      riskLevel: "low",
    },
    messages: [
      {
        role: "user",
        content: "总结已有结果",
        parts: [{ type: "text", text: "总结已有结果" }],
      },
    ],
    requestContextMessages: [
      {
        role: "system",
        content: "角色设定：保持回答简洁。",
      },
      {
        role: "system",
        content: "线程摘要：工具已经执行完成。",
      },
      {
        role: "system",
        content: "你可以使用当前可用工具。当前可用工具：read_open, terminal",
        requestContextScope: "agent-execution",
      },
    ],
    observations: [],
    evidence: {
      observations: [],
      toolExecutions: [],
      retrievals: [],
    },
    nextAction: finalizationPacket,
    finalizationPacket,
  };
  let generationMessages: Array<{ content: string }> = [];
  let budgetPrefaceMessages: Array<{ content: string }> = [];

  vi.spyOn(contextBudgetService, "pack").mockImplementation((input) => {
    budgetPrefaceMessages = input.sections.prefaceMessages ?? [];
    const messages = [
      ...(input.sections.prefaceMessages ?? []),
      ...(input.sections.instructionMessages ?? []),
      ...(input.sections.payloads ?? []).flatMap((payload) => payload.messages),
      ...(input.sections.historyMessages ?? []),
      input.sections.latestUserMessage,
    ];
    return {
      messages,
      payloads: [],
      audit: {
        policy: input.policy,
        model: "test-model",
        providerCode: "test-provider",
        modelContextTokens: 8192,
        reservedOutputTokens: 1024,
        maxInputTokens: 7168,
        totalEstimatedTokensBefore: 0,
        totalEstimatedTokensAfter: 0,
        sections: [],
        warnings: [],
      },
    };
  });
  vi.spyOn(providerProxyService, "describeChatInvocation").mockReturnValue({
    operation: "chat",
    providerCode: "test-provider",
    requestedProvider: "default",
    resolvedProvider: "default",
    model: "test-model",
    modelConfigId: "test-model-config",
    messageCount: 0,
    messagesPreview: [],
  });
  vi.spyOn(providerProxyService, "generateTextForRole").mockImplementation(
    async (_role, messages) => {
      generationMessages = messages;
      return "已有工具执行完成。";
    },
  );

  const result = await generateNode(state);
  const generationPrompt = generationMessages
    .map((message) => message.content)
    .join("\n");
  const budgetPreface = budgetPrefaceMessages
    .map((message) => message.content)
    .join("\n");

  assert.equal(result.answer, "已有工具执行完成。");
  assert.match(generationPrompt, /角色设定：保持回答简洁/);
  assert.match(generationPrompt, /线程摘要：工具已经执行完成/);
  assert.doesNotMatch(generationPrompt, /当前可用工具|read_open|terminal/);
  assert.match(budgetPreface, /角色设定：保持回答简洁/);
  assert.match(budgetPreface, /线程摘要：工具已经执行完成/);
  assert.doesNotMatch(budgetPreface, /当前可用工具|read_open|terminal/);
});
