import { Readable } from "node:stream";
import nodeFetch from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  assertUrlIsSafeToFetch,
  createGuardedLookup,
  guardedFetch,
  isGuardedFetchError,
} from "guarded-fetch";
import {
  generalSettingsRepository,
  type GeneralSettingsRecord,
} from "@/db/repositories/general-settings.repository.js";

export const WEB_FETCH_TIMEOUT_MS = 15_000;
export const WEB_FETCH_MAX_RESPONSE_BYTES = 512 * 1024;
export const WEB_FETCH_MAX_REDIRECTS = 5;

export type WebFetchFailureCategory =
  | "blocked"
  | "http"
  | "network"
  | "timeout"
  | "cancelled";

const FAILURE_MESSAGES: Record<WebFetchFailureCategory, string> = {
  blocked: "The URL could not be fetched because the destination is not permitted.",
  http: "The server responded with an error status.",
  network: "The URL could not be fetched due to a network error.",
  timeout: "The URL could not be fetched because the request timed out.",
  cancelled: "The fetch was cancelled.",
};

const isRetryableCategory = (category: WebFetchFailureCategory) =>
  category === "network" || category === "timeout";

export class WebFetchTransportError extends Error {
  readonly category: WebFetchFailureCategory;
  readonly code: WebFetchFailureCategory;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    category: WebFetchFailureCategory,
    options: {
      message?: string;
      retryable?: boolean;
      statusCode?: number;
      cause?: unknown;
    } = {},
  ) {
    const message =
      options.message ??
      (category === "http" && options.statusCode !== undefined
        ? `The server responded with HTTP status ${options.statusCode}.`
        : FAILURE_MESSAGES[category]);
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WebFetchTransportError";
    this.category = category;
    this.code = category;
    this.retryable = options.retryable ?? isRetryableCategory(category);
    if (options.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
  }
}

export interface WebFetchTransportResult {
  status: number;
  finalUrl: string;
  contentType: string;
  body: Buffer;
  byteLength: number;
  truncated: boolean;
}

export interface WebFetchTransportInput {
  url: string;
  signal: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  proxyUrl?: string | null;
}

export interface WebFetchTransportDeps {
  guardedFetch?: typeof guardedFetch;
  nodeFetch?: typeof nodeFetch;
  assertUrlIsSafeToFetch?: typeof assertUrlIsSafeToFetch;
  createGuardedLookup?: typeof createGuardedLookup;
  readProxyUrl?: () => string | null;
}

export const buildSocks5ProxyUrl = (
  settings: GeneralSettingsRecord,
): string | null => {
  const host = settings.socks5Host.trim();
  const port = Number.isInteger(settings.socks5Port) ? settings.socks5Port : 0;
  if (!host || port <= 0 || port > 65535) {
    return null;
  }

  const username = settings.socks5Username.trim();
  const password = settings.socks5Password.trim();
  const auth =
    username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";
  return `socks5://${auth}${host}:${port}`;
};

const readConfiguredProxyUrl = (): string | null => {
  let settings: GeneralSettingsRecord;
  try {
    settings = generalSettingsRepository.get();
  } catch (error) {
    // A proxy configuration that cannot be read is not the same as "no proxy
    // configured". Fail closed instead of silently falling back to a direct
    // connection.
    throw new WebFetchTransportError("network", {
      message:
        "The URL could not be fetched because the network proxy configuration could not be read.",
      retryable: false,
      cause: error,
    });
  }
  return buildSocks5ProxyUrl(settings);
};

const isRedirectStatus = (status: number) =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

const toNodeReadable = (body: unknown): Readable | null => {
  if (!body) {
    return null;
  }
  if (typeof (body as { getReader?: unknown }).getReader === "function") {
    return Readable.fromWeb(
      body as Parameters<typeof Readable.fromWeb>[0],
    );
  }
  return body as Readable;
};

const discardBody = (body: unknown) => {
  if (!body) {
    return;
  }
  const webStream = body as { cancel?: () => Promise<void> };
  if (typeof webStream.cancel === "function") {
    void webStream.cancel().catch(() => {});
    return;
  }
  const nodeStream = body as { destroy?: () => void };
  if (typeof nodeStream.destroy === "function") {
    nodeStream.destroy();
  }
};

