import { Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import type { KnowledgeBaseSummary } from "@/shared/api/knowledgeBase";

interface KnowledgeBaseSidebarProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onCreate: () => void;
  knowledgeBases: KnowledgeBaseSummary[];
  selectedKnowledgeBaseId: string | null;
  onSelectKnowledgeBase: (knowledgeBaseId: string) => void;
}

function formatKnowledgeBaseUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return "刚刚更新";
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 1) {
    return "刚刚更新";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}分钟前更新`;
  }

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) {
    return `${diffHours}小时前更新`;
  }

  return `${Math.max(Math.floor(diffMs / (1000 * 60 * 60 * 24)), 1)}天前更新`;
}

export default function KnowledgeBaseSidebar({
  searchText,
  onSearchTextChange,
  onCreate,
  knowledgeBases,
  selectedKnowledgeBaseId,
  onSelectKnowledgeBase,
}: KnowledgeBaseSidebarProps) {
  const { t } = useTranslation();

  return (
    <Card className="flex h-full min-h-0 flex-col" padding="sm">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-icon-tertiary" />
          <input
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder={t("settings.knowledgeBase.sidebar.searchPlaceholder")}
            className="h-8 w-full rounded-ui-control border border-border bg-surface-primary pl-8 pr-3 text-[13px] text-text-primary shadow-shadow-sm transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2"
          onClick={onCreate}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="stable-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {knowledgeBases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-text-secondary">
              {t("settings.knowledgeBase.sidebar.empty")}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {knowledgeBases.map((item) => {
              const isActive = item.id === selectedKnowledgeBaseId;
              const updatedAtLabel = formatKnowledgeBaseUpdatedAt(
                item.updatedAt,
              );

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectKnowledgeBase(item.id)}
                  className={`group flex w-full items-center gap-3 rounded-ui-control px-3 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-surface-secondary"
                      : "hover:bg-surface-secondary/60"
                  }`}
                >
                  <div
                    className={`h-4 w-[2px] shrink-0 rounded-full transition-colors ${
                      isActive
                        ? "bg-primary"
                        : "bg-transparent group-hover:bg-border"
                    }`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">
                        {item.name}
                      </span>
                    </div>
                    {updatedAtLabel ? (
                      <div className="mt-0.5 truncate text-[11px] leading-4 text-text-tertiary tabular-nums">
                        {updatedAtLabel}
                      </div>
                    ) : null}
                  </div>

                  <span
                    className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${
                      isActive
                        ? "bg-surface-primary text-text-secondary"
                        : "bg-surface-secondary text-text-tertiary group-hover:bg-surface-tertiary group-hover:text-text-secondary"
                    }`}
                  >
                    {item.documentCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
