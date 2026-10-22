import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { McpMarketplaceSyncStatus } from "@/shared/api/tools";

export default function MarketplaceStatus({ status, cache }: {
  status: McpMarketplaceSyncStatus | null;
  cache: { stale: boolean; cachedAt: string | null } | null;
}) {
  const { t } = useTranslation();
  if (!status && !cache?.stale) return null;
  return (
    <div className="space-y-1 text-xs text-text-tertiary" role="status">
      {status?.status === "syncing" ? <div className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("settings.mcp.marketplace.syncing")}</div> : null}
      {status?.status === "failed" ? <div className="text-warning-text">{status.lastError ? t("app.connectors.syncFailedDetail", { message: t("settings.mcp.marketplace.syncFailed"), error: status.lastError }) : t("settings.mcp.marketplace.syncFailed")}</div> : null}
      {status?.lastSuccessfulSyncAt ? <div>{t("settings.mcp.marketplace.lastUpdated")} · {new Date(status.lastSuccessfulSyncAt).toLocaleString()}</div> : null}
      {cache?.stale ? <div className="text-warning-text">{cache.cachedAt ? t("app.connectors.cachedMarketAt", { message: t("app.connectors.cachedMarket"), cachedAt: new Date(cache.cachedAt).toLocaleString() }) : t("app.connectors.cachedMarket")}</div> : null}
    </div>
  );
}