const readBoundedBody = async (input: {
  body: unknown;
  maxResponseBytes: number;
  deadlineAt: number;
  signal: AbortSignal;
}): Promise<{ body: Buffer; byteLength: number; truncated: boolean }> => {
  const readable = toNodeReadable(input.body);
  if (!readable) {
    return { body: Buffer.alloc(0), byteLength: 0, truncated: false };
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  let truncated = false;

  const timer = setTimeout(() => {
    readable.destroy(new WebFetchTransportError("timeout"));
  }, Math.max(0, input.deadlineAt - Date.now()));
  const onAbort = () => {
    readable.destroy(new WebFetchTransportError("cancelled"));
  };
  input.signal.addEventListener("abort", onAbort, { once: true });

  try {
    for await (const chunk of readable) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (byteLength + buffer.length > input.maxResponseBytes) {
        const remaining = input.maxResponseBytes - byteLength;
        if (remaining > 0) {
          chunks.push(buffer.subarray(0, remaining));
        }
        byteLength = input.maxResponseBytes;
        truncated = true;
        break;
      }
      chunks.push(buffer);
      byteLength += buffer.length;
    }
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", onAbort);
  }

  return {
    body: Buffer.concat(chunks, byteLength),
    byteLength,
    truncated,
  };
};

const finalizeResponse = async (input: {
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: unknown;
  maxResponseBytes: number;
  deadlineAt: number;
  signal: AbortSignal;
}): Promise<WebFetchTransportResult> => {
  if (input.status >= 400) {
    discardBody(input.body);
    throw new WebFetchTransportError("http", { statusCode: input.status });
  }

  const bounded = await readBoundedBody({
    body: input.body,
    maxResponseBytes: input.maxResponseBytes,
    deadlineAt: input.deadlineAt,
    signal: input.signal,
  });

  return {
    status: input.status,
    finalUrl: input.finalUrl,
    contentType: input.contentType ?? "",
    body: bounded.body,
    byteLength: bounded.byteLength,
    truncated: bounded.truncated,
  };
};

const toTransportError = (
  error: unknown,
  signal: AbortSignal,
): WebFetchTransportError => {
  if (signal.aborted) {
    return new WebFetchTransportError("cancelled", { cause: error });
  }
  if (error instanceof WebFetchTransportError) {
    return error;
  }
  if (isGuardedFetchError(error)) {
    switch (error.code) {
      case "timeout":
        return new WebFetchTransportError("timeout", { cause: error });
      case "network_error":
      case "response_too_large":
        return new WebFetchTransportError("network", { cause: error });
      default:
        return new WebFetchTransportError("blocked", { cause: error });
    }
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new WebFetchTransportError("timeout", { cause: error });
  }
  return new WebFetchTransportError("network", { cause: error });
};

