import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import type { ToolInvocationContext } from "../core/definitions.js";
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

const createContext = (overrides?: Partial<ToolInvocationContext>): ToolInvocationContext => ({
  invocationId: "test-invocation",
  args: {},
  signal: new AbortController().signal,
  environment: createHarnessEnvironmentSnapshot(),
  pushEvent() {},
  addArtifact(artifact) {
    return { id: "artifact-test", ...artifact };
  },
  trace: {
    startSpan() {
      return {
        spanId: "span-test",
        end() {},
      };
    },
  },
  ...overrides,
});

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
      required: ["queries"],
      properties: {
        queries: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 4,
          description: "1-4 distinct search queries executed concurrently and merged.",
        },
        maxResults: {
          type: "number",
          description:
            "Maximum number of merged results returned across all queries (1-10).",
        },
      },
      additionalProperties: false,
    });
  });

  it("keeps provider details out of the Agent-facing contract", () => {
    expect(webSearchTool.definition.description).not.toMatch(/Tavily|SearXNG/i);
    expect(webSearchTool.definition.outputSchema).toEqual({
      type: "object",
      required: ["queries", "results"],
      properties: {
        queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
        results: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "link", "snippet"],
            properties: {
              title: { type: "string" },
              link: { type: "string" },
              snippet: { type: "string" },
            },
          },
        },
      },
    });
  });

  it("validates queries args before contacting providers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      webSearchTool.execute(createContext({ args: { queries: "example" } })),
    ).rejects.toThrow("queries must be an array of 1-4 non-empty strings");

    await expect(
      webSearchTool.execute(createContext({ args: { queries: [] } })),
    ).rejects.toThrow("queries must contain between 1 and 4 non-empty unique strings");

    await expect(
      webSearchTool.execute(createContext({ args: { queries: [42] } })),
    ).rejects.toThrow("queries must contain only strings");

    await expect(
      webSearchTool.execute(createContext({ args: { queries: ["a", "b", "c", "d", "e"] } })),
    ).rejects.toThrow("queries must contain between 1 and 4 non-empty unique strings");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("trims and dedupes query strings before execution", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);

    const result = await webSearchTool.execute(
      createContext({ args: { queries: ["  alpha  ", "", "alpha", "beta"] } }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.structuredContent).toMatchObject({
      queries: ["alpha", "beta"],
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

    const result = await webSearchTool.execute(
      createContext({
        args: {
          queries: ["example"],
        },
        environment: createHarnessEnvironmentSnapshot({
          toolConfig: {
            web_search: {
              apiKey: "runtime-key",
            },
          },
        }),
      }),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://api.tavily.com/search");
    expect(result.structuredContent).toEqual({
      queries: ["example"],
      results: [
        {
          title: "Tavily Result",
          link: "https://example.com/tavily",
          snippet: "Snippet from Tavily",
        },
      ],
    });
    expect(result.content).toEqual([
      {
        type: "json",
        json: {
          results: [
            {
              title: "Tavily Result",
              link: "https://example.com/tavily",
              snippet: "Snippet from Tavily",
            },
          ],
        },
      },
    ]);
    expect(JSON.stringify(result.content)).not.toMatch(/tavily-search|provider/i);
  });

  it("fans out multiple queries concurrently and merges their results", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = String(init?.body ?? "");
      const query = body.includes('"query":"first query"') ? "first query" : "second query";
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              title: `Result for ${query}`,
              url: `https://example.com/${encodeURIComponent(query)}`,
              content: `Snippet for ${query}`,
            },
          ],
        }),
      } as Response;
    });

    const result = await webSearchTool.execute(
      createContext({ args: { queries: ["first query", "second query"] } }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.structuredContent).toEqual({
      queries: ["first query", "second query"],
      results: [
        {
          title: "Result for first query",
          link: "https://example.com/first%20query",
          snippet: "Snippet for first query",
        },
        {
          title: "Result for second query",
          link: "https://example.com/second%20query",
          snippet: "Snippet for second query",
        },
      ],
    });
  });

  it("dedupes merged results by normalized URL", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = String(init?.body ?? "");
      return {
        ok: true,
        json: async () => ({
          results:
            body.includes('"query":"alpha"')
              ? [
                  { title: "Alpha One", url: "https://Example.com/a/", content: "one" },
                  { title: "Alpha Two", url: "https://example.com/b", content: "two" },
                ]
              : [
                  { title: "Beta Duplicate", url: "https://example.com/a#section", content: "dup" },
                  { title: "Beta Unique", url: "https://example.com/c", content: "three" },
                ],
        }),
      } as Response;
    });

    const result = await webSearchTool.execute(
      createContext({ args: { queries: ["alpha", "beta"] } }),
    );

    expect(result.structuredContent.results).toEqual([
      { title: "Alpha One", link: "https://Example.com/a/", snippet: "one" },
      { title: "Alpha Two", link: "https://example.com/b", snippet: "two" },
      { title: "Beta Unique", link: "https://example.com/c", snippet: "three" },
    ]);
  });

  it("caps final merged results at maxResults", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "",
      maxResults: 4,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "One", url: "https://example.com/1", content: "one" },
          { title: "Two", url: "https://example.com/2", content: "two" },
        ],
      }),
    } as Response);

    const result = await webSearchTool.execute(
      createContext({ args: { queries: ["alpha", "beta"], maxResults: 1 } }),
    );

    expect(result.structuredContent.results).toHaveLength(1);
  });

  it("falls back the whole query batch when one query fails on the current provider", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "http://localhost:8080",
      maxResults: 4,
    });
    const artifacts: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) === "https://api.tavily.com/search") {
        const body = String(init?.body ?? "");
        if (body.includes('"query":"alpha"')) {
          return {
            ok: true,
            json: async () => ({
              results: [{ title: "Alpha Tavily", url: "https://example.com/tavily-a", content: "one" }],
            }),
          } as Response;
        }
        return { ok: false, status: 502 } as Response;
      }

      const query = new URL(String(url)).searchParams.get("q") ?? "";
      return {
        ok: true,
        json: async () => ({
          results: [{
            title: `SearXNG ${query}`,
            url: `https://example.com/searxng-${query}`,
            content: `fallback ${query}`,
          }],
        }),
      } as Response;
    });

    const result = await webSearchTool.execute(
      createContext({
        args: { queries: ["alpha", "beta"] },
        addArtifact(artifact) {
          artifacts.push(artifact as Record<string, unknown>);
          return { id: "a", ...artifact };
        },
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(result.structuredContent).toEqual({
      queries: ["alpha", "beta"],
      results: [
        {
          title: "SearXNG alpha",
          link: "https://example.com/searxng-alpha",
          snippet: "fallback alpha",
        },
        {
          title: "SearXNG beta",
          link: "https://example.com/searxng-beta",
          snippet: "fallback beta",
        },
      ],
    });
    expect(artifacts[0]?.metadata).toMatchObject({
      queries: ["alpha", "beta"],
      provider: "searxng",
      capabilityId: "searxng-search",
    });
  });

  it("falls back to the next provider when every query fails on the current provider", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "http://localhost:8080",
      maxResults: 4,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "https://api.tavily.com/search") {
        return { ok: false, status: 502 } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          results: [{ title: "SearXNG", url: "https://example.com/s", content: "snippet" }],
        }),
      } as Response;
    });

    const result = await webSearchTool.execute(
      createContext({ args: { queries: ["alpha", "beta"] } }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(result.structuredContent).toEqual({
      queries: ["alpha", "beta"],
      results: [
        {
          title: "SearXNG",
          link: "https://example.com/s",
          snippet: "snippet",
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

    await webSearchTool.execute(
      createContext({
        args: {
          queries: ["example"],
        },
        environment: createHarnessEnvironmentSnapshot({
          toolConfig: {
            web_search: {
              apiKey: "runtime-key",
            },
          },
        }),
      }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        body: expect.stringContaining('"max_results":4'),
      }),
    );
  });

  it("queries searxng when tavily is not configured and baseUrl is available", async () => {
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

    const result = await webSearchTool.execute(
      createContext({ args: { queries: ["example"] } }),
    );

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "http://localhost:8080/search?",
    );
    expect(result.structuredContent).toEqual({
      queries: ["example"],
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

    const result = await webSearchTool.execute(
      createContext({ args: { queries: ["fallback search"] } }),
    );

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "http://localhost:8080/search?",
    );
    expect(result.structuredContent).toMatchObject({
      queries: ["fallback search"],
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
      webSearchTool.execute(createContext({ args: { queries: ["latest news"] } })),
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

    const artifacts: Array<Record<string, unknown>> = [];
    const result = await webSearchTool.execute(
      createContext({
        args: { queries: ["fallback search"] },
        addArtifact(artifact) {
          artifacts.push(artifact as Record<string, unknown>);
          return { id: "artifact-fallback", ...artifact };
        },
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.tavily.com/search");
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain(
      "http://localhost:8080/search?",
    );
    expect(result.structuredContent).toMatchObject({
      queries: ["fallback search"],
    });
    expect(result.structuredContent).not.toHaveProperty("provider");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.metadata).toMatchObject({
      provider: "searxng",
      capabilityId: "searxng-search",
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
      await webSearchTool.execute(
        createContext({ args: { queries: ["latest news"] } }),
      );
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
      webSearchTool.execute(createContext({ args: { queries: ["needs config"] } })),
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

    await webSearchTool.execute(
      createContext({
        args: {
          queries: ["stored config wins"],
          apiKey: "tool-key",
        },
      }),
    );

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

    await webSearchTool.execute(
      createContext({
        args: {
          queries: ["stored searxng config wins"],
          baseUrl: "http://tool-arg-searxng:9999",
        },
      }),
    );

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

    await webSearchTool.execute(
      createContext({
        args: {
          queries: ["runtime override wins"],
        },
        environment: createHarnessEnvironmentSnapshot({
          toolConfig: {
            web_search: {
              apiKey: "runtime-key",
            },
          },
        }),
      }),
    );

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

    await webSearchTool.execute(
      createContext({
        args: {
          queries: ["runtime baseUrl override wins"],
        },
        environment: createHarnessEnvironmentSnapshot({
          toolConfig: {
            web_search: {
              baseUrl: "http://runtime-searxng:8080",
            },
          },
        }),
      }),
    );

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

    await webSearchTool.execute(
      createContext({
        args: {
          queries: ["scrub artifact"],
        },
        environment: createHarnessEnvironmentSnapshot({
          toolConfig: {
            web_search: {
              apiKey: "runtime-key",
              baseUrl: "http://runtime-searxng:8080",
            },
          },
        }),
        addArtifact(artifact) {
          artifacts.push(artifact as Record<string, unknown>);
          return { id: "artifact-1", ...artifact };
        },
      }),
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.kind).toBe("search-results");
    expect(artifacts[0]?.metadata).toEqual({
      queries: ["scrub artifact"],
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

  it("rejects without calling providers when the signal is already aborted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort();

    await expect(
      webSearchTool.execute(
        createContext({
          args: { queries: ["alpha"] },
          signal: controller.signal,
          environment: createHarnessEnvironmentSnapshot({
            toolConfig: { web_search: { apiKey: "runtime-key" } },
          }),
        }),
      ),
    ).rejects.toThrow("Web search cancelled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fall back to the next provider when the invocation signal aborts mid-flight", async () => {
    webSearchSettingsMock.get.mockReturnValue({
      tavilyApiKey: "stored-key",
      searxngBaseUrl: "http://localhost:8080",
      maxResults: 4,
    });
    const controller = new AbortController();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("This operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );

    const execution = webSearchTool.execute(
      createContext({
        args: { queries: ["alpha"] },
        signal: controller.signal,
      }),
    );
    controller.abort();

    await expect(execution).rejects.toThrow("Web search cancelled");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
