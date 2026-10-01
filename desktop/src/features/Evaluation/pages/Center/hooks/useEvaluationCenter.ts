import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/shared/ui/Modal";
import { message } from "@/shared/ui/Message";
import {
  deleteEvaluationRun,
  deleteEvaluationRuns,
  getEvaluationRuns,
} from "@/shared/api/evaluation";
import { listKnowledgeBases } from "@/shared/api/knowledgeBase";
import type { EvaluationRunRecord } from "../../../utils/types";
import { downloadEvaluationRunMarkdown } from "../../../utils/exportMarkdown";
import { formatEvaluationKnowledgeBaseLabel } from "../../../utils/knowledgeBaseLabel";

export function useEvaluationCenter() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<EvaluationRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedRun, setSelectedRun] = useState<EvaluationRunRecord | null>(
    null,
  );
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [knowledgeBaseNameById, setKnowledgeBaseNameById] = useState<
    Record<string, string>
  >({});

  const loadRuns = useCallback(
    async (options?: { silent?: boolean }) => {
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
          current
            ? nextRuns.find((run) => run.id === current.id) ?? null
            : null,
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
    },
    [t],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

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

  const handleDownloadRun = useCallback(
    async (run: EvaluationRunRecord) => {
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
    },
    [t],
  );

  const confirmDeleteRun = useCallback(
    (run: EvaluationRunRecord) => {
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
            setRuns((current) =>
              current.filter((item) => item.id !== run.id),
            );
            setSelectedRun((current) =>
              current?.id === run.id ? null : current,
            );
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
            setDeletingRunId((current) =>
              current === run.id ? null : current,
            );
          }
        },
      });
    },
    [t],
  );

  const confirmBulkDeleteRuns = useCallback(() => {
    const selectedRuns = runs.filter((run) => selectedRunIds.includes(run.id));
    if (selectedRuns.length === 0) {
      return;
    }

    Modal.confirm({
      title: t("settings.evaluation.center.bulkDeleteModal.title"),
      description: t(
        "settings.evaluation.center.bulkDeleteModal.description",
        {
          count: selectedRuns.length,
        },
      ),
      width: 460,
      tone: "danger",
      confirmText: t("settings.evaluation.center.bulkDeleteModal.confirm"),
      loadingText: t("settings.evaluation.center.bulkDeleteModal.deleting"),
      onConfirm: async () => {
        const { deletedIds } = await deleteEvaluationRuns(
          selectedRuns.map((run) => run.id),
        );
        const deletedIdSet = new Set(deletedIds);
        const deletedRuns = selectedRuns.filter((run) =>
          deletedIdSet.has(run.id),
        );
        const failedRuns = selectedRuns.filter(
          (run) => !deletedIdSet.has(run.id),
        );

        setRuns((current) =>
          current.filter((item) => !deletedIdSet.has(item.id)),
        );
        setSelectedRunIds((current) =>
          current.filter((id) => !deletedIdSet.has(id)),
        );
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
  }, [runs, selectedRunIds, t]);

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
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [knowledgeBaseNameById, query, runs]);

  return {
    runs,
    loading,
    refreshing,
    query,
    setQuery,
    selectedRun,
    setSelectedRun,
    selectedRunIds,
    setSelectedRunIds,
    deletingRunId,
    knowledgeBaseNameById,
    loadRuns,
    handleDownloadRun,
    confirmDeleteRun,
    confirmBulkDeleteRuns,
    filteredRuns,
  };
}
