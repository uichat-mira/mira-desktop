import {
  Boxes, ChevronRight, LibraryBig, Mail, MousePointerClick, Newspaper, PlugZap, Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { McpMarketplaceServer } from "@/shared/api/tools";
import {
  Card, GithubIcon, NotionIcon, Result, Skeleton,
} from "@/shared/ui";

import type { ConnectorView, ExternalConnector } from "../catalog";

// These are navigation entries, not runtime connection records.
const builtinEntries = [
  { id: "knowledgeBase", to: "/knowledge-base", icon: LibraryBig },
  { id: "github", to: "/settings/micro-apps/github", icon: GithubIcon },
  { id: "notion", to: "/settings/micro-apps/notion", icon: NotionIcon },
  { id: "mailCenter", to: "/settings/micro-apps/mail-center", icon: Mail },
  { id: "newsHub", to: "/settings/micro-apps/news-hub", icon: Newspaper },
  { id: "touchRealm", to: "/settings/micro-apps/jian-xing", icon: MousePointerClick },
  { id: "codeGraph", to: "/settings/micro-apps/codegraph-studio", icon: Boxes },
] as const;

interface ConnectorCatalogProps {
  entries: ExternalConnector[];
  query: string;
  view: ConnectorView;
  onManage: (id: string) => void;
  onDetails: (server: McpMarketplaceServer) => void;
  isLoading: boolean;
  incomplete: boolean;
}

const cardClass = "flex h-full w-full flex-col gap-4 rounded-ui-panel p-4 text-left transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const iconClass = "flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-control bg-surface-secondary text-icon-primary";

export default function ConnectorCatalog({ entries, query, view, onManage, onDetails, isLoading, incomplete }: ConnectorCatalogProps) {
  const { t } = useTranslation();
  const keyword = query.trim().toLowerCase();
  const builtins = view === "internal" ? builtinEntries.filter(({ id }) =>
    `${t(`app.connectors.builtins.${id}.name`)} ${t(`app.connectors.builtins.${id}.description`)} ${id}`.toLowerCase().includes(keyword),
  ) : [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {builtins.map(({ id, to, icon: Icon }) => {
          const name = t(`app.connectors.builtins.${id}.name`);
          return <Card key={id} padding="none">
            <Link to={to} aria-label={name} className={cardClass}>
              <div className="flex items-start gap-3">
                <span className={iconClass}><Icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <h4 className="break-words text-sm font-semibold text-text-primary">{name}</h4>
                  <div className="mt-1 text-xs text-text-tertiary">{t("app.connectors.builtinEntry")}</div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" />
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-text-secondary">{t(`app.connectors.builtins.${id}.description`)}</p>
            </Link>
          </Card>;
        })}
        {entries.map(({ id, installed, marketplace }) => {
          const name = installed?.displayName ?? marketplace!.title;
          return <Card key={id} padding="none">
            <button type="button" aria-label={name} className={cardClass} onClick={() => installed ? onManage(id) : onDetails(marketplace!)}>
              <div className="flex items-start gap-3">
                <span className={iconClass}><PlugZap className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h4 className="break-words text-sm font-semibold text-text-primary">{name}</h4>
                    {installed ? <span className={`text-xs ${installed.status === "connected" ? "text-success-text" : installed.status === "failed" ? "text-danger-text" : "text-text-tertiary"}`}>{t(`settings.mcp.installed.${installed.status}`)}</span> : null}
                  </div>
                  <div className="mt-1 break-all text-xs text-text-tertiary">{t(installed ? "app.connectors.installed" : "app.connectors.marketSource")} · MCP</div>
                  {installed ? <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-text-tertiary">
                    {!installed.enabled ? <span>{t("app.connectors.disabled")}</span> : null}
                    <span>{t(installed.agentEnabled ? "app.connectors.agentAllowed" : "app.connectors.agentNotAllowed")}</span>
                  </div> : <div className="mt-1 text-xs text-text-tertiary">{t(marketplace!.transports.some((item) => item.installable) ? "app.connectors.available" : "settings.mcp.marketplace.unsupported")}</div>}
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" />
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-text-secondary">{installed?.description ?? marketplace?.description}</p>
            </button>
          </Card>;
        })}
      </div>
      {isLoading ? <Skeleton height={96} /> : null}
      {!isLoading && !incomplete && builtins.length === 0 && entries.length === 0 ? <Result size="sm" icon={<Search className="h-4 w-4" />} title={t("app.connectors.noMatches")} /> : null}
    </div>
  );
}
