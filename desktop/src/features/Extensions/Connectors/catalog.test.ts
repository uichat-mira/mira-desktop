import { describe, expect, it } from "vitest";
import type { ExternalMcpServerRecord, McpMarketplaceServer } from "@/shared/api/tools";
import { buildExternalCatalog, resolveConnectorView, type ConnectorView } from "./catalog";

const installed: ExternalMcpServerRecord = {
  id: "docs", source: "registry", displayName: "Installed docs", description: "My documents",
  transport: { kind: "streamable-http", url: "https://example.test/mcp" },
  enabled: false, agentEnabled: false, status: "failed", discoveredTools: [],
  createdAt: "2026-10-19", updatedAt: "2026-10-19",
};
const market: McpMarketplaceServer = {
  id: "docs", name: "docs", title: "Market docs", description: "Documents", category: "data",
  version: null, status: null, isLatest: null, publishedAt: null, updatedAt: null,
  websiteUrl: null, repositoryUrl: null,
  transports: [{ kind: "streamable-http", packageType: "remote", installable: true, label: "Remote", url: "https://example.test/mcp" }],
};
const options = { installed: [installed, { ...installed, id: "delisted" }], marketplace: [market, { ...market, id: "new" }], view: "installed" as ConnectorView, query: "", category: "all", filter: "all" as const, installationKnown: true };

describe("connector catalog projection", () => {
  it("keeps only real installations in the installed view", () => {
    const entries = buildExternalCatalog(options);
    expect(entries.map((entry) => entry.id)).toEqual(["docs", "delisted"]);
    expect(entries[0]).toEqual({ id: "docs", installed });
    expect(entries[0].installed).toMatchObject({ enabled: false, status: "failed", agentEnabled: false });
  });
  it("keeps same names with different IDs", () => {
    expect(buildExternalCatalog({ ...options, view: "external", marketplace: [{ ...market, id: "different" }] }).map((entry) => entry.id)).toEqual(["different"]);
  });
  it("limits installed view to real installation records and internal to no external records", () => {
    expect(buildExternalCatalog({ ...options, view: "installed" }).map((entry) => entry.id)).toEqual(["docs", "delisted"]);
    expect(buildExternalCatalog({ ...options, view: "internal" })).toEqual([]);
  });
  it("shows uninstalled market entries only in the external view", () => {
    expect(buildExternalCatalog({ ...options, view: "external" }).map((entry) => entry.id)).toEqual(["new"]);
    expect(buildExternalCatalog({ ...options, view: "external", category: "data" }).map((entry) => entry.id)).toEqual(["new"]);
  });
  it("withholds external entries until installation state is known", () => {
    expect(buildExternalCatalog({ ...options, view: "external", installationKnown: false })).toEqual([]);
  });
  it("uses the last known installation snapshot while a later refresh reports an error", () => {
    expect(buildExternalCatalog({ ...options, view: "external", installationKnown: true }).map(({ id }) => id)).toEqual(["new"]);
  });
  it("matches installed capability IDs locally, including records absent from the market", () => {
    const records = [{ ...installed, discoveredTools: [{ name: "read", title: "Read", description: "", inputSchema: {}, projectedCapabilityId: "mcp:docs:read" }] }];
    expect(buildExternalCatalog({ ...options, installed: records, marketplace: [], query: "MCP:DOCS:READ" })).toHaveLength(1);
    expect(buildExternalCatalog({ ...options, marketplace: [], query: "missing" })).toEqual([]);
  });
  it("filters installed records locally and leaves submitted market search to the API", () => {
    expect(buildExternalCatalog({ ...options, view: "installed", query: "missing" })).toEqual([]);
    expect(buildExternalCatalog({ ...options, view: "external", query: "matching submitted query" }).map((entry) => entry.id)).toEqual(["new"]);
  });
  it("applies transport filters to uninstalled market entries", () => {
    const local = { ...installed, transport: { kind: "stdio" as const, command: "npx", args: [] } };
    expect(buildExternalCatalog({ ...options, installed: [local], view: "external", filter: "local" })).toEqual([]);
    expect(buildExternalCatalog({ ...options, installed: [local], view: "external", filter: "remote" }).map((entry) => entry.id)).toEqual(["new"]);
  });
  it("restores a marketplace entry after its installation is removed", () => {
    expect(buildExternalCatalog({ ...options, installed: [], view: "external" })[0]).toEqual({ id: "docs", marketplace: market });
  });
});

describe("connector view URLs", () => {
  it.each(["installed", "internal", "external", "custom"] as const)("resolves %s", (view) => {
    expect(resolveConnectorView(new URLSearchParams({ view }))).toBe(view);
  });
  it.each(["", "view=unknown", "view=&tab=unknown", "view=unknown&tab=marketplace"])("defaults to installed for %s", (search) => {
    expect(resolveConnectorView(new URLSearchParams(search))).toBe("installed");
  });
  it("accepts the legacy market tab, with explicit view taking precedence", () => {
    expect(resolveConnectorView(new URLSearchParams("tab=marketplace"))).toBe("external");
    expect(resolveConnectorView(new URLSearchParams("tab=marketplace&view=internal"))).toBe("internal");
  });
  it("maps legacy view values to the new names", () => {
    expect(resolveConnectorView(new URLSearchParams("view=builtin"))).toBe("internal");
    expect(resolveConnectorView(new URLSearchParams("view=all"))).toBe("installed");
  });
});
