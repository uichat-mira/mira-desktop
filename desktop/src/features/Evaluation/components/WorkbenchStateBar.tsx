import { useTranslation } from "react-i18next";
import Card from "@/shared/ui/Card";
import type { EvaluationJobStatus, EvaluationRunRecord, ParsedDataset } from "../utils/types";
import StatusBadge from "./StatusBadge";

interface WorkbenchStateBarProps {
  status: EvaluationJobStatus;
  dataset: ParsedDataset | null;
  runRecord: EvaluationRunRecord | null;
}

export function WorkbenchStateBar({
  status,
  dataset,
  runRecord,
}: WorkbenchStateBarProps) {
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

export default WorkbenchStateBar;
