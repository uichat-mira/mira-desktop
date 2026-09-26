import { Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/Button";
import Skeleton from "@/shared/ui/Skeleton";
import type { KnowledgeBaseSummary } from "@/shared/api/knowledgeBase";

interface KnowledgeBaseSidebarProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onCreate: () => void;
  knowledgeBases: KnowledgeBaseSummary[];
  selectedKnowledgeBaseId: string | null;
  onSelectKnowledgeBase: (knowledgeBaseId: string) => void;
  loading?: boolean;
}

function formatKnowledgeBaseCount(count: number) {
  return `${count}`;
}

function formatKnowledgeBaseUpdatedAt(
  value: string,
  t: (key: string, data?: Record<string, unknown>) => string,
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return t("settings.knowledgeBase.sidebar.updatedJustNow");
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 1) {
    return t("settings.knowledgeBase.sidebar.updatedJustNow");
  }

  if (diffMinutes < 60) {
    return t("settings.knowledgeBase.sidebar.updatedMinutesAgo", {
      minutes: diffMinutes,
    });
  }

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) {
    return t("settings.knowledgeBase.sidebar.updatedHoursAgo", {
      hours: diffHours,
    });
  }

  return t("settings.knowledgeBase.sidebar.updatedDaysAgo", {
    days: Math.max(Math.floor(diffMs / (1000 * 60 * 60 * 24)), 1),
  });
}

export default function KnowledgeBaseSidebar({
  searchText,
  onSearchTextChange,
  onCreate,
  knowledgeBases,
  selectedKnowledgeBaseId,
  onSelectKnowledgeBase,
  loading = false,
}: KnowledgeBaseSidebarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pt-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-icon-secondary" />
          <input
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder={t("settings.knowledgeBase.sidebar.searchPlaceholder")}
            className="h-8 w-full rounded-ui-control border border-border bg-surface-primary pl-9 pr-3 text-[13px] text-text-primary shadow-shadow-sm transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="stable-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3 pr-1">
        <div className="divide-y divide-border">
          {loading
            ? Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Skeleton height={16} width={`${54 + index * 4}%`} />
                    <Skeleton
                      height={20}
                      width={24}
                      className="ml-auto rounded-md"
                    />
                  </div>
                  <Skeleton
                    height={12}
                    width={`${36 + index * 3}%`}
                    className="mt-2"
                  />
                </div>
              ))
            : null}
          {knowledgeBases.map((item) => {
            const isActive = item.id === selectedKnowledgeBaseId;
            const updatedAtLabel = formatKnowledgeBaseUpdatedAt(
              item.updatedAt,
              t,
            );

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectKnowledgeBase(item.id)}
                className={`group grid w-full grid-cols-[minmax(0,1fr)_24px] items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 ${
                  isActive
                    ? "bg-surface-soft text-text-primary"
                    : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                }`}
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-primary">
                    {item.name}
                  </span>
                  {updatedAtLabel ? (
                    <div
                      className={`mt-0.5 truncate text-[11px] leading-4 tabular-nums ${
                        isActive ? "text-text-secondary" : "text-text-tertiary"
                      }`}
                    >
                      {updatedAtLabel}
                    </div>
                  ) : null}
                </div>
                <span
                  className={`mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-medium tabular-nums transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "bg-surface-secondary text-text-tertiary group-hover:bg-surface-primary"
                  }`}
                >
                  {formatKnowledgeBaseCount(item.documentCount)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
