import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import { message } from "@/shared/ui/Message";
import { StepIndicator } from "@/shared/ui/StepIndicator";
import FileUploadStep from "../../components/add/FileUploadStep";
import ChunkSettingsStep from "../../components/add/ChunkSettingsStep";
import ProcessingStep from "../../components/add/ProcessingStep";
import { useAddWizard, type UploadStep } from "../../hooks/useAddWizard";

export default function KnowledgeBaseAddWizard() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/knowledge-base";
  const wizard = useAddWizard();

  const {
    currentStep,
    settings,
    files,
    previewStats,
    previewFileId,
    processingProgress,
    processingDone,
    processingError,
    createdDocuments,
    previewLoading,
    llmConfig,
    embeddingConfig,
    rerankConfig,
    canProceedStep1,
    canProceedStep2,
    canUploadDocument,
    activeFile,
    effectivePreviewChunks,
    splitterHints,
    appendFiles,
    removeFile,
    goToStep,
    handlePreview,
    handleResample,
    resetSettings,
    setSettings,
    setPreviewFileId,
  } = wizard;

  const steps = useMemo(
    () => [
      { step: 1 as UploadStep, label: t("settings.knowledgeBase.add.step1") },
      { step: 2 as UploadStep, label: t("settings.knowledgeBase.add.step2") },
      { step: 3 as UploadStep, label: t("settings.knowledgeBase.add.step3") },
    ],
    [t],
  );

  const helperText = useMemo(
    () => t("settings.knowledgeBase.add.helperText"),
    [t],
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-4 overflow-hidden px-4 py-5">
      <div className="shrink-0 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => navigate(routeBase)}
        >
          <ArrowLeft className="h-4 w-4" />
          {t("settings.knowledgeBase.add.backToKnowledgeBase")}
        </Button>
      </div>

      <div className="shrink-0">
        <StepIndicator currentStep={currentStep} steps={steps} />
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden px-4 py-5 shadow-shadow-sm xl:px-5">
        <div
          className={
            currentStep === 2
              ? "h-full min-h-0 overflow-hidden"
              : "h-full min-h-0 overflow-y-auto"
          }
        >
          {currentStep === 1 ? (
            <FileUploadStep
              files={files}
              previewFileId={previewFileId}
              canProceed={canProceedStep1}
              canUpload={canUploadDocument}
              embeddingConnected={
                wizard.modelAccessStatus?.embeddingConnected ?? false
              }
              llmConnected={wizard.modelAccessStatus?.llmConnected ?? false}
              rerankConnected={
                wizard.modelAccessStatus?.rerankConnected ?? false
              }
              helperText={helperText}
              onSelectFiles={appendFiles}
              onSetPreviewFileId={setPreviewFileId}
              onRemoveFile={removeFile}
              onNext={() => goToStep(2)}
            />
          ) : null}
          {currentStep === 2 ? (
            <ChunkSettingsStep
              settings={settings}
              splitterHints={splitterHints}
              previewChunks={effectivePreviewChunks}
              previewStats={previewStats}
              previewFileName={activeFile?.name}
              previewLoading={previewLoading}
              llmConfig={llmConfig}
              embeddingConfig={embeddingConfig}
              rerankConfig={rerankConfig}
              canProceed={canProceedStep2}
              onSettingsChange={setSettings}
              onPreview={handlePreview}
              onResample={handleResample}
              onReset={resetSettings}
              onPrev={() => goToStep(1)}
              onNext={() => {
                if (!canProceedStep2) {
                  message.warning(t("settings.knowledgeBase.add.needConfig"));
                  return;
                }
                goToStep(3);
              }}
            />
          ) : null}
          {currentStep === 3 ? (
            <ProcessingStep
              filesLength={files.length}
              createdDocuments={createdDocuments}
              effectivePreviewChunks={effectivePreviewChunks}
              processingProgress={processingProgress}
              processingDone={processingDone}
              processingError={processingError}
              settings={settings}
              onBack={() => goToStep(2)}
            />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
