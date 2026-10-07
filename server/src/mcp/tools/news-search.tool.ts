import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { searchNewsHubCache } from "@/microapps/news-hub/news-search.adapter.js";

const DEFAULT_MAX_RESULTS = 4;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 10;

const normalizeQuery = (value: unknown) => {
  const query = typeof value === "string" ? value.trim() : "";
  if (!query) {
    throw mcpBadRequest("query is required");
  }
  return query;
};

const normalizeMaxResults = (value: unknown) => {
  if (value === undefined) {
    return DEFAULT_MAX_RESULTS;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw mcpBadRequest("maxResults must be a finite number");
  }
  return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.trunc(value)));
};

export const newsSearchTool: ToolImplementation = {
  definition: {
    id: "news_search",
    title: "News Search",
    description:
      "Search the locally collected News Hub cache from configured news feeds and sources using keyword, vector, fusion, and reranking. This tool does not search the live public web; use web_search for current public-web coverage.",
    domain: "web_search",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      additionalProperties: false,
    },
    tags: [
      "news",
      "local-news",
      "news-hub",
      "cache",
      "feed",
      "rss",
      "headline",
      "资讯",
      "新闻",
      "订阅源",
    ],
    outputSchema: {
      type: "object",
      required: ["query", "provider", "capabilityId", "results", "diagnostics"],
      properties: {
        query: { type: "string" },
        provider: { type: "string", enum: ["local_news_hub"] },
        capabilityId: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "link", "snippet", "metadata"],
            properties: {
              title: { type: "string" },
              link: { type: "string" },
              snippet: { type: "string" },
              metadata: { type: "object" },
            },
          },
        },
        diagnostics: { type: "object" },
      },
    },
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
    },
  },
  execute: async (context) => {
    const query = normalizeQuery(context.args.query);
    const maxResults = normalizeMaxResults(context.args.maxResults);
    const searchSpan = context.trace.startSpan({
      name: "Search local News Hub cache",
      kind: "result_normalization",
    });

    const news = await searchNewsHubCache({ query, maxResults });
    searchSpan.end({
      metadata: {
        keywordCandidates: news.diagnostics.keyword,
        vectorCandidates: news.diagnostics.vector,
        fusedCandidates: news.diagnostics.fused,
        rerankedCandidates: news.diagnostics.reranked,
        embedding: news.diagnostics.embedding,
        rerank: news.diagnostics.rerank,
      },
    });

    context.pushEvent({
      type: "invocation:progress",
      message: `Read ${news.results.length} local News Hub result(s)`,
    });
    context.addArtifact({
      kind: "search-results",
      title: `Local news results for ${query}`,
      data: news.results,
      metadata: {
        query,
        provider: "local_news_hub",
        capabilityId: "local-news-hub",
        resultCount: news.results.length,
        retrieval: news.diagnostics,
      },
    });

    return {
      structuredContent: {
        query,
        provider: "local_news_hub" as const,
        capabilityId: "local-news-hub",
        results: news.results,
        diagnostics: news.diagnostics,
      },
    };
  },
};
