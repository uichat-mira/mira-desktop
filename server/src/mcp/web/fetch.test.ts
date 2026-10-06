import { describe, expect, it, vi } from "vitest";
import { executeWebFetch } from "./fetch.js";
import { WebFetchTransportError } from "./transport.js";

describe("web fetch runtime", () => {
  it("rejects an empty url", async () => {
    await expect(
      executeWebFetch({ url: "   ", signal: new AbortController().signal }),
    ).rejects.toThrow("url must be a non-empty string");
  });

  it("maps a transport result into the execution result", async () => {
    const transport = vi.fn(async () => ({
      status: 200,
      finalUrl: "https://example.com/final",
      contentType: "text/plain",
      body: "body",
      byteLength: 4,
      truncated: false,
    }));
    const pushEvent = vi.fn();

    const result = await executeWebFetch({
      url: "  https://example.com  ",
      signal: new AbortController().signal,
      transport,
      pushEvent,
    });

    expect(transport).toHaveBeenCalledWith({
      url: "https://example.com",
      signal: expect.any(AbortSignal),
    });
    expect(pushEvent).toHaveBeenCalledWith({
      type: "invocation:progress",
      message: "Fetching web resource",
    });
    expect(result).toEqual({
      url: "https://example.com",
      finalUrl: "https://example.com/final",
      status: 200,
      contentType: "text/plain",
      content: "body",
      byteLength: 4,
      truncated: false,
    });
  });

  it("throws cancelled before fetching when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn();

    await expect(
      executeWebFetch({
        url: "https://example.com",
        signal: controller.signal,
        transport,
      }),
    ).rejects.toMatchObject({ category: "cancelled" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("propagates structured transport failures", async () => {
    const transport = vi.fn(async () => {
      throw new WebFetchTransportError("blocked");
    });

    await expect(
      executeWebFetch({
        url: "https://example.com",
        signal: new AbortController().signal,
        transport,
      }),
    ).rejects.toMatchObject({ category: "blocked", code: "blocked" });
  });
});
