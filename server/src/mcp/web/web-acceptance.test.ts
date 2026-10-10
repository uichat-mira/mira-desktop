import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import type { ToolInvocationContext } from "../core/definitions.js";

const settingsMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/db/repositories/web-search-settings.repository.js", () => ({
  webSearchSettingsRepository: settingsMock,
}));

const transportMock = vi.hoisted(() => ({ fetchWebResource: vi.fn() }));

vi.mock("./transport.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport.js")>();
  return { ...actual, fetchWebResource: transportMock.fetchWebResource };
});

import { webFetchTool } from "../tools/web-fetch.tool.js";
import { webSearchTool } from "../tools/web-search.tool.js";
import { WebFetchTransportError } from "./transport.js";
import { resolveWebSearchProviderAvailability } from "./search.js";
import { resolveWebSearchHarnessRuntimeReadiness } from "../../harness/web-search-readiness.js";

const READABLE_HTML = `<!doctype html><html><head><title>Mira Acceptance</title></head><body><nav><a href="/">Home</a><a href="/about">About</a></nav><article><h1>Mira Acceptance</h1><p>${"Mira retrieves a known public URL and extracts its readable main content deterministically. ".repeat(2)}</p></article><footer>Copyright 2026 Mira</footer></body></html>`;

const htmlBody = (html: string) => Buffer.from(html, "utf8");

const transportResult = (overrides: Record<string, unknown> = {}) => {
  const body = (overrides.body as Buffer | undefined) ?? htmlBody(READABLE_HTML);
  return {
    status: 200,
    finalUrl: "https://example.com/page",
    contentType: "text/html; charset=utf-8",
    body,
    byteLength: body.length,
    truncated: false,
    ...overrides,
  };
};

const createContext = (
  overrides?: Partial<ToolInvocationContext>,
): ToolInvocationContext => ({
  invocationId: "acceptance-invocation",
  args: {},
  signal: new AbortController().signal,
  pushEvent() {},
  addArtifact(artifact) {
    return { id: "artifact-acceptance", ...artifact };
  },
  trace: {
    startSpan() {
      return { spanId: "span-acceptance", end() {} };
    },
  },
  ...overrides,
});

const asRecord = (value: unknown) => value as Record<string, unknown>;

