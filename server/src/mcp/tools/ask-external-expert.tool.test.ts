import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolInvocationContext } from "../core/definitions.js";
import { executeHarnessInvocation } from "@/harness/invocations.js";
import { registerTool, unregisterTool } from "@/harness/registry.js";
import {
  attachHarnessLlmContentToExecution,
} from "@/agent/nodes/harness-tool-result.js";
import {
  createToolExecutionEvidenceSummary,
} from "@/agent/evidence.js";
import type { AgentToolExecutionResult } from "@/agent/types.js";
import {
  askExternalExpertTool,
  createAskExternalExpertTool,
} from "./ask-external-expert.tool.js";

const context = (args: Record<string, unknown>): ToolInvocationContext => ({
  invocationId: "invocation-external-expert",
  args,
  userId: 7,
  signal: new AbortController().signal,
  pushEvent: vi.fn(),
  addArtifact: vi.fn(),
  trace: {
    startSpan: vi.fn(() => ({ spanId: "span-external-expert", end: vi.fn() })),
  },
});

afterEach(() => {
  unregisterTool(askExternalExpertTool.definition.id);
});

describe("ask_external_expert", () => {
  it("accepts only a question and keeps connection details internal", async () => {
    const ask = vi.fn().mockResolvedValue({
      answer: "建议先验证数据来源。",
      status: "completed",
      latencyMs: 123,
    });
    const tool = createAskExternalExpertTool({ ask });

    const output = await tool.execute(context({
      question: "请给建议。",
    }));

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        question: "请给建议。",
      }),
    );
    expect(output).toEqual({
      result: {
        answer: "建议先验证数据来源。",
        status: "completed",
        latencyMs: 123,
      },
      evidence: expect.objectContaining({
        facts: expect.arrayContaining([
          "tool=ask_external_expert",
          "status=completed",
        ]),
        data: expect.objectContaining({ answer: "建议先验证数据来源。" }),
      }),
    });
    expect(tool.definition.inputSchema).toMatchObject({
      required: ["question"],
      properties: { question: expect.any(Object) },
      additionalProperties: false,
    });
    expect(tool.definition.inputSchema.properties).not.toHaveProperty("provider");
    expect(tool.definition.inputSchema.properties).not.toHaveProperty("conversation");
  });

  it("passes the provider result through Harness and into Agent Evidence", async () => {
    const tool = createAskExternalExpertTool({
      ask: vi.fn().mockResolvedValue({
        answer: "外部专家回复。",
        status: "completed",
        latencyMs: 88,
      }),
    });
    registerTool(tool);

    const invocation = await executeHarnessInvocation({
      toolId: "ask_external_expert",
      args: {
        question: "问题",
      },
      userId: 7,
    });

    expect(invocation.status).toBe("completed");
    expect(invocation.result).toEqual(
      expect.objectContaining({
        answer: "外部专家回复。",
      }),
    );
    expect(invocation.evidence?.data).toEqual(
      expect.objectContaining({ answer: "外部专家回复。" }),
    );

    const execution: AgentToolExecutionResult = {
      toolId: invocation.toolId,
      args: invocation.args,
      invocationId: invocation.id,
      status: "completed",
      result: invocation.result,
      evidence: invocation.evidence,
      startedAt: invocation.startedAt!,
      finishedAt: invocation.finishedAt!,
    };
    const evidence = createToolExecutionEvidenceSummary({
      execution: attachHarnessLlmContentToExecution(execution)!,
      evidenceIndex: 0,
    });
    expect(evidence.data).toEqual(
      expect.objectContaining({
        answer: "外部专家回复。",
      }),
    );
    expect(evidence.facts).toEqual(
      expect.arrayContaining(["tool=ask_external_expert", "status=completed"]),
    );
  });
});
