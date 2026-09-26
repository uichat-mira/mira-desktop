"use client";

import {
  CircleHelp,
  Braces,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Home,
  Info,
  LayoutDashboard,
  LibraryBig,
  ListChecks,
  LogOut,
  Settings2,
  Smartphone,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/providers/AuthProvider";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import { openExternalUrl } from "@/shared/platform/desktopRuntime";

type RailItem = {
  id: string;
  label: string;
  icon: typeof Home;
};

const primaryItems: RailItem[] = [
  { id: "home", label: "app.navigation.home", icon: Home },
  { id: "remote-access", label: "app.navigation.remoteAccess", icon: Smartphone },
  { id: "dashboard", label: "app.navigation.dashboard", icon: LayoutDashboard },
  { id: "projects", label: "app.navigation.projects", icon: FolderKanban },
  { id: "forge", label: "app.navigation.forge", icon: GitBranch },
];

function resolveActiveItem(pathname: string) {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname === "/forge") return "forge";
  if (pathname === "/remote-access") return "remote-access";
  if (pathname === "/dashboard") return "dashboard";
  return "home";
}

function isResourceRoute(pathname: string) {
  return (
    pathname === "/about" ||
    pathname.startsWith("/about/") ||
    pathname === "/development" ||
    pathname.startsWith("/development/")
  );
}

function isLibraryRoute(pathname: string) {
  return (
    pathname.startsWith("/knowledge-base") ||
    pathname.startsWith("/evaluation")
  );
}

function RailButton({
  item,
  active,
  to,
}: {
  item: RailItem;
  active: boolean;
  to?: string;
}) {
  const Icon = item.icon;
  const className = `group relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
    active
      ? "bg-surface-primary text-text-primary shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
      : "text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary"
  }`;

  const content = (
    <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
  );

  if (to) {
    return (
      <NavLink
        to={to}
        aria-label={item.label}
        title={item.label}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {content}
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      aria-label={item.label}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {content}
    </button>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const { session, logout } = useAuth();
  const { t } = useTranslation();
  const username = session?.user.username?.trim() || "User";
  const initials = Array.from(username).slice(0, 2).join("").toUpperCase();

  return (
    <DropdownMenu
      align="end"
      sideOffset={8}
      trigger={
        <button
          type="button"
          aria-label={username}
          title={username}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface-primary text-[11px] font-semibold text-text-secondary shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:border-border hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {initials}
        </button>
      }
      items={[
        {
          id: "settings",
          label: t("app.navigation.settings"),
          leadingIcon: <Settings2 className="h-4 w-4" />,
        },
        {
          id: "logout",
          label: t("app.sidebar.logout"),
          leadingIcon: <LogOut className="h-4 w-4" />,
          tone: "danger" as const,
        },
      ]}
      onSelect={(item) => {
        if (item.id === "settings") {
          navigate("/settings/general");
          return;
        }

        if (item.id === "logout") {
          logout();
        }
      }}
    />
  );
}

function ResourceMenu({ active = false }: { active?: boolean }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <DropdownMenu
      align="end"
      sideOffset={8}
      trigger={
        <button
          type="button"
          aria-label={t("app.navigation.help")}
          title={t("app.navigation.help")}
          aria-current={active ? "page" : undefined}
          className={`group relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
            active
              ? "bg-surface-primary text-text-primary shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
              : "text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary"
          }`}
        >
          <CircleHelp className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
        </button>
      }
      items={[
        {
          id: "about",
          label: t("app.navigation.about"),
          leadingIcon: <Info className="h-4 w-4" />,
        },
        {
          id: "development",
          label: t("app.navigation.development"),
          leadingIcon: <Braces className="h-4 w-4" />,
        },
        {
          id: "help",
          label: t("app.navigation.help"),
          leadingIcon: <ExternalLink className="h-4 w-4" />,
        },
      ]}
      onSelect={(item) => {
        if (item.id === "about") {
          navigate("/about");
        } else if (item.id === "development") {
          navigate("/development/logs");
        } else if (item.id === "help") {
          void openExternalUrl("https://mira.tomz.io");
        }
      }}
    />
  );
}

function LibraryMenu({ active = false }: { active?: boolean }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const triggerClassName = `group relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
    active
      ? "bg-surface-primary text-text-primary shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
      : "text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary"
  }`;

  return (
    <DropdownMenu
      align="end"
      sideOffset={8}
      trigger={
        <button
          type="button"
          aria-label={t("app.navigation.projects")}
          title={t("app.navigation.projects")}
          aria-current={active ? "page" : undefined}
          className={triggerClassName}
        >
          <FolderKanban className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
        </button>
      }
      items={[
        {
          id: "knowledge-base",
          label: t("app.navigation.knowledgeBase"),
          leadingIcon: <LibraryBig className="h-4 w-4" />,
        },
        {
          id: "evaluation",
          label: t("app.navigation.evaluation"),
          leadingIcon: <ListChecks className="h-4 w-4" />,
        },
      ]}
      onSelect={(item) => {
          navigate(item.id === "knowledge-base" ? "/knowledge-base" : "/evaluation/center");
      }}
    />
  );
}

export function AppNavigationRail() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const activeItem = resolveActiveItem(pathname);
  const localizedPrimaryItems = primaryItems.map((item) => ({
    ...item,
    label: t(item.label),
  }));

  return (
    <nav
      aria-label={t("app.navigation.primary")}
      className="flex h-[100dvh] w-[52px] shrink-0 flex-col items-center border-r border-border/70 bg-surface-tertiary px-1.5 py-3"
    >
      <NavLink
        to="/chat"
        aria-label={t("app.navigation.home")}
        title={t("app.navigation.home")}
        className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-[11px] text-text-primary transition-colors hover:bg-surface-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[8px] bg-text-primary text-[11px] font-semibold text-surface-tertiary">
          M
        </span>
      </NavLink>

      <div className="flex flex-col items-center gap-1">
        {localizedPrimaryItems.map((item) => (
          <div key={item.id}>
            {item.id === "projects" ? (
              <LibraryMenu active={isLibraryRoute(pathname)} />
            ) : (
              <RailButton
                item={item}
                active={activeItem === item.id}
                to={
                  item.id === "home"
                    ? "/chat"
                    : item.id === "remote-access"
                      ? "/remote-access"
                    : item.id === "dashboard"
                      ? "/dashboard"
                    : item.id === "forge"
                      ? "/forge"
                      : undefined
                }
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1">
        <RailButton
          item={{ id: "settings", label: t("app.navigation.settings"), icon: Settings2 }}
          active={activeItem === "settings"}
          to="/settings/general"
        />
        <ResourceMenu active={isResourceRoute(pathname)} />
        <UserMenu />
      </div>
    </nav>
  );
}

