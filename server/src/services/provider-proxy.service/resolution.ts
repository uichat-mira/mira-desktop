import {
  modelConfigRepository,
  providerConnectionRepository,
  providerModelRepository,
} from "@/db/repositories";
import type { ModelType, ProviderCode } from "@/db/schema.js";
import {
  getProviderDefinition,
  isCallableModelId,
} from "@/providers/catalog.js";
import { isCloudflareBaseUrl } from "@/services/cloudflare-provider.js";
import { decryptSecret } from "@/utils/crypto.js";
import { fetchJsonWithTimeout } from "@/utils/http.js";
import { parseModelParams } from "./params.js";
import type {
  AssertOllamaModelAvailableInput,
  ProviderResolution,
  ProxyProviderParam,
} from "./types.js";

const getRuntimeProviderCode = (input: {
  providerCode: ProviderCode | null;
  templateCode: string;
}): ProviderCode => {
  if (input.providerCode) {
    return input.providerCode;
  }

  if (input.templateCode === "openai-compatible-custom") {
    return "volcengine";
  }

  throw new Error(`Unsupported provider template "${input.templateCode}"`);
};

export const applyRoleSpecificProviderParams = (
  roleType: ModelType,
  providerCode: ProviderCode,
  params: Record<string, unknown>,
) => {
  const nextParams = { ...params };
  if (providerCode === "ollama" && nextParams.think === undefined) {
    nextParams.think = false;
  }
  if (providerCode === "volcengine" && nextParams.thinking === undefined) {
    nextParams.thinking = false;
  }

  if (roleType !== "task" && roleType !== "agentTask") {
    return nextParams;
  }

  switch (providerCode) {
    case "ollama":
      return {
        ...nextParams,
        think: false,
      };
    case "volcengine":
      return {
        ...nextParams,
        thinking: false,
      };
    default:
      return nextParams;
  }
};

export const resolveAgentTaskProvider = (
  requestedProvider: ProxyProviderParam = "default",
): ProviderResolution => {
  const agentTaskConfig = modelConfigRepository.findDefaultByType("agentTask");

  // Keep Agent runtime compatible with existing task-role installs until the
  // new dedicated AgentTask role is explicitly configured by the user.
  if (
    agentTaskConfig?.remoteModelId &&
    (agentTaskConfig.providerConnectionId || agentTaskConfig.providerCode)
  ) {
    return resolveProviderForRole("agentTask", requestedProvider);
  }

  return resolveProviderForRole("task", requestedProvider);
};

const resolveProviderModelIdentifier = (
  roleType: ModelType,
  providerCode: ProviderCode,
  modelConfig: ReturnType<typeof modelConfigRepository.findDefaultByType>,
) => {
  if (!modelConfig?.remoteModelId) {
    throw new Error(`No ${roleType.toUpperCase()} model configured`);
  }

  if (!getProviderDefinition(providerCode).callableModelIdPrefix) {
    return modelConfig.remoteModelId;
  }

  if (isCallableModelId(providerCode, modelConfig.remoteModelId)) {
    return modelConfig.remoteModelId;
  }

  if (isCallableModelId(providerCode, modelConfig.name)) {
    return modelConfig.name;
  }

  const providerModel = providerModelRepository.findByProviderAndRemoteModelId(
    providerCode,
    modelConfig.remoteModelId,
  );

  if (
    providerModel?.modelName &&
    isCallableModelId(providerCode, providerModel.modelName)
  ) {
    return providerModel.modelName;
  }

  throw new Error(
    `${getProviderDefinition(providerCode).displayName} ${roleType} model "${modelConfig.remoteModelId}" is not a callable model identifier`,
  );
};

const assertProviderConnectionConfigured = (input: {
  providerCode: ProviderCode;
  baseUrl: string;
  apiKey: string;
  roleType: ModelType;
}) => {
  const providerLabel = getProviderDefinition(input.providerCode).displayName;
  const normalizedBaseUrl = input.baseUrl.trim();
  const normalizedApiKey = input.apiKey.trim();

  if (!normalizedBaseUrl) {
    throw new Error(
      `${providerLabel} ${input.roleType.toUpperCase()} provider base URL 未配置。请先在提供商设置中完成配置。`,
    );
  }

  if (input.providerCode === "cloudflare") {
    if (
      normalizedBaseUrl.includes("<ACCOUNT_ID>") ||
      normalizedBaseUrl.includes("[ACCOUNT_ID]")
    ) {
      throw new Error(
        'Cloudflare base URL 仍是占位符。请改成真实账号地址，例如 "https://api.cloudflare.com/client/v4/accounts/<你的 ACCOUNT_ID>/ai/v1"。',
      );
    }

    if (!isCloudflareBaseUrl(normalizedBaseUrl)) {
      throw new Error(
        'Cloudflare base URL 格式不正确。请使用 "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1"。',
      );
    }
  }

  if (
    (input.providerCode === "cloudflare" || input.providerCode === "openai") &&
    !normalizedApiKey
  ) {
    throw new Error(
      `${providerLabel} API Key 未配置。请先在提供商设置中填写有效的 API Key。`,
    );
  }
};

