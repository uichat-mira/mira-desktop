import { BookOpenText, ExternalLink, Loader2, PlugZap, Power, Radar, Settings2, Trash2 } from "lucide-react";
import Badge from "@/shared/ui/Badge";
import { Button, IconButton } from "@/shared/ui/Button";
import CollapsiblePanel from "@/shared/ui/CollapsiblePanel";
import type { ExternalMcpServerRecord } from "@/shared/api/tools";
import { resolveGithubMirrorUrl } from "@/shared/github";

export type McpInstalledServersPanelProps = {
  servers: ExternalMcpServerRecord[];
  pendingServerId: string | null;
  labels: {
    title: string;
    emptyTitle: string;
    emptyDescription: string;
    configure: string;
    connect: string;
    discover: string;
    remove: string;
    discovered: string;
    connected: string;
    configured: string;
    failed: string;
    protocol: string;
    endpoint: string;
    remote: string;
    capabilities: string;
    tools: string;
    resources: string;
    prompts: string;
    projectedId: string;
    discoveredToolsSummary: string;
    docs: string;
    repository: string;
    packageName: string;
    installed: string;
    enabled: string;
    disabled: string;
    agentAccess: string;
  };
  onConfigure: (server: ExternalMcpServerRecord) => void;
  onConnect: (serverId: string) => void;
  onDiscover: (serverId: string) => void;
  onDelete: (server: ExternalMcpServerRecord) => void;
  onToggleAgentAccess: (server: ExternalMcpServerRecord, enabled: boolean) => void;
};

const getStatusLabel = (
  server: ExternalMcpServerRecord,
  labels: McpInstalledServersPanelProps["labels"],
) => {
  switch (server.status) {
    case "connected":
      return labels.connected;
    case "failed":
      return labels.failed;
    default:
      return labels.configured;
  }
};

