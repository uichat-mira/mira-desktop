import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRoleModelConfigs } from "@/app/providers/RoleModelConfigProvider";
import {
  generateEvaluationPackage,
  type EvaluationMode,
} from "@/shared/api/evaluation";
import {
  listKnowledgeBases,
  listKnowledgeBaseDocuments,
  type KnowledgeBaseSummary,
} from "@/shared/api/knowledgeBase";
import { hasConfiguredProviderBinding } from "@/shared/business/modelAccess";
import { Button } from "@/shared/ui/Button";
import { NumberInput, TextInput } from "@/shared/ui/Input";
import { message } from "@/shared/ui/Message";
import { Select } from "@/shared/ui/Select";
import { getProviderLabel } from "@/shared/providerCatalog";

interface EvaluationPackageGeneratorModalProps {
  onClose: () => void;
}

type FormState = {
  datasetName: string;
  knowledgeBaseId: string;
  sampleCount: number;
  documentCount: number;
  chunksPerDocument: number;
  mode: EvaluationMode;
  topK: number;
  topN: number;
  repeat: number;
  concurrency: number;
  timeoutSeconds: number;
};

type PresetId = "fast" | "balanced" | "strict";

type PresetDefinition = {
  id: PresetId;
  labelKey: string;
  description: string;
  values: Pick<
    FormState,
    | "sampleCount"
    | "documentCount"
    | "chunksPerDocument"
    | "mode"
    | "topK"
    | "topN"
    | "repeat"
    | "concurrency"
    | "timeoutSeconds"
  >;
};

