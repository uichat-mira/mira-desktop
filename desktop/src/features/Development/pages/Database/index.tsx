import { Database, ServerCog, Waypoints } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRuntimeHealth } from "@/features/system/hooks/useRuntimeHealth";
import Badge from "@/shared/ui/Badge";
import SectionCard, { SectionCardRow } from "@/shared/ui/SectionCard";
import StatusIndicator from "@/shared/ui/StatusIndicator";
import DevelopmentPageSkeleton from "../../components/DevelopmentPageSkeleton";

export default function DevelopmentDatabasePage() {
  const { t } = useTranslation();
  const { backendState, databaseState, vectorState } = useRuntimeHealth();
  const isLoading = [backendState, databaseState, vectorState].every(
    (state) => state.status === "unknown",
  );

  const getDetailText = (detailState: {
    detail?: string;
    detailKey?: string;
    detailValues?: Record<string, string>;
  }) =>
    detailState.detailKey
      ? t(detailState.detailKey, detailState.detailValues)
      : (detailState.detail ?? "");

  const rows = [
    {
      key: "backend",
      title: t("settings.general.health.services.server"),
      eyebrow: t("settings.development.database.rows.backendEyebrow"),
      detail: getDetailText(backendState),
      status: backendState.status,
      icon: <ServerCog className="h-4 w-4" />,
    },
    {
      key: "sqlite",
      title: t("settings.general.health.services.sqlite"),
      eyebrow: t("settings.development.database.rows.sqliteEyebrow"),
      detail: getDetailText(databaseState),
      status: databaseState.status,
      icon: <Database className="h-4 w-4" />,
    },
    {
      key: "sqlite-vec",
      title: t("settings.general.health.services.sqliteVec"),
      eyebrow: t("settings.development.database.rows.vectorEyebrow"),
      detail: getDetailText(vectorState),
      status: vectorState.status,
      icon: <Waypoints className="h-4 w-4" />,
    },
  ] as const;

  if (isLoading) {
    return <DevelopmentPageSkeleton />;
  }

  return (
    <div className="stable-scrollbar h-full min-h-0 overflow-y-auto pb-1">
      <SectionCard
        data-testid="database-status-list"
        title={t("settings.development.database.title")}
        divided
      >
        {rows.map((row) => (
          <SectionCardRow
            key={row.key}
            data-testid={`database-status-${row.key}`}
            className="min-h-[76px]"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ui-control bg-surface-secondary text-icon-secondary">
                {row.icon}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-text-primary">
                    {row.title}
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
                    {row.eyebrow}
                  </span>
                </div>
                {row.detail ? (
                  <p className="mt-1 break-all font-mono text-xs leading-5 text-text-secondary">
                    {row.detail}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 self-start pt-1">
              <StatusIndicator status={row.status} size="sm" />
              <Badge
                variant={
                  row.status === "running"
                    ? "success"
                    : row.status === "stopped"
                      ? "danger"
                      : "warning"
                }
                size="sm"
              >
                {t(`ui.statusIndicator.${row.status}`)}
              </Badge>
            </div>
          </SectionCardRow>
        ))}
      </SectionCard>
    </div>
  );
}
