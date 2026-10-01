import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FolderArchive,
  PackagePlus,
  Play,
  TableProperties,
} from "lucide-react";
import Badge from "@/shared/ui/Badge";
import Card from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import Divider from "@/shared/ui/Divider";
import Drawer from "@/shared/ui/Drawer";
import TabCard from "@/shared/ui/TabCard";
import TerminalPanel from "@/shared/ui/TerminalPanel";
import { FileUploadDropzone } from "@/shared/ui/FileUploadDropzone";
import { Modal } from "@/shared/ui/Modal";
import { message } from "@/shared/ui/Message";
import {
  createEvaluationRun,
  getEvaluationRun,
  parseEvaluationDataset,
} from "@/shared/api/evaluation";
import type {
  EvaluationJobStatus,
  EvaluationRunRecord,
  ParsedDataset,
} from "./types";
import MetricGrid from "@/features/Evaluation/components/MetricGrid";
import StatusBadge from "@/features/Evaluation/components/StatusBadge";
import EvaluationPackageGeneratorModal from "@/features/Evaluation/components/EvaluationPackageGeneratorModal";
import { getAppLanguage } from "@/shared/i18n";
import { formatEvaluationKnowledgeBaseLabel } from "./knowledgeBaseLabel";

type ConsoleTab = "log" | "result";

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

const getEvaluationRunStartErrorMessage = (
  error: unknown,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  const fallback = t("settings.evaluation.workbench.messages.runCreateFailed");
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.message.includes("missing a valid knowledgeBaseId")) {
    return t(
      "settings.evaluation.workbench.messages.missingKnowledgeBaseId",
    );
  }

  if (error.message.includes("unknown knowledge base")) {
    return t(
      "settings.evaluation.workbench.messages.unknownKnowledgeBase",
    );
  }

  return error.message || fallback;
};

