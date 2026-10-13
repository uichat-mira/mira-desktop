import type {
  ToolExecutionEnvironment,
  ToolInvocationContext,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpInternalError } from "../core/errors.js";
import { webSearchSettingsRepository } from "@/db/repositories/web-search-settings.repository.js";
import { createRouteError } from "@/utils/route-errors.js";
import { ErrorCodes } from "@/utils/response.js";

export const SEARCH_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESULTS = 4;
export const MIN_MAX_RESULTS = 1;
export const MAX_MAX_RESULTS = 10;
export const MIN_QUERIES = 1;
export const MAX_QUERIES = 4;

export type WebSearchProvider = "tavily" | "searxng";

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export type WebSearchProviderErrorCategory =
  | "http_error"
  | "upstream_unavailable"
  | "network_error"
  | "configuration_error"
  | "unknown_error";

export type WebSearchProviderError = {
  provider: WebSearchProvider;
  capabilityId: string;
  category: WebSearchProviderErrorCategory;
  message: string;
  statusCode?: number;
};

export type WebSearchProviderPlan = {
  provider: WebSearchProvider;
  capabilityId: string;
  priority: number;
};

export type WebSearchExecutionResult = {
  queries: string[];
  provider: WebSearchProvider;
  capabilityId: string;
  results: SearchResult[];
};

export type WebSearchRuntimeInput = {
  queries: string[];
  maxResults: number;
  environment?: ToolExecutionEnvironment;
  signal: AbortSignal;
  pushEvent?: (event: ToolInvocationEventInput) => void;
  trace?: ToolInvocationContext["trace"];
};

type TavilyResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

type SearxngResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
  unresponsive_engines?: Array<[string, string]>;
};

class WebSearchProviderExecutionError extends Error {
  readonly detail: WebSearchProviderError;

  constructor(detail: WebSearchProviderError) {
    super(detail.message);
    this.name = "WebSearchProviderExecutionError";
    this.detail = detail;
  }
}

const toWebSearchProviderError = (input: {
  provider: WebSearchProvider;
  capabilityId: string;
  category: WebSearchProviderErrorCategory;
  message: string;
  statusCode?: number;
}): WebSearchProviderError => ({
  provider: input.provider,
  capabilityId: input.capabilityId,
  category: input.category,
  message: input.message,
  ...(typeof input.statusCode === "number" ? { statusCode: input.statusCode } : {}),
});

const composeFetchSignal = (signal: AbortSignal) =>
  AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]);

const assertWebSearchEnvironment = (
  environment?: ToolExecutionEnvironment,
): ToolExecutionEnvironment => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Web search requires a harness environment snapshot");
  }

  return environment;
};

const resolveTrustedToolConfig = (environment: ToolExecutionEnvironment) =>
  environment.toolConfig?.web_search;

const resolveTavilyApiKey = (environment: ToolExecutionEnvironment) =>
  (
    resolveTrustedToolConfig(environment)?.apiKey ||
    webSearchSettingsRepository.get().tavilyApiKey ||
    (process.env.TAVILY_API_KEY ?? "")
  ).trim();

const resolveSearxngBaseUrl = (environment: ToolExecutionEnvironment) =>
  (
    resolveTrustedToolConfig(environment)?.baseUrl ||
    webSearchSettingsRepository.get().searxngBaseUrl ||
    (process.env.SEARXNG_BASE_URL ?? "")
  )
    .trim()
    .replace(/\/+$/, "");

const isSupportedSearxngBaseUrl = (value: string) => {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const sortProviderPlans = (
  environment: ToolExecutionEnvironment,
  tavilyApiKey: string,
  searxngBaseUrl: string,
): WebSearchProviderPlan[] =>
  [...environment.web_search.capabilities]
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
      plan.provider === "tavily"
        ? Boolean(tavilyApiKey)
        : isSupportedSearxngBaseUrl(searxngBaseUrl),
    )
    .sort(
      (left, right) =>
        right.priority - left.priority || left.provider.localeCompare(right.provider),
    );

