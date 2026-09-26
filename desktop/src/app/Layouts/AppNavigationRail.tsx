import {
  Braces,
  CircleHelp,
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
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/providers/AuthProvider";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import { openExternalUrl } from "@/shared/platform/desktopRuntime";

type RailLinkId = "home" | "remote-access" | "dashboard" | "forge";

type RailLinkItem = {
  kind: "link";
  id: RailLinkId;
  label: string;
  icon: LucideIcon;
  to: string;
};

type RailMenuItem = {
  kind: "library";
  id: "projects";
};

type PrimaryRailItem = RailLinkItem | RailMenuItem;

const primaryItems: PrimaryRailItem[] = [
  {
    kind: "link",
    id: "home",
    label: "app.navigation.home",
    icon: Home,
    to: "/chat",
  },
  {
    kind: "link",
    id: "remote-access",
    label: "app.navigation.remoteAccess",
    icon: Smartphone,
    to: "/remote-access",
  },
  {
    kind: "link",
    id: "dashboard",
    label: "app.navigation.dashboard",
    icon: LayoutDashboard,
    to: "/dashboard",
  },
  { kind: "library", id: "projects" },
  {
    kind: "link",
    id: "forge",
    label: "app.navigation.forge",
    icon: GitBranch,
    to: "/forge",
  },
];

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function resolveActiveItem(pathname: string): RailLinkId | "settings" | null {
  if (pathname === "/" || matchesRoute(pathname, "/chat")) return "home";
  if (matchesRoute(pathname, "/settings")) return "settings";
  if (matchesRoute(pathname, "/forge")) return "forge";
  if (matchesRoute(pathname, "/remote-access")) return "remote-access";
  if (matchesRoute(pathname, "/dashboard")) return "dashboard";
  return null;
}

function isResourceRoute(pathname: string) {
  return (
    matchesRoute(pathname, "/about") ||
    matchesRoute(pathname, "/development")
  );
}

function isLibraryRoute(pathname: string) {
  return (
    matchesRoute(pathname, "/knowledge-base") ||
    matchesRoute(pathname, "/evaluation")
  );
}

function RailButton({
  item,
  active,
}: {
  item: RailLinkItem;
  active: boolean;
}) {
  const Icon = item.icon;
  const className = `group relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
    active
      ? "bg-surface-primary text-text-primary shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
      : "text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary"
  }`;

  return (
    <NavLink
      to={item.to}
      aria-label={item.label}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
    </NavLink>
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
          <CircleHelp
            className="h-[18px] w-[18px]"
            strokeWidth={active ? 2.2 : 1.8}
          />
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
          <FolderKanban
            className="h-[18px] w-[18px]"
            strokeWidth={active ? 2.2 : 1.8}
          />
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
        navigate(
          item.id === "knowledge-base"
            ? "/knowledge-base"
            : "/evaluation/center",
        );
      }}
    />
  );
}

export function AppNavigationRail() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const activeItem = resolveActiveItem(pathname);

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
        {primaryItems.map((item) => (
          <div key={item.id}>
            {item.kind === "library" ? (
              <LibraryMenu active={isLibraryRoute(pathname)} />
            ) : (
              <RailButton
                item={{ ...item, label: t(item.label) }}
                active={activeItem === item.id}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1">
        <RailButton
          item={{
            kind: "link",
            id: "home",
            label: t("app.navigation.settings"),
            icon: Settings2,
            to: "/settings/general",
          }}
          active={activeItem === "settings"}
        />
        <ResourceMenu active={isResourceRoute(pathname)} />
        <UserMenu />
      </div>
    </nav>
  );
}
