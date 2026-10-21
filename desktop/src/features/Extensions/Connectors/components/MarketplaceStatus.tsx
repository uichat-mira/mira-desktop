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
      {status?.status === "failed" ? <div className="text-warning-text">{t("settings.mcp.marketplace.syncFailed")}{status.lastError ? `：${status.lastError}` : ""}</div> : null}
      {status?.lastSuccessfulSyncAt ? <div>{t("settings.mcp.marketplace.lastUpdated")} · {new Date(status.lastSuccessfulSyncAt).toLocaleString()}</div> : null}
      {cache?.stale ? <div className="text-warning-text">{t("app.connectors.cachedMarket")}{cache.cachedAt ? ` (${cache.cachedAt})` : ""}</div> : null}
    </div>
  );
}
