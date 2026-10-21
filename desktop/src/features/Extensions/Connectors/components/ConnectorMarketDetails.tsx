import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import McpMarketplaceDetailsDrawer from "./McpMarketplaceDetailsDrawer";

export default function ConnectorMarketDetails(props: Omit<ComponentProps<typeof McpMarketplaceDetailsDrawer>, "labels">) {
  const { t } = useTranslation();
  return <McpMarketplaceDetailsDrawer {...props} labels={{
    close: t("settings.mcp.marketplace.detailsDrawer.close"),
    details: t("settings.mcp.marketplace.detailsDrawer.details"),
    description: t("settings.mcp.marketplace.detailsDrawer.description"),
    identity: t("settings.mcp.marketplace.detailsDrawer.identity"),
    version: t("settings.mcp.marketplace.detailsDrawer.version"),
    status: t("settings.mcp.marketplace.detailsDrawer.status"),
    publishedAt: t("settings.mcp.marketplace.detailsDrawer.publishedAt"),
    updatedAt: t("settings.mcp.marketplace.detailsDrawer.updatedAt"),
    website: t("settings.mcp.marketplace.detailsDrawer.website"),
    repository: t("settings.mcp.marketplace.detailsDrawer.repository"),
    links: t("settings.mcp.marketplace.detailsDrawer.links"),
    transports: t("settings.mcp.marketplace.detailsDrawer.transports"),
    endpoint: t("settings.mcp.marketplace.detailsDrawer.endpoint"),
    command: t("settings.mcp.marketplace.detailsDrawer.command"),
    packageIdentifier: t("settings.mcp.marketplace.detailsDrawer.packageIdentifier"),
    installable: t("settings.mcp.marketplace.detailsDrawer.installable"),
    notInstallable: t("settings.mcp.marketplace.detailsDrawer.notInstallable"),
    unknown: t("settings.mcp.marketplace.detailsDrawer.unknown"),
    install: t("settings.mcp.marketplace.install"),
    manage: t("app.connectors.manage"),
    unsupported: t("settings.mcp.marketplace.unsupported"),
  }} />;
}
