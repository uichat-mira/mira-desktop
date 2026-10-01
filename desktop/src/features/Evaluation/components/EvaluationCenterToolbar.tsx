import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";

interface EvaluationCenterToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  selectedCount: number;
  onBulkDelete: () => void;
}

export default function EvaluationCenterToolbar({
  query,
  onQueryChange,
  refreshing,
  onRefresh,
  selectedCount,
  onBulkDelete,
}: EvaluationCenterToolbarProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/evaluation";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex min-w-[320px] flex-1 items-center justify-end gap-2 max-md:w-full">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-icon-secondary" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("settings.evaluation.center.searchPlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface-primary pl-9 pr-3 text-sm text-text-primary shadow-shadow-sm transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {t("common.actions.refresh")}
        </Button>
        <Button
          variant="danger-ghost"
          size="sm"
          disabled={selectedCount === 0}
          onClick={onBulkDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("settings.evaluation.center.bulkDelete")}
        </Button>
        <Button
          size="sm"
          onClick={() => navigate(`${routeBase}/center/new`)}
        >
          {t("settings.evaluation.center.create")}
        </Button>
      </div>
    </div>
  );
}
