import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolInvocationContext } from "../core/definitions.js";

const executeWebFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../web/fetch.js", () => ({
  executeWebFetch: executeWebFetchMock,
}));

import { webFetchTool } from "./web-fetch.tool.js";

const createContext = (
  overrides?: Partial<ToolInvocationContext>,
): ToolInvocationContext => ({
  invocationId: "test-invocation",
  args: {},
  signal: new AbortController().signal,
  pushEvent() {},
  addArtifact(artifact) {
    return { id: "artifact-test", ...artifact };
  },
  trace: {
    startSpan() {
      return { spanId: "span-test", end() {} };
    },
  },
  ...overrides,
});

describe("web fetch tool", () => {
  beforeEach(() => {
    executeWebFetchMock.mockReset();
  });

  it("keeps the model-facing input schema minimal", () => {
    expect(webFetchTool.definition.inputSchema).toEqual({
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          minLength: 1,
          description: "Absolute http/https URL of the resource to retrieve.",
        },
      },
      additionalProperties: false,
    });
  });

  it("validates the url argument before execution", async () => {
    await expect(
      webFetchTool.execute(createContext({ args: {} })),
    ).rejects.toThrow("url must be a string");
    await expect(
      webFetchTool.execute(createContext({ args: { url: "   " } })),
    ).rejects.toThrow("url must be a non-empty string");
    expect(executeWebFetchMock).not.toHaveBeenCalled();
  });

  it("delegates to the web fetch runtime and returns extracted content", async () => {
    executeWebFetchMock.mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com/final",
      status: 200,
      contentType: "text/html",
      byteLength: 1234,
      truncated: false,
      kind: "html",
      title: "Example",
      content: "# Example\n\nBody",
    });

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com" } }),
    );

    expect(executeWebFetchMock).toHaveBeenCalledWith({
      url: "https://example.com",
      signal: expect.any(AbortSignal),
      pushEvent: expect.any(Function),
      trace: expect.anything(),
    });
    expect(result.structuredContent).toEqual({
      url: "https://example.com",
      finalUrl: "https://example.com/final",
      status: 200,
      contentType: "text/html",
      byteLength: 1234,
      truncated: false,
      kind: "html",
      title: "Example",
      content: "# Example\n\nBody",
    });
    expect(result.isError).toBeUndefined();
  });

  it("flags browser_required and unsupported outcomes as errors", async () => {
    executeWebFetchMock.mockResolvedValue({
      url: "https://example.com/app",
      finalUrl: "https://example.com/app",
      status: 200,
      contentType: "text/html",
      byteLength: 40,
      truncated: false,
      kind: "browser_required",
      reason: "The page requires JavaScript to render its content.",
    });

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com/app" } }),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: "browser_required",
      reason: "The page requires JavaScript to render its content.",
    });
    expect(
      (result.structuredContent as Record<string, unknown>).content,
    ).toBeUndefined();
  });
});
