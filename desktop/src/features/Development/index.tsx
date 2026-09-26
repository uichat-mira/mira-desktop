import { useEffect, useMemo } from "react";
import { DatabaseZap, FlaskConical, ScrollText } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import SegmentedTabs from "@/shared/ui/SegmentedTabs";

const TAB_VALUES = [
  "logs",
  "database",
  "client-tests",
  "server-tests",
] as const;

type TabValue = (typeof TAB_VALUES)[number];

export default function DevelopmentSettings() {
  const basePath = "/development";
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === basePath) {
      navigate(`${basePath}/logs`, { replace: true });
    }
  }, [navigate, pathname]);

  const activeTab = useMemo<TabValue>(() => {
    if (pathname.includes("/development/database")) {
      return "database";
    }
    if (pathname.includes("/development/client-tests")) {
      return "client-tests";
    }
    if (pathname.includes("/development/server-tests")) {
      return "server-tests";
    }
    return "logs";
  }, [pathname]);

  const tabs = useMemo(
    () => [
      {
        value: "logs" as const,
        label: (
          <span className="flex items-center gap-1.5">
            <ScrollText className="h-4 w-4" />
            {t("settings.development.tabs.logs")}
          </span>
        ),
      },
      {
        value: "database" as const,
        label: (
          <span className="flex items-center gap-1.5">
            <DatabaseZap className="h-4 w-4" />
            {t("settings.development.tabs.database")}
          </span>
        ),
      },
      {
        value: "client-tests" as const,
        label: (
          <span className="flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4" />
            {t("settings.development.tabs.clientTests")}
          </span>
        ),
      },
      {
        value: "server-tests" as const,
        label: (
          <span className="flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4" />
            {t("settings.development.tabs.serverTests")}
          </span>
        ),
      },
    ],
    [t],
  );

  const handleTabChange = (value: TabValue) => {
    navigate(`${basePath}/${value}`);
  };

  return (
    <AppPageLayout
      miniTitle={t("settings.development.page.miniTitle")}
      title={t("settings.development.page.title")}
      description={t("settings.development.page.description")}
      contentClassName="flex h-full min-h-0 flex-col gap-4 pt-6"
    >
      <SegmentedTabs
        value={activeTab}
        onChange={handleTabChange}
        items={tabs}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </AppPageLayout>
  );
}
