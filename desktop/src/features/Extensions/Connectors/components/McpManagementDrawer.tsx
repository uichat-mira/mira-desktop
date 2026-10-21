import { useTranslation } from "react-i18next";
import type { ExternalMcpServerRecord } from "@/shared/api/tools";
import { Alert, Button, Drawer } from "@/shared/ui";
import McpInstalledServersPanel, { type McpInstalledServersPanelProps } from "./McpInstalledServersPanel";

type McpManagementDrawerProps = Omit<McpInstalledServersPanelProps, "servers"> & {
  server: ExternalMcpServerRecord | null;
  onClose: () => void;
  error: string | null;
  onRetry: () => void;
};

export default function McpManagementDrawer({
  server, onClose, error, onRetry, ...panelProps
}: McpManagementDrawerProps) {
  const { t } = useTranslation();
  return (
    <Drawer
      open={Boolean(server)}
      onClose={onClose}
      width={640}
      closeLabel={t("app.connectors.closeManager")}
      header={
        <div className="space-y-1">
          <div className="text-xs text-text-tertiary">{t("app.connectors.manage")}</div>
          <div className="text-base font-semibold text-text-primary">{server?.displayName}</div>
        </div>
      }
      bodyClassName="px-0 py-0"
    >
      {server ? (
        <section role="dialog" aria-label={server.displayName}>
          {error ? (
            <div className="p-4">
              <Alert variant="warning" title={error} action={<Button size="xs" onClick={onRetry}>{t("settings.mcp.marketplace.retry")}</Button>} />
            </div>
          ) : null}
          <McpInstalledServersPanel {...panelProps} servers={[server]} />
        </section>
      ) : null}
    </Drawer>
  );
}
