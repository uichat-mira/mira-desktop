// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import McpSettings from "./index";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { resolveGithubMirrorUrl } from "@/shared/github";

const getMcpMarketplaceServersMock = vi.fn();
const getMcpMarketplaceSyncStatusMock = vi.fn();
const requestMcpMarketplaceSyncMock = vi.fn();
const getExternalMcpServersMock = vi.fn();
const createExternalMcpServerMock = vi.fn();
const connectExternalMcpServerMock = vi.fn();
const discoverExternalMcpServerMock = vi.fn();
const deleteExternalMcpServerMock = vi.fn();
const getExternalMcpServerConfigSchemaMock = vi.fn();
const getExternalMcpServerConfigMock = vi.fn();
const updateExternalMcpServerConfigMock = vi.fn();
const updateExternalMcpAccessMock = vi.fn();
const modalConfirmMock = vi.fn();
const modalShowMock = vi.fn();
const modalCloseMock = vi.fn();
const messageSuccessMock = vi.fn();
const messageErrorMock = vi.fn();
const actionLabels: Record<string, string> = { "app.connectors.agentAccess": "允许 Agent 使用", "app.connectors.discovered": "已发现" };
const tMock = (key: string) => actionLabels[key] ?? key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}));

vi.mock("@/shared/api/tools", () => ({
  getMcpMarketplaceServers: (...args: unknown[]) => getMcpMarketplaceServersMock(...args),
  getMcpMarketplaceSyncStatus: (...args: unknown[]) =>
    getMcpMarketplaceSyncStatusMock(...args),
  requestMcpMarketplaceSync: (...args: unknown[]) =>
    requestMcpMarketplaceSyncMock(...args),
  getExternalMcpServers: (...args: unknown[]) => getExternalMcpServersMock(...args),
  createExternalMcpServer: (...args: unknown[]) => createExternalMcpServerMock(...args),
  connectExternalMcpServer: (...args: unknown[]) => connectExternalMcpServerMock(...args),
  discoverExternalMcpServer: (...args: unknown[]) => discoverExternalMcpServerMock(...args),
  deleteExternalMcpServer: (...args: unknown[]) => deleteExternalMcpServerMock(...args),
  getExternalMcpServerConfigSchema: (...args: unknown[]) => getExternalMcpServerConfigSchemaMock(...args),
  getExternalMcpServerConfig: (...args: unknown[]) => getExternalMcpServerConfigMock(...args),
  updateExternalMcpServerConfig: (...args: unknown[]) => updateExternalMcpServerConfigMock(...args),
  updateExternalMcpAccess: (...args: unknown[]) => updateExternalMcpAccessMock(...args),
}));

vi.mock("@/shared/ui/Modal", () => ({
  Modal: {
    confirm: (...args: unknown[]) => modalConfirmMock(...args),
    show: (...args: unknown[]) => modalShowMock(...args),
    close: (...args: unknown[]) => modalCloseMock(...args),
  },
}));

