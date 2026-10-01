import { beforeEach, describe, expect, it, vi } from "vitest";

import { adaptPlannerProviderOutput } from "./decision-adapter";

const nativeCapability = {
  adapter: "ark-json-schema" as const,
  resolved: {
    providerCode: "test-native",
    providerConnectionId: "test-connection",
    providerTemplateCode: "volcengine-agent-plan",
    baseUrl: "https://example.test",
    apiKey: "test-key",
    model: "test-model",
    modelConfigId: "test-model-config",
    params: {},
  },
};

const compatibilityCapability = {
  adapter: "none" as const,
  resolved: {
    ...nativeCapability.resolved,
    providerCode: "test-text",
    providerTemplateCode: "openai",
  },
};

const mocks = vi.hoisted(() => {
  const originalStreamTaskChatText = vi.fn();
  return {
    originalStreamTaskChatText,
    providerProxyService: {
      streamTaskChatText: originalStreamTaskChatText,
    },
    resolveTaskStructuredOutputCapability: vi.fn(),
    streamTaskStructuredOutputText: vi.fn(),
    writeStructuredLog: vi.fn(),
  };
});

vi.mock("@/logger", () => ({
  writeStructuredLog: mocks.writeStructuredLog,
}));

vi.mock("@/services/provider-proxy.service/index", () => ({
  providerProxyService: mocks.providerProxyService,
}));

vi.mock("@/services/provider-proxy.service/task-structured-output", () => ({
  resolveTaskStructuredOutputCapability: mocks.resolveTaskStructuredOutputCapability,
  streamTaskStructuredOutputText: mocks.streamTaskStructuredOutputText,
}));

await import("./structured-provider-hook");

const plannerMessages = [
  {
    role: "system" as const,
    content: "RUNTIME PLAN CONTRACT: return one Planner decision.",
  },
  {
    role: "user" as const,
    content: JSON.stringify({
      toolExposure: {
        exposedTools: ["read_open"],
        toolMeta: [
          {
            toolId: "read_open",
            title: "Read Open",
            description: "Open a workspace file.",
            inputSchema: {
              type: "object",
              properties: {
                path: { type: "string" },
                startLine: { type: "number" },
              },
              required: ["path"],
              additionalProperties: false,
            },
          },
        ],
      },
    }),
  },
];

const collect = async (stream: AsyncIterable<string>) => {
  let output = "";
  for await (const delta of stream) {
    output += delta;
  }
  return output;
};

