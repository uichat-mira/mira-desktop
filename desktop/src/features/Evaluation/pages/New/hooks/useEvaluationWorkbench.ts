import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
} from "../../../utils/types";

export type ConsoleTab = "log" | "result";

const getEvaluationRunStartErrorMessage = (
  error: unknown,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  const fallback = t("settings.evaluation.workbench.messages.runCreateFailed");
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.message.includes("missing a valid knowledgeBaseId")) {
    return t("settings.evaluation.workbench.messages.missingKnowledgeBaseId");
  }

  if (error.message.includes("unknown knowledge base")) {
    return t("settings.evaluation.workbench.messages.unknownKnowledgeBase");
  }

  return error.message || fallback;
};

export function useEvaluationWorkbench() {
  const { t } = useTranslation();
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [status, setStatus] = useState<EvaluationJobStatus>("idle");
  const [parsing, setParsing] = useState(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("log");
  const [runRecord, setRunRecord] = useState<EvaluationRunRecord | null>(null);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const resultScrollRef = useRef<HTMLDivElement>(null);

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

  const handleSelectFiles = useCallback(
    async (files: FileList | null) => {
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
        message.success(
          t("settings.evaluation.workbench.messages.parseSuccess"),
        );
      } catch (error) {
        message.error(
          error instanceof Error
            ? error.message
            : t("settings.evaluation.workbench.messages.parseFailed"),
        );
      } finally {
        setParsing(false);
      }
    },
    [t],
  );

  const handleStartEvaluation = useCallback(async () => {
    if (!dataset) {
      message.warning(t("settings.evaluation.workbench.messages.uploadFirst"));
      return;
    }

    if (dataset.validations.some((item) => item.status === "error")) {
      message.error(
        t("settings.evaluation.workbench.messages.validationError"),
      );
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
  }, [dataset, t]);

  return {
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
  };
}
