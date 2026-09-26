import { DatabaseZap, FilePlus2, Pencil, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import Skeleton from "@/shared/ui/Skeleton";
import Tooltip from "@/shared/ui/Tooltip";
import { useTranslation } from "react-i18next";
import type { FilterKey } from "../utils/mockData";

interface KnowledgeBaseToolbarProps {
  filter: FilterKey;
  selectedDocumentCount: number;
  canDeleteKnowledgeBase: boolean;
  onDeleteKnowledgeBase: () => void;
  onEditKnowledgeBase: () => void;
  onOpenMetadata: () => void;
  onOpenAddDocument: () => void;
  onBatchDelete: () => void;
  onFilterChange: (filter: FilterKey) => void;
  filterOptions: FilterKey[];
  loading?: boolean;
}

export default function KnowledgeBaseToolbar({
  filter,
  selectedDocumentCount,
  canDeleteKnowledgeBase,
  onDeleteKnowledgeBase,
  onEditKnowledgeBase,
  onOpenMetadata,
  onOpenAddDocument,
  onBatchDelete,
  onFilterChange,
  filterOptions,
  loading = false,
}: KnowledgeBaseToolbarProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Card variant="subtle" padding="none" className="inline-flex gap-1 p-1">
          <Skeleton height={28} width={52} />
          <Skeleton height={28} width={56} />
          <Skeleton height={28} width={60} />
        </Card>
        <Skeleton height={32} width={32} />
        <Skeleton height={32} width={108} />
        <Skeleton height={32} width={32} />
        <Skeleton height={32} width={124} />
        <Skeleton height={32} width={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Card variant="subtle" padding="none" className="inline-flex p-1">
        {filterOptions.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={`rounded-ui-control px-2.5 py-1 text-xs transition-colors ${
              filter === key
                ? "bg-surface-primary text-text-primary shadow-shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t(`settings.knowledgeBase.filter.${key}`)}
          </button>
        ))}
      </Card>
      <Tooltip text={t("settings.knowledgeBase.toolbar.editKnowledgeBase")} placement="top">
        <IconButton
          ariaLabel={t("settings.knowledgeBase.toolbar.editKnowledgeBase")}
          size="sm"
          styleType="outline"
          onClick={onEditKnowledgeBase}
        >
          <Pencil className="h-4 w-4" />
        </IconButton>
      </Tooltip>
      <Button variant="outline" size="sm" onClick={onOpenMetadata}>
        <DatabaseZap className="h-4 w-4" />
        {t("settings.knowledgeBase.toolbar.metadata")}
      </Button>
      <Tooltip text={t("settings.knowledgeBase.toolbar.addFile")} placement="top">
        <IconButton
          ariaLabel={t("settings.knowledgeBase.toolbar.addFile")}
          size="sm"
          styleType="outline"
          onClick={onOpenAddDocument}
        >
          <FilePlus2 className="h-4 w-4" />
        </IconButton>
      </Tooltip>
      <Button
        variant="danger-outline"
        size="sm"
        onClick={onBatchDelete}
        disabled={selectedDocumentCount === 0}
      >
        <Trash2 className="h-4 w-4" />
        {t("settings.knowledgeBase.toolbar.batchDelete")}
        {selectedDocumentCount > 0 ? ` (${selectedDocumentCount})` : ""}
      </Button>
      <Tooltip text={t("settings.knowledgeBase.toolbar.deleteKnowledgeBase")} placement="top">
        <IconButton
          ariaLabel={t("settings.knowledgeBase.toolbar.deleteKnowledgeBase")}
          size="sm"
          tone="danger"
          styleType="filled"
          disabled={!canDeleteKnowledgeBase}
          onClick={onDeleteKnowledgeBase}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </Tooltip>
    </div>
  );
}
