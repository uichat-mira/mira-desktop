import { useTranslation } from "react-i18next";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import DetailDrawer from "../../components/DetailDrawer";
import EvaluationCenterToolbar from "../../components/EvaluationCenterToolbar";
import EvaluationRunTable from "../../components/EvaluationRunTable";
import { useEvaluationCenter } from "./hooks/useEvaluationCenter";

export default function EvaluationCenter() {
  const { t } = useTranslation();
  const {
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
  } = useEvaluationCenter();

  return (
    <AppPageLayout
      miniTitle={t("settings.evaluation.center.page.miniTitle")}
      title={t("settings.evaluation.center.page.title")}
      description={t("settings.evaluation.center.page.description")}
      containerClassName="max-w-none"
      contentClassName="flex h-full min-h-0 flex-col gap-4 pt-6"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <EvaluationCenterToolbar
          query={query}
          onQueryChange={setQuery}
          refreshing={refreshing}
          onRefresh={() => void loadRuns({ silent: true })}
          selectedCount={selectedRunIds.length}
          onBulkDelete={confirmBulkDeleteRuns}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center rounded-ui-panel border border-dashed border-border bg-surface-secondary text-sm text-text-secondary">
              {t("settings.evaluation.center.loading")}
            </div>
          ) : filteredRuns.length > 0 ? (
            <div className="min-h-0 h-full overflow-hidden rounded-ui-panel border border-border bg-surface-primary">
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                  <EvaluationRunTable
                    data={filteredRuns}
                    knowledgeBaseNameById={knowledgeBaseNameById}
                    deletingRunId={deletingRunId}
                    selectedRunIds={selectedRunIds}
                    onSelectedRunIdsChange={setSelectedRunIds}
                    onViewRun={setSelectedRun}
                    onDownloadRun={handleDownloadRun}
                    onDeleteRun={confirmDeleteRun}
                  />
                </div>
                <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 text-body-small text-sm text-text-secondary">
                  <div>
                    {t("settings.evaluation.center.recordCount", {
                      count: filteredRuns.length,
                    })}
                  </div>
                  <div>
                    {t("settings.evaluation.center.selectedCount", {
                      count: selectedRunIds.length,
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-ui-panel border border-dashed border-border bg-surface-secondary text-sm text-text-secondary">
              {runs.length === 0
                ? t("settings.evaluation.center.empty")
                : t("settings.evaluation.center.noMatch")}
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
