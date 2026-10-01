import { DatabaseZap, FilePlus2, Pencil, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import Tooltip from "@/shared/ui/Tooltip";
import type { FilterKey } from "./mockData";

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
  filterOptions: Array<{ key: FilterKey; label: string }>;
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
}: KnowledgeBaseToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Card variant="subtle" padding="none" className="inline-flex p-1">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onFilterChange(option.key)}
            className={`rounded-ui-control px-2.5 py-1 text-xs transition-colors ${
              filter === option.key
                ? "bg-surface-primary text-text-primary shadow-shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </Card>
      <Tooltip text="编辑知识库" placement="top">
        <IconButton
          ariaLabel="编辑知识库"
          size="sm"
          styleType="outline"
          onClick={onEditKnowledgeBase}
        >
          <Pencil className="h-4 w-4" />
        </IconButton>
      </Tooltip>
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenMetadata}
      >
        <DatabaseZap className="h-4 w-4" />
        元数据
      </Button>
      <Tooltip text="添加文件" placement="top">
        <IconButton
          ariaLabel="添加文件"
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
        删除所选
        {selectedDocumentCount > 0 ? ` (${selectedDocumentCount})` : ""}
      </Button>
      <Tooltip text="删除知识库" placement="top">
        <IconButton
          ariaLabel="删除知识库"
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
