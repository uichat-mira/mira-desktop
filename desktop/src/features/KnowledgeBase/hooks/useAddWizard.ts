import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { message } from "@/shared/ui/Message";
import {
  getKnowledgeBaseDocumentStatus,
  previewKnowledgeBaseChunks,
  uploadKnowledgeBaseDocument,
  type ChunkPreviewResult,
  type ChunkingConfig,
  type KnowledgeBaseDocument,
} from "@/shared/api/knowledgeBase";
import { useRoleModelConfigs } from "@/app/providers/RoleModelConfigProvider";
import { hasConfiguredProviderBinding } from "@/shared/business/modelAccess";

export type UploadStep = 1 | 2 | 3;

export type UploadFileItem = {
  id: string;
  file: File;
  name: string;
  extension: string;
  size: number;
};

export const initialSettings: ChunkingConfig = {
  splitterType: "recursive",
  chunkSize: 1024,
  chunkOverlap: 50,
  keepSeparator: true,
  separator: "\\n\\n",
  separators: ["\\n\\n", "\\n", " ", ""],
  presetLanguage: "markdown",
  encodingName: "cl100k_base",
  allowedSpecial: [],
  disallowedSpecial: "all",
  lengthMetric: "characters",
  replaceWhitespace: true,
  removeUrls: false,
  useQaSplit: false,
};

const maxUploadFileSize = 100 * 1024 * 1024;
const pollingIntervalMs = 1500;
const pollingTimeoutMs = 10 * 60 * 1000;

export function resolveStep(value: string | null): UploadStep {
  if (value === "2") return 2;
  if (value === "3") return 3;
  return 1;
}

