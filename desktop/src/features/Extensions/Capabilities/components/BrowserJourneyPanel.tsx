import { RefreshCw, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/Button";
import type {
  BrowserJourneyState,
  BrowserJourneyStep,
  BrowserJourneyStepId,
  BrowserJourneyStepStatus,
} from "../browserJourney";

type BrowserJourneyPanelProps = {
  journey: BrowserJourneyState;
  isRunning: boolean;
  onRetry: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
};

const stepLabelKey: Record<BrowserJourneyStepId, string> = {
  navigate: "navigate",
  snapshot: "snapshot",
  click: "click",
  "observe-after-click": "observeAfterClick",
  assert: "assert",
};

const statusTone: Record<BrowserJourneyStepStatus, string> = {
  pending: "text-text-tertiary",
  running: "text-primary",
  awaiting_approval: "text-warning",
  completed: "text-success",
  failed: "text-danger",
  rejected: "text-danger",
  skipped: "text-text-tertiary",
};

function BrowserJourneyStepRow({ step }: { step: BrowserJourneyStep }) {
  const { t } = useTranslation();
  return (
    <li
      data-testid={`browser-journey-step-${step.id}`}
      className="rounded-ui-control border border-border bg-surface-secondary px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-text-primary">
          {t(`settings.development.capabilities.browserJourney.steps.${stepLabelKey[step.id]}`)}
        </span>
        <code className="text-[11px] text-text-tertiary">{step.toolId}</code>
        <span className={`text-[11px] font-medium ${statusTone[step.status]}`}>
          {t(`settings.development.capabilities.browserJourney.status.${step.status}`)}
        </span>
        {step.approvalDecision ? (
          <span className="text-[11px] text-text-secondary">
            {t("settings.development.capabilities.browserJourney.labels.approval")} ::{" "}
            {t(
              `settings.development.capabilities.browserJourney.approval.${step.approvalDecision}`,
            )}
          </span>
        ) : null}
        {step.resultOk !== null ? (
          <span
            className={`text-[11px] ${step.resultOk ? "text-success" : "text-danger"}`}
          >
            result.ok :: {String(step.resultOk)}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 space-y-0.5 font-mono text-[11px] leading-5 text-text-secondary">
        {step.invocationId ? <div>invocation :: {step.invocationId}</div> : null}
        {step.approvalInvocationId ? (
          <div>approval_invocation :: {step.approvalInvocationId}</div>
        ) : null}
        {step.sessionId ? <div>session :: {step.sessionId}</div> : null}
        {step.page ? (
          <>
            <div>page.url :: {step.page.url}</div>
            <div>page.title :: {step.page.title}</div>
            {step.page.snapshotHash ? (
              <div>page.snapshotHash :: {step.page.snapshotHash}</div>
            ) : null}
          </>
        ) : null}
        {step.ref ? <div>snapshot.ref :: {step.ref}</div> : null}
        {step.assertion ? (
          <div>
            assertion :: {step.assertion.kind} / {String(step.assertion.passed)}
          </div>
        ) : null}
        {step.error ? (
          <div className="text-danger">
            error :: {step.error.code} · {step.error.message}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function BrowserJourneyPanel({
  journey,
  isRunning,
  onRetry,
  onReset,
}: BrowserJourneyPanelProps) {
  const { t } = useTranslation();
  if (!journey.spec) return null;

  const retryDisabled =
    isRunning ||
    journey.status === "running" ||
    journey.status === "awaiting_approval";
  const resetDisabled = isRunning || journey.status === "running";

  return (
    <section
      data-testid="browser-journey-panel"
      className="space-y-3 rounded-ui-control border border-border bg-surface px-3 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-semibold text-text-primary">
            {t("settings.development.capabilities.browserJourney.title")}
          </div>
          <div className="text-xs leading-5 text-text-secondary">
            {t("settings.development.capabilities.browserJourney.description")}
          </div>
          <div className="break-all font-mono text-[11px] text-text-tertiary">
            startUrl :: {journey.spec.startUrl}
          </div>
          <div className="font-mono text-[11px] text-text-tertiary">
            assertion :: {journey.spec.assertion.kind} = {journey.spec.assertion.expected}
          </div>
          <div className="font-mono text-[11px] text-text-tertiary">
            {t("settings.development.capabilities.browserJourney.labels.runStatus")} ::{" "}
            {t(`settings.development.capabilities.browserJourney.status.${journey.status}`)}
          </div>
          {journey.error ? (
            <div className="text-xs text-danger">
              {journey.error.code} · {journey.error.message}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={retryDisabled}
            onClick={() => void onRetry()}
          >
            <RefreshCw className="h-4 w-4" />
            {t("settings.development.capabilities.browserJourney.actions.retry")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={resetDisabled}
            onClick={() => void onReset()}
          >
            <RotateCcw className="h-4 w-4" />
            {t("settings.development.capabilities.browserJourney.actions.reset")}
          </Button>
        </div>
      </div>
      <ol className="space-y-2">
        {journey.steps.map((step) => (
          <BrowserJourneyStepRow key={step.id} step={step} />
        ))}
      </ol>
    </section>
  );
}
