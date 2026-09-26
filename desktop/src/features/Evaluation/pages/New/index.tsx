import { useTranslation } from "react-i18next";
import { Eye, FolderArchive } from "lucide-react";
import Card from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { FileUploadDropzone } from "@/shared/ui/FileUploadDropzone";
import { Modal } from "@/shared/ui/Modal";
import { getAppLanguage } from "@/shared/i18n";
import EvaluationPackageGeneratorModal from "../../components/EvaluationPackageGeneratorModal";
import EvaluationWorkbenchHeader from "../../components/EvaluationWorkbenchHeader";
import WorkbenchStateBar from "../../components/WorkbenchStateBar";
import StatusBadge from "../../components/StatusBadge";
import ValidationPill from "../../components/ValidationPill";
import DatasetPreviewDrawer from "../../components/DatasetPreviewDrawer";
import EvaluationWorkbenchConsole from "../../components/EvaluationWorkbenchConsole";
import { useEvaluationWorkbench } from "./hooks/useEvaluationWorkbench";

const formatFileSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString(getAppLanguage(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function EvaluationWorkbench() {
  const { t } = useTranslation();
  const {
    dataset,
    status,
    parsing,
    consoleTab,
    setConsoleTab,
    runRecord,
    savedRunId,
    previewOpen,
    setPreviewOpen,
    logScrollRef,
    resultScrollRef,
    canRun,
    displayStatus,
    progressWidth,
    handleSelectFiles,
    handleStartEvaluation,
  } = useEvaluationWorkbench();

  const openPackageGenerator = () => {
    let modalKey = "";
    modalKey = Modal.show({
      title: t("settings.evaluation.packageGenerator.title"),
      width: 820,
      footer: null,
      bodyClassName: "px-4 py-3",
      content: (
        <EvaluationPackageGeneratorModal
          onClose={() => Modal.close(modalKey)}
        />
      ),
    });
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden">
      <EvaluationWorkbenchHeader
        canRun={canRun}
        onOpenPackageGenerator={openPackageGenerator}
        onStartEvaluation={handleStartEvaluation}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-none flex-col gap-4 px-2 pb-6 pt-1 lg:h-full">
          <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(340px,1fr)_minmax(0,2fr)]">
            <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <Card className="space-y-3 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text-primary">
                    {t("settings.evaluation.workbench.packageCard.title")}
                  </div>
                  {dataset ? <StatusBadge status={displayStatus} /> : null}
                </div>

                <FileUploadDropzone
                  onSelectFiles={(files) => {
                    void handleSelectFiles(files);
                  }}
                  accept=".zip"
                  maxCount={1}
                  helperText={
                    parsing
                      ? t("settings.evaluation.workbench.packageCard.parsing")
                      : t("settings.evaluation.workbench.packageCard.helper")
                  }
                  className="px-3 py-3"
                  disabled={parsing}
                />

                {dataset ? (
                  <>
                    <Card
                      variant="subtle"
                      className="px-3 py-2.5 text-xs leading-5 text-text-secondary"
                    >
                      <div className="font-medium text-text-primary">
                        {dataset.fileName}
                      </div>
                      <div>
                        {formatFileSize(dataset.fileSize)} ·{" "}
                        {t("settings.evaluation.shared.uploadedAt", {
                          value: formatDate(dataset.uploadedAt),
                        })}
                      </div>
                    </Card>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Card variant="subtle" className="px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                          {t(
                            "settings.evaluation.workbench.packageCard.dataset",
                          )}
                        </div>
                        <div className="mt-1 text-sm font-medium text-text-primary">
                          {dataset.datasetName}
                        </div>
                        <div className="mt-1 text-xs text-text-secondary">
                          {t("settings.evaluation.shared.documentCount", {
                            count: dataset.summary.documentCount,
                          })}{" "}
                          ·{" "}
                          {t("settings.evaluation.shared.sampleCount", {
                            count: dataset.summary.sampleCount,
                          })}
                        </div>
                      </Card>
                      <Card variant="subtle" className="px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                          {t(
                            "settings.evaluation.workbench.packageCard.runtimeConfig",
                          )}
                        </div>
                        <div className="mt-1 text-sm font-medium text-text-primary">
                          {dataset.config.mode === "retrieve"
                            ? t("settings.evaluation.shared.modeRetrieve")
                            : t(
                                "settings.evaluation.shared.modeRetrieveGenerate",
                              )}
                        </div>
                        <div className="mt-1 text-xs text-text-secondary">
                          topK {dataset.config.topK} · topN{" "}
                          {dataset.config.topN} · N {dataset.config.repeat}
                        </div>
                      </Card>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPreviewOpen(true)}
                      >
                        <Eye className="h-4 w-4" />
                        {t(
                          "settings.evaluation.workbench.packageCard.openPreview",
                        )}
                      </Button>
                    </div>
                  </>
                ) : null}
              </Card>

              <Card className="space-y-3 p-3.5">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-semibold text-text-primary">
                    {t("settings.evaluation.workbench.validation.title")}
                  </div>
                </div>
                {dataset ? (
                  <div className="space-y-2">
                    {dataset.validations.map((item) => (
                      <Card
                        key={item.id}
                        variant="subtle"
                        className="px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-text-primary">
                            {item.label}
                          </div>
                          <ValidationPill status={item.status} />
                        </div>
                        <div className="mt-1 text-xs leading-5 text-text-secondary">
                          {item.detail}
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card
                    variant="dashed"
                    className="px-3 py-5 text-sm text-text-secondary"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <FolderArchive className="h-4 w-4" />
                      {t("settings.evaluation.workbench.validation.empty")}
                    </div>
                  </Card>
                )}
              </Card>
            </div>

            <div className="flex min-h-[560px] flex-col gap-3 lg:min-h-0 lg:h-full">
              <WorkbenchStateBar
                status={displayStatus}
                dataset={dataset}
                runRecord={runRecord}
              />

              <EvaluationWorkbenchConsole
                consoleTab={consoleTab}
                onConsoleTabChange={setConsoleTab}
                dataset={dataset}
                runRecord={runRecord}
                status={status}
                progressWidth={progressWidth}
                savedRunId={savedRunId}
                logScrollRef={logScrollRef}
                resultScrollRef={resultScrollRef}
              />
            </div>
          </div>
        </div>
      </div>

      <DatasetPreviewDrawer
        open={previewOpen}
        dataset={dataset}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
