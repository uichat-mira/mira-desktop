import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, TableProperties } from "lucide-react";
import Badge from "@/shared/ui/Badge";
import Card from "@/shared/ui/Card";
import TabCard from "@/shared/ui/TabCard";
import TerminalPanel from "@/shared/ui/TerminalPanel";
import { getAppLanguage } from "@/shared/i18n";
import type {
  EvaluationJobStatus,
  EvaluationRunRecord,
  ParsedDataset,
} from "../utils/types";
import MetricGrid from "./MetricGrid";
import StatusBadge from "./StatusBadge";
import type { ConsoleTab } from "../pages/New/hooks/useEvaluationWorkbench";

const formatDate = (value: string) =>
  new Date(value).toLocaleString(getAppLanguage(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

interface EvaluationWorkbenchConsoleProps {
  consoleTab: ConsoleTab;
  onConsoleTabChange: (tab: ConsoleTab) => void;
  dataset: ParsedDataset | null;
  runRecord: EvaluationRunRecord | null;
  status: EvaluationJobStatus;
  progressWidth: number;
  savedRunId: string | null;
  logScrollRef: React.RefObject<HTMLDivElement>;
  resultScrollRef: React.RefObject<HTMLDivElement>;
}

export default function EvaluationWorkbenchConsole({
  consoleTab,
  onConsoleTabChange,
  dataset,
  runRecord,
  status,
  progressWidth,
  savedRunId,
  logScrollRef,
  resultScrollRef,
}: EvaluationWorkbenchConsoleProps) {
  const { t } = useTranslation();

  return (
    <TabCard
      value={consoleTab}
      onChange={onConsoleTabChange}
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
                    {dataset.config.topK} topN={dataset.config.topN} repeat=
                    {dataset.config.repeat}
                  </div>
                  <div className="border-b border-border/60 py-1.5">
                    samples={dataset.summary.sampleCount} documents=
                    {dataset.summary.documentCount}
                  </div>
                  <div className="pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
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
                      <div className="pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                        evaluation queued...
                      </div>
                      <div className="border-b border-border/60 py-1.5">
                        waiting for backend worker to pick up this run
                      </div>
                    </>
                  ) : null}

                  {runRecord ? (
                    <>
                      <div className="pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
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
                      {t(
                        "settings.evaluation.workbench.console.resultSummary",
                        {
                          count: runRecord.sampleResults.length,
                        },
                      )}
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
                                ? t(
                                    "settings.evaluation.workbench.console.success",
                                  )
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
                    {t(
                      "settings.evaluation.workbench.console.emptyResultTitle",
                    )}
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
  );
}
