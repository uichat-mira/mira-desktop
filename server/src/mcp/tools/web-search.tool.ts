import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { webSearchSettingsRepository } from "@/db/repositories/web-search-settings.repository.js";
import {
  DEFAULT_MAX_RESULTS,
  MAX_MAX_RESULTS,
  MAX_QUERIES,
  MIN_MAX_RESULTS,
  MIN_QUERIES,
  executeWebSearch,
} from "../web/search.js";

const normalizeQueries = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw mcpBadRequest("queries must be an array of 1-4 non-empty strings");
  }
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw mcpBadRequest("queries must contain only strings");
    }
    const query = entry.trim();
    if (query && !normalized.includes(query)) {
      normalized.push(query);
    }
  }
  if (normalized.length < MIN_QUERIES || normalized.length > MAX_QUERIES) {
    throw mcpBadRequest(
      `queries must contain between ${MIN_QUERIES} and ${MAX_QUERIES} non-empty unique strings`,
    );
  }
  return normalized;
};

const resolveDefaultMaxResults = (args: Record<string, unknown>) =>
  args.maxResults === undefined
    ? webSearchSettingsRepository.get().maxResults
    : args.maxResults;

const normalizeMaxResults = (value: unknown) => {
  if (value === undefined) {
    return DEFAULT_MAX_RESULTS;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw mcpBadRequest("maxResults must be a finite number");
  }
  return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.trunc(value)));
};

export const webSearchTool: ToolImplementation = {
  definition: {
    id: "web_search",
    title: "Web Search",
    description:
      "Search the current public web when relevant sources or URLs are not yet known. Provide 1-4 distinct queries; they run concurrently and their results are merged with duplicate links removed. Use web_fetch when a concrete URL is already known, news_search for the local News Hub cache, and Browser for interactive or login-required pages.",
    domain: "web_search",
    source: "internal",
    mode: "sync",
    inputSchema: {
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
    },
    tags: ["search", "web", "public", "current", "realtime"],
    outputSchema: {
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
    },
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
  },
  execute: async (context) => {
    const queries = normalizeQueries(context.args.queries);
    const maxResults = normalizeMaxResults(resolveDefaultMaxResults(context.args));
    const execution = await executeWebSearch({
      queries,
      maxResults,
      environment: context.environment,
      signal: context.signal,
      pushEvent: context.pushEvent,
      trace: context.trace,
    });

    context.addArtifact({
      kind: "search-results",
      title: `Search results for ${execution.queries.join(", ")}`,
      data: execution.results,
      metadata: {
        queries: execution.queries,
        provider: execution.provider,
        capabilityId: execution.capabilityId,
        resultCount: execution.results.length,
      },
    });

    return {
      content: [
        {
          type: "json",
          json: {
            results: execution.results,
          },
        },
      ],
      structuredContent: {
        queries: execution.queries,
        results: execution.results,
      },
    };
  },
};