export const resolveWebSearchProviderAvailability = (
  environment: ToolExecutionEnvironment,
) => {
  const tavilyApiKey = resolveTavilyApiKey(environment);
  const searxngBaseUrl = resolveSearxngBaseUrl(environment);
  return sortProviderPlans(environment, tavilyApiKey, searxngBaseUrl).length > 0;
};

const fetchTavilySearch = async (
  query: string,
  maxResults: number,
  apiKey: string,
  capabilityId: string,
  signal: AbortSignal,
): Promise<SearchResult[]> => {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: composeFetchSignal(signal),
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
  signal: AbortSignal,
): Promise<SearchResult[]> => {
  const response = await fetch(buildSearxngSearchUrl({ baseUrl, query }), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: composeFetchSignal(signal),
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

const executeSingleQuery = async (input: {
  plan: WebSearchProviderPlan;
  query: string;
  maxResults: number;
  tavilyApiKey: string;
  searxngBaseUrl: string;
  signal: AbortSignal;
}): Promise<SearchResult[]> => {
  if (input.plan.provider === "tavily") {
    return fetchTavilySearch(
      input.query,
      input.maxResults,
      input.tavilyApiKey,
      input.plan.capabilityId,
      input.signal,
    );
  }

  return fetchSearxngSearch(
    input.query,
    input.maxResults,
    input.searxngBaseUrl,
    input.plan.capabilityId,
    input.signal,
  );
};

const normalizeProviderFailure = (input: {
  provider: WebSearchProvider;
  capabilityId: string;
  error: unknown;
}): WebSearchProviderError => {
  const { error } = input;
  if (error instanceof WebSearchProviderExecutionError) {
    return error.detail;
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return toWebSearchProviderError({
      provider: input.provider,
      capabilityId: input.capabilityId,
      category: "network_error",
      message:
        error.name === "TimeoutError"
          ? `${input.provider === "tavily" ? "Tavily" : "SearXNG"} search timed out after ${SEARCH_TIMEOUT_MS}ms`
          : error.message,
    });
  }
  return toWebSearchProviderError({
    provider: input.provider,
    capabilityId: input.capabilityId,
    category: "unknown_error",
    message: error instanceof Error ? error.message : String(error),
  });
};

const aggregateProviderFailure = (
  plan: WebSearchProviderPlan,
  failures: WebSearchProviderError[],
): WebSearchProviderError => {
  const first = failures[0];
  if (!first) {
    throw mcpInternalError("Web search provider failed without a provider error");
  }
  if (failures.length === 1) {
    return first;
  }
  const uniqueMessages = [...new Set(failures.map((failure) => failure.message))];
  return toWebSearchProviderError({
    provider: plan.provider,
    capabilityId: plan.capabilityId,
    category: first.category,
    message: uniqueMessages.join("; "),
    ...(first.statusCode !== undefined ? { statusCode: first.statusCode } : {}),
  });
};

const normalizeResultLinkKey = (link: string) => {
  const trimmed = link.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return trimmed.toLowerCase();
  }
};

const mergeQueryResults = (
  perQueryResults: SearchResult[][],
  maxTotalResults: number,
): SearchResult[] => {
  const seenLinks = new Set<string>();
  const merged: SearchResult[] = [];
  const maxRank = Math.max(0, ...perQueryResults.map((results) => results.length));

  for (let rank = 0; rank < maxRank; rank += 1) {
    for (const results of perQueryResults) {
      const item = results[rank];
      if (!item) {
        continue;
      }
      const linkKey = normalizeResultLinkKey(item.link);
      if (!linkKey || seenLinks.has(linkKey)) {
        continue;
      }
      seenLinks.add(linkKey);
      merged.push(item);
      if (merged.length >= maxTotalResults) {
        return merged;
      }
    }
  }
  return merged;
};

export const executeWebSearch = async (
  input: WebSearchRuntimeInput,
): Promise<WebSearchExecutionResult> => {
  if (input.signal.aborted) {
    throw new Error("Web search cancelled");
  }

  const harnessEnvironment = assertWebSearchEnvironment(input.environment);
  const tavilyApiKey = resolveTavilyApiKey(harnessEnvironment);
  const searxngBaseUrl = resolveSearxngBaseUrl(harnessEnvironment);
  const plans = sortProviderPlans(harnessEnvironment, tavilyApiKey, searxngBaseUrl);

  const planningSpan = input.trace?.startSpan({
    name: "Resolve web search provider plan",
    kind: "strategy_selection",
  });
  const preferredPlan = plans[0];
  if (!preferredPlan) {
    planningSpan?.end({ status: "failed" });
    throw mcpInternalError(
      "No web search provider is available. Configure Tavily apiKey or SearXNG baseUrl.",
    );
  }

  input.pushEvent?.({
    type: "invocation:progress",
    message: `Web search plan: ${preferredPlan.capabilityId}`,
  });
  planningSpan?.end({
    metadata: {
      provider: preferredPlan.provider,
      capabilityId: preferredPlan.capabilityId,
    },
  });

  const maxTotalResults = input.maxResults;
  const providerErrors: WebSearchProviderError[] = [];
  const executionAttempts: Array<WebSearchProviderPlan & { reason?: string }> = [];
  let selectedProvider: WebSearchProvider | null = null;
  let selectedCapabilityId = "";
  let mergedResults: SearchResult[] = [];

  for (const plan of plans) {
    if (input.signal.aborted) {
      throw new Error("Web search cancelled");
    }
    input.pushEvent?.({
      type: "invocation:progress",
      message: `Searching web with ${plan.provider}`,
    });
    const executionSpan = input.trace?.startSpan({
      name: `Execute ${plan.provider} search`,
      kind: "command_execution",
      metadata: { provider: plan.provider },
    });

    const outcomes = await Promise.allSettled(
      input.queries.map(async (query) => ({
        query,
        results: await executeSingleQuery({
          plan,
          query,
          maxResults: input.maxResults,
          tavilyApiKey,
          searxngBaseUrl,
          signal: input.signal,
        }),
      })),
    );

    if (input.signal.aborted) {
      executionSpan?.end({ status: "cancelled" });
      throw new Error("Web search cancelled");
    }

    const successes: Array<{ query: string; results: SearchResult[] }> = [];
    const failures: Array<{ query: string; error: WebSearchProviderError }> = [];
    outcomes.forEach((outcome, index) => {
      const query = input.queries[index] ?? "";
      if (outcome.status === "fulfilled") {
        successes.push({ query, results: outcome.value.results });
        return;
      }
      failures.push({
        query,
        error: normalizeProviderFailure({
          provider: plan.provider,
          capabilityId: plan.capabilityId,
          error: outcome.reason,
        }),
      });
    });

    if (failures.length === 0) {
      executionSpan?.end({
        metadata: {
          provider: plan.provider,
          resultCount: successes.reduce((sum, item) => sum + item.results.length, 0),
        },
      });
      mergedResults = mergeQueryResults(
        successes.map((item) => item.results),
        maxTotalResults,
      );
      selectedProvider = plan.provider;
      selectedCapabilityId = plan.capabilityId;
      break;
    }

    const providerFailure = aggregateProviderFailure(
      plan,
      failures.map((failure) => failure.error),
    );
    executionSpan?.end({
      status: "failed",
      metadata: {
        provider: plan.provider,
        failedQueries: failures.map((failure) => failure.query),
        error: providerFailure.message,
      },
    });
    providerErrors.push(providerFailure);
    executionAttempts.push({ ...plan, reason: providerFailure.message });
  }

  if (!selectedProvider) {
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

  return {
    queries: input.queries,
    provider: selectedProvider,
    capabilityId: selectedCapabilityId,
    results: mergedResults,
  };
};
