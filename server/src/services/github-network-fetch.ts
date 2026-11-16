import nodeFetch from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import { buildSocks5ProxyUrl } from "@/services/socks5-proxy-config.js";
import {
  generalSettingsRepository,
  type GeneralSettingsRecord,
} from "@/db/repositories/general-settings.repository.js";

const GITHUB_PROXY_HOSTS = new Set(["github.com", "api.github.com"]);
const INSTALL_MARKER = "__UI_CHAT_MIRA_GITHUB_PROXY_FETCH_INSTALLED__" as const;

type GlobalWithInstallMarker = typeof globalThis & {
  [INSTALL_MARKER]?: boolean;
};

type ProxySettingsReader = () => GeneralSettingsRecord;
type NodeFetch = typeof nodeFetch;

export const buildGitHubSocks5ProxyUrl = (settings: GeneralSettingsRecord) =>
  buildSocks5ProxyUrl(settings);

const resolveRequestUrl = (input: string | URL | Request) => {
  try {
    if (typeof input === "string") return new URL(input);
    if (input instanceof URL) return input;
    return new URL(input.url);
  } catch {
    return null;
  }
};

export const isGitHubNetworkRequest = (input: string | URL | Request) => {
  const url = resolveRequestUrl(input);
  return Boolean(url && GITHUB_PROXY_HOSTS.has(url.hostname.toLowerCase()));
};

const toWebResponse = async (response: Awaited<ReturnType<NodeFetch>>) => {
  const arrayBuffer = await response.arrayBuffer();
  return new Response(arrayBuffer, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers as unknown as HeadersInit,
  });
};

export const createGitHubProxyAwareFetch = (
  input: {
    directFetch?: typeof globalThis.fetch;
    readProxySettings?: ProxySettingsReader;
    proxiedFetch?: NodeFetch;
  } = {},
): typeof globalThis.fetch => {
  const directFetch = input.directFetch ?? globalThis.fetch.bind(globalThis);
  const readProxySettings =
    input.readProxySettings ?? (() => generalSettingsRepository.get());
  const proxiedFetch = input.proxiedFetch ?? nodeFetch;
  let cachedProxyUrl: string | null = null;
  let cachedAgent: SocksProxyAgent | null = null;

  return (async (requestInput, requestInit) => {
    if (!isGitHubNetworkRequest(requestInput)) {
      return directFetch(requestInput, requestInit);
    }

    let proxyUrl: string | null = null;
    try {
      proxyUrl = buildGitHubSocks5ProxyUrl(readProxySettings());
    } catch {
      // Database bootstrap or settings reads can be unavailable during early startup.
      // Keep the native direct path rather than breaking unrelated server startup.
    }

    if (!proxyUrl) {
      return directFetch(requestInput, requestInit);
    }

    if (!cachedAgent || cachedProxyUrl !== proxyUrl) {
      cachedProxyUrl = proxyUrl;
      cachedAgent = new SocksProxyAgent(proxyUrl);
    }

    const response = await proxiedFetch(
      requestInput as Parameters<NodeFetch>[0],
      {
        ...(requestInit as Parameters<NodeFetch>[1]),
        agent: cachedAgent,
      },
    );
    return toWebResponse(response);
  }) as typeof globalThis.fetch;
};

export const installGitHubProxyAwareGlobalFetch = () => {
  const target = globalThis as GlobalWithInstallMarker;
  if (target[INSTALL_MARKER]) {
    return;
  }

  const directFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = createGitHubProxyAwareFetch({ directFetch });
  target[INSTALL_MARKER] = true;
};
