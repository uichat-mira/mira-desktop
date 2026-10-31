import {
  Braces,
  Cable,
  PlugZap,
  CircleHelp,
  Cloud,
  ExternalLink,
  GitBranch,
  Info,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Puzzle,
  Settings2,
  Smartphone,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/providers/AuthProvider";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import { message } from "@/shared/ui/Message";
import { openExternalUrl } from "@/shared/platform/desktopRuntime";
import logoIcon from "@/assets/branding/uichat-logo-icon.png";

type RailLinkId = "home" | "dashboard" | "forge" | "settings";

type RailLinkItem = {
  id: RailLinkId;
  label: string;
  icon: LucideIcon;
  to: string;
};

type RailMenuItem = { id: "extensions" } | { id: "remote-access" };

type PrimaryRailItem = RailLinkItem | RailMenuItem;

const primaryItems: PrimaryRailItem[] = [
  {
    id: "home",
    label: "app.navigation.home",
    icon: MessageSquareText,
    to: "/chat",
  },
  { id: "remote-access" },
  {
    id: "dashboard",
    label: "app.navigation.dashboard",
    icon: LayoutDashboard,
    to: "/dashboard",
  },
  { id: "extensions" },
  {
    id: "forge",
    label: "app.navigation.forge",
    icon: GitBranch,
    to: "/forge",
  },
];

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function resolveActiveItem(pathname: string): RailLinkId | null {
  if (pathname === "/" || matchesRoute(pathname, "/chat")) return "home";
  if (matchesRoute(pathname, "/settings/mcp")) {
    return null;
  }
  if (matchesRoute(pathname, "/settings")) return "settings";
  if (matchesRoute(pathname, "/forge")) return "forge";
  if (matchesRoute(pathname, "/dashboard")) return "dashboard";
  return null;
}

function isResourceRoute(pathname: string) {
  return (
    matchesRoute(pathname, "/about") ||
    matchesRoute(pathname, "/development")
  );
}

function isAboutRoute(pathname: string) {
  return matchesRoute(pathname, "/about");
}

function isDevelopmentRoute(pathname: string) {
  return matchesRoute(pathname, "/development");
}

function isExtensionCapabilitiesRoute(pathname: string) {
  return matchesRoute(pathname, "/extensions/capabilities");
}

function isExtensionConnectorsRoute(pathname: string) {
  return (
    matchesRoute(pathname, "/extensions/connectors") ||
    matchesRoute(pathname, "/extensions/mcp") ||
    matchesRoute(pathname, "/settings/mcp")
  );
}

function isExtensionSkillsRoute(pathname: string) {
  return matchesRoute(pathname, "/extensions/skills");
}

function isExtensionsRoute(pathname: string) {
  return matchesRoute(pathname, "/extensions") || isExtensionConnectorsRoute(pathname);
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
      ? "bg-primary/10 text-primary"
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
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
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
          void navigate("/settings/general");
          return;
        }

        if (item.id === "logout") {
          logout();
        }
      }}
    />
  );
}

