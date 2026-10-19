import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import Alert from "@/shared/ui/Alert";
import { message } from "@/shared/ui/Message";
import { Modal } from "@/shared/ui/Modal";
import IconButton from "@/shared/ui/IconButton";
import { Button } from "@/shared/ui/Button";
import { TextInput } from "@/shared/ui/Input";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import { useSearchParams } from "react-router-dom";
import {
  connectExternalMcpServer,
  createExternalMcpServer,
  deleteExternalMcpServer,
  discoverExternalMcpServer,
  getExternalMcpServerConfig,
  getExternalMcpServerConfigSchema,
  getExternalMcpServers,
  getMcpMarketplaceServers,
  getMcpMarketplaceSyncStatus,
  requestMcpMarketplaceSync,
  updateExternalMcpServerConfig,
  updateExternalMcpAccess,
  type ExternalMcpConfigSchemaResolution,
  type ExternalMcpServerConfigRecord,
  type ExternalMcpServerRecord,
  type McpMarketplaceServer,
  type McpMarketplaceSyncStatus,
} from "@/shared/api/tools";
import McpConfigModalContent from "./components/McpConfigModalContent";
import McpGuideDrawer from "./components/McpGuideDrawer";
import McpManagementDrawer from "./components/McpManagementDrawer";
import ConnectorCatalog from "./components/ConnectorCatalog";
import ConnectorMarketDetails from "./components/ConnectorMarketDetails";
import ConnectorFilters from "./components/ConnectorFilters";
import MarketplaceStatus from "./components/MarketplaceStatus";
import CustomMcpConfigModalContent from "./components/CustomMcpConfigModalContent";
import CustomDraftCatalog from "./components/CustomDraftCatalog";
import { buildExternalCatalog, resolveConnectorView, type ConnectorView, type MarketplaceFilter } from "./catalog";
import { removeCustomMcpDraft, upsertCustomMcpDrafts, type CustomMcpDraft, type CustomMcpMode } from "./customDrafts";

type InstallTransportChoice =
  | {
      kind: "streamable-http";
      url: string;
    }
  | {
      kind: "stdio";
      command: string;
      args?: string[];
    };

const isInstallableTransport = (
  transport: McpMarketplaceServer["transports"][number],
): transport is Extract<McpMarketplaceServer["transports"][number], { installable: true }> =>
  transport.installable;

const getMarketplaceTransportDetail = (
  transport: McpMarketplaceServer["transports"][number],
) => {
  if (transport.kind === "streamable-http") {
    return transport.url;
  }

  if (transport.kind === "stdio") {
    return `${transport.command}${transport.args?.length ? ` ${transport.args.join(" ")}` : ""}`;
  }

  return transport.packageIdentifier;
};

const dedupeMarketplaceServers = (servers: McpMarketplaceServer[]) => {
  const seen = new Set<string>();
  const deduped: McpMarketplaceServer[] = [];

  for (const server of servers) {
    if (seen.has(server.id)) {
      continue;
    }
    seen.add(server.id);
    deduped.push(server);
  }

  return deduped;
};

const toFriendlyMcpActionError = (error: unknown, action: "connect" | "discover") => {
  const fallback =
    action === "connect"
      ? "连接 MCP Server 失败"
      : "读取 MCP Server 能力失败";

  const raw = error instanceof Error ? error.message : "";
  if (!raw) {
    return fallback;
  }

  if (raw.includes("找不到 npx")) {
    return "连接失败：当前系统环境里找不到 npx。请确认 Node.js / npm 已正确安装，或把启动命令改成可执行的完整命令。";
  }

  if (raw.includes("找不到 uvx")) {
    return "连接失败：当前系统环境里找不到 uvx。请确认 uv 已安装，或把启动命令改成可执行的完整命令。";
  }

  if (raw.includes("Official MCP marketplace timed out")) {
    return "MCP 市场暂时超时，请稍后重试。";
  }

  if (raw.includes("timed out")) {
    return `连接失败：请求超时。原始错误：${raw}`;
  }

  if (raw.includes("MCP stdio response did not include result")) {
    return "连接失败：本地 MCP 进程已启动，但没有按预期返回初始化结果。请检查该 MCP 包是否兼容当前协议。";
  }

  if (raw.includes("Failed to parse stdio MCP JSON-RPC")) {
    return "连接失败：本地 MCP 进程输出的 JSON 不合法。请检查该 MCP 包是否真的支持 stdio MCP。";
  }

  if (raw.includes("External stdio MCP response")) {
    return "连接失败：本地 MCP 进程输出格式不符合 stdio MCP 协议。";
  }

  return raw.includes("连接失败") ? raw : `${fallback}：${raw}`;
};

