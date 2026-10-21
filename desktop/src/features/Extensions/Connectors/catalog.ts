import type { ExternalMcpServerRecord, McpMarketplaceServer } from "@/shared/api/tools";

export type ConnectorView = "installed" | "internal" | "external" | "custom";
export type MarketplaceFilter = "all" | "installable" | "remote" | "local";
export type ExternalConnector = {
  id: string;
  installed?: ExternalMcpServerRecord;
  marketplace?: McpMarketplaceServer;
};

export function resolveConnectorView(params: URLSearchParams): ConnectorView {
  const value = params.get("view");
  if (params.has("view")) {
    if (value === "builtin") return "internal";
    if (value === "all") return "installed";
    if (value === "installed" || value === "internal" || value === "external" || value === "custom") return value;
    return "installed";
  }
  return params.get("tab") === "marketplace" ? "external" : "installed";
}

export function buildExternalCatalog(input: {
  installed: ExternalMcpServerRecord[];
  marketplace: McpMarketplaceServer[];
  view: ConnectorView;
  query: string;
  category: string;
  filter: MarketplaceFilter;
  installationKnown: boolean;
}): ExternalConnector[] {
  if (input.view === "internal" || input.view === "custom") return [];

  const keyword = input.query.trim().toLowerCase();
  if (input.view === "installed") {
    return input.installed
      .filter((installed) => {
        if (!keyword) return true;
        const haystack = [installed.id, installed.displayName, installed.description ?? "",
          installed.transport.kind === "streamable-http" ? installed.transport.url : `${installed.transport.command} ${(installed.transport.args ?? []).join(" ")}`,
          ...installed.discoveredTools.map((tool) => `${tool.title} ${tool.projectedCapabilityId}`),
        ].join(" ").toLowerCase();
        return haystack.includes(keyword);
      })
      .map((installed) => ({ id: installed.id, installed }));
  }

  // Without an authoritative installation snapshot, marketplace cards cannot
  // be labeled or offered as definitely uninstalled.
  if (!input.installationKnown) return [];
  const installedIds = new Set(input.installed.map(({ id }) => id));
  return input.marketplace
    .filter((marketplace) => !installedIds.has(marketplace.id))
    .filter((marketplace) => input.category === "all" || marketplace.category === input.category)
    .filter((marketplace) => {
      if (input.filter === "all") return true;
      return marketplace.transports.some((transport) =>
        input.filter === "installable" ? transport.installable :
          transport.kind === (input.filter === "remote" ? "streamable-http" : "stdio"),
      );
    })
    .map((marketplace) => ({ id: marketplace.id, marketplace }));
}
