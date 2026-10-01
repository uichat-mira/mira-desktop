import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDownUp,
  ArrowDown,
  ArrowUp,
  Ellipsis,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { FileIcon } from "@/shared/ui/FileIcon";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import Skeleton from "@/shared/ui/Skeleton";
import Switch from "@/shared/ui/Switch";
import Table from "@/shared/ui/Table";
import type { ColumnMeta } from "@/shared/ui/Table";
import type { DocumentRow, DocumentSortKey } from "../hooks/useKnowledgeBase";

type DocumentTableProps = {
  data: DocumentRow[];
  selectedRowIds: string[];
  onSelectedRowIdsChange: (ids: string[]) => void;
  sortBy: DocumentSortKey;
  sortOrder: "asc" | "desc";
  onToggleSort: (key: DocumentSortKey) => void;
  togglingDocumentIds: string[];
  onToggleDocumentEnabled: (document: DocumentRow) => void;
  onRebuildIndex: (document: DocumentRow) => void;
  onDeleteDocument: (document: DocumentRow) => void;
  onGoToDetail: (document: DocumentRow) => void;
  emptyState: string;
  selectedKnowledgeBaseId: string | null;
  tableScrollRef: React.RefObject<HTMLDivElement>;
  loading?: boolean;
};

function getIndexStatusNotice(
  t: ReturnType<typeof useTranslation>["t"],
  document: DocumentRow,
) {
  if (document.indexStatus === "failed") {
    return {
      label: t("settings.knowledgeBase.status.failed"),
      className: "text-danger-text",
    };
  }

  if (document.indexStatus === "processing") {
    return {
      label: t("settings.knowledgeBase.status.processing"),
      className: "text-warning",
    };
  }

  return null;
}

