"use client";

import type { ComponentType } from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

export type UChatAgentAvailability = {
  enabled: boolean;
  disabledReason?: string;
};

export type UChatAgentUIController = {
  enabled: boolean;
  running?: boolean;
  toggleAvailability?: UChatAgentAvailability;
  submissionAvailability?: UChatAgentAvailability;
  onToggle?: () => void | Promise<void>;
  onSubmit?: () => void | Promise<void>;
  onApprove?: (runId: string) => void | Promise<void>;
  onReject?: (runId: string) => void | Promise<void>;
};

export function UChatAgentModeControl({
  enabled,
  availability,
  onToggle,
}: {
  enabled: boolean;
  availability: UChatAgentAvailability;
  onToggle: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const isDisabled = !enabled && availability.enabled === false;

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => {
        void onToggle();
      }}
      className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs transition-colors ${
        enabled
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-border/70 bg-surface-primary/90 text-text-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
      aria-pressed={enabled ? "true" : "false"}
      title={
        isDisabled
          ? availability.disabledReason ?? t("chat.thread.agent.toggleOn")
          : enabled
            ? t("chat.thread.agent.toggleOff")
            : t("chat.thread.agent.toggleOn")
      }
      aria-label={
        enabled
          ? t("chat.thread.agent.toggleOff")
          : t("chat.thread.agent.toggleOn")
      }
    >
      <Bot className="h-3.5 w-3.5" />
      <span>
        {enabled ? "Agent" : t("chat.thread.agent.compatibilityLabel")}
      </span>
    </button>
  );
}

export function resolveUChatAgentSubmission({
  controller,
  isSendDisabled,
  onSend,
}: {
  controller?: UChatAgentUIController;
  isSendDisabled: boolean;
  onSend: () => void | Promise<void>;
}) {
  const enabled = controller?.enabled === true;
  const availability = controller?.submissionAvailability;
  const isUnavailable = enabled && availability?.enabled === false;

  return {
    mode: enabled ? ("agent" as const) : ("chat" as const),
    disabled: isSendDisabled || isUnavailable,
    disabledReason: isUnavailable ? availability?.disabledReason : undefined,
    submit: enabled && controller?.onSubmit ? controller.onSubmit : onSend,
  };
}

export function UChatAgentComposerTools({
  controller,
  Extension,
}: {
  controller?: UChatAgentUIController;
  Extension?: ComponentType;
}) {
  return (
    <>
      {controller?.onToggle ? (
        <UChatAgentModeControl
          enabled={controller.enabled}
          availability={controller.toggleAvailability ?? { enabled: true }}
          onToggle={controller.onToggle}
        />
      ) : null}
      {Extension ? <Extension /> : null}
    </>
  );
}

export function resolveUChatTypingLabel({
  controller,
  agentRunningLabel,
  assistantTypingLabel,
}: {
  controller?: UChatAgentUIController;
  agentRunningLabel: string;
  assistantTypingLabel: string;
}) {
  return controller?.running ? agentRunningLabel : assistantTypingLabel;
}
