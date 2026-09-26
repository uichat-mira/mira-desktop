import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Download, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/shared/ui/Button";
import Table from "@/shared/ui/Table";
import type { ColumnMeta } from "@/shared/ui/Table";
import { getAppLanguage } from "@/shared/i18n";
import type { EvaluationRunRecord } from "../utils/types";
import StatusBadge from "./StatusBadge";
import { formatEvaluationKnowledgeBaseLabel } from "../utils/knowledgeBaseLabel";

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatDate = (value: string) =>
  new Date(value).toLocaleString(getAppLanguage(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

interface EvaluationRunTableProps {
  data: EvaluationRunRecord[];
  knowledgeBaseNameById: Record<string, string>;
  deletingRunId: string | null;
  selectedRunIds: string[];
  onSelectedRunIdsChange: (ids: string[]) => void;
  onViewRun: (run: EvaluationRunRecord) => void;
  onDownloadRun: (run: EvaluationRunRecord) => void;
  onDeleteRun: (run: EvaluationRunRecord) => void;
}

export default function EvaluationRunTable({
  data,
  knowledgeBaseNameById,
  deletingRunId,
  selectedRunIds,
  onSelectedRunIdsChange,
  onViewRun,
  onDownloadRun,
  onDeleteRun,
}: EvaluationRunTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<ColumnDef<EvaluationRunRecord>[]>(
    () => [
      {
        header: t("settings.evaluation.center.table.name"),
        accessorKey: "name",
        size: 300,
        minSize: 240,
        maxSize: 300,
        meta: {
          width: 300,
          sticky: "left",
          ellipsisTooltip: true,
        } satisfies ColumnMeta<EvaluationRunRecord>,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[300px]">
            <div className="truncate font-medium text-text-primary">
              {row.original.name}
            </div>
            <div className="mt-1 truncate text-xs text-text-secondary">
              {row.original.dataset.datasetName}
            </div>
            {formatEvaluationKnowledgeBaseLabel(
              row.original.dataset.knowledgeBaseId,
              knowledgeBaseNameById[row.original.dataset.knowledgeBaseId ?? ""],
            ) ? (
              <div className="mt-1 truncate text-[11px] text-text-tertiary">
                {t("settings.evaluation.center.table.knowledgeBase")} ·{" "}
                {formatEvaluationKnowledgeBaseLabel(
                  row.original.dataset.knowledgeBaseId,
                  knowledgeBaseNameById[
                    row.original.dataset.knowledgeBaseId ?? ""
                  ],
                )}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        header: t("settings.evaluation.center.table.status"),
        accessorKey: "status",
        size: 120,
        minSize: 120,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        header: t("settings.evaluation.center.table.sampleCount"),
        accessorKey: "sampleCount",
        size: 72,
        minSize: 72,
        cell: ({ row }) => row.original.dataset.summary.sampleCount,
      },
      {
        header: t("settings.evaluation.center.table.keyMetrics"),
        accessorKey: "metrics",
        size: 180,
        minSize: 180,
        cell: ({ row }) => (
          <div className="min-w-[150px] text-sm text-text-primary">
            Hit@K {formatPercent(row.original.metrics.hitAtK)}
            <div className="mt-1 text-xs text-text-secondary">
              Faithfulness {formatPercent(row.original.metrics.faithfulness)}
            </div>
          </div>
        ),
      },
      {
        header: t("settings.evaluation.center.table.completedAt"),
        accessorKey: "completedAt",
        size: 120,
        minSize: 120,
        cell: ({ row }) =>
          formatDate(row.original.completedAt ?? row.original.startedAt),
      },
      {
        header: t("settings.evaluation.center.table.actions"),
        id: "actions",
        size: 220,
        minSize: 220,
        cell: ({ row }) => (
          <div className="flex items-center justify-start gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewRun(row.original)}
            >
              {t("common.actions.view")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDownloadRun(row.original)}
            >
              <Download className="h-3.5 w-3.5" />
              {t("common.actions.download")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/5 hover:text-danger"
              disabled={
                deletingRunId === row.original.id ||
                row.original.status === "queued" ||
                row.original.status === "running"
              }
              onClick={() => onDeleteRun(row.original)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.actions.delete")}
            </Button>
          </div>
        ),
      },
    ],
    [deletingRunId, knowledgeBaseNameById, onDeleteRun, onDownloadRun, onViewRun, t],
  );

  return (
    <Table
      data={data}
      columns={columns}
      rowSelection={{
        selectedRowIds: selectedRunIds,
        onSelectedRowIdsChange: onSelectedRunIdsChange,
        getRowId: (row) => row.id,
        ariaLabel: (row) => row.name,
        selectAllAriaLabel: t("settings.evaluation.center.selectAllAria"),
      }}
      compact
      stickyHeader
      className="rounded-none border-0 shadow-none"
    />
  );
}
