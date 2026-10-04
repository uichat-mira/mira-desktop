import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { webSearchTool } from "./web-search.tool.js";

const webSearchSettingsMock = vi.hoisted(() => ({
  get: vi.fn(() => ({
    tavilyApiKey: "",
    searxngBaseUrl: "",
    maxResults: 4,
  })),
}));

vi.mock("@/db/repositories/web-search-settings.repository.js", () => ({
  webSearchSettingsRepository: webSearchSettingsMock,
}));

describe("web search tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAVILY_API_KEY;
    delete process.env.SEARXNG_BASE_URL;
    webSearchSettingsMock.get.mockReset();
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "",
      maxResults: 4,
    });
  });

  it("does not expose provider configuration fields in the LLM-facing input schema", () => {
    expect(webSearchTool.definition.inputSchema).toEqual({
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      additionalProperties: false,
    });
  });

  it("queries tavily when api key is available and provider priority prefers tavily", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Tavily Result",
            url: "https://example.com/tavily",
            content: "Snippet from Tavily",
          },
        ],
      }),
    } as Response);

    const result = await webSearchTool.execute({
      invocationId: "1",
      args: {
        query: "example",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        toolConfig: {
          web_search: {
            apiKey: "runtime-key",
          },
        },
      }),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-1",
            end() {},
          };
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://api.tavily.com/search");
    expect(result.structuredContent).toEqual({
      query: "example",
      provider: "tavily",
      capabilityId: "tavily-search",
      results: [
        {
          title: "Tavily Result",
          link: "https://example.com/tavily",
          snippet: "Snippet from Tavily",
        },
      ],
    });
  });

  it("uses stored maxResults when args do not provide one", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as Response);

    await webSearchTool.execute({
      invocationId: "stored-max-results",
      args: {
        query: "example",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        toolConfig: {
          web_search: {
            apiKey: "runtime-key",
          },
        },
      }),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-stored-max-results",
            end() {},
          };
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        body: expect.stringContaining('"max_results":4'),
      }),
    );
  });

  it("queries searxng when forced and baseUrl is available", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "http://localhost:8080",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "SearXNG Result",
            url: "https://example.com/searxng",
            content: "Snippet from SearXNG",
          },
        ],
      }),
    } as Response);

    const result = await webSearchTool.execute({
      invocationId: "2",
      args: {
        query: "example",
        provider: "searxng",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-2",
            end() {},
          };
        },
      },
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "http://localhost:8080/search?",
    );
    expect(result.structuredContent).toEqual({
      query: "example",
      provider: "searxng",
      capabilityId: "searxng-search",
      results: [
        {
          title: "SearXNG Result",
          link: "https://example.com/searxng",
          snippet: "Snippet from SearXNG",
        },
      ],
    });
  });

  it("uses searxng when tavily is unavailable but searxng is configured", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "http://localhost:8080",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as Response);

    const result = await webSearchTool.execute({
      invocationId: "3",
      args: {
        query: "fallback search",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-3",
            end() {},
          };
        },
      },
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "http://localhost:8080/search?",
    );
    expect(result.structuredContent).toMatchObject({
      provider: "searxng",
      query: "fallback search",
    });
  });

  it("fails with actionable searxng engine details when no results are returned and upstream engines are unavailable", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "http://localhost:8080",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        unresponsive_engines: [
          ["duckduckgo", "CAPTCHA"],
          ["google", "Suspended: CAPTCHA"],
        ],
      }),
    } as Response);

    await expect(
      webSearchTool.execute({
        invocationId: "3c",
        args: {
          query: "latest news",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-3c",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow(
      /SearXNG returned no results because upstream engines were unavailable.*duckduckgo: CAPTCHA.*google: Suspended: CAPTCHA/s,
    );
  });

  it("falls back to searxng when tavily search fails", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "http://localhost:8080",
      maxResults: 4,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: "Fallback Result",
              url: "https://example.com/fallback",
              content: "Snippet from fallback",
            },
          ],
        }),
      } as Response);

    const result = await webSearchTool.execute({
      invocationId: "3b",
      args: {
        query: "fallback search",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-3b",
            end() {},
          };
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.tavily.com/search");
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain(
      "http://localhost:8080/search?",
    );
    expect(result.structuredContent).toMatchObject({
      provider: "searxng",
      query: "fallback search",
    });
  });

  it("surfaces both provider failures when tavily fails and searxng has no responsive engines", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "http://localhost:8080",
      maxResults: 4,
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          unresponsive_engines: [["duckduckgo", "CAPTCHA"]],
        }),
      } as Response);

    try {
      await webSearchTool.execute({
        invocationId: "3d",
        args: {
          query: "latest news",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-3d",
              end() {},
            };
          },
        },
      });
      throw new Error("expected web search to fail");
    } catch (error) {
      expect(error).toMatchObject({
        errors: [
          {
            provider: "tavily",
            capabilityId: "tavily-search",
            category: "http_error",
            message: "Tavily search failed: 502",
            statusCode: 502,
          },
          {
            provider: "searxng",
            capabilityId: "searxng-search",
            category: "upstream_unavailable",
            message:
              "SearXNG returned no results because upstream engines were unavailable. duckduckgo: CAPTCHA",
          },
        ],
      });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Web search failed for all configured providers. tavily: Tavily search failed: 502; searxng: SearXNG returned no results because upstream engines were unavailable. duckduckgo: CAPTCHA",
      );
    }
  });

  it("fails when no provider configuration is available", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "",
    });
    await expect(
      webSearchTool.execute({
        invocationId: "4",
        args: {
          query: "needs config",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-4",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow(
      "No web search provider is available. Configure Tavily apiKey or SearXNG baseUrl.",
    );
  });

  it("ignores apiKey passed through tool args and uses stored settings instead", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as Response);

    await webSearchTool.execute({
      invocationId: "5",
      args: {
        query: "stored config wins",
        apiKey: "tool-key",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-5",
            end() {},
          };
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        body: expect.stringContaining('"api_key":"stored-key"'),
      }),
    );
  });

  it("ignores baseUrl passed through tool args and uses stored settings instead", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "http://stored-searxng:8080",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as Response);

    await webSearchTool.execute({
      invocationId: "5b",
      args: {
        query: "stored searxng config wins",
        baseUrl: "http://tool-arg-searxng:9999",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-5b",
            end() {},
          };
        },
      },
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "http://stored-searxng:8080/search?",
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain(
      "http://tool-arg-searxng:9999/search?",
    );
  });

  it("prefers trusted runtime tool config over stored settings", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as Response);

    await webSearchTool.execute({
      invocationId: "6",
      args: {
        query: "runtime override wins",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        toolConfig: {
          web_search: {
            apiKey: "runtime-key",
          },
        },
      }),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-6",
            end() {},
          };
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        body: expect.stringContaining('"api_key":"runtime-key"'),
      }),
    );
  });

  it("prefers trusted runtime baseUrl over stored settings", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "",
      searxngBaseUrl: "http://stored-searxng:8080",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as Response);

    await webSearchTool.execute({
      invocationId: "6b",
      args: {
        query: "runtime baseUrl override wins",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        toolConfig: {
          web_search: {
            baseUrl: "http://runtime-searxng:8080",
          },
        },
      }),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-6b",
            end() {},
          };
        },
      },
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "http://runtime-searxng:8080/search?",
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain(
      "http://stored-searxng:8080/search?",
    );
  });

  it("emits scrubbed search-results artifacts without provider secrets or raw config", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "http://stored-searxng:8080",
      maxResults: 4,
    });
    const artifacts: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as Response);

    await webSearchTool.execute({
      invocationId: "artifact-scrub",
      args: {
        query: "scrub artifact",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        toolConfig: {
          web_search: {
            apiKey: "runtime-key",
            baseUrl: "http://runtime-searxng:8080",
          },
        },
      }),
      pushEvent() {},
      addArtifact(artifact) {
        artifacts.push(artifact);
        return { id: "artifact-1", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-artifact-scrub",
            end() {},
          };
        },
      },
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.kind).toBe("search-results");
    expect(artifacts[0]?.metadata).toEqual({
      query: "scrub artifact",
      provider: "tavily",
      capabilityId: "tavily-search",
      resultCount: 0,
    });
    expect(JSON.stringify(artifacts[0])).not.toContain("runtime-key");
    expect(JSON.stringify(artifacts[0])).not.toContain("stored-key");
    expect(JSON.stringify(artifacts[0])).not.toContain("baseUrl");
    expect(JSON.stringify(artifacts[0])).not.toContain("SEARXNG_BASE_URL");
    expect(JSON.stringify(artifacts[0])).not.toContain("TAVILY_API_KEY");
    expect(JSON.stringify(artifacts[0])).not.toContain("headers");
  });

});
