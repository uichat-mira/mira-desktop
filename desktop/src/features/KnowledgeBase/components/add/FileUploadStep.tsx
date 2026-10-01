import { useTranslation } from "react-i18next";
import { ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { FileListItem } from "@/shared/ui/FileListItem";
import { FileUploadDropzone } from "@/shared/ui/FileUploadDropzone";
import AppNotice from "@/app/Layouts/AppNotice";
import ModelAccessStatusPill from "./ModelAccessStatusPill";
import type { UploadFileItem } from "../../hooks/useAddWizard";

interface FileUploadStepProps {
  files: UploadFileItem[];
  previewFileId: string;
  canProceed: boolean;
  canUpload: boolean;
  embeddingConnected: boolean;
  llmConnected: boolean;
  rerankConnected: boolean;
  helperText: string;
  onSelectFiles: (files: FileList | null) => void;
  onSetPreviewFileId: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onNext: () => void;
}

export default function FileUploadStep({
  files,
  previewFileId,
  canProceed,
  canUpload,
  embeddingConnected,
  llmConnected,
  rerankConnected,
  helperText,
  onSelectFiles,
  onSetPreviewFileId,
  onRemoveFile,
  onNext,
}: FileUploadStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="text-base font-semibold text-text-primary">
          {t("settings.knowledgeBase.add.uploadTitle")}
        </h1>
        <p className="text-sm text-text-secondary">
          {t("settings.knowledgeBase.add.uploadDesc")}
        </p>
      </div>

      {!embeddingConnected ? (
        <AppNotice tone="danger">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="space-y-2">
            <div className="font-medium">
              {t("settings.knowledgeBase.add.noEmbeddingWarning")}
            </div>
            <div className="flex flex-wrap gap-2">
              <ModelAccessStatusPill
                label={t("settings.knowledgeBase.add.embeddingModel")}
                connected={embeddingConnected}
              />
              <ModelAccessStatusPill
                label={t("settings.knowledgeBase.add.llmModel")}
                connected={llmConnected}
              />
              <ModelAccessStatusPill
                label={t("settings.knowledgeBase.add.rerankModel")}
                connected={rerankConnected}
              />
            </div>
          </div>
        </AppNotice>
      ) : null}

      <FileUploadDropzone
        onSelectFiles={onSelectFiles}
        helperText={canUpload ? helperText : t("settings.knowledgeBase.add.helperTextNoEmbedding")}
        maxCount={1}
        accept=".md,.txt"
        disabled={!canUpload}
      />

      <div className="space-y-2.5">
        {files.map((file) => (
          <FileListItem
            key={file.id}
            name={file.name}
            extension={file.extension}
            size={file.size}
            active={previewFileId === file.id}
            onClick={() => onSetPreviewFileId(file.id)}
            onRemove={() => onRemoveFile(file.id)}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          disabled={!canProceed || !canUpload}
          onClick={() => canProceed && canUpload && onNext()}
        >
          {t("settings.knowledgeBase.add.nextStep")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
