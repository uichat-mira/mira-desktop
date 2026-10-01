import type { EvaluationJobStatus } from "../utils/types";
import { useTranslation } from "react-i18next";

const statusMap: Record<EvaluationJobStatus | "saved", { key: string; className: string }> = {
  idle: {
    key: "settings.evaluation.status.idle",
    className: "border-border bg-surface-secondary text-text-secondary",
  },
  ready: {
    key: "settings.evaluation.status.ready",
    className: "border-success-border bg-success-soft text-success-text",
  },
  queued: {
    key: "settings.evaluation.status.queued",
    className: "border-warning-border bg-warning-soft text-warning-text",
  },
  running: {
    key: "settings.evaluation.status.running",
    className: "border-warning-border bg-warning-soft text-warning-text",
  },
  completed: {
    key: "settings.evaluation.status.completed",
    className: "border-success-border bg-success-soft text-success-text",
  },
  failed: {
    key: "settings.evaluation.status.failed",
    className: "border-danger-border bg-danger-soft text-danger-text",
  },
  saved: {
    key: "settings.evaluation.status.saved",
    className: "border-border bg-surface-secondary text-text-primary",
  },
};

export function StatusBadge({
  status,
}: {
  status: EvaluationJobStatus | "saved";
}) {
  const { t } = useTranslation();
  const current = statusMap[status];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${current.className}`}
    >
      {t(current.key)}
    </span>
  );
}

export default StatusBadge;
