import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { FileSearch, PartyPopper, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import type { KnowledgeBaseDocument } from "@/shared/api/knowledgeBase";

interface ProcessingStepProps {
  filesLength: number;
  createdDocuments: KnowledgeBaseDocument[];
  effectivePreviewChunks: Array<{ id: string; index: number; text: string }>;
  processingProgress: number;
  processingDone: boolean;
  processingError: string | null;
  settings: {
    chunkSize: number;
    replaceWhitespace: boolean;
    removeUrls: boolean;
    useQaSplit: boolean;
  };
  onBack: () => void;
}

export default function ProcessingStep({
  filesLength,
  createdDocuments,
  effectivePreviewChunks,
  processingProgress,
  processingDone,
  processingError,
  settings,
  onBack,
}: ProcessingStepProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/knowledge-base";

  const totalChunks =
    createdDocuments.reduce((sum, document) => sum + document.chunkCount, 0) ||
    effectivePreviewChunks.length;

  if (processingDone) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="w-full max-w-2xl px-6 py-8 text-center shadow-shadow-md">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success">
            <PartyPopper className="h-8 w-8" />
          </div>
          <div className="mt-5 text-2xl font-semibold text-text-primary">
            {t("settings.knowledgeBase.add.processComplete")}
          </div>
          <p className="mx-auto mt-2.5 max-w-xl text-sm leading-6 text-text-secondary">
            {t("settings.knowledgeBase.add.processCompleteDesc", {
              fileName:
                createdDocuments[0]?.name ??
                t("settings.knowledgeBase.add.knowledgeDoc"),
            })}
          </p>

          <Card variant="subtle" className="mt-5 px-4 py-3.5 text-left">
            <div className="grid gap-2.5 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-text-tertiary">
                  {t("settings.knowledgeBase.add.fileCount")}
                </div>
                <div className="mt-1 text-lg font-semibold text-text-primary">
                  {filesLength}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-text-tertiary">
                  {t("settings.knowledgeBase.add.textChunks")}
                </div>
                <div className="mt-1 text-lg font-semibold text-text-primary">
                  {totalChunks}
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-6 flex justify-center">
            <Button size="lg" onClick={() => navigate(routeBase)}>
              {t("settings.knowledgeBase.add.backToManage")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (processingError) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Card className="w-full max-w-2xl border-danger-border px-6 py-8 text-center shadow-shadow-md">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
            <FileSearch className="h-8 w-8" />
          </div>
          <div className="mt-5 text-2xl font-semibold text-text-primary">
            {t("settings.knowledgeBase.add.processFailedTitle")}
          </div>
          <p className="mx-auto mt-2.5 max-w-xl text-sm leading-6 text-text-secondary">
            {processingError}
          </p>

          <div className="mt-6 flex justify-center gap-3">
            <Button variant="secondary" onClick={onBack}>
              {t("settings.knowledgeBase.add.backToPrev")}
            </Button>
            <Button onClick={() => navigate(routeBase)}>
              {t("settings.knowledgeBase.add.backToManage")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1.6fr_0.8fr]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold text-text-primary">
              {t("settings.knowledgeBase.add.documentUploaded")}
            </h1>
            <p className="text-sm leading-6 text-text-secondary">
              {t("settings.knowledgeBase.add.documentUploadedDesc")}
            </p>
          </div>

          <Card>
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-text-primary">
                    {t("settings.knowledgeBase.add.processing")}
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">
                    {t("settings.knowledgeBase.add.processingDesc")}
                  </div>
                </div>
                <div className="text-sm font-semibold text-primary">
                  {processingProgress}%
                </div>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-surface-primary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${processingProgress}%` }}
                />
              </div>
            </div>
          </Card>

          <div className="grid gap-y-2.5 border-t border-border pt-3.5 md:grid-cols-[148px_1fr]">
            <div className="text-sm text-text-secondary">
              {t("settings.knowledgeBase.add.chunkMode")}
            </div>
            <div className="text-sm font-medium text-text-primary">
              {t("settings.knowledgeBase.add.general")}
            </div>

            <div className="text-sm text-text-secondary">
              {t("settings.knowledgeBase.add.maxChunkSize")}
            </div>
            <div className="text-sm font-medium text-text-primary">
              {settings.chunkSize}
            </div>

            <div className="text-sm text-text-secondary">
              {t("settings.knowledgeBase.add.preprocessingLabel")}
            </div>
            <div className="text-sm font-medium text-text-primary">
              {[
                settings.replaceWhitespace
                  ? t("settings.knowledgeBase.add.ruleReplaceWhitespace")
                  : null,
                settings.removeUrls
                  ? t("settings.knowledgeBase.add.ruleRemoveUrls")
                  : null,
                settings.useQaSplit
                  ? t("settings.knowledgeBase.add.ruleQaSplit")
                  : null,
              ]
                .filter(Boolean)
                .join(", ") ||
                t("settings.knowledgeBase.add.noExtraRules")}
            </div>
          </div>
        </div>

        <Card className="flex h-fit flex-col justify-between p-5">
          <div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="mt-4 text-xl font-semibold text-text-primary">
              {t("settings.knowledgeBase.add.whatsNext")}
            </div>
            <p className="mt-2.5 text-sm leading-6 text-text-secondary">
              {t("settings.knowledgeBase.add.whatsNextDesc")}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