describe("Planner provider boundary characterization", () => {
  beforeEach(() => {
    mocks.originalStreamTaskChatText.mockReset();
    mocks.resolveTaskStructuredOutputCapability.mockReset();
    mocks.resolveTaskStructuredOutputCapability.mockReturnValue(nativeCapability);
    mocks.streamTaskStructuredOutputText.mockReset();
    mocks.writeStructuredLog.mockReset();
  });

  it("uses the original text stream unchanged for non-Planner consumers", async () => {
    mocks.originalStreamTaskChatText.mockImplementation(async function* () {
      yield "ordinary task-model text";
    });

    const output = await collect(
      mocks.providerProxyService.streamTaskChatText([
        { role: "user", content: "Summarize this text." },
      ]),
    );

    expect(output).toBe("ordinary task-model text");
    expect(mocks.originalStreamTaskChatText).toHaveBeenCalledOnce();
    expect(mocks.resolveTaskStructuredOutputCapability).not.toHaveBeenCalled();
    expect(mocks.streamTaskStructuredOutputText).not.toHaveBeenCalled();
  });

  it("falls back to text-JSON only when native capability is explicitly absent", async () => {
    const compatibilityDecision =
      '{"type":"retrieve","query":"README","reason":"Need repository evidence."}';
    mocks.resolveTaskStructuredOutputCapability.mockReturnValue(
      compatibilityCapability,
    );
    mocks.originalStreamTaskChatText.mockImplementation(async function* () {
      yield compatibilityDecision.slice(0, 35);
      yield compatibilityDecision.slice(35);
    });

    const output = await collect(
      mocks.providerProxyService.streamTaskChatText(plannerMessages),
    );

    expect(output).toBe(compatibilityDecision);
    expect(mocks.resolveTaskStructuredOutputCapability).toHaveBeenCalledOnce();
    expect(mocks.streamTaskStructuredOutputText).not.toHaveBeenCalled();
    expect(mocks.originalStreamTaskChatText).toHaveBeenCalledOnce();
  });

  it("surfaces provider capability resolution errors without compatibility fallback", async () => {
    mocks.resolveTaskStructuredOutputCapability.mockImplementation(() => {
      throw new Error("task provider configuration is invalid");
    });
    mocks.originalStreamTaskChatText.mockImplementation(async function* () {
      yield '{"type":"error","reason":"compatibility fallback"}';
    });

    await expect(
      collect(mocks.providerProxyService.streamTaskChatText(plannerMessages)),
    ).rejects.toThrow("task provider configuration is invalid");
    expect(mocks.streamTaskStructuredOutputText).not.toHaveBeenCalled();
    expect(mocks.originalStreamTaskChatText).not.toHaveBeenCalled();
  });

  it("surfaces declared-native setup failures before stream creation", async () => {
    mocks.streamTaskStructuredOutputText.mockImplementation(() => {
      throw new Error("native structured setup failed");
    });
    mocks.originalStreamTaskChatText.mockImplementation(async function* () {
      yield '{"type":"error","reason":"compatibility fallback"}';
    });

    await expect(
      collect(mocks.providerProxyService.streamTaskChatText(plannerMessages)),
    ).rejects.toThrow("native structured setup failed");
    expect(mocks.originalStreamTaskChatText).not.toHaveBeenCalled();
  });

  it("marks a successful native provider stream for the typed native adapter", async () => {
    const nativeDecision =
      '{"type":"retrieve","query":"README","reason":"Need repository evidence."}';
    mocks.streamTaskStructuredOutputText.mockImplementation(
      () =>
        (async function* () {
          yield nativeDecision;
        })(),
    );

    const stream = mocks.providerProxyService.streamTaskChatText(plannerMessages);
    expect(await collect(stream)).toBe(nativeDecision);
    expect(
      (stream as { getOutputKind?: () => string }).getOutputKind?.(),
    ).toBe("native");
    expect(mocks.originalStreamTaskChatText).not.toHaveBeenCalled();
  });

  it("carries the native generation tool schema into optional-null cleanup", async () => {
    const nativeEnvelope = {
      type: "use_tool" as const,
      reason: "Open the known target.",
      query: null,
      toolId: "read_open",
      args: {
        path: "README.md",
        startLine: null,
      },
      question: null,
      completionProof: [],
      unresolvedGaps: [],
      planPatch: { addItems: [], completeIds: [] },
    };
    const nativeText = JSON.stringify(nativeEnvelope);
    mocks.streamTaskStructuredOutputText.mockImplementation(() =>
      Object.assign(
        (async function* () {
          yield nativeText;
        })(),
        {
          getStructuredOutput: () => nativeEnvelope,
        },
      ),
    );

    const stream = mocks.providerProxyService.streamTaskChatText(plannerMessages);
    expect(await collect(stream)).toBe(nativeText);
    const structuredOutput = (
      stream as { getStructuredOutput?: () => unknown }
    ).getStructuredOutput?.();
    const adapted = adaptPlannerProviderOutput({
      kind: "native",
      value: structuredOutput,
    });

    expect(adapted.decision).toEqual({
      type: "use_tool",
      reason: "Open the known target.",
      toolId: "read_open",
      args: {
        path: "README.md",
      },
    });
  });

  it("does not append a text-JSON fallback after partial native output", async () => {
    mocks.streamTaskStructuredOutputText.mockImplementation(
      () =>
        (async function* () {
          yield '{"type":"retrieve"';
          throw new Error("native stream interrupted");
        })(),
    );
    mocks.originalStreamTaskChatText.mockImplementation(async function* () {
      yield '{"type":"error","reason":"compatibility fallback"}';
    });

    await expect(
      collect(mocks.providerProxyService.streamTaskChatText(plannerMessages)),
    ).rejects.toThrow("native stream interrupted");
    expect(mocks.originalStreamTaskChatText).not.toHaveBeenCalled();
  });

  it("does not downgrade a declared native provider after its stream is created", async () => {
    mocks.streamTaskStructuredOutputText.mockImplementation(
      () =>
        (async function* () {
          throw new Error("native protocol rejected the schema");
        })(),
    );
    mocks.originalStreamTaskChatText.mockImplementation(async function* () {
      yield '{"type":"error","reason":"compatibility fallback"}';
    });

    await expect(
      collect(mocks.providerProxyService.streamTaskChatText(plannerMessages)),
    ).rejects.toThrow("native protocol rejected the schema");
    expect(mocks.originalStreamTaskChatText).not.toHaveBeenCalled();
  });
});
