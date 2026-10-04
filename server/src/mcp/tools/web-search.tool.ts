import type {
  ToolExecutionEnvironment,
  ToolInvocationContext,
  ToolImplementation,
} from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { webSearchSettingsRepository } from "@/db/repositories/web-search-settings.repository.js";
import { createRouteError } from "@/utils/route-errors.js";
import { ErrorCodes } from "@/utils/response.js";

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

type WebSearchProvider = "tavily" | "searxng";

type NormalizedWebSearchResult = {
  query: string;
  provider: WebSearchProvider;
  capabilityId: string;
  results: SearchResult[];
};

type WebSearchProviderErrorCategory =
  | "http_error"
  | "upstream_unavailable"
  | "network_error"
  | "configuration_error"
  | "unknown_error";

type WebSearchProviderError = {
  provider: WebSearchProvider;
  capabilityId: string;
  category: WebSearchProviderErrorCategory;
  message: string;
  statusCode?: number;
};

type TavilyResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

type SearxngResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
  unresponsive_engines?: Array<[string, string]>;
};

type WebSearchExecutionContext = Pick<
  ToolInvocationContext,
  "args" | "environment" | "pushEvent" | "trace"
>;

type WebSearchProviderPlan = {
  provider: WebSearchProvider;
  capabilityId: string;
  priority: number;
};

type WebSearchExecutionPlan = WebSearchProviderPlan & {
  reason?: string;
};

class WebSearchProviderExecutionError extends Error {
  readonly detail: WebSearchProviderError;

  constructor(detail: WebSearchProviderError) {
    super(detail.message);
    this.name = "WebSearchProviderExecutionError";
    this.detail = detail;
  }
}

const SEARCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 4;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 10;

const toWebSearchProviderError = (input: {
  provider: WebSearchProvider;
  capabilityId: string;
  category: WebSearchProviderErrorCategory;
  message: string;
  statusCode?: number;
}) => ({
  provider: input.provider,
  capabilityId: input.capabilityId,
  category: input.category,
  message: input.message,
  ...(typeof input.statusCode === "number" ? { statusCode: input.statusCode } : {}),
});

const withTimeoutSignal = () => AbortSignal.timeout(SEARCH_TIMEOUT_MS);

const assertWebSearchEnvironment = (environment?: ToolExecutionEnvironment) => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Web search requires a harness environment snapshot");
  }

  return environment;
};

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

const resolveStoredWebSearchSettings = () => webSearchSettingsRepository.get();

const resolveTrustedToolConfig = (environment?: ToolExecutionEnvironment) =>
  assertWebSearchEnvironment(environment).toolConfig?.web_search;

const resolveTavilyApiKey = (environment?: ToolExecutionEnvironment) =>
  (
    resolveTrustedToolConfig(environment)?.apiKey ||
    resolveStoredWebSearchSettings().tavilyApiKey ||
    (process.env.TAVILY_API_KEY ?? "")
  ).trim();

const resolveSearxngBaseUrl = (environment?: ToolExecutionEnvironment) =>
  (
    resolveTrustedToolConfig(environment)?.baseUrl ||
    resolveStoredWebSearchSettings().searxngBaseUrl ||
    (process.env.SEARXNG_BASE_URL ?? "")
  )
    .trim()
    .replace(/\/+$/, "");

const resolveDefaultMaxResults = (args: Record<string, unknown>) =>
  args.maxResults === undefined
    ? resolveStoredWebSearchSettings().maxResults
    : args.maxResults;

const sortProviderPlans = (
  environment: ToolExecutionEnvironment,
  context: WebSearchExecutionContext,
): WebSearchProviderPlan[] => {
  const tavilyApiKey = resolveTavilyApiKey(context.environment);
  const searxngBaseUrl = resolveSearxngBaseUrl(context.environment);

  return [...environment.web_search.capabilities]
    .filter((capability) => capability.available)
    .map((capability) => {
      const provider = capability.provider === "searxng" ? "searxng" : "tavily";
      return {
        provider,
        capabilityId: capability.id,
        priority: capability.priority,
      } satisfies WebSearchProviderPlan;
    })
    .filter((plan) =>
      plan.provider === "tavily" ? Boolean(tavilyApiKey) : Boolean(searxngBaseUrl),
    )
    .sort(
      (left, right) =>
        right.priority - left.priority || left.provider.localeCompare(right.provider),
    );
};

const fetchTavilySearch = async (
  query: string,
  maxResults: number,
  apiKey: string,
  capabilityId: string,
): Promise<SearchResult[]> => {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: withTimeoutSignal(),
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    throw new WebSearchProviderExecutionError(
      toWebSearchProviderError({
        provider: "tavily",
        capabilityId,
        category: "http_error",
        message: `Tavily search failed: ${response.status}`,
        statusCode: response.status,
      }),
    );
  }

  const data = (await response.json()) as TavilyResponse;
  return (data.results ?? []).map((item) => ({
    title: item.title ?? "",
    link: item.url ?? "",
    snippet: item.content ?? "",
  }));
};

const buildSearxngSearchUrl = (input: { baseUrl: string; query: string }) => {
  const searchParams = new URLSearchParams({
    q: input.query,
    format: "json",
    language: "all",
    safesearch: "0",
    pageno: "1",
  });
  return `${input.baseUrl}/search?${searchParams.toString()}`;
};