export default function ConnectorsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = resolveConnectorView(searchParams);
  const showsMarketplace = view === "external";
  const [customDrafts, setCustomDrafts] = useState<CustomMcpDraft[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedMarketServer, setSelectedMarketServer] = useState<McpMarketplaceServer | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const setView = (value: ConnectorView) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("tab");
      next.set("view", value);
      return next;
    });
  };
  const [marketplaceServers, setMarketplaceServers] = useState<McpMarketplaceServer[]>([]);
  const [installedServers, setInstalledServers] = useState<ExternalMcpServerRecord[]>([]);
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [committedMarketplaceQuery, setCommittedMarketplaceQuery] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] =
    useState<MarketplaceFilter>("all");
  const [marketplaceCategory, setMarketplaceCategory] = useState("all");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [marketplaceCacheInfo, setMarketplaceCacheInfo] = useState<{
    hit: boolean;
    stale: boolean;
    cachedAt: string | null;
  } | null>(null);
  const [isMarketplaceLoading, setIsMarketplaceLoading] = useState(false);
  const [isMarketplaceRefreshing, setIsMarketplaceRefreshing] = useState(false);
  const marketplaceRefreshInFlightRef = useRef(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceSyncStatus, setMarketplaceSyncStatus] =
    useState<McpMarketplaceSyncStatus | null>(null);
  const [marketplaceSearchPending, setMarketplaceSearchPending] = useState(false);
  const [isInstalledLoading, setIsInstalledLoading] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [hasInstalledSnapshot, setHasInstalledSnapshot] = useState(false);
  const [pendingInstallId, setPendingInstallId] = useState<string | null>(null);
  const installInFlightRef = useRef(false);
  const installedRequestSerialRef = useRef(0);
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const marketplaceRequestControllerRef = useRef<AbortController | null>(null);
  const marketplaceRequestSerialRef = useRef(0);
  const renderedMarketplaceScopeRef = useRef<string | null>(null);

  const effectiveCategory = view === "external" ? marketplaceCategory : "all";
  const effectiveFilter = view === "external" ? marketplaceFilter : "all";
  const marketplaceScope = JSON.stringify([committedMarketplaceQuery, effectiveCategory, effectiveFilter]);

  const activeMarketplaceScopeRef = useRef<string | null>(null);
  activeMarketplaceScopeRef.current = showsMarketplace ? marketplaceScope : null;

  const loadServers = useCallback(
    async (options?: {
      append?: boolean;
      cursor?: string | null;
      query?: string;
      silent?: boolean;
    }) => {
      const requestId = ++marketplaceRequestSerialRef.current;

      marketplaceRequestControllerRef.current?.abort();
      const controller = new AbortController();
      marketplaceRequestControllerRef.current = controller;

      if (!options?.silent) {
        setIsMarketplaceLoading(true);
      }
      setMarketplaceError(null);
      const scope = JSON.stringify([options?.query ?? "", effectiveCategory, effectiveFilter]);
      // Retain the displayed query's successful data during refresh. A new
      // query/filter clears it so results from a different scope are not shown.
      if (!options?.append && scope !== renderedMarketplaceScopeRef.current) {
        setMarketplaceServers([]);
        setNextCursor(null);
        setMarketplaceCacheInfo(null);
      }

      try {
        const result = await getMcpMarketplaceServers({
          limit: 24,
          cursor: options?.cursor ?? undefined,
          query: options?.query ?? "",
          category: effectiveCategory === "all" ? undefined : effectiveCategory,
          transport:
            effectiveFilter === "remote" || effectiveFilter === "local"
              ? effectiveFilter
              : undefined,
          installable: effectiveFilter === "installable" ? true : undefined,
          signal: controller.signal,
        });

        if (requestId !== marketplaceRequestSerialRef.current) {
          return;
        }

        renderedMarketplaceScopeRef.current = scope;
        setMarketplaceServers((current) =>
          dedupeMarketplaceServers(options?.append ? [...current, ...result.servers] : result.servers),
        );
        setNextCursor(result.metadata.nextCursor);
        setSourceUrl(result.metadata.sourceUrl);
        setMarketplaceCacheInfo(result.metadata.cache);
        if (result.metadata.sync) {
          setMarketplaceSyncStatus(result.metadata.sync);
        }
        setMarketplaceSearchPending(Boolean(result.metadata.searchPending));
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        if (requestId !== marketplaceRequestSerialRef.current) {
          return;
        }

        setMarketplaceError(
          loadError instanceof Error
            ? loadError.message
            : t("settings.mcp.messages.marketplaceLoadFailed"),
        );
      } finally {
        if (requestId === marketplaceRequestSerialRef.current) {
          setIsMarketplaceLoading(false);
        }
      }
    },
    [effectiveCategory, effectiveFilter, t],
  );

  const loadInstalledServers = useCallback(async () => {
    const requestId = ++installedRequestSerialRef.current;
    setIsInstalledLoading(true);
    setInstalledError(null);
    try {
      const result = await getExternalMcpServers();
      if (requestId !== installedRequestSerialRef.current) return;
      setInstalledServers(result);
      setHasInstalledSnapshot(true);
      setSelectedServerId((id) => result.some((server) => server.id === id) ? id : null);
    } catch (loadError) {
      if (requestId !== installedRequestSerialRef.current) return;
      setInstalledError(
        loadError instanceof Error ? loadError.message : t("settings.mcp.messages.installedLoadFailed"),
      );
    } finally {
      if (requestId === installedRequestSerialRef.current) setIsInstalledLoading(false);
    }
  }, [t]);

  const applyInstall = useCallback(
    async (server: McpMarketplaceServer, transport: InstallTransportChoice) => {
      const matchedStdioTransport =
        transport.kind === "stdio"
          ? server.transports.find(
              (item) =>
                item.kind === "stdio" &&
                item.command === transport.command &&
                JSON.stringify(item.args ?? []) === JSON.stringify(transport.args ?? []),
            )
          : undefined;

      const installed = await createExternalMcpServer({
        id: server.id,
        registryUrl: sourceUrl ?? undefined,
        packageName:
          matchedStdioTransport && matchedStdioTransport.kind === "stdio"
            ? matchedStdioTransport.args?.at(-1)
            : undefined,
        documentationUrl: server.websiteUrl ?? undefined,
        repositoryUrl: server.repositoryUrl ?? undefined,
        displayName: server.title,
        description: server.description,
        version: server.version ?? undefined,
        transport,
        disclaimerAccepted: true,
      });
      message.success(t("settings.mcp.messages.installSucceeded"));
      setInstalledServers((current) => [...current.filter((item) => item.id !== installed.id), installed]);
      setSelectedMarketServer(null);
      setSelectedServerId(installed.id);
      setView("installed");
      await loadInstalledServers();
    },
    [loadInstalledServers, setView, sourceUrl, t],
  );

  useEffect(() => {
    if (!showsMarketplace) return;
    void loadServers({ query: committedMarketplaceQuery });

    return () => {
      marketplaceRequestControllerRef.current?.abort();
    };
  }, [loadServers, committedMarketplaceQuery, showsMarketplace]);

  useEffect(() => { void loadInstalledServers(); }, [loadInstalledServers]);
  const selectedServer = installedServers.find((server) => server.id === selectedServerId) ?? null;
  const installedServerIds = new Set(installedServers.map((server) => server.id));
  const openManagement = (id: string) => {
    setSelectedMarketServer(null);
    setSelectedServerId(id);
  };

  useEffect(() => {
    if (!showsMarketplace || marketplaceSyncStatus?.status !== "syncing") return;
    let active = true;
    const scope = marketplaceScope;
    const timer = window.setInterval(() => {
      void getMcpMarketplaceSyncStatus()
        .then((status) => {
          if (!active || activeMarketplaceScopeRef.current !== scope) return;
          setMarketplaceSyncStatus(status);
          void loadServers({
            query: committedMarketplaceQuery,
            cursor: null,
            append: false,
            silent: true,
          });
        })
        .catch((error) => {
          if (!active || activeMarketplaceScopeRef.current !== scope) return;
          setMarketplaceError(
            error instanceof Error
              ? error.message
              : t("settings.mcp.messages.marketplaceLoadFailed"),
          );
        });
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [committedMarketplaceQuery, loadServers, marketplaceSyncStatus?.status, marketplaceScope, showsMarketplace, t]);

  useEffect(() => {
    if (!showsMarketplace || !marketplaceSearchPending) return;
    const timer = window.setTimeout(() => {
      void loadServers({
        query: committedMarketplaceQuery,
        cursor: null,
        append: false,
        silent: true,
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [committedMarketplaceQuery, loadServers, marketplaceSearchPending, showsMarketplace]);

  const refreshMarketplace = async () => {
    if (marketplaceRefreshInFlightRef.current) return;
    marketplaceRefreshInFlightRef.current = true;
    setIsMarketplaceRefreshing(true);
    const refreshScope = marketplaceScope;
    try {
      const result = await requestMcpMarketplaceSync();
      setMarketplaceSyncStatus(result.status);
      // Sync can finish after navigation or a new search. Only refresh the
      // list when the originating query and filters are still active.
      if (activeMarketplaceScopeRef.current === refreshScope) {
        await loadServers({ query: committedMarketplaceQuery, silent: true });
      }
    } catch (error) {
      if (activeMarketplaceScopeRef.current === refreshScope) {
        setMarketplaceError(error instanceof Error ? error.message : t("settings.mcp.messages.marketplaceLoadFailed"));
      }
    } finally {
      marketplaceRefreshInFlightRef.current = false;
      setIsMarketplaceRefreshing(false);
    }
  };
  const loadMore = () => {
    if (!nextCursor || isMarketplaceLoading) {
      return;
    }

    void loadServers({ query: committedMarketplaceQuery, cursor: nextCursor, append: true });
  };

  const submitMarketplaceSearch = useCallback(() => {
    const normalizedQuery = marketplaceQuery.trim();
    if (normalizedQuery === committedMarketplaceQuery) {
      if (showsMarketplace && !isMarketplaceLoading) void loadServers({ query: normalizedQuery, cursor: null, append: false });
      return;
    }
    setCommittedMarketplaceQuery(normalizedQuery);
  }, [committedMarketplaceQuery, isMarketplaceLoading, loadServers, marketplaceQuery, showsMarketplace]);

  const installServer = (server: McpMarketplaceServer) => {
    if (installedServerIds.has(server.id)) { openManagement(server.id); return; }
    if (!hasInstalledSnapshot || installedError || isInstalledLoading || installInFlightRef.current) return;
    const transports = server.transports;
    const installableTransports = transports.filter(isInstallableTransport);
    if (transports.length === 0 || installableTransports.length === 0) {
      message.error(t("settings.mcp.messages.installUnsupported"));
      return;
    }

    const closeInstallPicker = (key: string) => {
      Modal.close(key);
    };

    const runInstall = async (transport: InstallTransportChoice) => {
      if (installInFlightRef.current) return;
      installInFlightRef.current = true;
      setPendingInstallId(server.id);
      try {
        await applyInstall(server, transport);
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("app.connectors.installFailed"));
      } finally {
        installInFlightRef.current = false;
        setPendingInstallId(null);
      }
    };

    if (installableTransports.length === 1) {
      const [transport] = installableTransports;
      void runInstall(
        transport.kind === "streamable-http"
          ? {
              kind: "streamable-http",
              url: transport.url,
            }
          : {
              kind: "stdio",
              command: transport.command ?? "",
              args: transport.args ?? [],
            },
      );
      return;
    }

    const modalKey = Modal.show({
      title: t("settings.mcp.installDialog.title"),
      width: 640,
      footer: null,
      content: (
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-medium text-text-primary">{server.title}</div>
              {server.version ? (
                <span className="rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[11px] text-text-tertiary">
                  v{server.version}
                </span>
              ) : null}
            </div>
            <div className="text-sm leading-6 text-text-secondary">
              {t("settings.mcp.installDialog.description", {
                name: server.title,
              })}
            </div>
            {server.description ? (
              <div className="rounded-ui-control border border-border bg-surface-secondary px-3 py-2 text-sm leading-6 text-text-secondary">
                {server.description}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            {transports.map((transport) => (
              <button
                key={`${server.id}-${transport.kind}-${getMarketplaceTransportDetail(transport)}`}
                type="button"
                className={`w-full rounded-ui-control border px-4 py-4 text-left transition-colors ${
                  transport.installable
                    ? "border-border bg-surface-primary hover:bg-surface-secondary"
                    : "border-border/70 bg-surface-secondary/40 opacity-80"
                }`}
                onClick={() => {
                  if (!transport.installable) {
                    return;
                  }
                  closeInstallPicker(modalKey);
                  void runInstall(
                    transport.kind === "streamable-http"
                      ? {
                          kind: "streamable-http",
                          url: transport.url,
                        }
                      : {
                          kind: "stdio",
                          command: transport.command ?? "",
                          args: transport.args ?? [],
                        },
                  );
                }}
                disabled={!transport.installable}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">
                        {transport.label}
                      </span>
                      <span className="rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[11px] text-text-tertiary">
                        {transport.packageType}
                      </span>
                    </div>
                    <div className="mt-2 break-all font-mono text-xs text-text-tertiary">
                      {getMarketplaceTransportDetail(transport)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-text-tertiary">
                    {transport.installable ? t("settings.mcp.marketplace.install") : "暂不支持安装"}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {server.websiteUrl || server.repositoryUrl ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
              {server.websiteUrl ? (
                <a
                  href={server.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-secondary underline underline-offset-4 hover:text-text-primary"
                >
                  Docs
                </a>
              ) : null}
              {server.repositoryUrl ? (
                <a
                  href={server.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-secondary underline underline-offset-4 hover:text-text-primary"
                >
                  GitHub
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    });
  };

  const runServerAction = async (
    serverId: string,
    action: "connect" | "discover",
  ) => {
    setPendingServerId(serverId);
    try {
      if (action === "connect") {
        await connectExternalMcpServer(serverId);
        message.success(t("settings.mcp.messages.connectSucceeded"));
      } else {
        await discoverExternalMcpServer(serverId);
        message.success(t("settings.mcp.messages.discoverSucceeded"));
      }
      await loadInstalledServers();
    } catch (actionError) {
      message.error(toFriendlyMcpActionError(actionError, action));
    } finally {
      setPendingServerId(null);
    }
  };

  const toggleAgentAccess = async (server: ExternalMcpServerRecord, agentEnabled: boolean) => {
    setPendingServerId(server.id);
    try {
      await updateExternalMcpAccess(server.id, agentEnabled);
      await loadInstalledServers();
      message.success(agentEnabled ? t("app.connectors.agentAllowed") : t("app.connectors.agentNotAllowed"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新 Agent Access 失败");
    } finally {
      setPendingServerId(null);
    }
  };

  const removeServer = (server: ExternalMcpServerRecord) => {
    Modal.confirm({
      title: t("settings.mcp.deleteDialog.title"),
      description: t("settings.mcp.deleteDialog.description", {
        name: server.displayName,
      }),
      confirmText: t("settings.mcp.deleteDialog.confirm"),
      tone: "danger",
      onConfirm: async () => {
        try {
          await deleteExternalMcpServer(server.id);
          setInstalledServers((current) => current.filter((item) => item.id !== server.id));
          setSelectedServerId((current) => current === server.id ? null : current);
          message.success(t("settings.mcp.messages.deleteSucceeded"));
          await loadInstalledServers();
        } catch (error) {
          message.error(error instanceof Error ? error.message : t("app.connectors.deleteFailed"));
          throw error;
        }
      },
    });
  };

  const openConfig = async (server: ExternalMcpServerRecord) => {
    let modalKey = "";

    const ConfigModalBody = () => {
      const [schema, setSchema] = useState<ExternalMcpConfigSchemaResolution | null>(null);
      const [config, setConfig] = useState<ExternalMcpServerConfigRecord | null>(null);
      const [isLoading, setIsLoading] = useState(true);
      const [isSubmitting, setIsSubmitting] = useState(false);
      const [error, setError] = useState<string | null>(null);

      useEffect(() => {
        let cancelled = false;

        const load = async () => {
          setIsLoading(true);
          setError(null);
          try {
            const [nextSchema, nextConfig] = await Promise.all([
              getExternalMcpServerConfigSchema(server.id),
              getExternalMcpServerConfig(server.id),
            ]);
            if (cancelled) {
              return;
            }
            setSchema(nextSchema);
            setConfig(nextConfig);
          } catch (loadError) {
            if (cancelled) {
              return;
            }
            setError(
              loadError instanceof Error
                ? loadError.message
                : t("settings.mcp.messages.configLoadFailed"),
            );
          } finally {
            if (!cancelled) {
              setIsLoading(false);
            }
          }
        };

        void load();

        return () => {
          cancelled = true;
        };
      }, []);

      if (isLoading) {
        return (
          <div className="flex min-h-[220px] items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("settings.mcp.config.loading")}
            </div>
          </div>
        );
      }

      if (!schema || !config) {
        return (
          <div className="rounded-ui-control border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error ?? t("settings.mcp.messages.configLoadFailed")}
          </div>
        );
      }

      return (
        <McpConfigModalContent
          schema={schema}
          config={config}
          isSubmitting={isSubmitting}
          error={error}
          labels={{
            endpointUrl: t("settings.mcp.config.endpointUrl"),
            bearerToken: t("settings.mcp.config.bearerToken"),
            timeoutMs: t("settings.mcp.config.timeoutMs"),
            customHeadersJson: t("settings.mcp.config.customHeadersJson"),
            cwd: t("settings.mcp.config.cwd"),
            envJson: t("settings.mcp.config.envJson"),
            authType: t("settings.mcp.config.authType"),
            authTypeNone: t("settings.mcp.config.authTypeNone"),
            authTypeBearer: t("settings.mcp.config.authTypeBearer"),
            knownPartial: t("settings.mcp.config.knownPartial"),
            notesTitle: t("settings.mcp.config.notesTitle"),
            cancel: t("settings.mcp.config.cancel"),
            save: t("settings.mcp.config.save"),
            saveLoading: t("settings.mcp.config.saveLoading"),
            clearTokenHint: t("settings.mcp.config.clearTokenHint"),
          }}
          onCancel={() => Modal.close(modalKey)}
          onSubmit={async (input) => {
            setIsSubmitting(true);
            setError(null);
            try {
              const updated = await updateExternalMcpServerConfig(server.id, input);
              setConfig(updated);
              message.success(t("settings.mcp.messages.configSaveSucceeded"));
              Modal.close(modalKey);
              await loadInstalledServers();
            } catch (submitError) {
              setError(
                submitError instanceof Error
                  ? submitError.message
                  : t("settings.mcp.messages.configSaveFailed"),
              );
            } finally {
              setIsSubmitting(false);
            }
          }}
        />
      );
    };

    modalKey = Modal.show({
      title: t("settings.mcp.config.title", { name: server.displayName }),
      width: 640,
      height: 720,
      bodyClassName: "h-full",
      content: <ConfigModalBody />,
      footer: null,
    });
  };

  const openCustomDraftDialog = (draft?: CustomMcpDraft) => {
    const editingId = draft?.id;
    let modalKey = "";
    modalKey = Modal.show({
      title: draft
        ? t("app.connectors.custom.editTitle", { name: draft.name })
        : t("app.connectors.custom.title"),
      width: 680,
      maxHeight: "88vh",
      bodyClassName: "overflow-y-auto",
      footer: null,
      content: (
        <CustomMcpConfigModalContent
          draft={draft}
          onCancel={() => Modal.close(modalKey)}
          onSubmit={(mode: CustomMcpMode, servers) => {
            const additions = servers.map(({ name, config }) => ({
              id: `${mode}:${name}`,
              mode,
              name,
              config,
            }));
            setCustomDrafts((current) => {
              const withoutEdited = editingId ? removeCustomMcpDraft(current, editingId) : current;
              return upsertCustomMcpDrafts(withoutEdited, additions);
            });
            Modal.close(modalKey);
          }}
        />
      ),
    });
  };

  // Only merge market data belonging to the active submitted query and filters.
  const hasCurrentMarketplace = renderedMarketplaceScopeRef.current === marketplaceScope;
  const currentMarketplace = hasCurrentMarketplace ? marketplaceServers : [];
  const entries = buildExternalCatalog({
    installed: installedServers,
    marketplace: currentMarketplace,
    view,
    query: committedMarketplaceQuery,
    category: effectiveCategory,
    filter: effectiveFilter,
    installationKnown: hasInstalledSnapshot,
  });
  const activeLoading = ((view === "installed" || showsMarketplace) && isInstalledLoading) ||
    (showsMarketplace && (isMarketplaceLoading || isMarketplaceRefreshing));
  const incomplete = (view === "installed" || showsMarketplace) && (
    Boolean(installedError) || !hasInstalledSnapshot ||
    (showsMarketplace && (Boolean(marketplaceError) || marketplaceSearchPending || Boolean(nextCursor)))
  );
  const handleRefresh = () => {
    void loadInstalledServers();
    if (showsMarketplace) void refreshMarketplace();
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitMarketplaceSearch();
  };
  const clearSearch = () => {
    setMarketplaceQuery("");
    setCommittedMarketplaceQuery("");
  };

  return (
    <AppPageLayout
      miniTitle={t("app.navigation.extensions")}
      title={t("app.navigation.connectors")}
      description={t("app.connectors.description")}
      contentClassName="pt-5"
      scrollBody={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-3">
          <div className="stable-scrollbar min-w-0 basis-full flex-1 overflow-x-auto pb-1 sm:basis-auto">
            <div className="flex gap-1">
              {(["installed", "internal", "external", "custom"] as const).map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={view === value ? "secondary" : "ghost"}
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                  className="shrink-0"
                >
                  {t(`app.connectors.views.${value}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">
            {view === "custom" ? (
              <Button size="xs" onClick={() => openCustomDraftDialog()}>
                {t("app.connectors.custom.add")}
              </Button>
            ) : null}
            {view === "external" ? (
              <ConnectorFilters
                category={marketplaceCategory}
                filter={marketplaceFilter}
                onCategoryChange={setMarketplaceCategory}
                onFilterChange={setMarketplaceFilter}
              />
            ) : null}
            {searchOpen || marketplaceQuery || committedMarketplaceQuery ? (
              <div className="flex w-52 max-w-full items-center gap-1">
                <TextInput
                  autoFocus
                  ariaLabel={t("app.connectors.search")}
                  placeholder={t("app.connectors.searchPlaceholder")}
                  value={marketplaceQuery}
                  onChange={setMarketplaceQuery}
                  onKeyDown={handleSearchKeyDown}
                  compact
                  onBlur={() => {
                    if (!marketplaceQuery && !committedMarketplaceQuery) setSearchOpen(false);
                  }}
                />
                <IconButton ariaLabel={t("app.connectors.clearSearch")} size="sm" onClick={clearSearch}>
                  <X size={15} />
                </IconButton>
              </div>
            ) : (
              <IconButton ariaLabel={t("app.connectors.search")} size="sm" styleType="filled" onClick={() => setSearchOpen(true)}>
                <Search size={17} />
              </IconButton>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={handleRefresh}
              disabled={activeLoading || (showsMarketplace && marketplaceSyncStatus?.status === "syncing")}
            >
              <RefreshCw className={`h-4 w-4 ${activeLoading ? "animate-spin" : ""}`} />
              {t("settings.mcp.installed.refresh")}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setIsGuideOpen(true)}>
              {t("settings.mcp.guide.open")}
            </Button>
          </div>
        </div>
        <div className="stable-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
          {installedError ? (
            <Alert
              variant="warning"
              title={t("app.connectors.installationLoadFailed")}
              action={
                <Button size="xs" variant="outline" disabled={isInstalledLoading} onClick={() => void loadInstalledServers()}>
                  {t("settings.mcp.marketplace.retry")}
                </Button>
              }
            >{installedError}</Alert>
          ) : null}
          {showsMarketplace && marketplaceError ? (
            <Alert
              variant="warning"
              title={t("settings.mcp.messages.marketplaceLoadFailed")}
              action={
                <Button size="xs" variant="outline" disabled={isMarketplaceLoading} onClick={() => void loadServers({ query: committedMarketplaceQuery })}>
                  {t("settings.mcp.marketplace.retry")}
                </Button>
              }
            >{marketplaceError}</Alert>
          ) : null}
          {showsMarketplace ? <MarketplaceStatus status={marketplaceSyncStatus} cache={marketplaceCacheInfo} /> : null}
          {view === "custom" ? (
            customDrafts.length > 0 ? (
              <CustomDraftCatalog
                drafts={customDrafts}
                query={committedMarketplaceQuery}
                onEdit={openCustomDraftDialog}
                onRemove={(id) => setCustomDrafts((current) => removeCustomMcpDraft(current, id))}
              />
            ) : (
              <div className="rounded-ui-panel border border-dashed border-border px-6 py-14 text-center">
                <p className="text-sm font-medium text-text-primary">{t("app.connectors.custom.emptyTitle")}</p>
                <p className="mt-2 text-sm text-text-secondary">{t("app.connectors.custom.emptyDescription")}</p>
              </div>
            )
          ) : (
            <ConnectorCatalog
              entries={entries}
              query={committedMarketplaceQuery}
              view={view}
              onManage={openManagement}
              onDetails={setSelectedMarketServer}
              isLoading={activeLoading}
              incomplete={incomplete}
            />
          )}
          {showsMarketplace && marketplaceSearchPending ? (
            <p role="status" className="text-xs text-text-tertiary">{t("settings.mcp.marketplace.loading")}</p>
          ) : null}
          {showsMarketplace && hasCurrentMarketplace && nextCursor ? (
            <div className="flex justify-center">
              <Button size="sm" variant="outline" disabled={isMarketplaceLoading} onClick={loadMore}>
                {t("settings.mcp.marketplace.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <ConnectorMarketDetails
        server={selectedMarketServer}
        installed={Boolean(selectedMarketServer && installedServerIds.has(selectedMarketServer.id))}
        canInstall={hasInstalledSnapshot && !installedError && !isInstalledLoading && !pendingInstallId}
        onManage={openManagement}
        onInstall={installServer}
        onClose={() => setSelectedMarketServer(null)}
      />

      <McpManagementDrawer
        pendingServerId={pendingServerId}
        server={selectedServer}
        onClose={() => setSelectedServerId(null)}
        error={installedError}
        onRetry={() => void loadInstalledServers()}
        labels={{
          title: t("settings.mcp.installed.title"),
          emptyTitle: t("settings.mcp.installed.emptyTitle"),
          emptyDescription: t("settings.mcp.installed.emptyDescription"),
          configure: t("settings.mcp.installed.configure"),
          connect: t("settings.mcp.installed.connect"),
          discover: t("settings.mcp.installed.discover"),
          remove: t("settings.mcp.installed.remove"),
          discovered: t("settings.mcp.installed.discovered"),
          connected: t("settings.mcp.installed.connected"),
          configured: t("settings.mcp.installed.configured"),
          failed: t("settings.mcp.installed.failed"),
          protocol: t("settings.mcp.installed.protocol"),
          endpoint: t("settings.mcp.installed.endpoint"),
          remote: t("settings.mcp.installed.remote"),
          capabilities: t("settings.mcp.installed.capabilities"),
          tools: t("settings.mcp.installed.tools"),
          resources: t("settings.mcp.installed.resources"),
          prompts: t("settings.mcp.installed.prompts"),
          projectedId: t("settings.mcp.installed.projectedId"),
          discoveredToolsSummary: t("app.connectors.discovered"),
          docs: "Docs",
          repository: "GitHub",
          packageName: "Package",
          installed: t("app.connectors.installed"),
          enabled: t("app.connectors.enabled"),
          disabled: t("app.connectors.disabled"),
          agentAccess: t("app.connectors.agentAccess"),
        }}
        onConfigure={(server) => void openConfig(server)}
        onConnect={(serverId) => void runServerAction(serverId, "connect")}
        onDiscover={(serverId) => void runServerAction(serverId, "discover")}
        onDelete={removeServer}
        onToggleAgentAccess={toggleAgentAccess}
      />

      <McpGuideDrawer
        open={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        labels={{
          title: t("settings.mcp.guide.title"),
          intro: t("settings.mcp.guide.intro"),
          searchTitle: t("settings.mcp.guide.sections.search.title"),
          searchBody: t("settings.mcp.guide.sections.search.body"),
          installTitle: t("settings.mcp.guide.sections.install.title"),
          installBody: t("settings.mcp.guide.sections.install.body"),
          configTitle: t("settings.mcp.guide.sections.config.title"),
          configBody: t("settings.mcp.guide.sections.config.body"),
          connectTitle: t("settings.mcp.guide.sections.connect.title"),
          connectBody: t("settings.mcp.guide.sections.connect.body"),
          discoverTitle: t("settings.mcp.guide.sections.discover.title"),
          discoverBody: t("settings.mcp.guide.sections.discover.body"),
          inspectTitle: t("settings.mcp.guide.sections.inspect.title"),
          inspectBody: t("settings.mcp.guide.sections.inspect.body"),
          boundaryTitle: t("settings.mcp.guide.sections.boundary.title"),
          boundaryBody: t("settings.mcp.guide.sections.boundary.body"),
          officialSourceTitle: t("settings.mcp.guide.sections.officialSource.title"),
          officialSourceBody: t("settings.mcp.guide.sections.officialSource.body"),
          close: t("settings.mcp.guide.close"),
          searchHint: t("settings.mcp.guide.searchHint"),
        }}
      />
    </AppPageLayout>
  );
}
