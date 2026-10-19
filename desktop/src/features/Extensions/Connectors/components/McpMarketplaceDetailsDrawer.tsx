import { Download, ExternalLink as ExternalLinkIcon } from "lucide-react";
import type { McpMarketplaceServer } from "@/shared/api/tools";
import Badge from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import Drawer from "@/shared/ui/Drawer";
import ExternalLink from "@/shared/ui/ExternalLink";

type McpMarketplaceDetailsDrawerProps = {
  server: McpMarketplaceServer | null;
  installed: boolean;
  canInstall: boolean;
  onManage: (id: string) => void;
  labels: {
    close: string;
    details: string;
    description: string;
    install: string;
    manage: string;
    unsupported: string;
    identity: string;
    version: string;
    status: string;
    publishedAt: string;
    updatedAt: string;
    website: string;
    repository: string;
    links: string;
    transports: string;
    endpoint: string;
    command: string;
    packageIdentifier: string;
    installable: string;
    notInstallable: string;
    unknown: string;
  };
  onClose: () => void;
  onInstall: (server: McpMarketplaceServer) => void;
};

const displayValue = (value: string | null, fallback: string) =>
  value?.trim() || fallback;

const formatDate = (value: string | null, fallback: string) => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const detailRowClassName =
  "grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-border/70 py-2.5 last:border-b-0";

export default function McpMarketplaceDetailsDrawer({
  server,
  installed,
  canInstall,
  onManage,
  labels,
  onClose,
  onInstall,
}: McpMarketplaceDetailsDrawerProps) {
  const installable = Boolean(server?.transports.some((transport) => transport.installable));

  return (
    <Drawer
      open={Boolean(server)}
      onClose={onClose}
      width={560}
      closeLabel={labels.close}
      closeMaskLabel={labels.close}
      header={
        server ? (
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              {labels.details}
            </div>
            <div className="text-base font-semibold text-text-primary">{server.title}</div>
            <div className="break-all text-xs text-text-tertiary">{server.id}</div>
          </div>
        ) : null
      }
      footer={
        server ? (
          <Button
            variant="primary"
            onClick={() => installed ? onManage(server.id) : onInstall(server)}
            disabled={!installed && (!installable || !canInstall)}
          >
            <Download className="h-4 w-4" />
            {installed ? labels.manage : installable ? labels.install : labels.unsupported}
          </Button>
        ) : null
      }
    >
      {server ? (
        <div className="space-y-5">
          <section>
            <div className="text-sm font-medium text-text-primary">{labels.description}</div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
              {server.description || server.name}
            </p>
          </section>

          <section>
            <div className="text-sm font-medium text-text-primary">{labels.identity}</div>
            <div className="mt-2 rounded-ui-control border border-border px-4">
              <div className={detailRowClassName}>
                <span className="text-xs text-text-tertiary">{labels.version}</span>
                <span className="text-sm text-text-secondary">
                  {displayValue(server.version, labels.unknown)}
                </span>
              </div>
              <div className={detailRowClassName}>
                <span className="text-xs text-text-tertiary">{labels.status}</span>
                <span className="text-sm text-text-secondary">
                  {displayValue(server.status, labels.unknown)}
                </span>
              </div>
              <div className={detailRowClassName}>
                <span className="text-xs text-text-tertiary">{labels.publishedAt}</span>
                <span className="text-sm text-text-secondary">
                  {formatDate(server.publishedAt, labels.unknown)}
                </span>
              </div>
              <div className={detailRowClassName}>
                <span className="text-xs text-text-tertiary">{labels.updatedAt}</span>
                <span className="text-sm text-text-secondary">
                  {formatDate(server.updatedAt, labels.unknown)}
                </span>
              </div>
            </div>
          </section>

          {server.websiteUrl || server.repositoryUrl ? (
            <section>
              <div className="text-sm font-medium text-text-primary">{labels.links}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {server.websiteUrl ? (
                  <ExternalLink
                    href={server.websiteUrl}
                    className="inline-flex items-center gap-1.5 rounded-ui-control border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                    {labels.website}
                  </ExternalLink>
                ) : null}
                {server.repositoryUrl ? (
                  <ExternalLink
                    href={server.repositoryUrl}
                    className="inline-flex items-center gap-1.5 rounded-ui-control border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                    {labels.repository}
                  </ExternalLink>
                ) : null}
              </div>
            </section>
          ) : null}

          <section>
            <div className="text-sm font-medium text-text-primary">{labels.transports}</div>
            <div className="mt-2 space-y-3">
              {server.transports.length > 0 ? (
                server.transports.map((transport, index) => {
                  const detail =
                    transport.kind === "streamable-http"
                      ? { label: labels.endpoint, value: transport.url }
                      : transport.kind === "stdio"
                        ? {
                            label: labels.command,
                            value: [transport.command, ...(transport.args ?? [])]
                              .filter(Boolean)
                              .join(" "),
                          }
                        : {
                            label: labels.packageIdentifier,
                            value: transport.packageIdentifier,
                          };

                  return (
                    <div
                      key={`${server.id}-${transport.kind}-${index}`}
                      className="rounded-ui-control border border-border bg-surface-secondary/35 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {transport.label}
                        </span>
                        <Badge variant={transport.installable ? "success" : "muted"}>
                          {transport.installable ? labels.installable : labels.notInstallable}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-text-tertiary">{detail.label}</div>
                      <div className="mt-1 break-all font-mono text-xs leading-5 text-text-secondary">
                        {detail.value || labels.unknown}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-sm text-text-tertiary">{labels.unknown}</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
