export const NOTIFICATION_ELIGIBILITY_EVENT =
  "final_transition_first_seen" as const;

export type NotificationCanonicalMessage = {
  id: string;
  role: string;
  content: string;
  parts?: Array<{ type: string; text?: string }>;
  metadata?: Record<string, unknown>;
};

const getAgentState = (message: NotificationCanonicalMessage) => {
  const agent = message.metadata?.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return { isAgent: false, status: null as string | null };
  }
  const status = (agent as { status?: unknown }).status;
  return {
    isAgent: true,
    status: typeof status === "string" ? status : null,
  };
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
  const agent = getAgentState(message);
  return (
    agent.isAgent &&
    (agent.status === "queued" || agent.status === "running")
  );
};

export const isNotificationUserVisibleFinal = (
  message: NotificationCanonicalMessage,
) => {
  if (message.role !== "assistant") return false;
  if (!getVisibleText(message)) return false;

  const agent = getAgentState(message);
  if (!agent.isAgent) {
    // Ordinary Chat / RAG Assistant messages do not carry Agent metadata.
    return true;
  }

  // Agent notification semantics are metadata-only. UI copy and locale must
  // never determine whether an Agent snapshot is final.
  return agent.status === "completed";
};

export const isNotificationEligibleTransition = (
  previous: NotificationCanonicalMessage | null,
  next: NotificationCanonicalMessage,
) => {
  if (!isNotificationUserVisibleFinal(next)) return false;
  if (previous && previous.id !== next.id) return false;
  return previous === null || isNotificationPlaceholderOrRunning(previous);
};