export function parseListInput(value: string) {
  return value
    .split(/[\n,，]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function useAddWizard() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentStep = resolveStep(searchParams.get("step"));
  const knowledgeBaseId = searchParams.get("knowledgeBaseId") || undefined;

  const [settings, setSettings] = useState<ChunkingConfig>(initialSettings);
  const [files, setFiles] = useState<UploadFileItem[]>([]);
  const [previewChunks, setPreviewChunks] = useState<
    ChunkPreviewResult["sampleChunks"]
  >([]);
  const [previewStats, setPreviewStats] = useState<
    ChunkPreviewResult["stats"] | null
  >(null);
  const [previewFileId, setPreviewFileId] = useState<string>("");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingDone, setProcessingDone] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [createdDocuments, setCreatedDocuments] = useState<
    KnowledgeBaseDocument[]
  >([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const {
    configs: roleConfigs,
    configMap,
    modelAccessStatus,
    refresh,
  } = useRoleModelConfigs();

  const canProceedStep1 = files.length > 0;
  const llmConfig = configMap.llm;
  const embeddingConfig = configMap.embedding;
  const rerankConfig = configMap.rerank;
  const canProceedStep2 = Boolean(
    hasConfiguredProviderBinding(llmConfig) &&
      hasConfiguredProviderBinding(embeddingConfig),
  );
  const canUploadDocument = modelAccessStatus?.embeddingConnected ?? false;

  const activeFile =
    files.find((item) => item.id === previewFileId) ?? files[0] ?? null;
  const effectivePreviewChunks = useMemo(
    () => (previewChunks.length > 0 ? previewChunks : []),
    [previewChunks],
  );

  const splitterHints = useMemo(
    () => ({
      splitterType: t("settings.knowledgeBase.add.hints.splitterType"),
      chunkSize: t("settings.knowledgeBase.add.hints.chunkSize"),
      chunkOverlap: t("settings.knowledgeBase.add.hints.chunkOverlap"),
      keepSeparator: t("settings.knowledgeBase.add.hints.keepSeparator"),
      separator: t("settings.knowledgeBase.add.hints.separator"),
      separators: t("settings.knowledgeBase.add.hints.separators"),
      presetLanguage: t("settings.knowledgeBase.add.hints.presetLanguage"),
      encodingName: t("settings.knowledgeBase.add.hints.encodingName"),
      allowedSpecial: t("settings.knowledgeBase.add.hints.allowedSpecial"),
      disallowedSpecial: t(
        "settings.knowledgeBase.add.hints.disallowedSpecial",
      ),
      lengthMetric: t("settings.knowledgeBase.add.hints.lengthMetric"),
      replaceWhitespace: t(
        "settings.knowledgeBase.add.hints.replaceWhitespace",
      ),
      removeUrls: t("settings.knowledgeBase.add.hints.removeUrls"),
      useQaSplit: t("settings.knowledgeBase.add.hints.useQaSplit"),
    }),
    [t],
  );

  useEffect(() => {
    if (currentStep !== 2) {
      return;
    }

    void refresh();
  }, [currentStep, refresh]);

  useEffect(() => {
    if (currentStep !== 3) {
      setProcessingProgress(0);
      setProcessingDone(false);
      setProcessingError(null);
      setCreatedDocuments([]);
      return;
    }

    setProcessingProgress(0);
    setProcessingDone(false);
    setProcessingError(null);
    setCreatedDocuments([]);

    let cancelled = false;

    void (async () => {
      try {
        const created: KnowledgeBaseDocument[] = [];

        for (const [index, file] of files.entries()) {
          if (cancelled) {
            return;
          }

          const acceptedDocument = knowledgeBaseId
            ? await uploadKnowledgeBaseDocument(knowledgeBaseId, {
                file: file.file,
                name: file.name,
                fileExt: file.extension.toLowerCase(),
                fileSize: file.size,
                sourceType: "upload",
                sourceLabel: t("settings.knowledgeBase.add.localUpload"),
                enabled: true,
                chunkingConfig: settings,
              })
            : await uploadKnowledgeBaseDocument({
                file: file.file,
                name: file.name,
                fileExt: file.extension.toLowerCase(),
                fileSize: file.size,
                sourceType: "upload",
                sourceLabel: t("settings.knowledgeBase.add.localUpload"),
                enabled: true,
                chunkingConfig: settings,
              });

          if (!cancelled) {
            setProcessingProgress(
              Math.max(10, Math.round(((index + 0.35) / files.length) * 100)),
            );
          }

          const startedAt = Date.now();
          let document = acceptedDocument;

          while (!cancelled && document.indexStatus === "processing") {
            if (Date.now() - startedAt > pollingTimeoutMs) {
              throw new Error(t("settings.knowledgeBase.add.indexTimeout"));
            }

            await new Promise((resolve) =>
              window.setTimeout(resolve, pollingIntervalMs),
            );
            document = knowledgeBaseId
              ? await getKnowledgeBaseDocumentStatus(
                  knowledgeBaseId,
                  acceptedDocument.id,
                )
              : await getKnowledgeBaseDocumentStatus(acceptedDocument.id);
          }

          if (document.indexStatus === "failed") {
            throw new Error(
              document.errorMessage ||
                t("settings.knowledgeBase.add.processFailed"),
            );
          }

          created.push(document);

          if (!cancelled) {
            setCreatedDocuments([...created]);
            setProcessingProgress(
              Math.round(((index + 1) / files.length) * 100),
            );
          }
        }

        if (!cancelled) {
          setProcessingDone(true);
          message.success(t("settings.knowledgeBase.add.uploadSuccess"));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("settings.knowledgeBase.add.processFailed");
        setProcessingError(errorMessage);
        message.error(errorMessage);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentStep, files, knowledgeBaseId, settings, t]);

  useEffect(() => {
    setPreviewChunks([]);
    setPreviewStats(null);
  }, [activeFile?.id, settings]);

  const appendFiles = useCallback(
    async (selectedFiles: FileList | null) => {
      if (!selectedFiles || selectedFiles.length === 0) {
        return;
      }

      if (selectedFiles.length > 1) {
        message.warning(t("settings.knowledgeBase.add.oneFileOnly"));
        return;
      }

      const oversizedFile = Array.from(selectedFiles).find(
        (file) => file.size > maxUploadFileSize,
      );
      if (oversizedFile) {
        message.warning(t("settings.knowledgeBase.add.fileTooLarge"));
        return;
      }

      if (files.length >= 1) {
        message.warning(t("settings.knowledgeBase.add.removeFirst"));
        return;
      }

      const nextFiles = await Promise.all(
        Array.from(selectedFiles).map(async (file) => ({
          id: `${file.name}-${file.lastModified}`,
          file,
          name: file.name,
          extension: file.name.split(".").pop()?.toUpperCase() ?? "FILE",
          size: file.size,
        })),
      );

      setFiles((current) => {
        if (current.some((existing) => existing.id === nextFiles[0]?.id)) {
          return current;
        }
        return [...current, ...nextFiles];
      });

      if (nextFiles[0]) {
        setPreviewFileId(nextFiles[0].id);
        message.success(t("settings.knowledgeBase.add.fileAdded"));
      }
    },
    [files.length, t],
  );

  const removeFile = useCallback(
    (id: string) => {
      setFiles((current) => {
        const nextFiles = current.filter((item) => item.id !== id);
        setPreviewFileId((currentPreviewId) =>
          currentPreviewId === id ? (nextFiles[0]?.id ?? "") : currentPreviewId,
        );
        return nextFiles;
      });
      setPreviewChunks([]);
      message.info(t("settings.knowledgeBase.add.fileRemoved"));
    },
    [t],
  );

  const goToStep = useCallback(
    (step: UploadStep) => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("step", `${step}`);
      if (knowledgeBaseId) {
        nextParams.set("knowledgeBaseId", knowledgeBaseId);
      } else {
        nextParams.delete("knowledgeBaseId");
      }
      setSearchParams(nextParams);
    },
    [knowledgeBaseId, searchParams, setSearchParams],
  );

  const runPreview = useCallback(
    async (successMessage?: string) => {
      const targetFile =
        files.find((item) => item.id === previewFileId) ?? files[0];
      if (!targetFile) {
        message.warning(t("settings.knowledgeBase.add.selectFileToPreview"));
        return false;
      }

      try {
        setPreviewLoading(true);
        const result = await previewKnowledgeBaseChunks({
          file: targetFile.file,
          name: targetFile.name,
          fileExt: targetFile.extension.toLowerCase(),
          fileSize: targetFile.size,
          sourceType: "upload",
          sourceLabel: t("settings.knowledgeBase.add.localUpload"),
          enabled: true,
          chunkingConfig: settings,
        });
        setPreviewChunks(result.sampleChunks);
        setPreviewStats(result.stats);
        message.success(
          successMessage ??
            t("settings.knowledgeBase.add.previewSuccess", {
              count: result.totalChunks,
            }),
        );
        return true;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("settings.knowledgeBase.add.previewFailed");
        message.error(errorMessage);
        return false;
      } finally {
        setPreviewLoading(false);
      }
    },
    [files, previewFileId, settings, t],
  );

  const handlePreview = useCallback(async () => {
    await runPreview();
  }, [runPreview]);

  const handleResample = useCallback(async () => {
    await runPreview(t("settings.knowledgeBase.add.resampleSuccess"));
  }, [runPreview, t]);

  const resetSettings = useCallback(() => {
    setSettings(initialSettings);
    setPreviewChunks([]);
    setPreviewStats(null);
  }, []);

  return {
    t,
    searchParams,
    setSearchParams,
    currentStep,
    knowledgeBaseId,
    settings,
    setSettings,
    files,
    setFiles,
    previewChunks,
    setPreviewChunks,
    previewStats,
    setPreviewStats,
    previewFileId,
    setPreviewFileId,
    processingProgress,
    setProcessingProgress,
    processingDone,
    setProcessingDone,
    processingError,
    setProcessingError,
    createdDocuments,
    setCreatedDocuments,
    previewLoading,
    setPreviewLoading,
    roleConfigs,
    configMap,
    modelAccessStatus,
    refreshRoleModelConfigs: refresh,
    canProceedStep1,
    llmConfig,
    embeddingConfig,
    rerankConfig,
    canProceedStep2,
    canUploadDocument,
    activeFile,
    effectivePreviewChunks,
    splitterHints,
    appendFiles,
    removeFile,
    goToStep,
    runPreview,
    handlePreview,
    handleResample,
    resetSettings,
    initialSettings,
  };
}
