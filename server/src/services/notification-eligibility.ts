export const NOTIFICATION_ELIGIBILITY_EVENT =
  "final_transition_first_seen" as const;

export type NotificationCanonicalMessage = {
  id: string;
  role: string;
  content: string;
  parts?: Array<{ type: string; text?: string }>;
  metadata?: Record<string, unknown>;
};

const PLACEHOLDER_TEXT = new Set([
  "Agent 正在运行…",
  "Agent 正在运行...",
  "等待审批",
]);

const getAgentStatus = (message: NotificationCanonicalMessage) => {
  const agent = message.metadata?.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return null;
  }
  const status = (agent as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
};

const getVisibleText = (message: NotificationCanonicalMessage) => {
  const content = message.content.trim();
  if (content) return content;
  return (message.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
};

export const isNotificationPlaceholderOrRunning = (
  message: NotificationCanonicalMessage,
) => {
  if (message.role !== "assistant") return false;
  const status = getAgentStatus(message);
  if (status === "queued" || status === "running") return true;
  return PLACEHOLDER_TEXT.has(getVisibleText(message));
};

export const isNotificationUserVisibleFinal = (
  message: NotificationCanonicalMessage,
) => {
  if (message.role !== "assistant") return false;
  const text = getVisibleText(message);
  if (!text || PLACEHOLDER_TEXT.has(text)) return false;

  const status = getAgentStatus(message);
  if (!status) return true;
  return status === "completed";
};

export const isNotificationEligibleTransition = (
  previous: NotificationCanonicalMessage | null,
  next: NotificationCanonicalMessage,
) => {
  if (!isNotificationUserVisibleFinal(next)) return false;
  if (previous && previous.id !== next.id) return false;
  return (
    previous === null ||
    isNotificationPlaceholderOrRunning(previous)
  );
};