function ValidationPill({ status }: { status: "pass" | "warning" | "error" }) {
  const { t } = useTranslation();
  const statusMap = {
    pass: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    error: "bg-danger/10 text-danger",
  } as const;

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMap[status]}`}
    >
      {status === "pass"
        ? t("settings.evaluation.shared.statusPass")
        : status === "warning"
          ? t("settings.evaluation.shared.statusWarning")
          : t("settings.evaluation.shared.statusError")}
    </span>
  );
}

function WorkbenchStateBar({
  status,
  dataset,
  runRecord,
}: {
  status: EvaluationJobStatus;
  dataset: ParsedDataset | null;
  runRecord: EvaluationRunRecord | null;
}) {
  const { t } = useTranslation();
  const summary = dataset?.summary;
  const sampleCount = summary?.sampleCount ?? 0;
  const completedCount =
    status === "completed" || status === "failed"
      ? (runRecord?.sampleResults.length ?? 0)
      : status === "queued"
        ? 0
        : status === "running"
          ? (runRecord?.sampleResults.length ?? 0)
          : 0;

  return (
    <Card className="grid gap-2.5 px-3.5 py-3 sm:grid-cols-2 xl:grid-cols-5">
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {t("settings.evaluation.workbench.stateBar.taskStatus")}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <StatusBadge status={status} />
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {t("settings.evaluation.workbench.stateBar.dataset")}
        </div>
        <div className="mt-1 text-sm font-medium text-text-primary">
          {dataset?.datasetName ??
            t("settings.evaluation.workbench.stateBar.waitingUpload")}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {t("settings.evaluation.workbench.stateBar.progress")}
        </div>
        <div className="mt-1 text-sm font-medium text-text-primary">
          {completedCount} / {sampleCount || "--"}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {t("settings.evaluation.workbench.stateBar.mode")}
        </div>
        <div className="mt-1 text-sm font-medium text-text-primary">
          {dataset
            ? dataset.config.mode === "retrieve"
              ? t("settings.evaluation.shared.modeRetrieve")
              : t("settings.evaluation.shared.modeRetrieveGenerate")
            : "--"}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {t("settings.evaluation.workbench.stateBar.params")}
        </div>
        <div className="mt-1 text-sm font-medium text-text-primary">
          {dataset ? `K${dataset.config.topK} / N${dataset.config.topN}` : "--"}
        </div>
      </div>
    </Card>
  );
}

function DatasetPreviewDrawer({
  open,
  dataset,
  onClose,
}: {
  open: boolean;
  dataset: ParsedDataset | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!dataset) {
    return null;
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      closeLabel={t("settings.evaluation.workbench.preview.closeDrawer")}
      closeMaskLabel={t("settings.evaluation.workbench.preview.closeMask")}
      bodyClassName="space-y-4"
      header={
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {t("settings.evaluation.workbench.preview.title")}
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            {dataset.datasetName} ·{" "}
            {t("settings.evaluation.shared.sampleCount", {
              count: dataset.summary.sampleCount,
            })}{" "}
            ·{" "}
            {t("settings.evaluation.shared.documentCount", {
              count: dataset.summary.documentCount,
            })}
          </div>
        </div>
      }
    >
      <section className="space-y-2">
        <div className="text-sm font-semibold text-text-primary">
          {t("settings.evaluation.workbench.preview.samplePreview")}
        </div>
        <div className="space-y-2">
          {dataset.previewSamples.map((sample) => (
            <Card key={sample.id} variant="subtle" className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-surface-primary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                  {sample.id}
                </span>
                <div className="text-xs text-text-secondary">
                  {sample.tags.join(" · ")}
                </div>
              </div>
              <div className="mt-2 text-sm font-medium text-text-primary">
                {sample.question}
              </div>
              <div className="mt-1 text-xs leading-5 text-text-secondary">
                {t("settings.evaluation.workbench.preview.goldSources")}：
                {sample.goldSources.join("、")}
              </div>
              <div className="mt-1 text-xs leading-5 text-text-secondary">
                {t("settings.evaluation.workbench.preview.reference")}：
                {sample.expectedAnswer}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-sm font-semibold text-text-primary">
          {t("settings.evaluation.workbench.preview.documentPreview")}
        </div>
        <div className="space-y-2">
          {dataset.documents.map((document) => (
            <Card
              key={document.id}
              variant="subtle"
              className="flex items-center justify-between px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-primary">
                  {document.name}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {document.sizeLabel}
                </div>
              </div>
              <span className="ml-3 rounded-full bg-surface-primary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                {document.type}
              </span>
            </Card>
          ))}
        </div>
      </section>
    </Drawer>
  );
}

export default function EvaluationWorkbench() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/evaluation";
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [status, setStatus] = useState<EvaluationJobStatus>("idle");
  const [parsing, setParsing] = useState(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("log");
  const [runRecord, setRunRecord] = useState<EvaluationRunRecord | null>(null);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const resultScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!runRecord || consoleTab !== "log") {
      return;
    }

    const scrollContainer = logScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [runRecord, consoleTab]);

  useEffect(() => {
    if (!runRecord || consoleTab !== "result") {
      return;
    }

    const scrollContainer = resultScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [runRecord, consoleTab]);

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

  useEffect(() => {
    if (!runRecord) {
      return;
    }

    if (runRecord.status === "completed" || runRecord.status === "failed") {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const nextRun = await getEvaluationRun(runRecord.id);
        setRunRecord(nextRun);
        setStatus(nextRun.status);
      } catch {
        // Keep the last visible state and try again on the next tick.
      }
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [runRecord]);

  const canRun = Boolean(
    dataset &&
    dataset.validations.every((item) => item.status !== "error") &&
    !parsing &&
    status !== "queued" &&
    status !== "running",
  );

  const displayStatus = useMemo<EvaluationJobStatus>(() => {
    if (
      dataset &&
      (status === "idle" || status === "ready") &&
      dataset.validations.some((item) => item.status === "error")
    ) {
      return "failed";
    }

    if (dataset && status === "idle") {
      return "ready";
    }

    return status;
  }, [dataset, status]);

  const progressWidth = useMemo(() => {
    if (!dataset) {
      return 0;
    }

    const sampleCount = dataset.summary.sampleCount || 1;
    const completedCount = runRecord?.sampleResults.length ?? 0;

    if (status === "completed" || status === "failed") {
      return 100;
    }

    if (status === "queued") {
      return 18;
    }

    if (status === "running") {
      return Math.max(24, Math.min(96, (completedCount / sampleCount) * 100));
    }

    return status === "ready" ? 8 : 0;
  }, [dataset, runRecord?.sampleResults.length, status]);

  const handleSelectFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const [file] = Array.from(files);
    if (!file || !file.name.toLowerCase().endsWith(".zip")) {
      message.warning(t("settings.evaluation.workbench.messages.uploadZip"));
      return;
    }

    try {
      setParsing(true);
      setStatus("idle");
      setRunRecord(null);
      setSavedRunId(null);
      setConsoleTab("log");
      const parsed = await parseEvaluationDataset(file);
      setDataset(parsed);
      setStatus("ready");
      message.success(t("settings.evaluation.workbench.messages.parseSuccess"));
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("settings.evaluation.workbench.messages.parseFailed"),
      );
    } finally {
      setParsing(false);
    }
  };

  const handleStartEvaluation = async () => {
    if (!dataset) {
      message.warning(t("settings.evaluation.workbench.messages.uploadFirst"));
      return;
    }

    if (dataset.validations.some((item) => item.status === "error")) {
      message.error(t("settings.evaluation.workbench.messages.validationError"));
      return;
    }

    try {
      setStatus("queued");
      setConsoleTab("log");
      const nextRun = await createEvaluationRun({
        datasetId: dataset.id,
      });
      setRunRecord(nextRun);
      setStatus(nextRun.status);
      setSavedRunId(nextRun.id);
      message.success(t("settings.evaluation.workbench.messages.runCreated"));
    } catch (error) {
      setStatus("ready");
      message.error(getEvaluationRunStartErrorMessage(error, t));
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="shrink-0 px-2 pt-6">
        <div className="mx-auto flex w-full max-w-none flex-col gap-2">
          <div>
            <Button
              variant="link"
              size="sm"
              className="justify-start gap-1 self-start text-caption text-text-secondary hover:no-underline"
              onClick={() => navigate(`${routeBase}/center`)}
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Button>
          </div>
          <div className="flex min-h-10 items-center justify-between gap-3">
            <div className="text-[18px] font-semibold leading-[1.4] text-text-primary">
              {t("settings.evaluation.workbench.page.title")}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                onClick={openPackageGenerator}
              >
                <PackagePlus className="h-4 w-4" />
                {t("settings.evaluation.workbench.actions.generatePackage")}
              </Button>
              <Button
                variant="success-ghost"
                size="sm"
                disabled={!canRun}
                onClick={() => {
                  void handleStartEvaluation();
                }}
              >
                <Play className="h-4 w-4" />
                {t("settings.evaluation.workbench.actions.startEvaluation")}
              </Button>
            </div>
          </div>
          <Divider />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-none flex-col gap-4 px-2 pb-6 pt-1 lg:h-full">
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(340px,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <Card className="space-y-3 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-text-primary">
                {t("settings.evaluation.workbench.packageCard.title")}
              </div>
              {dataset ? (
                <StatusBadge status={displayStatus} />
              ) : null}
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
                      {t("settings.evaluation.workbench.packageCard.dataset")}
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
                      {t("settings.evaluation.workbench.packageCard.runtimeConfig")}
                    </div>
                    <div className="mt-1 text-sm font-medium text-text-primary">
                      {dataset.config.mode === "retrieve"
                        ? t("settings.evaluation.shared.modeRetrieve")
                        : t("settings.evaluation.shared.modeRetrieveGenerate")}
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">
                      topK {dataset.config.topK} · topN {dataset.config.topN} ·
                      N {dataset.config.repeat}
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
                    {t("settings.evaluation.workbench.packageCard.openPreview")}
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
                {t("settings.evaluation.workbench.validation.empty")}
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

          <TabCard
            value={consoleTab}
            onChange={setConsoleTab}
            items={[
              {
                value: "log",
                label: t("settings.evaluation.workbench.console.log"),
              },
              {
                value: "result",
                label: t("settings.evaluation.workbench.console.result"),
              },
            ]}
            headerAside={
              savedRunId
                ? t("settings.evaluation.workbench.console.savedHint")
                : t("settings.evaluation.workbench.console.unsavedHint")
            }
            className="flex-1 lg:min-h-0 lg:h-full"
            bodyClassName="lg:min-h-0 lg:h-full"
          >
            <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
              {consoleTab === "log" ? (
                <div className="flex h-full min-h-[320px] flex-1 flex-col lg:min-h-0">
                  <TerminalPanel
                    variant="plain"
                    scrollRef={logScrollRef}
                    meta={
                      <>
                        <span className="block sm:inline">Stream:</span>{" "}
                        <span className="break-all font-mono text-text-primary">
                          terminal://rag-eval-runner
                        </span>
                      </>
                    }
                    footer={
                      <>
                        <div className="mb-2 flex items-center justify-between text-[11px] text-text-secondary">
                          <span>Progress</span>
                          <span>{Math.round(progressWidth)}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${progressWidth}%` }}
                          />
                        </div>
                      </>
                    }
                  >
                    {dataset ? (
                      <>
                        <div className="border-b border-border/60 py-1.5">
                          <span className="mr-2 text-text-tertiary">$</span>
                          load {dataset.fileName}
                        </div>
                        <div className="border-b border-border/60 py-1.5 text-success">
                          manifest parsed: mode={dataset.config.mode} topK=
                          {dataset.config.topK} topN={dataset.config.topN}{" "}
                          repeat={dataset.config.repeat}
                        </div>
                        <div className="border-b border-border/60 py-1.5">
                          samples={dataset.summary.sampleCount} documents=
                          {dataset.summary.documentCount}
                        </div>
                        <div className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                          validation summary
                        </div>
                        {dataset.validations.map((item) => (
                          <div
                            key={item.id}
                            className="border-b border-border/60 py-1.5"
                          >
                            <span className="mr-2 text-text-tertiary">-</span>
                            {item.label} ::{" "}
                            <span
                              className={
                                item.status === "pass"
                                  ? "text-success"
                                  : item.status === "warning"
                                    ? "text-warning"
                                    : "text-danger"
                              }
                            >
                              {item.status}
                            </span>
                          </div>
                        ))}
                        <div className="py-1.5 pt-3">
                          <span className="mr-2 text-text-tertiary">$</span>
                          ready
                        </div>

                        {status === "queued" ? (
                          <>
                            <div className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                              evaluation queued...
                            </div>
                            <div className="border-b border-border/60 py-1.5">
                              waiting for backend worker to pick up this run
                            </div>
                          </>
                        ) : null}

                        {runRecord ? (
                          <>
                            <div className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                              run summary
                            </div>
                            {runRecord.logs.map((log) => (
                              <div
                                key={log.id}
                                className="border-b border-border/60 py-1.5"
                              >
                                <span className="mr-2 text-text-tertiary">
                                  [{log.timestamp}]
                                </span>{" "}
                                {log.text}
                              </div>
                            ))}
                          </>
                        ) : null}
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-text-secondary">
                        {t("settings.evaluation.workbench.console.emptyLog")}
                      </div>
                    )}
                  </TerminalPanel>
                </div>
              ) : (
                <div
                  ref={resultScrollRef}
                  className="stable-scrollbar h-full min-h-[420px] overflow-y-auto px-3.5 py-3 lg:min-h-0"
                >
                  {runRecord ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-text-primary">
                            {runRecord.name}
                          </div>
                          <div className="mt-1 text-xs text-text-secondary">
                            {runRecord.dataset.config.mode === "retrieve"
                              ? t("settings.evaluation.shared.modeRetrieve")
                              : t("settings.evaluation.shared.modeRetrieveGenerate")}{" "}
                            ·{" "}
                            {runRecord.completedAt
                              ? t("settings.evaluation.shared.completedAt", {
                                  value: formatDate(runRecord.completedAt),
                                })
                              : t("settings.evaluation.shared.createdAt", {
                                  value: formatDate(runRecord.startedAt),
                                })}{" "}
                            ·{" "}
                            {t("settings.evaluation.workbench.console.resultSummary", {
                              count: runRecord.sampleResults.length,
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={runRecord.status} />
                          {savedRunId ? (
                            <Badge variant="success" size="md" className="gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {t("settings.evaluation.status.saved")}
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      <MetricGrid metrics={runRecord.metrics} />

                      <div className="w-full">
                        <Card className="space-y-2 p-3.5">
                          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                            <TableProperties className="h-4 w-4 text-primary" />
                            {t("settings.evaluation.workbench.console.summary")}
                          </div>
                          <div className="space-y-2">
                            {runRecord.sampleResults.slice(0, 4).map((item) => (
                              <Card
                                key={item.id}
                                variant="subtle"
                                className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="whitespace-normal break-all text-text-primary">
                                    {item.question}
                                  </div>
                                  <div className="mt-1 text-xs text-text-secondary">
                                    {item.status === "success"
                                      ? t("settings.evaluation.workbench.console.success")
                                      : item.errorMessage}
                                  </div>
                                </div>
                                <div className="shrink-0 text-xs font-medium text-text-secondary">
                                  {(item.latencyMs / 1000).toFixed(1)}s
                                </div>
                              </Card>
                            ))}
                          </div>
                        </Card>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Card
                        variant="dashed"
                        className="max-w-md px-5 py-8 text-center"
                      >
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <AlertCircle className="h-6 w-6" />
                        </div>
                        <div className="mt-3 text-base font-semibold text-text-primary">
                          {t("settings.evaluation.workbench.console.emptyResultTitle")}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-text-secondary">
                          {t(
                            "settings.evaluation.workbench.console.emptyResultDescription",
                          )}
                        </p>
                      </Card>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabCard>
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
