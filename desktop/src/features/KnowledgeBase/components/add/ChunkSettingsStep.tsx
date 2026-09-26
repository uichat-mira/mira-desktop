import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Cpu,
  Eye,
  RotateCcw,
  ScanSearch,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import { NumberInput, TextArea, TextInput } from "@/shared/ui/Input";
import { Select } from "@/shared/ui/Select";
import type { RoleModelConfig } from "@/shared/api/modelSettings";
import type {
  ChunkPreviewResult,
  ChunkingConfig,
} from "@/shared/api/knowledgeBase";
import { BUILT_IN_LOCAL_MODELS } from "@/shared/business/localModels";
import ModelStatusCard from "./ModelStatusCard";
import SwitchField from "./SwitchField";
import PreviewPanel from "./PreviewPanel";
import { parseListInput } from "../../hooks/useAddWizard";

interface ChunkSettingsStepProps {
  settings: ChunkingConfig;
  splitterHints: Record<string, string>;
  previewChunks: Array<{
    id: string;
    index: number;
    text: string;
    charCount: number;
  }>;
  previewStats: ChunkPreviewResult["stats"] | null;
  previewFileName: string | undefined;
  previewLoading: boolean;
  llmConfig: RoleModelConfig | null;
  embeddingConfig: RoleModelConfig | null;
  rerankConfig: RoleModelConfig | null;
  canProceed: boolean;
  onSettingsChange: (updater: (prev: ChunkingConfig) => ChunkingConfig) => void;
  onPreview: () => void;
  onResample: () => void;
  onReset: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export default function ChunkSettingsStep({
  settings,
  splitterHints,
  previewChunks,
  previewStats,
  previewFileName,
  previewLoading,
  llmConfig,
  embeddingConfig,
  rerankConfig,
  canProceed,
  onSettingsChange,
  onPreview,
  onResample,
  onReset,
  onPrev,
  onNext,
}: ChunkSettingsStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 2xl:grid 2xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.82fr)] 2xl:gap-4 2xl:overflow-hidden 2xl:pr-0">
        <div className="min-w-0 2xl:min-h-0 2xl:overflow-y-auto 2xl:pr-1">
          <div className="space-y-3.5 pb-4">
            <section className="space-y-2.5">
              <div className="text-base font-semibold text-text-primary">
                {t("settings.knowledgeBase.add.chunkSettings")}
              </div>
              <Card className="p-4">
                <div className="space-y-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Settings2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-base font-semibold text-text-primary">
                        {t("settings.knowledgeBase.add.general")}
                      </div>
                      <div className="text-sm text-text-secondary">
                        {t("settings.knowledgeBase.add.generalDesc")}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="min-w-0">
                      <Select
                        label={t("settings.knowledgeBase.add.splitterType")}
                        labelHelp={splitterHints.splitterType}
                        value={settings.splitterType}
                        onChange={(value) =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            splitterType:
                              value as ChunkingConfig["splitterType"],
                          }))
                        }
                        options={[
                          {
                            value: "recursive",
                            label: "RecursiveCharacterTextSplitter",
                          },
                          { value: "markdown", label: "MarkdownTextSplitter" },
                          {
                            value: "character",
                            label: "CharacterTextSplitter",
                          },
                          { value: "token", label: "TokenTextSplitter" },
                        ]}
                        compact
                      />
                    </div>
                    <div className="min-w-0">
                      <NumberInput
                        label={`${t("settings.knowledgeBase.add.chunkSize")} (${settings.lengthMetric === "utf8Bytes" ? "bytes" : "characters"})`}
                        labelHelp={splitterHints.chunkSize}
                        value={settings.chunkSize}
                        onChange={(value) =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            chunkSize: Number(value) || 0,
                          }))
                        }
                        compact
                      />
                    </div>
                    <div className="min-w-0">
                      <NumberInput
                        label={`${t("settings.knowledgeBase.add.chunkOverlap")} (${settings.lengthMetric === "utf8Bytes" ? "bytes" : "characters"})`}
                        labelHelp={splitterHints.chunkOverlap}
                        value={settings.chunkOverlap}
                        onChange={(value) =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            chunkOverlap: Number(value) || 0,
                          }))
                        }
                        compact
                      />
                    </div>
                    <div className="min-w-0">
                      <Select
                        label={t("settings.knowledgeBase.add.lengthMetric")}
                        labelHelp={splitterHints.lengthMetric}
                        value={settings.lengthMetric}
                        onChange={(value) =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            lengthMetric:
                              value as ChunkingConfig["lengthMetric"],
                          }))
                        }
                        options={[
                          {
                            value: "characters",
                            label: t("settings.knowledgeBase.add.characters"),
                          },
                          {
                            value: "utf8Bytes",
                            label: t("settings.knowledgeBase.add.utf8Bytes"),
                          },
                        ]}
                        compact
                      />
                    </div>
                    <SwitchField
                      label={t("settings.knowledgeBase.add.keepSeparator")}
                      hint={splitterHints.keepSeparator}
                      checked={settings.keepSeparator}
                      onChange={() =>
                        onSettingsChange((prev) => ({
                          ...prev,
                          keepSeparator: !prev.keepSeparator,
                        }))
                      }
                    />
                    {settings.splitterType === "character" ? (
                      <div className="min-w-0">
                        <TextInput
                          label={t("settings.knowledgeBase.add.separator")}
                          labelHelp={splitterHints.separator}
                          value={settings.separator}
                          onChange={(value) =>
                            onSettingsChange((prev) => ({
                              ...prev,
                              separator: value,
                            }))
                          }
                          compact
                        />
                      </div>
                    ) : null}
                    {settings.splitterType === "recursive" ? (
                      <>
                        <div className="min-w-0">
                          <Select
                            label={t(
                              "settings.knowledgeBase.add.presetLanguage",
                            )}
                            labelHelp={splitterHints.presetLanguage}
                            value={settings.presetLanguage ?? ""}
                            onChange={(value) =>
                              onSettingsChange((prev) => ({
                                ...prev,
                                presetLanguage: value
                                  ? (value as ChunkingConfig["presetLanguage"])
                                  : null,
                              }))
                            }
                            options={[
                              {
                                value: "",
                                label: t("settings.knowledgeBase.add.noPreset"),
                              },
                              { value: "markdown", label: "markdown" },
                              { value: "html", label: "html" },
                              { value: "js", label: "js" },
                              { value: "python", label: "python" },
                              { value: "cpp", label: "cpp" },
                              { value: "go", label: "go" },
                              { value: "java", label: "java" },
                              { value: "php", label: "php" },
                              { value: "proto", label: "proto" },
                              { value: "rst", label: "rst" },
                              { value: "ruby", label: "ruby" },
                              { value: "rust", label: "rust" },
                              { value: "scala", label: "scala" },
                              { value: "swift", label: "swift" },
                              { value: "latex", label: "latex" },
                              { value: "sol", label: "sol" },
                            ]}
                            compact
                          />
                        </div>
                        <div className="min-w-0 md:col-span-2 xl:col-span-3">
                          <TextArea
                            label={t(
                              "settings.knowledgeBase.add.customSeparators",
                            )}
                            labelHelp={splitterHints.separators}
                            rows={4}
                            value={settings.separators.join("\n")}
                            onChange={(value) =>
                              onSettingsChange((prev) => ({
                                ...prev,
                                separators: parseListInput(value),
                              }))
                            }
                            compact
                          />
                        </div>
                      </>
                    ) : null}
                    {settings.splitterType === "token" ? (
                      <>
                        <div className="min-w-0">
                          <TextInput
                            label={t("settings.knowledgeBase.add.encodingName")}
                            labelHelp={splitterHints.encodingName}
                            value={settings.encodingName}
                            onChange={(value) =>
                              onSettingsChange((prev) => ({
                                ...prev,
                                encodingName: value,
                              }))
                            }
                            compact
                          />
                        </div>
                        <div className="min-w-0">
                          <TextInput
                            label={t(
                              "settings.knowledgeBase.add.allowedSpecial",
                            )}
                            labelHelp={splitterHints.allowedSpecial}
                            value={
                              Array.isArray(settings.allowedSpecial)
                                ? settings.allowedSpecial.join(", ")
                                : settings.allowedSpecial
                            }
                            onChange={(value) =>
                              onSettingsChange((prev) => ({
                                ...prev,
                                allowedSpecial:
                                  value.trim() === "all"
                                    ? "all"
                                    : parseListInput(value),
                              }))
                            }
                            compact
                          />
                        </div>
                        <div className="min-w-0">
                          <TextInput
                            label={t(
                              "settings.knowledgeBase.add.disallowedSpecial",
                            )}
                            labelHelp={splitterHints.disallowedSpecial}
                            value={
                              Array.isArray(settings.disallowedSpecial)
                                ? settings.disallowedSpecial.join(", ")
                                : settings.disallowedSpecial
                            }
                            onChange={(value) =>
                              onSettingsChange((prev) => ({
                                ...prev,
                                disallowedSpecial:
                                  value.trim() === "all"
                                    ? "all"
                                    : parseListInput(value),
                              }))
                            }
                            compact
                          />
                        </div>
                      </>
                    ) : null}
                  </div>

                  <div className="space-y-2.5 border-t border-border pt-4">
                    <div className="text-sm font-medium text-text-primary">
                      {t("settings.knowledgeBase.add.preprocessingRules")}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <SwitchField
                        label={t(
                          "settings.knowledgeBase.add.replaceWhitespace",
                        )}
                        hint={splitterHints.replaceWhitespace}
                        checked={settings.replaceWhitespace}
                        onChange={() =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            replaceWhitespace: !prev.replaceWhitespace,
                          }))
                        }
                      />
                      <SwitchField
                        label={t("settings.knowledgeBase.add.removeUrls")}
                        hint={splitterHints.removeUrls}
                        checked={settings.removeUrls}
                        onChange={() =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            removeUrls: !prev.removeUrls,
                          }))
                        }
                      />
                      <SwitchField
                        label={t("settings.knowledgeBase.add.useQaSplit")}
                        hint={splitterHints.useQaSplit}
                        checked={settings.useQaSplit}
                        onChange={() =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            useQaSplit: !prev.useQaSplit,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-dashed border-border bg-surface-secondary/70 px-3.5 py-3 text-xs leading-5 text-text-secondary">
                    {t("settings.knowledgeBase.add.tip")}
                  </div>

                  <div className="flex items-center gap-2.5 border-t border-border pt-4">
                    <Button
                      variant="secondary"
                      onClick={() => void onPreview()}
                      disabled={previewLoading}
                    >
                      <Eye className="h-4 w-4" />
                      {previewLoading
                        ? t("settings.knowledgeBase.add.previewing")
                        : t("settings.knowledgeBase.add.preview")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void onResample()}
                      disabled={previewLoading}
                    >
                      <Sparkles className="h-4 w-4" />
                      {t("settings.knowledgeBase.add.resample")}
                    </Button>
                    <Button variant="ghost" onClick={onReset}>
                      <RotateCcw className="h-4 w-4" />
                      {t("settings.knowledgeBase.add.reset")}
                    </Button>
                  </div>
                </div>
              </Card>
            </section>

            <section className="space-y-2.5">
              <div className="text-base font-semibold text-text-primary">
                {t("settings.knowledgeBase.add.modelConfig")}
              </div>
              <div className="space-y-2.5">
                <ModelStatusCard
                  title={t("settings.knowledgeBase.add.llmTitle")}
                  description={t("settings.knowledgeBase.add.llmDesc")}
                  config={llmConfig}
                  required
                  icon={<Bot className="h-5 w-5" />}
                />
                <ModelStatusCard
                  title={t("settings.knowledgeBase.add.embeddingTitle")}
                  description={t("settings.knowledgeBase.add.embeddingDesc")}
                  config={embeddingConfig}
                  builtInModel={BUILT_IN_LOCAL_MODELS.embedding}
                  required
                  icon={<Cpu className="h-5 w-5" />}
                />
                <ModelStatusCard
                  title={t("settings.knowledgeBase.add.rerankTitle")}
                  description={t("settings.knowledgeBase.add.rerankDesc")}
                  config={rerankConfig}
                  builtInModel={BUILT_IN_LOCAL_MODELS.rerank}
                  icon={<ScanSearch className="h-5 w-5" />}
                />
              </div>
            </section>
          </div>
        </div>

        <div className="min-w-0 2xl:min-h-0">
          <PreviewPanel
            fileName={previewFileName}
            previewChunks={previewChunks}
            previewStats={previewStats}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border bg-surface-primary pt-4">
        <Button variant="ghost" onClick={onPrev}>
          <ArrowLeft className="h-4 w-4" />
          {t("settings.knowledgeBase.add.prevStep")}
        </Button>

        <Button disabled={!canProceed} onClick={onNext}>
          {t("settings.knowledgeBase.add.nextStep")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
