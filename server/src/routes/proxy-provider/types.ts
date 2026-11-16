import type { ProxyProviderParam } from "@/services/provider-proxy.service/index.js";
import type { ProxyChatMessageInput } from "@/services/provider-proxy.message-protocol.js";

/** Shared request body for provider chat and task-chat endpoints. */
export interface ChatMessagesBody {
  /** Canonical desktop chat protocol. */
  messages: ProxyChatMessageInput[];
}

/** Provider chat path parameter. `default` may route into the RAG pipeline. */
export interface ProviderChatParams {
  /** Provider code or `default` to use the configured default model route. */
  provider: ProxyProviderParam;
}

/** Provider chat body includes optional thread metadata for RAG persistence. */
export interface ProviderChatBody extends ChatMessagesBody {
  /** Thread id from the desktop chat runtime. Required for RAG persistence. */
  id?: string;
  /** Client message id for the latest user message. A UUID is generated when absent. */
  messageId?: string;
  /** Host-authoritative optimistic append, separate from Desktop branch edits. */
  appendAtTail?: { expectedTailMessageId: string | null };
  /** Per-send Agent mode request from the composer Agent button. */
  agentEnabled?: boolean;
  requestedToolGroupIds?: string[];
}

/** Embedding route body. Strings are normalized into a one-item input array. */
export interface ProviderEmbeddingsBody {
  /** Text or batch of texts to embed. Empty strings are rejected by schema validation. */
  input: string | string[];
}
