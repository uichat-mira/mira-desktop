import { describe, expect, it, vi } from "vitest";
import { executeWebFetch } from "./fetch.js";
import { WebFetchTransportError } from "./transport.js";

const transportResult = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  finalUrl: "https://example.com/final",
  contentType: "text/plain; charset=utf-8",
  body: Buffer.from("plain body"),
  byteLength: 10,
  truncated: false,
  ...overrides,
});

describe("web fetch runtime", () => {
  it("rejects an empty url", async () => {
    await expect(
      executeWebFetch({ url: "   ", signal: new AbortController().signal }),
    ).rejects.toThrow("url must be a non-empty string");
  });

  it("extracts content and preserves transport metadata", async () => {
    const transport = vi.fn(async () => transportResult());
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
      contentType: "text/plain; charset=utf-8",
      byteLength: 10,
      truncated: false,
      kind: "text",
      content: "plain body",
    });
  });

  it("preserves transport truncation metadata after extraction", async () => {
    const transport = vi.fn(async () =>
      transportResult({ truncated: true, byteLength: 512 * 1024 }),
    );

    const result = await executeWebFetch({
      url: "https://example.com/big",
      signal: new AbortController().signal,
      transport,
    });

    expect(result.truncated).toBe(true);
    expect(result.byteLength).toBe(512 * 1024);
    expect(result.kind).toBe("text");
  });

  it("reports browser_required for a JavaScript shell", async () => {
    const transport = vi.fn(async () =>
      transportResult({
        contentType: "text/html; charset=utf-8",
        body: Buffer.from(
          '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/app.js"></script></body></html>',
        ),
      }),
    );

    const result = await executeWebFetch({
      url: "https://example.com/app",
      signal: new AbortController().signal,
      transport,
    });

    expect(result.kind).toBe("browser_required");
    expect(result.reason).toBeTruthy();
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
