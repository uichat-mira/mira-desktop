import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const originalStreamTaskChatText = vi.fn();
  return {
    originalStreamTaskChatText,
    providerProxyService: {
      streamTaskChatText: originalStreamTaskChatText,
    },
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
              properties: { path: { type: "string" } },
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
    expect(mocks.streamTaskStructuredOutputText).not.toHaveBeenCalled();
  });

  it("falls back to the current text-JSON compatibility stream when native structured output fails before emitting", async () => {
    const compatibilityDecision =
      '{"type":"retrieve","query":"README","reason":"Need repository evidence."}';
    mocks.streamTaskStructuredOutputText.mockImplementation(
      () =>
        (async function* () {
          throw new Error("structured output unavailable");
        })(),
    );
    mocks.originalStreamTaskChatText.mockImplementation(async function* () {
      yield compatibilityDecision.slice(0, 35);
      yield compatibilityDecision.slice(35);
    });

    const output = await collect(
      mocks.providerProxyService.streamTaskChatText(plannerMessages),
    );

    expect(output).toBe(compatibilityDecision);
    expect(mocks.streamTaskStructuredOutputText).toHaveBeenCalledOnce();
    expect(mocks.originalStreamTaskChatText).toHaveBeenCalledOnce();
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
});