describe("web_search acceptance", () => {
  beforeEach(() => {
    settingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "",
      maxResults: 4,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    settingsMock.get.mockReset();
    delete process.env.TAVILY_API_KEY;
    delete process.env.SEARXNG_BASE_URL;
  });

  it("reports no usable provider when search credentials/configuration are absent", () => {
    const environment = createHarnessEnvironmentSnapshot();

    expect(resolveWebSearchProviderAvailability(environment)).toBe(false);
  });

  it("rejects malformed SearXNG endpoints from readiness and execution planning", async () => {
    settingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "not-a-url",
      maxResults: 4,
    });
    const environment = createHarnessEnvironmentSnapshot();

    expect(resolveWebSearchProviderAvailability(environment)).toBe(false);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      webSearchTool.execute(
        createContext({
          args: { queries: ["alpha"] },
          environment,
        }),
      ),
    ).rejects.toThrow("No web search provider is available");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports readiness-check failures separately from missing provider configuration", () => {
    settingsMock.get.mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const readiness = resolveWebSearchHarnessRuntimeReadiness(
      createHarnessEnvironmentSnapshot(),
    );

    expect(readiness).toEqual({
      state: "unavailable",
      reason: "Web search runtime readiness could not be verified.",
      code: "readiness_check_failed",
    });
    expect(JSON.stringify(readiness)).not.toContain("database unavailable");
  });

  it("reports a usable provider without exposing the configured secret", () => {
    const secret = "acceptance-secret-key";
    settingsMock.get.mockReturnValue({
      tavilyApiKey: secret,
      searxngBaseUrl: "",
      maxResults: 4,
    });
    const environment = createHarnessEnvironmentSnapshot();

    const available = resolveWebSearchProviderAvailability(environment);

    expect(available).toBe(true);
    expect(JSON.stringify(available)).not.toContain(secret);
  });

  it("fans out multiple queries, merges, dedupes by normalized URL, and caps results", async () => {
    settingsMock.get.mockReturnValue({
      tavilyApiKey: "acceptance-key",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = String(init?.body ?? "");
      const results = body.includes('"query":"alpha"')
        ? [
            { title: "Alpha", url: "https://example.com/a/", content: "a" },
            { title: "Beta", url: "https://example.com/b", content: "b" },
          ]
        : [
            { title: "Gamma", url: "https://example.com/c", content: "c" },
            { title: "Alpha duplicate", url: "https://example.com/a#section", content: "dup" },
          ];
      return { ok: true, json: async () => ({ results }) } as Response;
    });

    const result = await webSearchTool.execute(
      createContext({
        args: { queries: ["alpha", "beta"], maxResults: 3 },
        environment: createHarnessEnvironmentSnapshot(),
      }),
    );

    const structured = asRecord(result.structuredContent);
    expect(structured.queries).toEqual(["alpha", "beta"]);
    expect((structured.results as Array<{ link: string }>).map((item) => item.link)).toEqual([
      "https://example.com/a/",
      "https://example.com/c",
      "https://example.com/b",
    ]);
  });

  it("falls back to the next provider when the preferred provider fails", async () => {
    settingsMock.get.mockReturnValue({
      tavilyApiKey: "acceptance-key",
      searxngBaseUrl: "http://localhost:8080",
      maxResults: 4,
    });
    const artifacts: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "https://api.tavily.com/search") {
        return { ok: false, status: 502 } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          results: [{ title: "Fallback", url: "https://example.com/fallback", content: "fallback" }],
        }),
      } as Response;
    });

    const result = await webSearchTool.execute(
      createContext({
        args: { queries: ["alpha"] },
        environment: createHarnessEnvironmentSnapshot(),
        addArtifact(artifact) {
          artifacts.push(artifact as Record<string, unknown>);
          return { id: "artifact-fallback", ...artifact };
        },
      }),
    );

    expect(asRecord(result.structuredContent).results).toHaveLength(1);
    expect(artifacts[0]?.metadata).toMatchObject({
      provider: "searxng",
      capabilityId: "searxng-search",
    });
  });

  it("propagates caller cancellation before contacting providers", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      webSearchTool.execute(
        createContext({
          args: { queries: ["alpha"] },
          signal: controller.signal,
          environment: createHarnessEnvironmentSnapshot({
            toolConfig: { web_search: { apiKey: "acceptance-key" } },
          }),
        }),
      ),
    ).rejects.toThrow("Web search cancelled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("web_fetch acceptance", () => {
  beforeEach(() => {
    transportMock.fetchWebResource.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts readable HTML into markdown with retrieval metadata", async () => {
    transportMock.fetchWebResource.mockResolvedValue(transportResult());

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com/page" } }),
    );

    const structured = asRecord(result.structuredContent);
    expect(result.isError).toBeUndefined();
    expect(structured).toMatchObject({
      url: "https://example.com/page",
      finalUrl: "https://example.com/page",
      status: 200,
      contentType: "text/html; charset=utf-8",
      truncated: false,
      kind: "html",
    });
    expect(String(structured.content)).toContain("readable main content");
  });

  it("decodes non-UTF-8 (GBK) HTML declared in the content type", async () => {
    const chinese =
      "这是一段用于验收 GBK 解码的中文正文内容，长度足够被识别为主正文。".repeat(3);
    const html = `<!doctype html><html><head><title>验收</title></head><body><article><h1>验收</h1><p>${chinese}</p></article></body></html>`;
    transportMock.fetchWebResource.mockResolvedValue(
      transportResult({
        contentType: "text/html; charset=gbk",
        body: iconv.encode(html, "gbk"),
      }),
    );

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com/cn" } }),
    );

    const structured = asRecord(result.structuredContent);
    expect(structured.kind).toBe("html");
    expect(String(structured.content)).toContain("GBK 解码");
    expect(String(structured.content)).not.toContain("\uFFFD");
  });

  it("preserves the final URL after a redirect", async () => {
    transportMock.fetchWebResource.mockResolvedValue(
      transportResult({ finalUrl: "https://example.com/final" }),
    );

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com/start" } }),
    );

    expect(asRecord(result.structuredContent)).toMatchObject({
      url: "https://example.com/start",
      finalUrl: "https://example.com/final",
    });
  });

  it("keeps bounded content when the transport truncates the body", async () => {
    transportMock.fetchWebResource.mockResolvedValue(
      transportResult({ truncated: true, byteLength: 512 * 1024 }),
    );

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com/big" } }),
    );

    expect(asRecord(result.structuredContent)).toMatchObject({
      truncated: true,
      byteLength: 512 * 1024,
      kind: "html",
    });
  });

  it("surfaces a timeout as a structured failure", async () => {
    transportMock.fetchWebResource.mockRejectedValue(
      new WebFetchTransportError("timeout"),
    );

    await expect(
      webFetchTool.execute(createContext({ args: { url: "https://example.com/slow" } })),
    ).rejects.toMatchObject({ category: "timeout" });
  });

  it("projects caller cancellation as cancelled without fetching", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      webFetchTool.execute(
        createContext({ args: { url: "https://example.com/cancel" }, signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ category: "cancelled" });
    expect(transportMock.fetchWebResource).not.toHaveBeenCalled();
  });

  it("blocks private/unsafe destinations as a structured failure", async () => {
    transportMock.fetchWebResource.mockRejectedValue(
      new WebFetchTransportError("blocked"),
    );

    await expect(
      webFetchTool.execute(createContext({ args: { url: "http://127.0.0.1/" } })),
    ).rejects.toMatchObject({ category: "blocked", retryable: false });
  });

  it("reports unsupported for non-text content without pretending success", async () => {
    transportMock.fetchWebResource.mockResolvedValue(
      transportResult({
        contentType: "image/png",
        body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
    );

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com/image.png" } }),
    );

    expect(asRecord(result.structuredContent).kind).toBe("unsupported");
    expect(result.isError).toBe(true);
    expect(asRecord(result.structuredContent).content).toBeUndefined();
  });

  it("reports browser_required for a JavaScript shell instead of an empty success", async () => {
    transportMock.fetchWebResource.mockResolvedValue(
      transportResult({
        body: htmlBody(
          '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/app.js"></script></body></html>',
        ),
      }),
    );

    const result = await webFetchTool.execute(
      createContext({ args: { url: "https://example.com/app" } }),
    );

    expect(asRecord(result.structuredContent).kind).toBe("browser_required");
    expect(result.isError).toBe(true);
  });
});
