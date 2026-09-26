import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Download, Ellipsis, Eye, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import { Button } from "@/shared/ui/Button";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import Table from "@/shared/ui/Table";
import type { ColumnMeta } from "@/shared/ui/Table";
import { Modal } from "@/shared/ui/Modal";
import {
  deleteEvaluationRun,
  deleteEvaluationRuns,
  getEvaluationRuns,
} from "@/shared/api/evaluation";
import { listKnowledgeBases } from "@/shared/api/knowledgeBase";
import type { EvaluationRunRecord } from "./types";
import StatusBadge from "@/features/Evaluation/components/StatusBadge";
import DetailDrawer from "@/features/Evaluation/components/DetailDrawer";
import { message } from "@/shared/ui/Message";
import type { ColumnDef } from "@tanstack/react-table";
import { downloadEvaluationRunMarkdown } from "./exportMarkdown";
import { getAppLanguage } from "@/shared/i18n";
import { formatEvaluationKnowledgeBaseLabel } from "./knowledgeBaseLabel";

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatDate = (value: string) =>
  new Date(value).toLocaleString(getAppLanguage(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function EvaluationCenter() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/evaluation";
  const [runs, setRuns] = useState<EvaluationRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedRun, setSelectedRun] = useState<EvaluationRunRecord | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [knowledgeBaseNameById, setKnowledgeBaseNameById] = useState<
    Record<string, string>
  >({});

  const loadRuns = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const nextRuns = await getEvaluationRuns();
      setRuns(nextRuns);
      setSelectedRunIds((current) =>
        current.filter((id) => nextRuns.some((run) => run.id === id)),
      );
      setSelectedRun((current) =>
        current ? nextRuns.find((run) => run.id === current.id) ?? null : null,
      );
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("settings.evaluation.center.messages.loadFailed"),
      );
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadRuns();
  }, []);

  useEffect(() => {
    const loadKnowledgeBaseNames = async () => {
      try {
        const items = await listKnowledgeBases();
        setKnowledgeBaseNameById(
          items.reduce<Record<string, string>>((acc, item) => {
            acc[item.id] = item.name;
            return acc;
          }, {}),
        );
      } catch {
        setKnowledgeBaseNameById({});
      }
    };

    void loadKnowledgeBaseNames();
  }, []);

  const handleDownloadRun = async (run: EvaluationRunRecord) => {
    try {
      await downloadEvaluationRunMarkdown(run);
      message.success(
        t("settings.evaluation.center.messages.downloadStarted", {
          name: run.name,
        }),
      );
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("settings.evaluation.center.messages.exportFailed"),
      );
    }
  };

  const confirmDeleteRun = (run: EvaluationRunRecord) => {
    Modal.confirm({
      title: t("settings.evaluation.center.deleteModal.title"),
      description: `${t("settings.evaluation.center.deleteModal.description", {
        name: run.name,
      })} ${t("settings.evaluation.center.deleteModal.warning")}`,
      width: 440,
      tone: "danger",
      confirmText: t("settings.evaluation.center.deleteModal.confirm"),
      loadingText: t("settings.evaluation.center.deleteModal.deleting"),
      onConfirm: async () => {
        try {
          setDeletingRunId(run.id);
          await deleteEvaluationRun(run.id);
          setRuns((current) => current.filter((item) => item.id !== run.id));
          setSelectedRun((current) => (current?.id === run.id ? null : current));
          message.success(
            t("settings.evaluation.center.messages.deleted", {
              name: run.name,
            }),
          );
        } catch (error) {
          throw new Error(
            error instanceof Error
              ? error.message
              : t("settings.evaluation.center.messages.deleteFailed"),
          );
        } finally {
          setDeletingRunId((current) => (current === run.id ? null : current));
        }
      },
    });
  };

  const confirmBulkDeleteRuns = () => {
    const selectedRuns = runs.filter((run) => selectedRunIds.includes(run.id));
    if (selectedRuns.length === 0) {
      return;
    }

    Modal.confirm({
      title: t("settings.evaluation.center.bulkDeleteModal.title"),
      description: t("settings.evaluation.center.bulkDeleteModal.description", {
        count: selectedRuns.length,
      }),
      width: 460,
      tone: "danger",
      confirmText: t("settings.evaluation.center.bulkDeleteModal.confirm"),
      loadingText: t("settings.evaluation.center.bulkDeleteModal.deleting"),
      onConfirm: async () => {
        const { deletedIds } = await deleteEvaluationRuns(
          selectedRuns.map((run) => run.id),
        );
        const deletedIdSet = new Set(deletedIds);
        const deletedRuns = selectedRuns.filter((run) => deletedIdSet.has(run.id));
        const failedRuns = selectedRuns.filter((run) => !deletedIdSet.has(run.id));

        setRuns((current) => current.filter((item) => !deletedIdSet.has(item.id)));
        setSelectedRunIds((current) => current.filter((id) => !deletedIdSet.has(id)));
        setSelectedRun((current) =>
          current && deletedIdSet.has(current.id) ? null : current,
        );

        if (deletedRuns.length > 0) {
          message.success(
            t("settings.evaluation.center.bulkDeleteModal.success", {
              count: deletedRuns.length,
            }),
          );
        }

        if (failedRuns.length > 0) {
          throw new Error(
            t("settings.evaluation.center.bulkDeleteModal.partialFailed", {
              count: failedRuns.length,
            }),
          );
        }
      },
    });
  };

  const filteredRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return runs;
    }

    return runs.filter((run) =>
      [
        run.name,
        run.dataset.datasetName,
        run.dataset.knowledgeBaseId ?? "",
        formatEvaluationKnowledgeBaseLabel(
          run.dataset.knowledgeBaseId,
          knowledgeBaseNameById[run.dataset.knowledgeBaseId ?? ""],
        ) ?? "",
      ].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [knowledgeBaseNameById, query, runs]);

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
                  knowledgeBaseNameById[row.original.dataset.knowledgeBaseId ?? ""],
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
        size: 56,
        minSize: 56,
        meta: {
          align: "right",
        } satisfies ColumnMeta<EvaluationRunRecord>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <DropdownMenu
              align="end"
              sideOffset={4}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent bg-transparent p-0 text-text-secondary transition-all duration-150 hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
                  aria-label={`${t("common.actions.more")}: ${row.original.name}`}
                >
                  <Ellipsis className="h-4 w-4" />
                </button>
              }
              items={[
                {
                  id: "view",
                  label: t("common.actions.view"),
                  leadingIcon: <Eye className="h-4 w-4" />,
                },
                {
                  id: "download",
                  label: t("common.actions.download"),
                  leadingIcon: <Download className="h-4 w-4" />,
                },
                {
                  id: "delete",
                  label: t("common.actions.delete"),
                  leadingIcon: <Trash2 className="h-4 w-4" />,
                  tone: "danger",
                  disabled:
                    deletingRunId === row.original.id ||
                    row.original.status === "queued" ||
                    row.original.status === "running",
                },
              ]}
              onSelect={(item) => {
                if (item.id === "view") {
                  setSelectedRun(row.original);
                  return;
                }
                if (item.id === "download") {
                  void handleDownloadRun(row.original);
                  return;
                }
                if (item.id === "delete") {
                  confirmDeleteRun(row.original);
                }
              }}
            />
          </div>
        ),
      },
    ],
    [deletingRunId, t],
  );

  return (
    <AppPageLayout
      miniTitle={t("settings.evaluation.center.page.miniTitle")}
      title={t("settings.evaluation.center.page.title")}
      description={t("settings.evaluation.center.page.description")}
      contentClassName="flex h-full min-h-0 flex-col gap-4 pt-6"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex min-w-[320px] flex-1 items-center justify-end gap-2 max-md:w-full">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-icon-secondary" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("settings.evaluation.center.searchPlaceholder")}
                className="h-9 w-full rounded-xl border border-border bg-surface-primary pl-9 pr-3 text-sm text-text-primary shadow-shadow-sm transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={refreshing}
              onClick={() => void loadRuns({ silent: true })}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {t("common.actions.refresh")}
            </Button>
            <Button
              variant="danger-ghost"
              size="sm"
              disabled={selectedRunIds.length === 0}
              onClick={confirmBulkDeleteRuns}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("settings.evaluation.center.bulkDelete")}
            </Button>
            <Button
              size="sm"
              onClick={() => navigate(`${routeBase}/center/new`)}
            >
              新建评测
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center rounded-ui-panel border border-dashed border-border bg-surface-secondary text-sm text-text-secondary">
              {t("settings.evaluation.center.loading")}
            </div>
          ) : (
            <div className="min-h-0 h-full overflow-hidden rounded-ui-panel border border-border bg-surface-primary">
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                  <Table
                    data={filteredRuns}
                    columns={columns}
                    emptyState={
                      <div className="flex min-h-[320px] items-center justify-center text-sm text-text-secondary">
                        {runs.length === 0
                          ? t("settings.evaluation.center.empty")
                          : t("settings.evaluation.center.noMatch")}
                      </div>
                    }
                    rowSelection={{
                      selectedRowIds: selectedRunIds,
                      onSelectedRowIdsChange: setSelectedRunIds,
                      getRowId: (row) => row.id,
                      ariaLabel: (row) => row.name,
                      selectAllAriaLabel: "Select all evaluation runs",
                    }}
                    compact
                    stickyHeader
                    className="rounded-none border-0 shadow-none"
                  />
                </div>
                {filteredRuns.length > 0 ? (
                  <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 text-body-small text-sm text-text-secondary">
                    <div>共 {filteredRuns.length} 条记录</div>
                    <div>已选 {selectedRunIds.length} 条</div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <DetailDrawer
        open={Boolean(selectedRun)}
        run={selectedRun}
        knowledgeBaseName={
          selectedRun
            ? knowledgeBaseNameById[selectedRun.dataset.knowledgeBaseId ?? ""]
            : undefined
        }
        onClose={() => setSelectedRun(null)}
        onDelete={confirmDeleteRun}
        onDownload={handleDownloadRun}
        deleting={selectedRun ? deletingRunId === selectedRun.id : false}
      />
    </AppPageLayout>
  );
}