function ExtensionsMenu({
  active = false,
  pathname,
}: {
  active?: boolean;
  pathname: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const triggerClassName = `group relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
    active
      ? "bg-primary/10 text-primary"
      : "text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary"
  }`;

  return (
    <DropdownMenu
      align="start"
      side="right"
      sideOffset={8}
      trigger={
        <button
          type="button"
          aria-label={t("app.navigation.extensions")}
          title={t("app.navigation.extensions")}
          aria-current={active ? "page" : undefined}
          className={triggerClassName}
        >
          <Puzzle
            className="h-[18px] w-[18px]"
            strokeWidth={1.8}
          />
        </button>
      }
      items={[
        {
          id: "capabilities",
          label: t("app.navigation.capabilities"),
          leadingIcon: <Wrench className="h-4 w-4" />,
          selected: isExtensionCapabilitiesRoute(pathname),
        },
        {
          id: "connectors",
          label: t("app.navigation.connectors"),
          leadingIcon: <PlugZap className="h-4 w-4" />,
          selected: isExtensionConnectorsRoute(pathname),
        },
        {
          id: "skills",
          label: t("app.navigation.skills"),
          leadingIcon: <Sparkles className="h-4 w-4" />,
          selected: isExtensionSkillsRoute(pathname),
        },
      ]}
      onSelect={(item) => {
        if (item.id === "capabilities") {
          void navigate("/extensions/capabilities");
        } else if (item.id === "connectors") {
          void navigate("/extensions/connectors");
        } else if (item.id === "skills") {
          void navigate("/extensions/skills");
        }
      }}
    />
  );
}

function ResourceMenu({
  active = false,
  pathname,
}: {
  active?: boolean;
  pathname: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <DropdownMenu
      align="start"
      side="right"
      sideOffset={8}
      trigger={
        <button
          type="button"
          aria-label={t("app.navigation.help")}
          title={t("app.navigation.help")}
          aria-current={active ? "page" : undefined}
          className={`group relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
            active
              ? "bg-primary/10 text-primary"
              : "text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary"
          }`}
        >
          <CircleHelp
            className="h-[18px] w-[18px]"
            strokeWidth={1.8}
          />
        </button>
      }
      items={[
        {
          id: "about",
          label: t("app.navigation.about"),
          leadingIcon: <Info className="h-4 w-4" />,
          selected: isAboutRoute(pathname),
        },
        {
          id: "development",
          label: t("app.navigation.development"),
          leadingIcon: <Braces className="h-4 w-4" />,
          selected: isDevelopmentRoute(pathname),
        },
        {
          id: "help",
          label: t("app.navigation.help"),
          leadingIcon: <ExternalLink className="h-4 w-4" />,
        },
      ]}
      onSelect={(item) => {
        if (item.id === "about") {
          void navigate("/about");
        } else if (item.id === "development") {
          void navigate("/development/logs");
        } else if (item.id === "help") {
          void openExternalUrl("https://mira.tomz.io").catch(() => {
            message.error(t("app.navigation.helpOpenFailed"));
          });
        }
      }}
    />
  );
}

function RemoteAccessMenu({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const remoteActive = matchesRoute(pathname, "/remote-access");
  const cloudActive = matchesRoute(pathname, "/cloud-account");
  const active = remoteActive || cloudActive;

  return (
    <DropdownMenu
      align="start"
      side="right"
      sideOffset={8}
      trigger={
        <button
          type="button"
          aria-label={t("app.navigation.remoteAccess")}
          title={t("app.navigation.remoteAccess")}
          aria-current={active ? "page" : undefined}
          className={`group relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
            active
              ? "bg-primary/10 text-primary"
              : "text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary"
          }`}
        >
          <Smartphone className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      }
      items={[
        {
          id: "cloud-account",
          label: t("app.navigation.cloudAccount"),
          leadingIcon: <Cloud className="h-4 w-4" />,
          selected: cloudActive,
        },
        {
          id: "remote-access",
          label: t("app.navigation.remoteAccess"),
          leadingIcon: <Cable className="h-4 w-4" />,
          selected: remoteActive,
        },
      ]}
      onSelect={(item) => void navigate(`/${item.id}`)}
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
        <img
          src={logoIcon}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-7 w-7 rounded-[7px] object-contain"
        />
      </NavLink>

      <div className="flex flex-col items-center gap-1">
        {primaryItems.map((item) => (
          <div key={item.id}>
            {item.id === "remote-access" ? (
              <RemoteAccessMenu pathname={pathname} />
            ) : item.id === "extensions" ? (
              <ExtensionsMenu
                active={isExtensionsRoute(pathname)}
                pathname={pathname}
              />
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
            id: "settings",
            label: t("app.navigation.settings"),
            icon: Settings2,
            to: "/settings/general",
          }}
          active={activeItem === "settings"}
        />
        <ResourceMenu active={isResourceRoute(pathname)} pathname={pathname} />
        <UserMenu />
      </div>
    </nav>
  );
}
