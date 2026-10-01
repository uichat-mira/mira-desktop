"use client";

import type { ReactNode } from "react";
import { NavLink, useLocation, type To } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import Sidebar from "../Sidebar";
import NavItem from "@/shared/ui/NavItem";
import Divider from "@/shared/ui/Divider";
import { type SettingsNavGroup, type SettingsNavigationItem, useSettingsNavigationItems } from "@/app/routes/settingsRoutes";

/**
 * Shared shell for workspace-style pages.
 *
 * Risk note:
 * This shell is intentionally presentation-only. Runtime ownership stays in the
 * chat/settings workspace files so future route changes do not accidentally
 * couple visual layout changes with the chat runtime lifecycle.
 */
export function WorkspaceShell({
  sidebarContent,
  showBackToChatLink,
  mainContent,
  shellClassName,
  contentClassName,
  showSidebarHeader = true,
}: {
  sidebarContent: ReactNode;
  showBackToChatLink: boolean;
  mainContent: ReactNode;
  shellClassName?: string;
  contentClassName?: string;
  showSidebarHeader?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="w-full min-w-0"
      style={{
        display: "grid",
        gridTemplateColumns: "256px 1fr",
        height: "100dvh",
      }}
    >
      <Sidebar showHeader={showSidebarHeader}>
        {showBackToChatLink ? (
          <NavItem to="/chat" icon={<ArrowLeft size={16} />}>
            {t("common.actions.backToChat")}
          </NavItem>
        ) : null}
        {sidebarContent}
      </Sidebar>

      <main
        className={`flex h-screen w-full min-w-0 flex-col overflow-hidden px-0 ${
          shellClassName ?? "rounded-l-[24px] bg-surface-primary"
        }`}
      >
        <section className="flex min-h-0 flex-1">
          <div
            className={`flex min-h-0 min-w-0 flex-1 ${contentClassName ?? ""}`}
          >
            {mainContent}
          </div>
        </section>
      </main>
    </div>
  );
}

export function SettingsNavigation({ showBackToChatLink = true }: { showBackToChatLink?: boolean }) {
  const { t } = useTranslation();
  const settingsNavigationItems = useSettingsNavigationItems();
  const groupedItems = useMemo(() => {
    const groups = new Map<SettingsNavGroup, SettingsNavigationItem[]>();

    for (const item of [...settingsNavigationItems].sort((left, right) => left.order - right.order)) {
      const current = groups.get(item.group) ?? [];
      current.push(item);
      groups.set(item.group, current);
    }

    return groups;
  }, [settingsNavigationItems]);

  const navGroupTitles: Partial<Record<SettingsNavGroup, string>> = {
    basic: t("settings.navigation.basicConfig"),
    knowledge: t("settings.navigation.knowledgeGroup"),
    app: t("settings.navigation.appGroup"),
    other: t("settings.navigation.otherGroup"),
  };

  const orderedGroups: SettingsNavGroup[] = ["general", "basic", "knowledge", "app", "other"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showBackToChatLink ? (
        <NavLink
          to="/chat"
          className="mb-3 inline-flex items-center gap-2 rounded-[10px] px-2 py-2 text-sm text-text-secondary transition-colors duration-150 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <ArrowLeft size={15} />
          {t("common.actions.backToChat")}
        </NavLink>
      ) : null}

      <div className="stable-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {orderedGroups.map((group, index) => {
          const items = groupedItems.get(group) ?? [];

          if (items.length === 0) {
            return null;
          }

          return (
            <div key={group}>
              {index > 0 ? <Divider /> : null}
              <SettingsNavigationGroup
                title={navGroupTitles[group]}
                items={items}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isSettingsNavigationItemActive(item: SettingsNavigationItem, pathname: string) {
  if (item.match === "prefix") {
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  }

  return pathname === item.to;
}

function buildSettingsNavigationItemTarget(
  item: SettingsNavigationItem,
  pathname: string,
  search: string,
): To {
  if (
    item.preserveSearch &&
    search &&
    (pathname === item.to || pathname.startsWith(`${item.to}/`))
  ) {
    return {
      pathname: item.to,
      search,
    };
  }

  return item.to;
}

function SettingsNavigationGroup({
  title,
  items,
}: {
  title?: string;
  items: SettingsNavigationItem[];
}) {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <div className="space-y-1">
      {title ? (
        <div className="px-2 pb-1 text-[12px] font-medium text-text-tertiary">
          {title}
        </div>
      ) : null}
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <NavLink
            key={item.to}
            to={buildSettingsNavigationItemTarget(item, location.pathname, location.search)}
            className={() =>
              `flex items-center gap-3 rounded-[10px] px-3 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated ${
                isSettingsNavigationItemActive(item, location.pathname)
                  ? "bg-surface-soft text-text-primary"
                  : "text-text-secondary hover:bg-surface-soft hover:text-text-primary"
              }`
            }
          >
            <Icon size={16} className="shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}
