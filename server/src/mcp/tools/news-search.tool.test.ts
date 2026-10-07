import { afterEach, describe, expect, it, vi } from "vitest";
import { newsSearchTool } from "./news-search.tool.js";

const newsSearchMock = vi.hoisted(() => ({
  searchNewsHubCache: vi.fn(),
}));

vi.mock("@/microapps/news-hub/news-search.adapter.js", () => newsSearchMock);

describe("news search tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    newsSearchMock.searchNewsHubCache.mockReset();
  });

  it("declares a local read-only News Hub search contract", () => {
    expect(newsSearchTool.definition).toMatchObject({
      id: "news_search",
      domain: "web_search",
      capabilities: {
        sideEffect: "none",
        requiresApproval: false,
      },
    });
    expect(newsSearchTool.definition.capabilities.networkAccess).toBeUndefined();
  });

  it("searches only the local News Hub cache and returns retrieval diagnostics", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    newsSearchMock.searchNewsHubCache.mockResolvedValue({
      results: [
        {
          title: "Local cached headline",
          link: "https://example.com/news",
          snippet: "cached summary",
          metadata: {
            provider: "local_news_hub",
            sourceKey: "hn-frontpage",
            sourceName: "Hacker News Front Page",
            publishedAt: "2026-07-21T00:00:00.000Z",
            tags: ["news"],
          },
        },
      ],
      diagnostics: {
        keyword: 3,
        vector: 2,
        fused: 2,
        reranked: 1,
        embedding: "used",
        rerank: "used",
      },
    });

    const result = await newsSearchTool.execute({
      invocationId: "news-1",
      args: { query: "AI 新闻", maxResults: 5 },
      signal: new AbortController().signal,
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-news-1",
            end() {},
          };
        },
      },
    });

    expect(newsSearchMock.searchNewsHubCache).toHaveBeenCalledWith({
      query: "AI 新闻",
      maxResults: 5,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      query: "AI 新闻",
      provider: "local_news_hub",
      capabilityId: "local-news-hub",
      diagnostics: {
        keyword: 3,
        reranked: 1,
      },
    });
  });

  it("rejects an empty query", async () => {
    await expect(
      newsSearchTool.execute({
        invocationId: "news-2",
        args: { query: "" },
        signal: new AbortController().signal,
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "artifact-2", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-news-2",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow("query is required");
  });
});
