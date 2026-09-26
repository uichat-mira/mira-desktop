import Card from "@/shared/ui/Card";
import type { EvaluationMetricSummary } from "../utils/types";
import { useTranslation } from "react-i18next";

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export function MetricGrid({
  metrics,
  compact = false,
}: {
  metrics: EvaluationMetricSummary;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const cards = [
    {
      label: t("settings.evaluation.metrics.hitAtK"),
      value: formatPercent(metrics.hitAtK),
    },
    {
      label: t("settings.evaluation.metrics.recallAtK"),
      value: formatPercent(metrics.recallAtK),
    },
    {
      label: t("settings.evaluation.metrics.mrr"),
      value: metrics.mrr.toFixed(2),
    },
    {
      label: t("settings.evaluation.metrics.faithfulness"),
      value: formatPercent(metrics.faithfulness),
    },
    {
      label: t("settings.evaluation.metrics.answerRelevance"),
      value: formatPercent(metrics.answerRelevance),
    },
    {
      label: t("settings.evaluation.metrics.answerCompleteness"),
      value: formatPercent(metrics.answerCompleteness),
    },
    {
      label: t("settings.evaluation.metrics.sourceHitRate"),
      value: formatPercent(metrics.sourceHitRate),
    },
    {
      label: t("settings.evaluation.metrics.averageLatency", {
        count: metrics.failedCount,
      }),
      value: `${(metrics.averageLatencyMs / 1000).toFixed(1)}s`,
    },
  ];

  return (
    <div
      className={`grid gap-2.5 ${compact ? "md:grid-cols-3" : "md:grid-cols-3 xl:grid-cols-3"}`}
    >
      {cards.map((card) => (
        <Card
          key={card.label}
          label={card.label}
          value={card.value}
          className="min-h-[60px] px-3.5 py-3"
        />
      ))}
    </div>
  );
}

export default MetricGrid;