export default function McpInstalledServersPanel({
  servers,
  pendingServerId,
  labels,
  onConfigure,
  onConnect,
  onDiscover,
  onDelete,
  onToggleAgentAccess,
}: McpInstalledServersPanelProps) {
  return (
    <div className="min-h-0">
      <div className="px-5 py-4">
        <div className="text-sm font-medium text-text-primary">{labels.title}</div>
      </div>

      {servers.length === 0 ? (
        <div className="px-5 py-8">
          <div className="text-sm font-medium text-text-primary">{labels.emptyTitle}</div>
          <div className="mt-1 text-sm text-text-secondary">{labels.emptyDescription}</div>
        </div>
      ) : null}

      {servers.length > 0 ? (
        <div>
          {servers.map((server) => {
            const isPending = pendingServerId === server.id;
            return (
              <div
                key={server.id}
                className="border-t border-border px-5 py-3 first:border-t"
              >
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {server.displayName}
                        </div>
                        <Badge variant="muted">{labels.installed}</Badge>
                        <Badge variant={server.enabled ? "success" : "muted"}>
                          {server.enabled ? labels.enabled : labels.disabled}
                        </Badge>
                        <Badge variant="muted">{getStatusLabel(server, labels)}</Badge>
                        {server.discoveredTools.length > 0 ? (
                          <Badge variant="success">
                            {labels.discovered}: {server.discoveredTools.length}
                          </Badge>
                        ) : null}
                        {server.protocolVersion ? (
                          <Badge variant="muted">
                            {labels.protocol}: {server.protocolVersion}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-1 break-all text-xs text-text-tertiary">{server.id}</div>
                    </div>

                    <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => onConfigure(server)}
                      >
                        <Settings2 className="h-4 w-4" />
                        {labels.configure}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => onConnect(server.id)}
                      >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                        {labels.connect}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isPending}
                        onClick={() => onDiscover(server.id)}
                      >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                        {labels.discover}
                      </Button>
                      <IconButton
                        size="sm"
                        styleType={server.agentEnabled ? "filled" : "outline"}
                        tone={server.agentEnabled ? "primary" : "default"}
                        onClick={() => onToggleAgentAccess(server, !server.agentEnabled)}
                        disabled={isPending || !server.enabled}
                        ariaLabel={labels.agentAccess}
                        aria-pressed={server.agentEnabled}
                        title={labels.agentAccess}
                      >
                        <Power className="h-4 w-4" />
                      </IconButton>
                      <Button
                        variant="danger-outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => onDelete(server)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {labels.remove}
                      </Button>
                    </div>
                  </div>

                  <div className="min-w-0">
                    {server.description ? (
                      <div className="mt-1 text-sm leading-5 text-text-secondary">
                        {server.description}
                      </div>
                    ) : null}

                    {server.remoteServerInfo || server.documentationUrl || server.repositoryUrl ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
                        {server.remoteServerInfo ? (
                          <>
                            <span>{labels.remote}:</span>
                            {server.remoteServerInfo.title || server.remoteServerInfo.name ? (
                              <span>
                                {server.remoteServerInfo.title ?? server.remoteServerInfo.name}
                                {server.remoteServerInfo.name &&
                                server.remoteServerInfo.title &&
                                server.remoteServerInfo.name !== server.remoteServerInfo.title
                                  ? ` (${server.remoteServerInfo.name})`
                                  : ""}
                              </span>
                            ) : null}
                            {server.remoteServerInfo.version ? <span>v{server.remoteServerInfo.version}</span> : null}
                          </>
                        ) : null}

                        {server.documentationUrl || server.repositoryUrl ? (
                          <span className="inline-flex items-center gap-2 border-l border-border pl-2">
                            {server.documentationUrl ? (
                              <a
                                href={server.documentationUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-text-secondary underline underline-offset-4 hover:text-text-primary"
                              >
                                <BookOpenText className="h-3.5 w-3.5" />
                                {labels.docs}
                              </a>
                            ) : null}
                            {server.repositoryUrl ? (
                              <a
                                href={resolveGithubMirrorUrl(server.repositoryUrl)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-text-secondary underline underline-offset-4 hover:text-text-primary"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {labels.repository}
                              </a>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-2 text-xs leading-5 text-text-tertiary">
                      {labels.endpoint}:{" "}
                      {server.transport.kind === "streamable-http"
                        ? server.transport.url
                        : `${server.transport.command}${
                            server.transport.args?.length
                              ? ` ${server.transport.args.join(" ")}`
                              : ""
                          }`}
                    </div>

                    {server.packageName ? (
                      <div className="mt-1 text-xs text-text-tertiary">
                        {labels.packageName}: {server.packageName}
                      </div>
                    ) : null}

                    {server.remoteCapabilities ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
                        <span>{labels.capabilities}:</span>
                        {server.remoteCapabilities.hasTools ? <Badge variant="muted">{labels.tools}</Badge> : null}
                        {server.remoteCapabilities.hasResources ? (
                          <Badge variant="muted">{labels.resources}</Badge>
                        ) : null}
                        {server.remoteCapabilities.hasPrompts ? <Badge variant="muted">{labels.prompts}</Badge> : null}
                      </div>
                    ) : null}

                    {server.lastError ? (
                    <div className="mt-2 rounded-ui-control border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
                        {server.lastError}
                      </div>
                    ) : null}

                    {server.discoveredTools.length > 0 ? (
                      <CollapsiblePanel
                        className="mt-2"
                        title={`${labels.discoveredToolsSummary} ${server.discoveredTools.length} ${labels.tools}`}
                        meta={server.discoveredTools.map((tool) => tool.title).join(" / ")}
                        contentClassName="border-t border-border bg-surface-primary px-3 py-2"
                      >
                        {server.discoveredTools.map((tool) => (
                          <div
                            key={`${server.id}-${tool.projectedCapabilityId}`}
                            className="border-b border-border py-2 last:border-b-0"
                          >
                            <div className="text-xs font-medium text-text-primary">
                              {tool.title}
                            </div>
                            <div className="mt-1 break-all text-xs text-text-tertiary">
                              {labels.projectedId}: {tool.projectedCapabilityId}
                            </div>
                          </div>
                        ))}
                      </CollapsiblePanel>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