const normalizeProxyUrl = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const createWebFetchTransport = (
  deps: WebFetchTransportDeps = {},
): ((input: WebFetchTransportInput) => Promise<WebFetchTransportResult>) => {
  const doGuardedFetch = deps.guardedFetch ?? guardedFetch;
  const doNodeFetch = deps.nodeFetch ?? nodeFetch;
  const assertSafeUrl = deps.assertUrlIsSafeToFetch ?? assertUrlIsSafeToFetch;
  const createLookup = deps.createGuardedLookup ?? createGuardedLookup;
  const readProxyUrl = deps.readProxyUrl ?? readConfiguredProxyUrl;

  const fetchDirect = async (
    url: URL,
    input: WebFetchTransportInput,
    options: {
      timeoutMs: number;
      maxResponseBytes: number;
      maxRedirects: number;
      deadlineAt: number;
    },
  ): Promise<WebFetchTransportResult> => {
    const response = await doGuardedFetch(url.toString(), {
      signal: input.signal,
      timeoutMs: options.timeoutMs,
      followRedirects: true,
      maxRedirects: options.maxRedirects,
    });

    return finalizeResponse({
      status: response.status,
      finalUrl: response.url || url.toString(),
      contentType: response.headers.get("content-type"),
      body: response.body,
      maxResponseBytes: options.maxResponseBytes,
      deadlineAt: options.deadlineAt,
      signal: input.signal,
    });
  };

  const fetchThroughSocks = async (
    url: URL,
    proxyUrl: string,
    input: WebFetchTransportInput,
    options: {
      timeoutMs: number;
      maxResponseBytes: number;
      maxRedirects: number;
      deadlineAt: number;
    },
  ): Promise<WebFetchTransportResult> => {
    const agent = new SocksProxyAgent(proxyUrl, {
      lookup: createLookup(),
    });
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(options.timeoutMs),
    ]);

    try {
      let currentUrl = url.toString();

      for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
        if (input.signal.aborted) {
          throw new WebFetchTransportError("cancelled");
        }

        await assertSafeUrl(currentUrl);

        const response = await doNodeFetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          agent,
          signal,
        });

        const location = response.headers.get("location");
        if (isRedirectStatus(response.status)) {
          discardBody(response.body);
          if (hop === options.maxRedirects) {
            throw new WebFetchTransportError("blocked", {
              message:
                "The URL could not be fetched because it redirected too many times.",
              retryable: false,
            });
          }
          if (!location) {
            throw new WebFetchTransportError("blocked", {
              message:
                "The URL could not be fetched because a redirect response had no target.",
              retryable: false,
            });
          }
          let nextUrl: string;
          try {
            nextUrl = new URL(location, currentUrl).toString();
          } catch (error) {
            throw new WebFetchTransportError("blocked", {
              message:
                "The URL could not be fetched because a redirect target was not a valid URL.",
              retryable: false,
              cause: error,
            });
          }
          currentUrl = nextUrl;
          continue;
        }

        return await finalizeResponse({
          status: response.status,
          finalUrl: currentUrl,
          contentType: response.headers.get("content-type"),
          body: response.body,
          maxResponseBytes: options.maxResponseBytes,
          deadlineAt: options.deadlineAt,
          signal: input.signal,
        });
      }

      throw new WebFetchTransportError("blocked", {
        message: "The URL could not be fetched because it redirected too many times.",
        retryable: false,
      });
    } finally {
      agent.destroy();
    }
  };

  return async (input: WebFetchTransportInput): Promise<WebFetchTransportResult> => {
    const timeoutMs = input.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
    const maxResponseBytes = input.maxResponseBytes ?? WEB_FETCH_MAX_RESPONSE_BYTES;
    const maxRedirects = input.maxRedirects ?? WEB_FETCH_MAX_REDIRECTS;
    const deadlineAt = Date.now() + timeoutMs;

    if (input.signal.aborted) {
      throw new WebFetchTransportError("cancelled");
    }

    let url: URL;
    try {
      url = new URL(input.url);
    } catch (error) {
      throw new WebFetchTransportError("blocked", {
        message: "The URL could not be fetched because it is not a valid absolute URL.",
        retryable: false,
        cause: error,
      });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new WebFetchTransportError("blocked", {
        message: "The URL could not be fetched because only http and https URLs are supported.",
        retryable: false,
      });
    }
    if (url.username || url.password) {
      throw new WebFetchTransportError("blocked", {
        message: "The URL could not be fetched because embedded credentials are not allowed.",
        retryable: false,
      });
    }

    try {
      const proxyUrl =
        input.proxyUrl === undefined
          ? normalizeProxyUrl(readProxyUrl())
          : normalizeProxyUrl(input.proxyUrl);

      return proxyUrl
        ? await fetchThroughSocks(url, proxyUrl, input, {
            timeoutMs,
            maxResponseBytes,
            maxRedirects,
            deadlineAt,
          })
        : await fetchDirect(url, input, {
            timeoutMs,
            maxResponseBytes,
            maxRedirects,
            deadlineAt,
          });
    } catch (error) {
      throw toTransportError(error, input.signal);
    }
  };
};

export const fetchWebResource = createWebFetchTransport();