vi.mock("@/shared/ui/Message", () => ({
  message: {
    success: (...args: unknown[]) => messageSuccessMock(...args),
    error: (...args: unknown[]) => messageErrorMock(...args),
  },
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
}

function renderPage(route = "/extensions/connectors?view=external") {
  return render(<MemoryRouter initialEntries={[route]}><McpSettings /><LocationProbe /></MemoryRouter>);
}

const installedServer = {
  id: "remote-docs", source: "registry" as const, displayName: "Remote Docs",
  description: "Third-party docs MCP", transport: { kind: "streamable-http" as const, url: "https://remote.example/mcp" },
  status: "connected" as const, enabled: true, agentEnabled: false,
  createdAt: "2026-06-25T00:00:00.000Z", updatedAt: "2026-06-25T00:00:00.000Z", discoveredTools: [],
};

describe("Connectors", () => {
  beforeEach(() => {
    getMcpMarketplaceServersMock.mockReset();
    getMcpMarketplaceSyncStatusMock.mockReset();
    requestMcpMarketplaceSyncMock.mockReset();
    getExternalMcpServersMock.mockReset();
    createExternalMcpServerMock.mockReset();
    connectExternalMcpServerMock.mockReset();
    discoverExternalMcpServerMock.mockReset();
    deleteExternalMcpServerMock.mockReset();
    getExternalMcpServerConfigSchemaMock.mockReset();
    getExternalMcpServerConfigMock.mockReset();
    updateExternalMcpServerConfigMock.mockReset();
    updateExternalMcpAccessMock.mockReset();
    modalConfirmMock.mockReset();
    modalShowMock.mockReset();
    modalCloseMock.mockReset();
    messageSuccessMock.mockReset();
    messageErrorMock.mockReset();

    getMcpMarketplaceServersMock.mockResolvedValue({
      servers: [
        {
          id: "remote-docs",
          name: "remote-docs",
          title: "Remote Docs",
          description: "Third-party docs MCP",
          version: "1.0.0",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: "https://docs.example.dev/mcp",
          repositoryUrl: "https://github.com/example/remote-docs",
          transports: [
            {
              kind: "streamable-http",
              packageType: "remote",
              installable: true,
              label: "Remote HTTP",
              url: "https://remote.example/mcp",
            },
          ],
        },
      ],
      metadata: {
        count: 1,
        nextCursor: null,
        sourceUrl: "https://registry.modelcontextprotocol.io/v0/servers",
      },
    });
    getExternalMcpServersMock.mockResolvedValue([]);
    getMcpMarketplaceSyncStatusMock.mockResolvedValue({
      sourceUrl: "https://registry.modelcontextprotocol.io/v0.1/servers",
      status: "idle",
      mode: "incremental",
      lastAttemptAt: null,
      lastSuccessfulSyncAt: null,
      lastFullSyncAt: null,
      updatedCount: 0,
      lastError: null,
      nextAutoSyncAt: null,
    });
    requestMcpMarketplaceSyncMock.mockResolvedValue({
      started: true,
      status: {
        sourceUrl: "https://registry.modelcontextprotocol.io/v0.1/servers",
        status: "syncing",
        mode: "incremental",
        lastAttemptAt: "2026-07-31T00:00:00.000Z",
        lastSuccessfulSyncAt: null,
        lastFullSyncAt: null,
        updatedCount: 0,
        lastError: null,
        nextAutoSyncAt: null,
      },
    });
    createExternalMcpServerMock.mockResolvedValue({
      id: "remote-docs",
      source: "registry",
      displayName: "Remote Docs",
      transport: {
        kind: "streamable-http",
        url: "https://remote.example/mcp",
      },
      status: "configured",
      enabled: true,
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
      discoveredTools: [],
    });
    modalConfirmMock.mockImplementation(async (options: { onConfirm: () => Promise<void> | void }) => {
      await options.onConfirm();
    });
    modalShowMock.mockReturnValue("modal_1");
    getExternalMcpServerConfigSchemaMock.mockResolvedValue({
      fields: [
        { key: "endpointUrl", label: "Endpoint URL", type: "url", required: true },
        { key: "bearerToken", label: "Bearer Token", type: "password", required: false, secret: true },
        { key: "customHeadersJson", label: "Custom Headers JSON", type: "json", required: false },
        { key: "timeoutMs", label: "Timeout (ms)", type: "number", required: true },
      ],
      completeness: "known-partial",
      sources: ["manual"],
      notes: [],
    });
    getExternalMcpServerConfigMock.mockResolvedValue({
      endpointUrl: "https://remote.example/mcp",
      authType: "none",
      timeoutMs: 30000,
      customHeadersJson: "",
      hasBearerToken: false,
    });
    updateExternalMcpServerConfigMock.mockResolvedValue({
      endpointUrl: "https://remote.example/mcp",
      authType: "bearer",
      timeoutMs: 45000,
      customHeadersJson: '{\n  "X-Org-Id": "demo"\n}',
      hasBearerToken: true,
    });
    updateExternalMcpAccessMock.mockResolvedValue({
      id: "remote-docs",
      agentEnabled: true,
    });
  });


  it("shows the four exclusive views and defaults to installed records", async () => {
    getExternalMcpServersMock.mockResolvedValue([installedServer]);
    renderPage("/extensions/connectors");
    for (const view of ["installed", "internal", "external", "custom"]) {
      expect(screen.getByRole("button", { name: `app.connectors.views.${view}` })).toBeInTheDocument();
    }
    expect(await screen.findByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remote Docs", exact: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "app.connectors.views.installed" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.setup().click(screen.getByRole("button", { name: "app.connectors.views.external" }));
    expect(screen.queryByRole("button", { name: "Remote Docs", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "settings.mcp.tabs.marketplace" })).not.toBeInTheDocument();
  });

  it("adds and removes session-only custom MCP drafts without calling MCP mutation APIs", async () => {
    const user = userEvent.setup();
    renderPage("/extensions/connectors?view=custom");
    await waitFor(() => expect(getExternalMcpServersMock).toHaveBeenCalled());
    const apiMocks = [
      getMcpMarketplaceServersMock, getMcpMarketplaceSyncStatusMock, requestMcpMarketplaceSyncMock,
      getExternalMcpServersMock, createExternalMcpServerMock, connectExternalMcpServerMock,
      discoverExternalMcpServerMock, deleteExternalMcpServerMock, getExternalMcpServerConfigSchemaMock,
      getExternalMcpServerConfigMock, updateExternalMcpServerConfigMock, updateExternalMcpAccessMock,
    ];
    const callsBeforeDraft = apiMocks.map((apiMock) => apiMock.mock.calls.length);
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.add" }));
    const configContent = modalShowMock.mock.calls.at(-1)?.[0].content;
    const { unmount } = render(configContent);
    fireEvent.change(screen.getByRole("textbox", { name: "app.connectors.custom.jsonLabel" }), {
      target: { value: '{"mcpServers":{"draft docs":{"command":"npx","args":["-y","docs-mcp"]}}}' },
    });
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.confirm" }));
    unmount();
    expect(await screen.findByRole("button", { name: "draft docs" })).toBeInTheDocument();
    expect(screen.getByText("app.connectors.custom.draftStatus")).toBeInTheDocument();
    expect(createExternalMcpServerMock).not.toHaveBeenCalled();
    expect(connectExternalMcpServerMock).not.toHaveBeenCalled();
    expect(discoverExternalMcpServerMock).not.toHaveBeenCalled();
    expect(deleteExternalMcpServerMock).not.toHaveBeenCalled();
    expect(updateExternalMcpServerConfigMock).not.toHaveBeenCalled();
    expect(updateExternalMcpAccessMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "app.connectors.custom.removeDraft" }));
    expect(screen.getByText("app.connectors.custom.emptyTitle")).toBeInTheDocument();
    expect(apiMocks.map((apiMock) => apiMock.mock.calls.length)).toEqual(callsBeforeDraft);
  });

  it.each(["/extensions/connectors", "/extensions/connectors?tab=unknown"])("shows real builtin entry links on the default view at %s", async (route) => {
    const user = userEvent.setup();
    renderPage(route);
    await user.click(screen.getByRole("button", { name: "app.connectors.views.internal" }));
    const destinations = [
      ["knowledgeBase", "/knowledge-base"], ["github", "/settings/micro-apps/github"],
      ["notion", "/settings/micro-apps/notion"], ["mailCenter", "/settings/micro-apps/mail-center"],
      ["newsHub", "/settings/micro-apps/news-hub"], ["touchRealm", "/settings/micro-apps/jian-xing"],
      ["codeGraph", "/settings/micro-apps/codegraph-studio"],
    ];
    for (const [id, href] of destinations) {
      expect(await screen.findByRole("link", { name: `app.connectors.builtins.${id}.name` })).toHaveAttribute("href", href);
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "settings.mcp.installed.refresh" })).toBeEnabled());
    expect(screen.queryByText("原型预览")).not.toBeInTheDocument();
  });

  it("restores flat views with history and preserves the shared submitted search", async () => {
    const user = userEvent.setup();
    renderPage("/extensions/connectors");
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    const search = screen.getByRole("textbox", { name: "app.connectors.search" });
    await user.type(search, "docs{Enter}");
    await user.click(screen.getByRole("button", { name: "app.connectors.views.external" }));
    expect(screen.getByTestId("location")).toHaveTextContent("view=external");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "app.connectors.views.installed" })).toHaveAttribute("aria-pressed", "true");
    expect(search).toHaveValue("docs");
    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByRole("button", { name: "app.connectors.views.external" })).toHaveAttribute("aria-pressed", "true");
    expect(search).toHaveValue("docs");
  });

  it("opens installed items for management without exposing a marketplace duplicate", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValue([installedServer]);
    renderPage("/extensions/connectors");
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));
    expect(await screen.findByRole("dialog", { name: "Remote Docs" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/extensions/connectors");
    expect(createExternalMcpServerMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "允许 Agent 使用" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps a failed installation in the market with its search and error feedback", async () => {
    const user = userEvent.setup();
    createExternalMcpServerMock.mockRejectedValue(new Error("install rejected"));
    renderPage();
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    await user.type(screen.getByRole("textbox", { name: "app.connectors.search" }), "docs{Enter}");
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));
    await user.click(await screen.findByRole("button", { name: "settings.mcp.marketplace.install" }));
    await waitFor(() => expect(messageErrorMock).toHaveBeenCalledWith("install rejected"));
    expect(screen.getByTestId("location")).toHaveTextContent("view=external");
    expect(screen.getByRole("textbox", { name: "app.connectors.search" })).toHaveValue("docs");
  });

  it("selects the newly installed item even when refreshing the installed list fails", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValueOnce([]).mockRejectedValue(new Error("list offline"));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));
    await user.click(await screen.findByRole("button", { name: "settings.mcp.marketplace.install" }));
    expect(await screen.findByRole("dialog", { name: "Remote Docs" })).toBeInTheDocument();
    expect(screen.getAllByText("list offline").length).toBeGreaterThan(0);
    expect(screen.getByTestId("location")).toHaveTextContent("view=installed");
  });

  it("keeps internal entries and installed MCP records in separate views", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValue([installedServer]);
    renderPage("/extensions/connectors");
    await screen.findByRole("button", { name: "Remote Docs", exact: true });
    await user.click(screen.getByRole("button", { name: "app.connectors.views.internal" }));
    expect(screen.queryByText("Remote Docs")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "app.connectors.builtins.github.name" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "app.connectors.views.external" }));
    expect(screen.queryByText("Remote Docs")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "app.connectors.builtins.github.name" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "app.connectors.views.installed" }));
    expect(screen.getByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
  });


  it("preserves the selected drawer while refreshed capabilities change", async () => {
    const user = userEvent.setup();
    const tool = { name: "read_doc", title: "Read doc", description: "Read", inputSchema: { type: "object" }, projectedCapabilityId: "mcp:remote-docs:read_doc" };
    getExternalMcpServersMock.mockResolvedValueOnce([installedServer]).mockResolvedValue([{ ...installedServer, discoveredTools: [tool] }]);
    discoverExternalMcpServerMock.mockResolvedValue({ ...installedServer, discoveredTools: [tool] });
    renderPage("/extensions/connectors");
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));
    await user.click(screen.getByRole("button", { name: "settings.mcp.installed.discover" }));
    const expand = await screen.findByRole("button", { name: /已发现 1 settings\.mcp\.installed\.tools/ });
    await user.click(expand);
    expect(screen.getByText("settings.mcp.installed.projectedId: mcp:remote-docs:read_doc")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Remote Docs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "允许 Agent 使用" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps internal entries available after a failed list request and supports retry", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockRejectedValueOnce(new Error("list offline")).mockResolvedValue([installedServer]);
    renderPage("/extensions/connectors");
    expect(await screen.findByText("list offline")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "app.connectors.views.internal" }));
    expect(screen.getByRole("link", { name: "app.connectors.builtins.github.name" })).toHaveAttribute("href", "/settings/micro-apps/github");
    await user.click(screen.getByRole("button", { name: "settings.mcp.marketplace.retry" }));
    await user.click(screen.getByRole("button", { name: "app.connectors.views.installed" }));
    expect(await screen.findByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
    expect(screen.queryByText("list offline")).not.toBeInTheDocument();
  });

  it("withholds marketplace cards after an installed-list failure and retries before showing them", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockRejectedValueOnce(new Error("cannot check installed")).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("cannot check installed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remote Docs", exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "settings.mcp.marketplace.retry" }));
    expect(await screen.findByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remote Docs", exact: true }));
    expect(screen.getByRole("button", { name: "settings.mcp.marketplace.install" })).toBeEnabled();
    expect(screen.queryByText("cannot check installed")).not.toBeInTheDocument();
  });

  it("retains successful marketplace results when refreshing the same query fails", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Remote Docs");
    getMcpMarketplaceServersMock.mockRejectedValue(new Error("market offline"));
    requestMcpMarketplaceSyncMock.mockResolvedValue({ started: true, status: { status: "idle", lastSuccessfulSyncAt: null } });
    await user.click(screen.getByRole("button", { name: "settings.mcp.installed.refresh" }));
    expect(await screen.findByText("market offline")).toBeInTheDocument();
    expect(screen.getByText("Remote Docs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.mcp.marketplace.retry" })).toBeEnabled();
  });

  it("does not show a global no-match message when a builtin search result exists", async () => {
    const user = userEvent.setup();
    renderPage("/extensions/connectors");
    await waitFor(() => expect(screen.getByRole("button", { name: "settings.mcp.installed.refresh" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "app.connectors.views.internal" }));
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    await user.type(screen.getByRole("textbox", { name: "app.connectors.search" }), "github{Enter}");
    expect(screen.getByRole("link", { name: "app.connectors.builtins.github.name" })).toBeInTheDocument();
    expect(screen.queryByText("app.connectors.noMatches")).not.toBeInTheDocument();
  });

  it("blocks repeat installation while the first request is pending", async () => {
    const user = userEvent.setup();
    let rejectInstall!: (reason: Error) => void;
    createExternalMcpServerMock.mockImplementation(() => new Promise((_, reject) => { rejectInstall = reject; }));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));
    const install = await screen.findByRole("button", { name: "settings.mcp.marketplace.install" });
    await waitFor(() => expect(install).toBeEnabled());
    await user.dblClick(install);
    expect(install).toBeDisabled();
    expect(createExternalMcpServerMock).toHaveBeenCalledTimes(1);
    rejectInstall(new Error("cancel test request"));
    await waitFor(() => expect(install).toBeEnabled());
  });

  it("keeps the selected server when connecting fails", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValue([installedServer]);
    connectExternalMcpServerMock.mockRejectedValue(new Error("connection refused"));
    renderPage("/extensions/connectors");
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));
    await user.click(screen.getByRole("button", { name: "settings.mcp.installed.connect" }));
    await waitFor(() => expect(messageErrorMock).toHaveBeenCalledWith(expect.stringContaining("connection refused")));
    expect(screen.getByRole("dialog", { name: "Remote Docs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.mcp.installed.connect" })).toBeEnabled();
  });

  it("installs a marketplace server, switches to installed and opens management", async () => {
    const user = userEvent.setup();

    getExternalMcpServersMock.mockResolvedValueOnce([]).mockResolvedValue([installedServer]);
    renderPage();
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    await user.type(screen.getByRole("textbox", { name: "app.connectors.search" }), "docs{Enter}");
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "settings.mcp.marketplace.install",
        }),
      ).toBeEnabled();
    });

    const installButton = screen.getByRole("button", {
      name: "settings.mcp.marketplace.install",
    });

    await user.click(installButton);

    await waitFor(() => {
      expect(createExternalMcpServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "remote-docs",
          documentationUrl: "https://docs.example.dev/mcp",
          repositoryUrl: "https://github.com/example/remote-docs",
          disclaimerAccepted: true,
          transport: {
            kind: "streamable-http",
            url: "https://remote.example/mcp",
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Remote Docs" })).toBeInTheDocument();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("view=installed");
    expect(screen.getByRole("button", { name: "app.connectors.views.installed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "app.connectors.search" })).toHaveValue("docs");
  });

  it("deletes an installed MCP server from the installed tab", async () => {
    const user = userEvent.setup();

    getExternalMcpServersMock.mockResolvedValueOnce([
      {
        id: "remote-docs",
        source: "registry",
        displayName: "Remote Docs",
        description: "Third-party docs MCP",
        documentationUrl: "https://docs.example.dev/mcp",
        repositoryUrl: "https://github.com/example/remote-docs",
        transport: {
          kind: "streamable-http",
          url: "https://remote.example/mcp",
        },
        status: "configured",
        enabled: true,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
        discoveredTools: [],
      },
    ]);
    getExternalMcpServersMock.mockResolvedValueOnce([]);
    deleteExternalMcpServerMock.mockResolvedValue({
      id: "remote-docs",
    });

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: "app.connectors.views.installed",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));

    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://docs.example.dev/mcp",
    );
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      resolveGithubMirrorUrl("https://github.com/example/remote-docs"),
    );

    await user.click(
      screen.getByRole("button", {
        name: "settings.mcp.installed.remove",
      }),
    );

    expect(modalConfirmMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(deleteExternalMcpServerMock).toHaveBeenCalledWith("remote-docs");
    });

    await waitFor(() => {
      expect(screen.getByText("app.connectors.noMatches")).toBeInTheDocument();
    });
  });

  it("renders and toggles Agent Access, then reports update failures", async () => {
    const user = userEvent.setup();
    const server = {
      id: "remote-docs",
      source: "registry" as const,
      displayName: "Remote Docs",
      transport: {
        kind: "streamable-http" as const,
        url: "https://remote.example/mcp",
      },
      status: "connected" as const,
      enabled: true,
      agentEnabled: false,
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
      discoveredTools: [],
    };
    getExternalMcpServersMock.mockResolvedValueOnce([server]);
    getExternalMcpServersMock.mockResolvedValueOnce([{ ...server, agentEnabled: true }]);
    updateExternalMcpAccessMock.mockResolvedValueOnce({ ...server, agentEnabled: true });

    renderPage();
    await user.click(
      await screen.findByRole("button", {
        name: "app.connectors.views.installed",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));

    const accessButton = await screen.findByRole("button", {
      name: "允许 Agent 使用",
    });
    expect(accessButton).toHaveAttribute("aria-pressed", "false");
    await user.click(accessButton);

    await waitFor(() => {
      expect(updateExternalMcpAccessMock).toHaveBeenCalledWith("remote-docs", true);
    });
    expect(await screen.findByRole("button", {
      name: "允许 Agent 使用",
    })).toHaveAttribute("aria-pressed", "true");

    updateExternalMcpAccessMock.mockRejectedValueOnce(new Error("access update failed"));
    await user.click(screen.getByRole("button", {
      name: "允许 Agent 使用",
    }));
    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledWith("access update failed");
    });
  });

  it("opens config modal and saves MCP server config", async () => {
    const user = userEvent.setup();

    getExternalMcpServersMock.mockResolvedValueOnce([
      {
        id: "remote-docs",
        source: "registry",
        displayName: "Remote Docs",
        description: "Third-party docs MCP",
        transport: {
          kind: "streamable-http",
          url: "https://remote.example/mcp",
        },
        status: "configured",
        enabled: true,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
        discoveredTools: [],
      },
    ]);
    getExternalMcpServersMock.mockResolvedValueOnce([
      {
        id: "remote-docs",
        source: "registry",
        displayName: "Remote Docs",
        description: "Third-party docs MCP",
        transport: {
          kind: "streamable-http",
          url: "https://remote.example/mcp",
        },
        status: "configured",
        enabled: true,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
        discoveredTools: [],
      },
    ]);

    modalShowMock.mockImplementation((options: { content: JSX.Element }) => {
      render(options.content);
      return "modal_1";
    });

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: "app.connectors.views.installed",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));


    await user.click(
      screen.getByRole("button", {
        name: "settings.mcp.installed.configure",
      }),
    );

    await waitFor(() => {
      expect(getExternalMcpServerConfigSchemaMock).toHaveBeenCalledWith("remote-docs");
      expect(getExternalMcpServerConfigMock).toHaveBeenCalledWith("remote-docs");
    });

    await user.click(
      screen.getByRole("button", {
        name: "settings.mcp.config.authTypeBearer",
      }),
    );
    await user.type(screen.getByLabelText("settings.mcp.config.bearerToken"), "secret-token");
    await user.clear(screen.getByLabelText("settings.mcp.config.timeoutMs"));
    await user.type(screen.getByLabelText("settings.mcp.config.timeoutMs"), "45000");
    fireEvent.change(screen.getByLabelText("settings.mcp.config.customHeadersJson"), {
      target: {
        value: '{\n  "X-Org-Id": "demo"\n}',
      },
    });

    await user.click(
      screen.getByRole("button", {
        name: "settings.mcp.config.save",
      }),
    );

    await waitFor(() => {
      expect(updateExternalMcpServerConfigMock).toHaveBeenCalledWith("remote-docs", {
        endpointUrl: "https://remote.example/mcp",
        authType: "bearer",
        timeoutMs: 45000,
        customHeadersJson: '{\n  "X-Org-Id": "demo"\n}',
        bearerToken: "secret-token",
      });
    });
    expect(modalCloseMock).toHaveBeenCalledWith("modal_1");
  });

  it("renders discovered MCP tools inside a collapsible panel", async () => {
    const user = userEvent.setup();

    getExternalMcpServersMock.mockResolvedValueOnce([
      {
        id: "slideshot",
        source: "registry",
        displayName: "Slideshot",
        description: "PowerPoint MCP",
        transport: {
          kind: "stdio",
          command: "npx",
          args: ["-y", "slideshot-mcp"],
        },
        status: "connected",
        enabled: true,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
        discoveredTools: [
          {
            name: "discover_themes",
            title: "discover_themes",
            description: "",
            inputSchema: { type: "object" },
            projectedCapabilityId: "mcp:io.github.06ketan-slideshot:tool:discover_themes",
          },
          {
            name: "create_slides",
            title: "create_slides",
            description: "",
            inputSchema: { type: "object" },
            projectedCapabilityId: "mcp:io.github.06ketan-slideshot:tool:create_slides",
          },
        ],
      },
    ]);

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: "app.connectors.views.installed",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Slideshot", exact: true }));

    expect(
      screen.getByRole("button", {
        name: /已发现 2 settings\.mcp\.installed\.tools/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Projected ID:/i)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /已发现 2 settings\.mcp\.installed\.tools/i,
      }),
    );

    expect(screen.getByText("discover_themes")).toBeInTheDocument();
    expect(
      screen.getByText(/mcp:io\.github\.06ketan-slideshot:tool:discover_themes/i),
    ).toBeInTheDocument();
  });

  it("renders stdio config fields for installed stdio servers", async () => {
    const user = userEvent.setup();

    getExternalMcpServersMock.mockResolvedValueOnce([
      {
        id: "local-docs",
        source: "manual",
        displayName: "Local Docs",
        description: "stdio server",
        transport: {
          kind: "stdio",
          command: "npx",
          args: ["-y", "@demo/local-docs-mcp"],
        },
        status: "configured",
        enabled: true,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
        discoveredTools: [],
      },
    ]);
    getExternalMcpServersMock.mockResolvedValueOnce([
      {
        id: "local-docs",
        source: "manual",
        displayName: "Local Docs",
        description: "stdio server",
        transport: {
          kind: "stdio",
          command: "npx",
          args: ["-y", "@demo/local-docs-mcp"],
        },
        status: "configured",
        enabled: true,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
        discoveredTools: [],
      },
    ]);
    getExternalMcpServerConfigSchemaMock.mockResolvedValueOnce({
      fields: [
        { key: "command", label: "Command", type: "text", required: true },
        { key: "argsText", label: "Args JSON", type: "json", required: false },
        { key: "cwd", label: "Working Directory", type: "text", required: false },
        { key: "envJson", label: "Env JSON", type: "json", required: false },
        { key: "timeoutMs", label: "Timeout (ms)", type: "number", required: true },
      ],
      completeness: "known-partial",
      sources: ["manual"],
      notes: [],
    });
    getExternalMcpServerConfigMock.mockResolvedValueOnce({
      command: "npx",
      argsText: '[\n  "-y",\n  "@demo/local-docs-mcp"\n]',
      packageName: "@demo/local-docs-mcp",
      cwd: "D:\\workspace\\rag-demo",
      envJson: '{\n  "HTTP_PROXY": "http://127.0.0.1:7890"\n}',
      authType: "none",
      timeoutMs: 30000,
      customHeadersJson: "",
      hasBearerToken: false,
    });
    updateExternalMcpServerConfigMock.mockResolvedValueOnce({
      command: "uvx",
      argsText: '["mcparmory-github"]',
      cwd: "D:\\workspace\\rag-demo",
      envJson: '{\n  "HTTP_PROXY": "http://127.0.0.1:7890"\n}',
      authType: "none",
      timeoutMs: 30000,
      customHeadersJson: "",
      hasBearerToken: false,
    });

    modalShowMock.mockImplementation((options: { content: JSX.Element }) => {
      render(options.content);
      return "modal_1";
    });

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: "app.connectors.views.installed",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Local Docs", exact: true }));

    await user.click(
      screen.getByRole("button", {
        name: "settings.mcp.installed.configure",
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Command")).toBeInTheDocument();
      expect(screen.getByLabelText("Args JSON")).toBeInTheDocument();
      expect(screen.getByLabelText("Working Directory")).toBeInTheDocument();
      expect(screen.getByLabelText("Env JSON")).toBeInTheDocument();
      expect(screen.queryByLabelText("Endpoint URL")).not.toBeInTheDocument();
      expect(screen.getByText("@demo/local-docs-mcp")).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText("Command"));
    await user.type(screen.getByLabelText("Command"), "uvx");
    await user.clear(screen.getByLabelText("Args JSON"));
    fireEvent.change(screen.getByLabelText("Args JSON"), {
      target: {
        value: '["mcparmory-github"]',
      },
    });
    fireEvent.change(screen.getByLabelText("Working Directory"), {
      target: {
        value: "D:\\workspace\\rag-demo",
      },
    });
    fireEvent.change(screen.getByLabelText("Env JSON"), {
      target: {
        value: '{\n  "HTTP_PROXY": "http://127.0.0.1:7890"\n}',
      },
    });

    await user.click(screen.getByRole("button", { name: "settings.mcp.config.save" }));

    await waitFor(() => {
      expect(updateExternalMcpServerConfigMock).toHaveBeenCalledWith("local-docs", {
        command: "uvx",
        argsText: '["mcparmory-github"]',
        cwd: "D:\\workspace\\rag-demo",
        envJson: '{\n  "HTTP_PROXY": "http://127.0.0.1:7890"\n}',
        authType: "none",
        timeoutMs: 30000,
        customHeadersJson: "",
        bearerToken: null,
      });
    });
  });

  it("shows unsupported package transports without allowing install", async () => {
    getMcpMarketplaceServersMock.mockResolvedValueOnce({
      servers: [
        {
          id: "oci-only",
          name: "oci-only",
          title: "OCI Only",
          description: "Container image MCP",
          version: "1.0.0",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: null,
          repositoryUrl: null,
          transports: [
            {
              kind: "package",
              packageType: "oci",
              installable: false,
              label: "OCI image",
              packageIdentifier: "ghcr.io/example/oci-only:1.0.0",
            },
          ],
        },
      ],
      metadata: {
        count: 1,
        nextCursor: null,
        sourceUrl: "https://registry.modelcontextprotocol.io/v0/servers",
        cache: {
          hit: false,
          stale: false,
          cachedAt: null,
        },
      },
    });

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "OCI Only", exact: true }));
    expect(
      screen.getByRole("button", {
        name: "settings.mcp.marketplace.unsupported",
      }),
    ).toBeDisabled();
    expect(createExternalMcpServerMock).not.toHaveBeenCalled();
  });

  it("shows a cached marketplace hint when stale cached results are returned", async () => {
    getMcpMarketplaceServersMock.mockResolvedValueOnce({
      servers: [
        {
          id: "remote-docs",
          name: "remote-docs",
          title: "Remote Docs",
          description: "Third-party docs MCP",
          version: "1.0.0",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: "https://docs.example.dev/mcp",
          repositoryUrl: "https://github.com/example/remote-docs",
          transports: [
            {
              kind: "streamable-http",
              packageType: "remote",
              installable: true,
              label: "Remote HTTP",
              url: "https://remote.example/mcp",
            },
          ],
        },
      ],
      metadata: {
        count: 1,
        nextCursor: null,
        sourceUrl: "https://registry.modelcontextprotocol.io/v0/servers",
        cache: {
          hit: true,
          stale: true,
          cachedAt: "2026-06-27T01:05:00.000Z",
        },
      },
    });

    renderPage();

    expect(
      await screen.findByText(/app.connectors.cachedMarket/i),
    ).toBeInTheDocument();
  });

  it("deduplicates marketplace servers with the same id before rendering", async () => {
    getMcpMarketplaceServersMock.mockResolvedValueOnce({
      servers: [
        {
          id: "ac.tandem/docs-mcp",
          name: "docs-mcp",
          title: "Docs MCP",
          description: "First entry",
          version: "1.0.0",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: null,
          repositoryUrl: null,
          transports: [
            {
              kind: "streamable-http",
              packageType: "remote",
              installable: true,
              label: "Remote HTTP",
              url: "https://example.com/mcp",
            },
          ],
        },
        {
          id: "ac.tandem/docs-mcp",
          name: "docs-mcp",
          title: "Docs MCP Duplicate",
          description: "Duplicate entry",
          version: "1.0.1",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: null,
          repositoryUrl: null,
          transports: [
            {
              kind: "streamable-http",
              packageType: "remote",
              installable: true,
              label: "Remote HTTP",
              url: "https://example.com/mcp-2",
            },
          ],
        },
      ],
      metadata: {
        count: 2,
        nextCursor: null,
        sourceUrl: "https://registry.modelcontextprotocol.io/v0/servers",
        cache: {
          hit: false,
          stale: false,
          cachedAt: null,
        },
      },
    });

    renderPage();

    await screen.findByText("Docs MCP");
    expect(screen.queryByText("Docs MCP Duplicate")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Docs MCP", exact: true })).toHaveLength(1);
  });

  it("opens marketplace details with registry metadata and links", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: "Remote Docs", exact: true,
      }),
    );

    expect(
      await screen.findByText("settings.mcp.marketplace.detailsDrawer.identity"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "settings.mcp.marketplace.detailsDrawer.website",
      }),
    ).toHaveAttribute("href", "https://docs.example.dev/mcp");
    expect(
      screen.getByRole("link", {
        name: "settings.mcp.marketplace.detailsDrawer.repository",
      }),
    ).toHaveAttribute("href", "https://github.com/example/remote-docs");
    expect(screen.getByText("https://remote.example/mcp")).toBeInTheDocument();
  });

  it("filters marketplace results by installability and transport", async () => {
    const user = userEvent.setup();
    getMcpMarketplaceServersMock.mockResolvedValueOnce({
      servers: [
        {
          id: "remote-server",
          name: "remote-server",
          title: "Remote Server",
          description: "Remote MCP",
          version: "1.0.0",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: null,
          repositoryUrl: null,
          transports: [
            {
              kind: "streamable-http",
              packageType: "remote",
              installable: true,
              label: "Remote HTTP",
              url: "https://remote.example/mcp",
            },
          ],
        },
        {
          id: "local-server",
          name: "local-server",
          title: "Local Server",
          description: "Local npm MCP",
          version: "1.0.0",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: null,
          repositoryUrl: null,
          transports: [
            {
              kind: "stdio",
              packageType: "npm",
              installable: true,
              label: "npm package",
              command: "npx",
              args: ["-y", "local-server"],
              packageIdentifier: "local-server",
            },
          ],
        },
        {
          id: "oci-server",
          name: "oci-server",
          title: "OCI Server",
          description: "OCI MCP",
          version: "1.0.0",
          status: "active",
          isLatest: true,
          publishedAt: null,
          updatedAt: null,
          websiteUrl: null,
          repositoryUrl: null,
          transports: [
            {
              kind: "package",
              packageType: "oci",
              installable: false,
              label: "OCI image",
              packageIdentifier: "ghcr.io/example/oci-server:1.0.0",
            },
          ],
        },
      ],
      metadata: {
        count: 3,
        nextCursor: null,
        sourceUrl: "https://registry.modelcontextprotocol.io/v0.1/servers",
        cache: {
          hit: false,
          stale: false,
          cachedAt: null,
        },
      },
    });

    renderPage();
    await screen.findByText("Remote Server");

    await user.click(screen.getByRole("button", { name: "app.connectors.filterMenu" }));
    await user.hover(screen.getByRole("menuitem", { name: "settings.mcp.marketplace.filterLabel" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "settings.mcp.marketplace.filters.local" }));
    await waitFor(() =>
      expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ transport: "local" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "app.connectors.filterMenu" }));
    await user.hover(screen.getByRole("menuitem", { name: "settings.mcp.marketplace.filterLabel" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "settings.mcp.marketplace.filters.installable" }));
    await waitFor(() =>
      expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ installable: true }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "app.connectors.filterMenu" }));
    await user.hover(screen.getByRole("menuitem", { name: "settings.mcp.marketplace.categoryLabel" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "settings.mcp.marketplace.categories.searchKnowledge" }));
    await waitFor(() =>
      expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "search-knowledge" }),
      ),
    );
  });

  it.each(["/extensions/connectors?tab=marketplace", "/extensions/connectors?view=external"])("opens the external view from %s", async (route) => {
    renderPage(route);
    expect(screen.getByRole("button", { name: "app.connectors.views.external" })).toHaveAttribute("aria-pressed", "true");
    await screen.findByRole("button", { name: "Remote Docs", exact: true });
  });

  it("does not fetch the market in internal or installed views", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValue([{ ...installedServer, id: "delisted", enabled: false, status: "failed" }]);
    renderPage("/extensions/connectors?view=builtin");
    await waitFor(() => expect(screen.getByRole("button", { name: "settings.mcp.installed.refresh" })).toBeEnabled());
    expect(getMcpMarketplaceServersMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "app.connectors.views.installed" }));
    expect(screen.getByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
    expect(getMcpMarketplaceServersMock).not.toHaveBeenCalled();
    expect(screen.getByText("app.connectors.disabled")).toBeInTheDocument();
    expect(screen.getByText("settings.mcp.installed.failed")).toBeInTheDocument();
  });

  it("only submits search on Enter, retains it across views and supports clearing", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValue([{ ...installedServer, id: "other-installed" }]);
    renderPage();
    await screen.findByRole("button", { name: "Remote Docs", exact: true });
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    const search = screen.getByRole("textbox", { name: "app.connectors.search" });
    const requests = getMcpMarketplaceServersMock.mock.calls.length;
    await user.type(search, "nonexistent");
    expect(getMcpMarketplaceServersMock).toHaveBeenCalledTimes(requests);
    expect(screen.getByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
    getMcpMarketplaceServersMock.mockResolvedValue({ servers: [], metadata: { nextCursor: null, sourceUrl: "https://registry.test" } });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: "nonexistent" })));
    expect(screen.queryByRole("button", { name: "Remote Docs", exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "app.connectors.views.installed" }));
    expect(search).toHaveValue("nonexistent");
    await user.click(screen.getByRole("button", { name: "app.connectors.views.external" }));
    getMcpMarketplaceServersMock.mockResolvedValue({ servers: [
      { id: "remote-docs", name: "remote-docs", title: "Remote Docs", description: "Third-party docs MCP", category: "data", transports: [{ kind: "streamable-http", packageType: "remote", installable: true, label: "Remote", url: "https://remote.example/mcp" }] },
    ], metadata: { nextCursor: null, sourceUrl: "https://registry.test" } });
    await user.click(screen.getByRole("button", { name: "app.connectors.clearSearch" }));
    await waitFor(() => expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: "" })));
    expect(await screen.findByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
  });

  it("suspends external-only filters in internal and installed, then restores them", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValue([{ ...installedServer, id: "delisted" }]);
    renderPage();
    await screen.findByRole("button", { name: "Remote Docs", exact: true });
    await user.click(screen.getByRole("button", { name: "app.connectors.filterMenu" }));
    await user.hover(screen.getByRole("menuitem", { name: "settings.mcp.marketplace.categoryLabel" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "settings.mcp.marketplace.categories.data" }));
    await waitFor(() => expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(expect.objectContaining({ category: "data" })));
    expect(screen.queryByText("app.connectors.installed · MCP")).not.toBeInTheDocument();
    const marketplaceRequestsBeforeLeaving = getMcpMarketplaceServersMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "app.connectors.views.internal" }));
    expect(screen.queryByRole("button", { name: "app.connectors.filterMenu" })).not.toBeInTheDocument();
    expect(getMcpMarketplaceServersMock).toHaveBeenCalledTimes(marketplaceRequestsBeforeLeaving);
    await user.click(screen.getByRole("button", { name: "app.connectors.views.installed" }));
    expect(screen.getByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "app.connectors.views.external" }));
    await waitFor(() => expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(expect.objectContaining({ category: "data" })));
  });

  it("does not report an installed record as an uninstalled market result when the market fails", async () => {
    getExternalMcpServersMock.mockResolvedValue([{ ...installedServer, id: "delisted" }]);
    getMcpMarketplaceServersMock.mockRejectedValue(new Error("market unavailable"));
    renderPage();
    await screen.findByText("market unavailable");
    expect(screen.queryByRole("button", { name: "Remote Docs", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("app.connectors.noMatches")).not.toBeInTheDocument();
  });

  it("retains pagination results and cursor on a failed page, then deduplicates on retry", async () => {
    const user = userEvent.setup();
    const first = await getMcpMarketplaceServersMock();
    getMcpMarketplaceServersMock.mockClear();
    getMcpMarketplaceServersMock.mockResolvedValueOnce({ ...first, metadata: { ...first.metadata, nextCursor: "page-2" } })
      .mockRejectedValueOnce(new Error("page unavailable"))
      .mockResolvedValue({ servers: [first.servers[0], { ...first.servers[0], id: "next", title: "Next service" }], metadata: { nextCursor: null, sourceUrl: first.metadata.sourceUrl } });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "settings.mcp.marketplace.loadMore" }));
    await screen.findByText("page unavailable");
    expect(screen.getByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "settings.mcp.marketplace.loadMore" }));
    await screen.findByRole("button", { name: "Next service", exact: true });
    expect(screen.getAllByRole("button", { name: "Remote Docs", exact: true })).toHaveLength(1);
    expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "page-2" }));
  });

  it("restores a market details card after deleting an installed service", async () => {
    const user = userEvent.setup();
    getExternalMcpServersMock.mockResolvedValueOnce([installedServer]).mockResolvedValue([]);
    deleteExternalMcpServerMock.mockResolvedValue({ id: "remote-docs" });
    renderPage("/extensions/connectors");
    await user.click(await screen.findByRole("button", { name: "Remote Docs", exact: true }));
    await user.click(screen.getByRole("button", { name: "settings.mcp.installed.remove" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remote Docs" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "app.connectors.views.external" }));
    await user.click(screen.getByRole("button", { name: "Remote Docs", exact: true }));
    expect(await screen.findByRole("button", { name: "settings.mcp.marketplace.install" })).toBeEnabled();
  });

  it("offers the next page before claiming an empty catalog when the current page is empty", async () => {
    getMcpMarketplaceServersMock.mockResolvedValue({ servers: [], metadata: { nextCursor: "next", sourceUrl: "https://registry.test" } });
    renderPage();
    expect(await screen.findByRole("button", { name: "settings.mcp.marketplace.loadMore" })).toBeInTheDocument();
    expect(screen.queryByText("app.connectors.noMatches")).not.toBeInTheDocument();
  });
  it("blocks duplicate search submissions while the same submitted query is loading", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Remote Docs", exact: true });
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    let resolveSearch!: (value: unknown) => void;
    getMcpMarketplaceServersMock.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve; }));
    const before = getMcpMarketplaceServersMock.mock.calls.length;
    await user.type(screen.getByRole("textbox", { name: "app.connectors.search" }), "docs{Enter}{Enter}{Enter}");
    expect(getMcpMarketplaceServersMock).toHaveBeenCalledTimes(before + 1);
    resolveSearch({ servers: [], metadata: { nextCursor: null, sourceUrl: "https://registry.test" } });
    await screen.findByText("app.connectors.noMatches");
  });

  it("does not let a delayed refresh replace a newer submitted search", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Remote Docs", exact: true });
    let finishSync!: (value: unknown) => void;
    requestMcpMarketplaceSyncMock.mockImplementation(() => new Promise((resolve) => { finishSync = resolve; }));
    await user.click(screen.getByRole("button", { name: "settings.mcp.installed.refresh" }));
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    await user.type(screen.getByRole("textbox", { name: "app.connectors.search" }), "new query{Enter}");
    await waitFor(() => expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: "new query" })));
    const calls = getMcpMarketplaceServersMock.mock.calls.length;
    finishSync({ started: true, status: { status: "idle", lastSuccessfulSyncAt: null } });
    await waitFor(() => expect(screen.getByRole("button", { name: "settings.mcp.installed.refresh" })).toBeEnabled());
    expect(getMcpMarketplaceServersMock).toHaveBeenCalledTimes(calls);
  });

  it.each(["success", "failure"])("ignores an obsolete sync poll %s after a new search", async (outcome) => {
    const user = userEvent.setup();
    const first = await getMcpMarketplaceServersMock();
    getMcpMarketplaceServersMock.mockClear();
    getMcpMarketplaceServersMock.mockResolvedValue({ ...first, metadata: { ...first.metadata, sync: { status: "syncing" } } });
    let finishStatus!: (value: unknown) => void;
    let rejectStatus!: (error: Error) => void;
    getMcpMarketplaceSyncStatusMock.mockImplementation(() => new Promise((resolve, reject) => { finishStatus = resolve; rejectStatus = reject; }));
    renderPage();
    await waitFor(() => expect(getMcpMarketplaceSyncStatusMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "app.connectors.search", exact: true }));
    await user.type(screen.getByRole("textbox", { name: "app.connectors.search" }), "new query{Enter}");
    await waitFor(() => expect(getMcpMarketplaceServersMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: "new query" })));
    const calls = getMcpMarketplaceServersMock.mock.calls.length;
    await act(async () => {
      if (outcome === "success") finishStatus({ status: "idle", lastSuccessfulSyncAt: null });
      else rejectStatus(new Error("obsolete poll error"));
    });
    expect(screen.queryByText("obsolete poll error")).not.toBeInTheDocument();
    expect(getMcpMarketplaceServersMock).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "Remote Docs", exact: true })).toBeInTheDocument();
  });

});
