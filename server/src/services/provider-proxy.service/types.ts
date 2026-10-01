import type {
  ModelType,
  ProviderCode,
  ProviderTemplateCode,
} from "@/db/schema.js";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol.js";

export type ProxyProviderParam = ProviderCode | "default";

export interface ProviderResolution {
  providerCode: ProviderCode;
  providerConnectionId: string;
  providerTemplateCode: ProviderTemplateCode;
  baseUrl: string;
  apiKey: string;
  model: string;
  modelConfigId: string;
  params: Record<string, unknown>;
}

export interface ProviderInvocationMetadata {
  providerCode: ProviderCode;
  providerLabel: string;
  protocol: string;
  operation: string;
  endpoint: string;
  model: string;
  modelConfigId: string;
  params: Record<string, unknown>;
  request: {
    method: "POST";
    url: string;
    body: Record<string, unknown>;
  };
}

export interface ChatProviderAdapter {
  streamChat(input: {
    resolved: ProviderResolution;
    messages: NormalizedChatMessage[];
  }): AsyncIterable<string>;

  describeInvocation(input: {
    resolved: ProviderResolution;
    messages: NormalizedChatMessage[];
    operation: "chat" | "task-chat";
  }): ProviderInvocationMetadata;
}

export interface RerankResolution extends ProviderResolution {
  endpoint: string;
}

export interface AssertOllamaModelAvailableInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  role: ModelType;
}
