import type { ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Blend,
  Bolt,
  Boxes,
  PanelsTopLeft,
  SlidersHorizontal,
  ShieldCheck,
  Wrench,
  UserRoundPen,
} from "lucide-react";
import GeneralSettings from "@/features/Settings/pages/General/index";
import PersonalizationSettings from "@/features/Settings/pages/Personalization/index";
import AccountSettings from "@/features/Settings/pages/Account/index";
import ModelSettings from "@/features/Settings/pages/ModelSetting";
import McpSettings from "@/features/Settings/pages/Mcp/index";
import IntegrationsSettings from "@/features/Settings/pages/Integrations/index";
import ToolsSettings from "@/features/Settings/pages/Tools/index";
import RoleSettings from "@/features/Settings/pages/Personas/index";
import MicroAppsSettings from "@/features/Settings/pages/MicroApps/index";
import MicroAppDetailPage from "@/features/Settings/pages/MicroApps/Detail";
import ImageGenerationStudioPage from "@/features/Settings/pages/MicroApps/ImageGeneration";
import ComputerUseDebuggerPage from "@/features/Settings/pages/MicroApps/ComputerUse";
import MailCenterPage from "@/features/Settings/pages/MicroApps/MailCenter";
import NewsHubPage from "@/features/Settings/pages/MicroApps/NewsHub";
import TtsStudioPage from "@/features/Settings/pages/MicroApps/Tts";
import CodeGraphStudioPage from "@/features/Settings/pages/MicroApps/CodeGraph";
import EvolvingKnowledgeStudioPage from "@/features/Settings/pages/MicroApps/EvolvingKnowledge";
import NotionMicroAppPage from "@/features/Settings/pages/MicroApps/Notion";
import GitHubMicroAppPage from "@/features/Settings/pages/MicroApps/GitHub";
import JianXingPage from "@/features/Settings/pages/MicroApps/JianXing";
import OfficeSuitePage from "@/features/Settings/pages/MicroApps/OfficeSuite";

export type SettingsNavGroup =
  | "general"
  | "basic"
  | "knowledge"
  | "app"
  | "other";

export type SettingsNavMatchMode = "exact" | "prefix";

type SettingsRouteNavMeta = {
  labelKey: string;
  icon: LucideIcon;
  group: SettingsNavGroup;
  order: number;
  match?: SettingsNavMatchMode;
  preserveSearch?: boolean;
};

type SettingsRouteConfig = {
  path: string;
  element?: ReactNode;
  children?: SettingsRouteConfig[];
  nav?: SettingsRouteNavMeta;
};

export type SettingsNavigationItem = {
  label: string;
  icon: LucideIcon;
  to: string;
  group: SettingsNavGroup;
  order: number;
  match: SettingsNavMatchMode;
  preserveSearch: boolean;
};

const settingsRouteTree: SettingsRouteConfig[] = [
  {
    path: "general",
    element: <GeneralSettings />,
    nav: { labelKey: "settings.navigation.general", icon: Bolt, group: "general", order: 10 },
  },
  {
    path: "personalization",
    element: <PersonalizationSettings />,
    nav: {
      labelKey: "settings.navigation.personalization",
      icon: SlidersHorizontal,
      group: "general",
      order: 20,
    },
  },
  {
    path: "model-setting",
    element: <ModelSettings />,
    nav: { labelKey: "settings.navigation.model", icon: Blend, group: "basic", order: 10 },
  },
  {
    path: "roles",
    element: <RoleSettings />,
    nav: { labelKey: "settings.navigation.roles", icon: UserRoundPen, group: "app", order: 10 },
  },
  {
    path: "skills",
    element: <Navigate to="/extensions/skills" replace />,
  },
  {
    path: "micro-apps",
    element: <Outlet />,
    nav: {
      labelKey: "settings.navigation.microApps",
      icon: PanelsTopLeft,
      group: "app",
      order: 15,
      match: "prefix",
    },
    children: [
      {
        path: "",
        element: <MicroAppsSettings />,
      },
      {
        path: "notion",
        element: <NotionMicroAppPage />,
      },
      {
        path: "github",
        element: <GitHubMicroAppPage />,
      },
      {
        path: "office-suite",
        element: <OfficeSuitePage />,
      },
      {
        path: ":appId",
        element: <MicroAppDetailPage />,
      },
      {
        path: "news-hub",
        element: <NewsHubPage />,
      },
      {
        path: "image-generation-studio",
        element: <ImageGenerationStudioPage />,
      },
      {
        path: "computer-use-studio",
        element: <ComputerUseDebuggerPage />,
      },
      {
        path: "jian-xing",
        element: <JianXingPage />,
      },
      {
        path: "mail-center",
        element: <MailCenterPage />,
      },
      {
        path: "tts-studio",
        element: <TtsStudioPage />,
      },
      {
        path: "codegraph-studio",
        element: <CodeGraphStudioPage />,
      },
      {
        path: "evolving-knowledge-studio",
        element: <EvolvingKnowledgeStudioPage />,
      },
    ],
  },
  {
    path: "mcp",
    element: <McpSettings />,
    nav: { labelKey: "settings.navigation.mcp", icon: Boxes, group: "basic", order: 30 },
  },
  {
    path: "integrations",
    element: <IntegrationsSettings />,
    nav: {
      labelKey: "settings.navigation.enterpriseIntegrations",
      icon: ShieldCheck,
      group: "app",
      order: 20,
    },
  },
  {
    path: "tools",
    element: <ToolsSettings />,
    nav: { labelKey: "settings.navigation.tools", icon: Wrench, group: "basic", order: 20 },
  },
  {
    path: "account",
    element: <AccountSettings />,
  },
];

function buildSettingsRouteObjects(routes: SettingsRouteConfig[]): RouteObject[] {
  return routes.map((route) => ({
    path: route.path,
    element: route.element,
    children: route.children
      ? buildSettingsRouteObjects(route.children)
      : undefined,
  }));
}

function buildSettingsNavigationItems(
  routes: SettingsRouteConfig[],
  translate: (key: string) => string,
  parentPath = "/settings",
): SettingsNavigationItem[] {
  return routes.flatMap((route) => {
    const currentPath = `${parentPath}/${route.path}`;
    const ownItem = route.nav
      ? [
          {
            label: translate(route.nav.labelKey),
            icon: route.nav.icon,
            to: currentPath,
            group: route.nav.group,
            order: route.nav.order,
            match: route.nav.match ?? "exact",
            preserveSearch: route.nav.preserveSearch ?? false,
          },
        ]
      : [];

    const childItems = route.children
      ? buildSettingsNavigationItems(route.children, translate, currentPath)
      : [];

    return [...ownItem, ...childItems];
  });
}

export const settingsRoutes = buildSettingsRouteObjects(settingsRouteTree);

// 设置侧边导航和实际路由共用同一份配置，后续扩展成多级菜单时不需要再维护第二套映射。
export const useSettingsNavigationItems = () => {
  const { t } = useTranslation();

  return useMemo(
    () => buildSettingsNavigationItems(settingsRouteTree, t),
    [t],
  );
};
