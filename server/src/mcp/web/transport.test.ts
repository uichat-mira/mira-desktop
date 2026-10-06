import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedFetchError } from "guarded-fetch";

const generalSettingsMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/db/repositories/general-settings.repository.js", () => ({
  generalSettingsRepository: generalSettingsMock,
}));

import { createWebFetchTransport } from "./transport.js";

const freshSignal = () => new AbortController().signal;

const nodeResponse = (input: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}) => ({
  status: input.status ?? 200,
  headers: {
    get: (name: string) => input.headers?.[name.toLowerCase()] ?? null,
  },
  body: input.body ? Readable.from([Buffer.from(input.body)]) : null,
});

const safeTarget = (url: string) => ({
  url: new URL(url),
  hostname: new URL(url).hostname,
});

describe("web fetch transport", () => {
  beforeEach(() => {
    generalSettingsMock.get.mockReset();
    generalSettingsMock.get.mockReturnValue({
      socks5Host: "",
      socks5Port: 0,
      socks5Username: "",
      socks5Password: "",
    });
  });

  it("rejects non-http(s) protocols before any request", async () => {
    const guardedFetch = vi.fn();
    const transport = createWebFetchTransport({
      guardedFetch: guardedFetch as never,
      readProxyUrl: () => null,
    });

    await expect(
      transport({ url: "file:///etc/passwd", signal: freshSignal() }),
    ).rejects.toMatchObject({ category: "blocked", code: "blocked", retryable: false });
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("rejects URLs with embedded credentials", async () => {
    const transport = createWebFetchTransport({ readProxyUrl: () => null });

    await expect(
      transport({ url: "https://user:secret@example.com/", signal: freshSignal() }),
    ).rejects.toMatchObject({ category: "blocked", retryable: false });
  });

  it("uses the direct path when no proxy host/port is configured", async () => {
    const guardedFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const transport = createWebFetchTransport({ guardedFetch: guardedFetch as never });

    const result = await transport({
      url: "https://example.com/page",
      signal: freshSignal(),
    });

    expect(guardedFetch).toHaveBeenCalledOnce();
    expect(result.body.toString("utf8")).toBe("ok");
  });

  it("fails closed when the proxy configuration cannot be read", async () => {
    generalSettingsMock.get.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    const guardedFetch = vi.fn();
    const transport = createWebFetchTransport({ guardedFetch: guardedFetch as never });

    await expect(
      transport({ url: "https://example.com/page", signal: freshSignal() }),
    ).rejects.toMatchObject({ category: "network", retryable: false });
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("fetches directly through the guarded transport and bounds the body", async () => {
    const guardedFetch = vi.fn(
      async () =>
        new Response("hello world", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    );
    const transport = createWebFetchTransport({
      guardedFetch: guardedFetch as never,
      readProxyUrl: () => null,
    });

    const result = await transport({
      url: "https://example.com/page",
      signal: freshSignal(),
    });

    expect(guardedFetch).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: 200,
      finalUrl: "https://example.com/page",
      contentType: "text/plain; charset=utf-8",
      body: Buffer.from("hello world"),
      byteLength: 11,
      truncated: false,
    });
  });

  it("marks oversized bodies as truncated instead of failing", async () => {
    const guardedFetch = vi.fn(
      async () => new Response("x".repeat(4096), { status: 200 }),
    );
    const transport = createWebFetchTransport({
      guardedFetch: guardedFetch as never,
      readProxyUrl: () => null,
    });

    const result = await transport({
      url: "https://example.com/large",
      signal: freshSignal(),
      maxResponseBytes: 1024,
    });

    expect(result.truncated).toBe(true);
    expect(result.byteLength).toBe(1024);
    expect(result.body.length).toBe(1024);
  });

  it("maps non-2xx responses to an http failure with status", async () => {
    const guardedFetch = vi.fn(async () => new Response("nope", { status: 404 }));
    const transport = createWebFetchTransport({
      guardedFetch: guardedFetch as never,
      readProxyUrl: () => null,
    });

    await expect(
      transport({ url: "https://example.com/missing", signal: freshSignal() }),
    ).rejects.toMatchObject({ category: "http", statusCode: 404, retryable: false });
  });

  it("maps guarded-fetch timeout and network codes to distinct failures", async () => {
    const timeoutTransport = createWebFetchTransport({
      guardedFetch: (async () => {
        throw new GuardedFetchError("timeout", "timed out");
      }) as never,
      readProxyUrl: () => null,
    });
    const networkTransport = createWebFetchTransport({
      guardedFetch: (async () => {
        throw new GuardedFetchError("network_error", "connection reset");
      }) as never,
      readProxyUrl: () => null,
    });
    const blockedTransport = createWebFetchTransport({
      guardedFetch: (async () => {
        throw new GuardedFetchError("hostname_unsafe", "private address");
      }) as never,
      readProxyUrl: () => null,
    });

    await expect(
      timeoutTransport({ url: "https://example.com/slow", signal: freshSignal() }),
    ).rejects.toMatchObject({ category: "timeout", retryable: true });
    await expect(
      networkTransport({ url: "https://example.com/reset", signal: freshSignal() }),
    ).rejects.toMatchObject({ category: "network", retryable: true });
    await expect(
      blockedTransport({ url: "https://example.com/private", signal: freshSignal() }),
    ).rejects.toMatchObject({ category: "blocked", retryable: false });
  });

  it("projects caller cancellation as cancelled even when the transport reports network_error", async () => {
    const controller = new AbortController();
    const guardedFetch = vi.fn(
      (_url: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new GuardedFetchError("network_error", "aborted")),
            { once: true },
          );
        }),
    );
    const transport = createWebFetchTransport({
      guardedFetch: guardedFetch as never,
      readProxyUrl: () => null,
    });

    const pending = transport({
      url: "https://example.com/cancel",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 0);

    await expect(pending).rejects.toMatchObject({
      category: "cancelled",
      retryable: false,
    });
  });

  it("routes through SOCKS with a validated pre-request URL", async () => {
    const assertUrlIsSafeToFetch = vi.fn(async (url: string) => safeTarget(url));
    const nodeFetch = vi.fn(async () =>
      nodeResponse({ body: "proxied body", headers: { "content-type": "text/html" } }),
    );
    const transport = createWebFetchTransport({
      nodeFetch: nodeFetch as never,
      assertUrlIsSafeToFetch: assertUrlIsSafeToFetch as never,
      createGuardedLookup: () => (() => {}) as never,
    });

    const result = await transport({
      url: "https://example.com/page",
      signal: freshSignal(),
      proxyUrl: "socks5://127.0.0.1:1080",
    });

    expect(assertUrlIsSafeToFetch).toHaveBeenCalledWith("https://example.com/page");
    expect(nodeFetch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 200,
      finalUrl: "https://example.com/page",
      body: Buffer.from("proxied body"),
      contentType: "text/html",
    });
  });

  it("revalidates every redirect hop on the SOCKS path", async () => {
    const assertUrlIsSafeToFetch = vi.fn(async (url: string) => safeTarget(url));
    const nodeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        nodeResponse({
          status: 302,
          headers: { location: "https://example.com/final" },
        }),
      )
      .mockResolvedValueOnce(nodeResponse({ body: "final body" }));
    const transport = createWebFetchTransport({
      nodeFetch: nodeFetch as never,
      assertUrlIsSafeToFetch: assertUrlIsSafeToFetch as never,
      createGuardedLookup: () => (() => {}) as never,
    });

    const result = await transport({
      url: "https://example.com/page",
      signal: freshSignal(),
      proxyUrl: "socks5://127.0.0.1:1080",
    });

    expect(assertUrlIsSafeToFetch).toHaveBeenNthCalledWith(1, "https://example.com/page");
    expect(assertUrlIsSafeToFetch).toHaveBeenNthCalledWith(2, "https://example.com/final");
    expect(result.finalUrl).toBe("https://example.com/final");
    expect(result.body.toString("utf8")).toBe("final body");
  });

  it("blocks a SOCKS redirect whose next hop fails destination policy", async () => {
    const assertUrlIsSafeToFetch = vi
      .fn()
      .mockResolvedValueOnce(safeTarget("https://example.com/page"))
      .mockRejectedValueOnce(new GuardedFetchError("hostname_unsafe", "private address"));
    const nodeFetch = vi.fn().mockResolvedValueOnce(
      nodeResponse({
        status: 302,
        headers: { location: "https://internal.example/final" },
      }),
    );
    const transport = createWebFetchTransport({
      nodeFetch: nodeFetch as never,
      assertUrlIsSafeToFetch: assertUrlIsSafeToFetch as never,
      createGuardedLookup: () => (() => {}) as never,
    });

    await expect(
      transport({
        url: "https://example.com/page",
        signal: freshSignal(),
        proxyUrl: "socks5://127.0.0.1:1080",
      }),
    ).rejects.toMatchObject({ category: "blocked", retryable: false });
    expect(nodeFetch).toHaveBeenCalledOnce();
  });

  it("classifies a malformed SOCKS redirect target as blocked", async () => {
    const assertUrlIsSafeToFetch = vi.fn(async (url: string) => safeTarget(url));
    const nodeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        nodeResponse({ status: 302, headers: { location: "http://[bad" } }),
      );
    const transport = createWebFetchTransport({
      nodeFetch: nodeFetch as never,
      assertUrlIsSafeToFetch: assertUrlIsSafeToFetch as never,
      createGuardedLookup: () => (() => {}) as never,
    });

    await expect(
      transport({
        url: "https://example.com/page",
        signal: freshSignal(),
        proxyUrl: "socks5://127.0.0.1:1080",
      }),
    ).rejects.toMatchObject({ category: "blocked", retryable: false });
    expect(nodeFetch).toHaveBeenCalledOnce();
  });

  it("classifies a SOCKS redirect without a target as blocked", async () => {
    const assertUrlIsSafeToFetch = vi.fn(async (url: string) => safeTarget(url));
    const nodeFetch = vi.fn().mockResolvedValueOnce(nodeResponse({ status: 302 }));
    const transport = createWebFetchTransport({
      nodeFetch: nodeFetch as never,
      assertUrlIsSafeToFetch: assertUrlIsSafeToFetch as never,
      createGuardedLookup: () => (() => {}) as never,
    });

    await expect(
      transport({
        url: "https://example.com/page",
        signal: freshSignal(),
        proxyUrl: "socks5://127.0.0.1:1080",
      }),
    ).rejects.toMatchObject({ category: "blocked", retryable: false });
    expect(nodeFetch).toHaveBeenCalledOnce();
  });

  it("projects caller cancellation on the SOCKS path as cancelled", async () => {
    const controller = new AbortController();
    const nodeFetch = vi.fn(
      (_url: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const transport = createWebFetchTransport({
      nodeFetch: nodeFetch as never,
      assertUrlIsSafeToFetch: (async (url: string) => safeTarget(url)) as never,
      createGuardedLookup: () => (() => {}) as never,
    });

    const pending = transport({
      url: "https://example.com/page",
      signal: controller.signal,
      proxyUrl: "socks5://127.0.0.1:1080",
    });
    setTimeout(() => controller.abort(), 0);

    await expect(pending).rejects.toMatchObject({ category: "cancelled" });
  });
});