type KnowledgeBaseStats = {
  documentCount: number;
  chunkCount: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const basePresetValues = {
  fast: {
    sampleCount: 8,
    documentCount: 4,
    chunksPerDocument: 2,
    mode: "retrieve-generate",
    topK: 10,
    topN: 5,
    repeat: 1,
    concurrency: 1,
    timeoutSeconds: 300,
  },
  balanced: {
    sampleCount: 12,
    documentCount: 6,
    chunksPerDocument: 3,
    mode: "retrieve-generate",
    topK: 10,
    topN: 5,
    repeat: 1,
    concurrency: 1,
    timeoutSeconds: 300,
  },
  strict: {
    sampleCount: 20,
    documentCount: 10,
    chunksPerDocument: 3,
    mode: "retrieve-generate",
    topK: 15,
    topN: 5,
    repeat: 1,
    concurrency: 1,
    timeoutSeconds: 600,
  },
} as const;

const formatPresetNumbers = (values: Pick<
  FormState,
  "sampleCount" | "documentCount" | "chunksPerDocument" | "topK" | "topN"
>) =>
  `${values.sampleCount} / ${values.documentCount} / ${values.chunksPerDocument}，TopK ${values.topK}，TopN ${values.topN}`;

const buildPresetValues = (
  stats: KnowledgeBaseStats | null,
  presetId: PresetId,
): PresetDefinition["values"] => {
  const documentCount = Math.max(0, stats?.documentCount ?? 0);
  const chunkCount = Math.max(0, stats?.chunkCount ?? 0);
  const averageChunksPerDocument =
    documentCount > 0 ? chunkCount / documentCount : 0;

  const presetConfig = {
    fast: { sampleCount: 8, documentRatio: 0.25, topK: 10, timeoutSeconds: 300 },
    balanced: {
      sampleCount: 12,
      documentRatio: 0.4,
      topK: 10,
      timeoutSeconds: 300,
    },
    strict: {
      sampleCount: 20,
      documentRatio: 0.6,
      topK: 15,
      timeoutSeconds: 600,
    },
  }[presetId];

  if (documentCount === 0 || chunkCount === 0) {
    return {
      sampleCount: presetConfig.sampleCount,
      documentCount: basePresetValues[presetId].documentCount,
      chunksPerDocument: basePresetValues[presetId].chunksPerDocument,
      mode: basePresetValues[presetId].mode,
      topK: presetConfig.topK,
      topN: basePresetValues[presetId].topN,
      repeat: basePresetValues[presetId].repeat,
      concurrency: basePresetValues[presetId].concurrency,
      timeoutSeconds: presetConfig.timeoutSeconds,
    };
  }

  const desiredDocuments = clamp(
    Math.ceil(documentCount * presetConfig.documentRatio),
    1,
    documentCount,
  );
  const maxChunksPerDocument = clamp(
    Math.ceil(averageChunksPerDocument * 1.2),
    1,
    12,
  );
  const chunksPerDocument = clamp(
    Math.ceil(presetConfig.sampleCount / desiredDocuments),
    1,
    maxChunksPerDocument,
  );
  const candidateMax = Math.min(
    chunkCount,
    desiredDocuments * chunksPerDocument,
  );

  return {
    sampleCount: Math.min(presetConfig.sampleCount, candidateMax),
    documentCount: desiredDocuments,
    chunksPerDocument,
    mode: basePresetValues[presetId].mode,
    topK: presetConfig.topK,
    topN: basePresetValues[presetId].topN,
    repeat: basePresetValues[presetId].repeat,
    concurrency: basePresetValues[presetId].concurrency,
    timeoutSeconds: presetConfig.timeoutSeconds,
  };
};

const buildPresetDefinitions = (
  stats: KnowledgeBaseStats | null,
): PresetDefinition[] => [
  {
    id: "fast",
    labelKey: "settings.evaluation.packageGenerator.presets.fast.label",
    description: formatPresetNumbers(buildPresetValues(stats, "fast")),
    values: buildPresetValues(stats, "fast"),
  },
  {
    id: "balanced",
    labelKey: "settings.evaluation.packageGenerator.presets.balanced.label",
    description: formatPresetNumbers(buildPresetValues(stats, "balanced")),
    values: buildPresetValues(stats, "balanced"),
  },
  {
    id: "strict",
    labelKey: "settings.evaluation.packageGenerator.presets.strict.label",
    description: formatPresetNumbers(buildPresetValues(stats, "strict")),
    values: buildPresetValues(stats, "strict"),
  },
];

const createDefaultForm = (): FormState => ({
  datasetName: `evaluation-pack-${new Date().toLocaleDateString("sv-SE")}`,
  knowledgeBaseId: "",
  ...basePresetValues.fast,
});

export default function EvaluationPackageGeneratorModal({
  onClose,
}: EvaluationPackageGeneratorModalProps) {
  const { t } = useTranslation();
  const { configMap } = useRoleModelConfigs();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>(createDefaultForm);
  const [selectedPresetId, setSelectedPresetId] = useState<PresetId>("fast");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>(
    [],
  );
  const [readyStats, setReadyStats] = useState<KnowledgeBaseStats | null>(null);
  const [loadingKnowledgeBases, setLoadingKnowledgeBases] = useState(true);
  const [checkingKnowledgeBase, setCheckingKnowledgeBase] = useState(false);

  const evaluationConfig = configMap.evaluation;
  const hasEvaluationModel = hasConfiguredProviderBinding(evaluationConfig);
  const evaluationProviderLabel = evaluationConfig?.providerCode
    ? getProviderLabel(evaluationConfig.providerCode)
    : evaluationConfig?.providerConnectionId
      ? evaluationConfig.providerConnectionId
    : t("settings.evaluation.packageGenerator.notConfigured");
  const hasReadyDocuments =
    typeof readyStats?.documentCount === "number"
      ? readyStats.documentCount > 0 && readyStats.chunkCount > 0
      : true;
  const selectedKnowledgeBase =
    knowledgeBases.find((item) => item.id === form.knowledgeBaseId) ?? null;
  const presetDefinitions = useMemo(
    () => buildPresetDefinitions(readyStats),
    [readyStats],
  );
  const selectedPreset =
    presetDefinitions.find((item) => item.id === selectedPresetId) ??
    presetDefinitions[0];

  useEffect(() => {
    void (async () => {
      try {
        setLoadingKnowledgeBases(true);
        const items = await listKnowledgeBases();
        setKnowledgeBases(items);
        setForm((previous) => ({
          ...previous,
          knowledgeBaseId:
            items.some((item) => item.id === previous.knowledgeBaseId)
              ? previous.knowledgeBaseId
              : items[0]?.id ?? "",
        }));
      } catch {
        setKnowledgeBases([]);
      } finally {
        setLoadingKnowledgeBases(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!form.knowledgeBaseId) {
      setReadyStats(null);
      return;
    }

    void (async () => {
      try {
        setCheckingKnowledgeBase(true);
        const readyDocuments = await listKnowledgeBaseDocuments(
          form.knowledgeBaseId,
          {
            enabled: true,
            indexStatus: "ready",
          },
        );
        setReadyStats({
          documentCount: readyDocuments.length,
          chunkCount: readyDocuments.reduce(
            (sum, item) => sum + item.chunkCount,
            0,
          ),
        });
      } catch {
        setReadyStats(null);
      } finally {
        setCheckingKnowledgeBase(false);
      }
    })();
  }, [form.knowledgeBaseId]);

  useEffect(() => {
    setForm((previous) => {
      if (!previous.knowledgeBaseId) {
        return previous;
      }

      const preset =
        presetDefinitions.find((item) => item.id === selectedPresetId) ??
        presetDefinitions[0];

      return {
        ...previous,
        ...preset.values,
      };
    });
  }, [presetDefinitions, selectedPresetId]);

  const applyPreset = (presetId: PresetId) => {
    const preset =
      presetDefinitions.find((item) => item.id === presetId) ??
      presetDefinitions[0];
    setSelectedPresetId(preset.id);
    setForm((previous) => ({
      ...previous,
      ...preset.values,
    }));
  };

  const handleDownload = async () => {
    if (!hasEvaluationModel) {
      message.warning(
        t(
          "settings.evaluation.packageGenerator.messages.configureEvaluationModel",
        ),
      );
      return;
    }
    if (!hasReadyDocuments) {
      message.warning(
        t("settings.evaluation.packageGenerator.messages.noReadyDocuments"),
      );
      return;
    }
    if (!form.knowledgeBaseId) {
      message.warning(
        t("settings.evaluation.packageGenerator.messages.selectKnowledgeBase"),
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await generateEvaluationPackage(form);
      const url = window.URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success(
        t("settings.evaluation.packageGenerator.messages.generated"),
      );
      onClose();
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("settings.evaluation.packageGenerator.messages.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 rounded-xl border border-border bg-surface-secondary px-3 py-2.5 text-xs leading-5 text-text-secondary">
        {t("settings.evaluation.packageGenerator.intro", {
          provider: evaluationProviderLabel,
          model:
            evaluationConfig?.name ||
            t("settings.evaluation.packageGenerator.configureModelFirst"),
        })}
      </div>

      <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto py-2.5">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-sm font-medium text-text-primary">
                {t("settings.evaluation.packageGenerator.preset")}
              </div>
              <Select
                value={selectedPreset.id}
                onChange={(presetId) => applyPreset(presetId as PresetId)}
                compact
                options={presetDefinitions.map((item) => ({
                  value: item.id,
                  label: t(item.labelKey),
                }))}
                disabled={submitting}
              />
              <div className="text-xs leading-5 text-text-secondary">
                {selectedPreset.description}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium text-text-primary">
                {t("settings.evaluation.packageGenerator.sourceKnowledgeBase")}
              </div>
              <Select
                value={form.knowledgeBaseId}
                onChange={(knowledgeBaseId) =>
                  setForm((previous) => ({
                    ...previous,
                    knowledgeBaseId,
                  }))
                }
                compact
                options={knowledgeBases.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                disabled={
                  submitting ||
                  loadingKnowledgeBases ||
                  knowledgeBases.length === 0
                }
              />
              <div className="text-xs leading-5 text-text-secondary">
                {loadingKnowledgeBases
                  ? t(
                      "settings.evaluation.packageGenerator.loadingKnowledgeBases",
                    )
                  : checkingKnowledgeBase
                    ? t(
                        "settings.evaluation.packageGenerator.checkingAvailability",
                      )
                    : selectedKnowledgeBase
                      ? t(
                          "settings.evaluation.packageGenerator.selectedKnowledgeBaseHint",
                          {
                            name: selectedKnowledgeBase.name,
                          },
                        )
                      : t(
                          "settings.evaluation.packageGenerator.selectKnowledgeBaseHint",
                        )}
              </div>
              <div className="text-xs leading-5 text-text-secondary">
                {t("settings.evaluation.packageGenerator.readyResourceCount", {
                  documents: readyStats?.documentCount ?? 0,
                  chunks: readyStats?.chunkCount ?? 0,
                })}
              </div>
              {!checkingKnowledgeBase && !hasReadyDocuments ? (
                <div className="text-xs leading-5 text-warning">
                  {t(
                    "settings.evaluation.packageGenerator.noReadyDocumentsForSelected",
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2">
            <TextInput
              label={t("settings.evaluation.packageGenerator.datasetName")}
              labelHelp={t(
                "settings.evaluation.packageGenerator.help.datasetName",
              )}
              value={form.datasetName}
              compact
              onChange={(datasetName) =>
                setForm((previous) => ({ ...previous, datasetName }))
              }
              disabled={submitting}
            />

            <NumberInput
              label={t("settings.evaluation.packageGenerator.sampleCount")}
              labelHelp={t(
                "settings.evaluation.packageGenerator.help.sampleCount",
              )}
              value={form.sampleCount}
              compact
              onChange={(sampleCount) =>
                setForm((previous) => ({
                  ...previous,
                  sampleCount: Number.isFinite(sampleCount)
                    ? sampleCount
                    : previous.sampleCount,
                }))
              }
              disabled={submitting}
            />
            <NumberInput
              label={t("settings.evaluation.packageGenerator.documentCount")}
              labelHelp={t(
                "settings.evaluation.packageGenerator.help.documentCount",
              )}
              value={form.documentCount}
              compact
              onChange={(documentCount) =>
                setForm((previous) => ({
                  ...previous,
                  documentCount: Number.isFinite(documentCount)
                    ? documentCount
                    : previous.documentCount,
                }))
              }
              disabled={submitting}
            />
            <NumberInput
              label={t("settings.evaluation.packageGenerator.chunksPerDocument")}
              labelHelp={t(
                "settings.evaluation.packageGenerator.help.chunksPerDocument",
              )}
              value={form.chunksPerDocument}
              compact
              onChange={(chunksPerDocument) =>
                setForm((previous) => ({
                  ...previous,
                  chunksPerDocument: Number.isFinite(chunksPerDocument)
                    ? chunksPerDocument
                    : previous.chunksPerDocument,
                }))
              }
              disabled={submitting}
            />

            <Select
              label={t("settings.evaluation.packageGenerator.mode")}
              labelHelp={t("settings.evaluation.packageGenerator.help.mode")}
              value={form.mode}
              compact
              onChange={(mode) =>
                setForm((previous) => ({
                  ...previous,
                  mode: mode as EvaluationMode,
                }))
              }
              options={[
                {
                  value: "retrieve-generate",
                  label: t(
                    "settings.evaluation.packageGenerator.modeRetrieveGenerate",
                  ),
                },
                {
                  value: "retrieve",
                  label: t("settings.evaluation.packageGenerator.modeRetrieve"),
                },
              ]}
              disabled={submitting}
            />

            <NumberInput
              label="TopK"
              labelHelp={t("settings.evaluation.packageGenerator.help.topK")}
              value={form.topK}
              compact
              onChange={(topK) =>
                setForm((previous) => ({
                  ...previous,
                  topK: Number.isFinite(topK) ? topK : previous.topK,
                }))
              }
              disabled={submitting}
            />
            <NumberInput
              label="TopN"
              labelHelp={t("settings.evaluation.packageGenerator.help.topN")}
              value={form.topN}
              compact
              onChange={(topN) =>
                setForm((previous) => ({
                  ...previous,
                  topN: Number.isFinite(topN) ? topN : previous.topN,
                }))
              }
              disabled={submitting}
            />
            <NumberInput
              label="Repeat"
              labelHelp={t("settings.evaluation.packageGenerator.help.repeat")}
              value={form.repeat}
              compact
              onChange={(repeat) =>
                setForm((previous) => ({
                  ...previous,
                  repeat: Number.isFinite(repeat) ? repeat : previous.repeat,
                }))
              }
              disabled={submitting}
            />
            <NumberInput
              label={t("settings.evaluation.packageGenerator.concurrency")}
              labelHelp={t(
                "settings.evaluation.packageGenerator.help.concurrency",
              )}
              value={form.concurrency}
              compact
              onChange={(concurrency) =>
                setForm((previous) => ({
                  ...previous,
                  concurrency: Number.isFinite(concurrency)
                    ? concurrency
                    : previous.concurrency,
                }))
              }
              disabled={submitting}
            />
            <NumberInput
              label={t("settings.evaluation.packageGenerator.timeoutSeconds")}
              labelHelp={t(
                "settings.evaluation.packageGenerator.help.timeoutSeconds",
              )}
              value={form.timeoutSeconds}
              compact
              onChange={(timeoutSeconds) =>
                setForm((previous) => ({
                  ...previous,
                  timeoutSeconds: Number.isFinite(timeoutSeconds)
                    ? timeoutSeconds
                    : previous.timeoutSeconds,
                }))
              }
              disabled={submitting}
            />
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 shrink-0 flex items-center justify-end gap-2 border-t border-border bg-surface-elevated/95 pt-3 backdrop-blur-sm">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          onClick={() => void handleDownload()}
          disabled={
            submitting ||
            !hasEvaluationModel ||
            loadingKnowledgeBases ||
            checkingKnowledgeBase ||
            !hasReadyDocuments ||
            !form.knowledgeBaseId
          }
        >
          {submitting
            ? t("settings.evaluation.packageGenerator.generating")
            : t("settings.evaluation.packageGenerator.generateAndDownload")}
        </Button>
      </div>
    </div>
  );
}