const resolveProviderConnection = (
  providerId: string,
  roleType: ModelType,
) => {
  const provider =
    providerConnectionRepository.findById(providerId) ??
    providerConnectionRepository.findByCode(providerId as ProviderCode);
  if (!provider) {
    throw new Error(`Provider "${providerId}" not found`);
  }

  if (!provider.isEnabled) {
    throw new Error(`Provider "${providerId}" is disabled`);
  }

  const decryptedApiKey = decryptSecret(provider.apiKeyEncrypted);
  const runtimeProviderCode = getRuntimeProviderCode({
    providerCode: provider.providerCode ?? null,
    templateCode: provider.templateCode,
  });
  assertProviderConnectionConfigured({
    providerCode: runtimeProviderCode,
    baseUrl: provider.baseUrl ?? "",
    apiKey: decryptedApiKey,
    roleType,
  });

  return {
    id: provider.id,
    templateCode: provider.templateCode,
    providerCode: runtimeProviderCode,
    baseUrl: provider.baseUrl ?? "",
    apiKey: decryptedApiKey,
  };
};

export const resolveProviderForRole = (
  roleType: ModelType,
  requestedProvider: ProxyProviderParam = "default",
): ProviderResolution => {
  const modelConfig = modelConfigRepository.findDefaultByType(roleType);
  if (!modelConfig) {
    throw new Error(`No ${roleType.toUpperCase()} model configured`);
  }

  if (!modelConfig.providerCode || !modelConfig.remoteModelId) {
    if (!modelConfig.providerConnectionId || !modelConfig.remoteModelId) {
      throw new Error(
        `${roleType.toUpperCase()} model has no provider or remote model assigned`,
      );
    }
  }

  const resolvedProviderId =
    modelConfig.providerConnectionId ?? modelConfig.providerCode;

  if (!resolvedProviderId) {
    throw new Error(
      `${roleType.toUpperCase()} model has no provider or remote model assigned`,
    );
  }

  const connection = resolveProviderConnection(resolvedProviderId, roleType);
  const configuredRuntimeProviderCode = connection.providerCode;

  if (
    requestedProvider !== "default" &&
    requestedProvider !== configuredRuntimeProviderCode
  ) {
    throw new Error(
      `Requested provider "${requestedProvider}" does not match current default ${roleType.toUpperCase()} provider "${configuredRuntimeProviderCode}"`,
    );
  }

  return {
    providerCode: configuredRuntimeProviderCode,
    providerConnectionId: connection.id,
    providerTemplateCode: connection.templateCode,
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    model: resolveProviderModelIdentifier(
      roleType,
      connection.providerCode,
      modelConfig,
    ),
    modelConfigId: modelConfig.id,
    params: applyRoleSpecificProviderParams(
      roleType,
      connection.providerCode,
      parseModelParams(modelConfig.params),
    ),
  };
};

export const resolveExplicitProviderSelection = (
  providerCode: ProviderCode,
  remoteModelId: string,
  params: Record<string, unknown> = {},
): ProviderResolution => {
  const connection = resolveProviderConnection(providerCode, "evaluation");
  const model = remoteModelId.trim();

  if (!model) {
    throw new Error("Evaluation model is required");
  }

  return {
    providerCode,
    providerConnectionId: connection.id,
    providerTemplateCode: connection.templateCode,
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    model,
    modelConfigId: `manual:${providerCode}:${model}`,
    params,
  };
};

export const assertOllamaModelAvailable = async (
  params: AssertOllamaModelAvailableInput,
) => {
  const headers: HeadersInit = {};
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const result = await fetchJsonWithTimeout<{
    models?: Array<{ name: string }>;
  }>(`${params.baseUrl.replace(/\/+$/, "")}/api/tags`, { headers }, 10_000);

  const availableModels = (result.models ?? []).map((item) => item.name);
  const isAvailable = availableModels.some(
    (name) =>
      name === params.model ||
      name === `${params.model}:latest` ||
      name.replace(/:latest$/, "") === params.model,
  );

  if (!isAvailable) {
    throw new Error(
      `Ollama ${params.role} 模型 "${params.model}" 当前未在 ${params.baseUrl} 可用。请先 pull 该模型，或在模型设置里重新选择一个已同步且已下载的模型。`,
    );
  }
};