export default function DocumentTable({
  data,
  selectedRowIds,
  onSelectedRowIdsChange,
  sortBy,
  sortOrder,
  onToggleSort,
  togglingDocumentIds,
  onToggleDocumentEnabled,
  onRebuildIndex,
  onDeleteDocument,
  onGoToDetail,
  emptyState,
  selectedKnowledgeBaseId,
  tableScrollRef,
  loading = false,
}: DocumentTableProps) {
  const { t } = useTranslation();

  const renderSortIcon = useCallback(
    (column: DocumentSortKey) => {
      if (sortBy !== column) {
        return <ArrowDownUp className="h-3 w-3 text-icon-tertiary" />;
      }

      return sortOrder === "asc" ? (
        <ArrowUp className="h-3 w-3 text-primary" />
      ) : (
        <ArrowDown className="h-3 w-3 text-primary" />
      );
    },
    [sortBy, sortOrder],
  );

  const columns = useMemo<ColumnDef<DocumentRow>[]>(
    () => [
      {
        accessorKey: "name",
        size: 300,
        meta: {
          width: "30%",
          sticky: "left",
          ellipsisTooltip: true,
        } satisfies ColumnMeta<DocumentRow>,
        header: () => (
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-xs font-medium tracking-[0.02em] ${
              sortBy === "name" ? "text-text-primary" : "text-text-tertiary"
            }`}
            onClick={() => onToggleSort("name")}
          >
            {t("settings.knowledgeBase.table.name")}
            {renderSortIcon("name")}
          </button>
        ),
        sortingFn: "alphanumeric",
        cell: ({ row }) => (
          <div className="flex min-w-0 w-full items-center gap-2">
            <FileIcon
              extension={row.original.type}
              className="h-4 w-4 shrink-0"
            />
            <button
              type="button"
              className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left font-medium text-text-primary transition-colors hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              onClick={(event) => {
                event.stopPropagation();
                onGoToDetail(row.original);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {row.original.name}
            </button>
          </div>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: () => (
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-xs font-medium tracking-[0.02em] ${
              sortBy === "updatedAt"
                ? "text-text-primary"
                : "text-text-tertiary"
            }`}
            onClick={() => onToggleSort("updatedAt")}
          >
            {t("settings.knowledgeBase.table.updatedAt")}
            {renderSortIcon("updatedAt")}
          </button>
        ),
        size: 96,
        meta: {
          mono: true,
          muted: true,
        } satisfies ColumnMeta<DocumentRow>,
      },
      {
        id: "status",
        header: () => (
          <div className="text-xs font-medium tracking-[0.02em] text-text-tertiary">
            {t("settings.knowledgeBase.table.status")}
          </div>
        ),
        size: 144,
        cell: ({ row }) => {
          const statusNotice = getIndexStatusNotice(t, row.original);

          return (
            <div
              className="inline-flex items-center gap-2"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <Switch
                checked={row.original.enabled}
                onChange={() => {
                  onToggleDocumentEnabled(row.original);
                }}
                disabled={togglingDocumentIds.includes(row.original.id)}
                size="sm"
                ariaLabel={
                  row.original.enabled
                    ? t("settings.knowledgeBase.actions.disableDocument")
                    : t("settings.knowledgeBase.actions.enableDocument")
                }
              />
              {statusNotice ? (
                <span
                  className={`text-xs font-medium leading-5 ${statusNotice.className}`}
                >
                  {statusNotice.label}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => (
          <div className="text-right text-xs font-medium tracking-[0.02em] text-text-tertiary">
            {t("settings.knowledgeBase.table.actions")}
          </div>
        ),
        size: 56,
        meta: {
          align: "right",
        } satisfies ColumnMeta<DocumentRow>,
        cell: ({ row }) => (
          <div
            className="relative flex items-center justify-end gap-1"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            data-kb-action-menu
          >
            <DropdownMenu
              align="end"
              sideOffset={4}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent bg-transparent p-0 text-text-secondary transition-all duration-150 hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
                  aria-label={t(
                    "settings.knowledgeBase.filters.moreActionsAria",
                    { name: row.original.name },
                  )}
                >
                  <Ellipsis className="h-4 w-4" />
                </button>
              }
              items={[
                {
                  id: "rebuild",
                  label: t("settings.knowledgeBase.actions.rebuildIndex"),
                  leadingIcon: <RotateCcw className="h-4 w-4" />,
                },
                {
                  id: "delete",
                  label: t("common.actions.delete"),
                  leadingIcon: <Trash2 className="h-4 w-4" />,
                  tone: "danger",
                },
              ]}
              onSelect={(item) => {
                if (item.id === "rebuild") {
                  onRebuildIndex(row.original);
                  return;
                }
                if (item.id === "delete") {
                  onDeleteDocument(row.original);
                }
              }}
            />
          </div>
        ),
      },
    ],
    [
      sortBy,
      sortOrder,
      t,
      togglingDocumentIds,
      onToggleSort,
      onToggleDocumentEnabled,
      onRebuildIndex,
      onDeleteDocument,
      renderSortIcon,
    ],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {loading ? (
        <div className="min-h-full bg-surface-primary">
          <div className="grid grid-cols-[32px_30%_96px_144px_56px] items-center gap-0 border-b border-border px-3 py-2">
            <Skeleton height={12} width={14} />
            <Skeleton height={12} width={72} />
            <Skeleton height={12} width={52} />
            <Skeleton height={12} width={44} />
            <Skeleton height={12} width={38} className="justify-self-end" />
          </div>
          <div className="px-3 py-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="grid grid-cols-[32px_30%_96px_144px_56px] items-center gap-0 border-b border-border/70 py-3 last:border-b-0"
              >
                <Skeleton height={14} width={14} />
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton height={16} width={16} className="shrink-0" />
                  <Skeleton
                    height={16}
                    width={`${46 + ((index % 3) + 1) * 10}%`}
                    className="max-w-[180px]"
                  />
                </div>
                <Skeleton height={14} width={54} />
                <div className="flex items-center gap-2">
                  <Skeleton height={20} width={30} className="rounded-full" />
                </div>
                <div className="flex items-center justify-end">
                  <Skeleton height={28} width={28} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Table
          key={selectedKnowledgeBaseId ?? "empty"}
          data={data}
          columns={columns}
          rowSelection={{
            selectedRowIds,
            onSelectedRowIdsChange,
            getRowId: (row) => row.id,
            ariaLabel: (row) => row.name,
            selectAllAriaLabel: "Select all documents",
          }}
          compact
          stickyHeader
          className="rounded-none border-0 shadow-none"
          emptyState={emptyState}
          scrollRef={tableScrollRef}
          getRowProps={(row) => ({
            onDoubleClick: () => onGoToDetail(row.original),
          })}
        />
      )}
    </div>
  );
}