const fetchSearxngSearch = async (
  query: string,
  maxResults: number,
  baseUrl: string,
  capabilityId: string,
): Promise<SearchResult[]> => {
  const response = await fetch(buildSearxngSearchUrl({ baseUrl, query }), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: withTimeoutSignal(),
  });

  if (!response.ok) {
    throw new WebSearchProviderExecutionError(
      toWebSearchProviderError({
        provider: "searxng",
        capabilityId,
        category: "http_error",
        message: `SearXNG search failed: ${response.status}`,
        statusCode: response.status,
      }),
    );
  }

  const data = (await response.json()) as SearxngResponse;
  const results = (data.results ?? []).slice(0, maxResults).map((item) => ({
    title: item.title ?? "",
    link: item.url ?? "",
    snippet: item.content ?? "",
  }));

  if (results.length === 0 && (data.unresponsive_engines?.length ?? 0) > 0) {
    const engineSummary = data.unresponsive_engines
      ?.map(([engine, reason]) => `${engine}: ${reason}`)
      .join("; ");
    throw new WebSearchProviderExecutionError(
      toWebSearchProviderError({
        provider: "searxng",
        capabilityId,
        category: "upstream_unavailable",
        message: `SearXNG returned no results because upstream engines were unavailable. ${engineSummary}`,
      }),
    );
  }

  return results;
};

const executeWebSearchPlan = async (input: {
  plan: WebSearchProviderPlan;
  query: string;
  maxResults: number;
  apiKey: string;
  baseUrl: string;
}) => {
  if (input.plan.provider === "tavily") {
    return fetchTavilySearch(
      input.query,
      input.maxResults,
      input.apiKey,
      input.plan.capabilityId,
    );
  }

  return fetchSearxngSearch(
    input.query,
    input.maxResults,
    input.baseUrl,
    input.plan.capabilityId,
  );
};

export const webSearchTool: ToolImplementation = {
  definition: {
    id: "web_search",
    title: "Web Search",
    description:
      "Search the current public web through a harness-selected provider such as Tavily or SearXNG. This tool does not search the local News Hub cache; use news_search for collected local news sources.",
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
    tags: ["search", "web", "public", "current", "realtime"],
    outputSchema: {
      type: "object",
      required: ["query", "provider", "capabilityId", "results"],
      properties: {
        query: { type: "string" },
        provider: { type: "string", enum: ["tavily", "searxng"] },
        capabilityId: { type: "string" },
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
    const query = normalizeQuery(context.args.query);
    const maxResults = normalizeMaxResults(resolveDefaultMaxResults(context.args));
    const resolvedApiKey = resolveTavilyApiKey(context.environment);
    const resolvedBaseUrl = resolveSearxngBaseUrl(context.environment);
    const harnessEnvironment = assertWebSearchEnvironment(context.environment);
    const plans = sortProviderPlans(harnessEnvironment, context);
    const executionAttempts: WebSearchExecutionPlan[] = [];

    let results: SearchResult[] | null = null;
    let selectedProvider: WebSearchProvider | null = null;
    let selectedCapabilityId = "";
    const providerErrors: WebSearchProviderError[] = [];

    const planningSpan = context.trace.startSpan({
      name: "Resolve web search provider plan",
      kind: "strategy_selection",
    });
    const planSummary = plans[0];
    if (!planSummary) {
      planningSpan.end({ status: "failed" });
      throw mcpInternalError(
        "No web search provider is available. Configure Tavily apiKey or SearXNG baseUrl.",
      );
    }

    context.pushEvent({
      type: "invocation:progress",
      message: `Web search plan: ${planSummary.capabilityId}`,
    });
    planningSpan.end({
      metadata: {
        provider: planSummary.provider,
        capabilityId: planSummary.capabilityId,
      },
    });

    for (const plan of plans) {
      context.pushEvent({
        type: "invocation:progress",
        message: `Searching web with ${plan.provider}`,
      });
      const executionSpan = context.trace.startSpan({
        name: `Execute ${plan.provider} search`,
        kind: "command_execution",
        metadata: { provider: plan.provider },
      });

      try {
        const nextResults = await executeWebSearchPlan({
          plan,
          query,
          maxResults,
          apiKey: resolvedApiKey,
          baseUrl: resolvedBaseUrl,
        });
        executionSpan.end({
          metadata: { provider: plan.provider, resultCount: nextResults.length },
        });
        results = nextResults;
        selectedProvider = plan.provider;
        selectedCapabilityId = plan.capabilityId;
        break;
      } catch (error) {
        const detail =
          error instanceof WebSearchProviderExecutionError
            ? error.detail
            : toWebSearchProviderError({
                provider: plan.provider,
                capabilityId: plan.capabilityId,
                category: "unknown_error",
                message: error instanceof Error ? error.message : String(error),
              });
        executionSpan.end({
          status: "failed",
          metadata: { provider: plan.provider, error: detail.message },
        });
        providerErrors.push(detail);
        executionAttempts.push({ ...plan, reason: detail.message });
      }
    }

    if (!results || !selectedProvider) {
      const attemptSummary = executionAttempts
        .map((attempt) => `${attempt.provider}: ${attempt.reason ?? "failed"}`)
        .join("; ");
      throw createRouteError({
        statusCode: 500,
        code: ErrorCodes.INTERNAL_ERROR,
        message: attemptSummary
          ? `Web search failed for all configured providers. ${attemptSummary}`
          : "No web search provider is available. Configure Tavily apiKey or SearXNG baseUrl.",
        errors: providerErrors,
      });
    }

    const normalizedResult: NormalizedWebSearchResult = {
      query,
      provider: selectedProvider,
      capabilityId: selectedCapabilityId,
      results,
    };

    context.addArtifact({
      kind: "search-results",
      title: `Search results for ${query}`,
      data: results,
      metadata: {
        query,
        provider: selectedProvider,
        capabilityId: selectedCapabilityId,
        resultCount: results.length,
      },
    });

    return { structuredContent: normalizedResult };
  },
};
