import { getSqlite } from "@/db";
import {
  modelConfigRepository,
  modelParamTemplateRepository,
} from "@/db/repositories/model-config.repository.js";
import { providerConnectionRepository } from "@/db/repositories/provider-settings.repository.js";
import { applySqliteConnectionPragmas } from "@/db/init-utils";
import {
  DEFAULT_PROVIDER_CONNECTIONS,
  DEFAULT_IMAGE_GENERATION_PARAMS,
  DEFAULT_VOICE_PARAMS,
  DEFAULT_ROLE_CONFIGS,
  MANAGED_AGENT_TASK_PARAMS,
  MANAGED_TASK_PARAMS,
  PARAM_TEMPLATES,
} from "@/services/model-config.defaults.js";
import {
  toSqlEnumValues,
  PROVIDER_CODE_VALUES,
  PROVIDER_TEMPLATE_CODE_VALUES,
} from "@/providers/codes.js";

const parseParams = (paramsJson: string) => {
  try {
    const parsed = JSON.parse(paramsJson || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const hasLegacyTaskParams = (params: Record<string, unknown>) =>
  params.temperature === 0.7 &&
  params.topP === 0.9 &&
  params.topK === 40 &&
  params.maxTokens === 2048 &&
  params.frequencyPenalty === 0 &&
  params.presencePenalty === 0;

const needsManagedTaskParams = (params: Record<string, unknown>) => {
  const expectedEntries = Object.entries(MANAGED_TASK_PARAMS);

  return (
    hasLegacyTaskParams(params) ||
    expectedEntries.some(([key, value]) => params[key] !== value)
  );
};

const providerCodeSqlValues = toSqlEnumValues(PROVIDER_CODE_VALUES);
const providerTemplateCodeSqlValues = toSqlEnumValues(
  PROVIDER_TEMPLATE_CODE_VALUES,
);
const MODEL_TYPE_SQL_VALUES = [
  "llm",
  "embedding",
  "rerank",
  "task",
  "agentTask",
  "evaluation",
  "imageGeneration",
  "voice",
] as const;

const modelTypeSqlValues = MODEL_TYPE_SQL_VALUES.map((value) => `'${value}'`).join(", ");

const tableSqlContainsAllValues = (
  sqlite: ReturnType<typeof getSqlite>,
  tableName: string,
  values: readonly string[],
) => {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;

  return values.every((value) => row?.sql?.includes(`'${value}'`) ?? false);
};

const tableSupportsAllModelRoles = (
  sqlite: ReturnType<typeof getSqlite>,
  tableName: string,
) => {
  return tableSqlContainsAllValues(sqlite, tableName, MODEL_TYPE_SQL_VALUES);
};

const tableSupportsAllProviderCodes = (
  sqlite: ReturnType<typeof getSqlite>,
  tableName: string,
) => {
  return tableSqlContainsAllValues(sqlite, tableName, PROVIDER_CODE_VALUES);
};

const tableSupportsAllProviderTemplateCodes = (
  sqlite: ReturnType<typeof getSqlite>,
  tableName: string,
) => {
  return tableSqlContainsAllValues(
    sqlite,
    tableName,
    PROVIDER_TEMPLATE_CODE_VALUES,
  );
};

const recreateModelConfigTablesForCurrentRoles = (
  sqlite: ReturnType<typeof getSqlite>,
) => {
  if (
    tableSupportsAllModelRoles(sqlite, "model_configs") &&
    tableSupportsAllModelRoles(sqlite, "model_param_templates") &&
    tableSupportsAllProviderCodes(sqlite, "model_configs")
  ) {
    return;
  }

  sqlite.exec("BEGIN");

  try {
    sqlite.exec(`
      DROP INDEX IF EXISTS idx_model_configs_type_default;
      DROP INDEX IF EXISTS idx_model_configs_type;
      DROP INDEX IF EXISTS idx_model_param_templates_type;
      DROP INDEX IF EXISTS idx_model_param_templates_type_key;
    `);

    if (
      !tableSupportsAllModelRoles(sqlite, "model_configs") ||
      !tableSupportsAllProviderCodes(sqlite, "model_configs")
    ) {
      sqlite.exec(`
        ALTER TABLE model_configs RENAME TO model_configs_legacy;

        CREATE TABLE model_configs (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          type TEXT NOT NULL CHECK (type IN (${modelTypeSqlValues})),
          name TEXT NOT NULL DEFAULT '',
          provider_code TEXT CHECK (provider_code IN (${providerCodeSqlValues})),
          remote_model_id TEXT,
          params TEXT NOT NULL DEFAULT '{}',
          is_default INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO model_configs (
          id,
          type,
          name,
          provider_code,
          remote_model_id,
          params,
          is_default,
          created_at,
          updated_at
        )
        SELECT
          id,
          type,
          name,
          provider_code,
          remote_model_id,
          params,
          is_default,
          created_at,
          updated_at
        FROM model_configs_legacy;

        DROP TABLE model_configs_legacy;
      `);
    }

    if (!tableSupportsAllModelRoles(sqlite, "model_param_templates")) {
      sqlite.exec(`
        ALTER TABLE model_param_templates RENAME TO model_param_templates_legacy;

        CREATE TABLE model_param_templates (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          model_type TEXT NOT NULL CHECK (model_type IN (${modelTypeSqlValues})),
          param_key TEXT NOT NULL,
          param_label TEXT NOT NULL,
          param_type TEXT NOT NULL CHECK (param_type IN ('number', 'select', 'boolean')),
          step REAL,
          options TEXT,
          default_value TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(model_type, param_key)
        );

        INSERT INTO model_param_templates (
          id,
          model_type,
          param_key,
          param_label,
          param_type,
          step,
          options,
          default_value,
          created_at
        )
        SELECT
          id,
          model_type,
          param_key,
          param_label,
          param_type,
          step,
          options,
          default_value,
          created_at
        FROM model_param_templates_legacy;

        DROP TABLE model_param_templates_legacy;
      `);
    }

    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_type_default
      ON model_configs(type)
      WHERE is_default = 1;
      CREATE INDEX IF NOT EXISTS idx_model_configs_type ON model_configs(type);
      CREATE INDEX IF NOT EXISTS idx_model_param_templates_type ON model_param_templates(model_type);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_model_param_templates_type_key ON model_param_templates(model_type, param_key);
    `);

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
};

const ensureModelConfigConnectionColumns = (
  sqlite: ReturnType<typeof getSqlite>,
) => {
  const columns = sqlite.prepare("PRAGMA table_info(model_configs)").all() as Array<{
    name: string;
  }>;
  const hasProviderConnectionId = columns.some(
    (column) => column.name === "provider_connection_id",
  );

  if (!hasProviderConnectionId) {
    sqlite.exec(`
      ALTER TABLE model_configs
      ADD COLUMN provider_connection_id TEXT
      REFERENCES provider_connections(id)
      ON DELETE SET NULL
    `);
  }
};

const migrateProviderConnectionTables = (sqlite: ReturnType<typeof getSqlite>) => {
  const connectionColumns = sqlite.prepare("PRAGMA table_info(provider_connections)").all() as Array<{
    name: string;
    pk: number;
  }>;
  const hasConnectionId = connectionColumns.some((column) => column.name === "id");
  const providerConnectionsNeedsRebuild =
    connectionColumns.length > 0 &&
    (!hasConnectionId ||
      connectionColumns.some(
        (column) => column.name === "provider_code" && column.pk === 1,
      ) ||
      !tableSupportsAllProviderCodes(sqlite, "provider_connections") ||
      !tableSupportsAllProviderTemplateCodes(sqlite, "provider_connections"));

  if (providerConnectionsNeedsRebuild) {
    const foreignKeysEnabled = sqlite.pragma("foreign_keys", {
      simple: true,
    }) as number;

    if (foreignKeysEnabled) {
      sqlite.exec("PRAGMA foreign_keys = OFF");
    }

    try {
      sqlite.exec("BEGIN");

      try {
        sqlite.exec(`
        DROP INDEX IF EXISTS idx_provider_connections_status;
        DROP INDEX IF EXISTS idx_provider_connections_template;
        DROP INDEX IF EXISTS idx_provider_connections_provider_code_unique;
        DROP INDEX IF EXISTS idx_provider_connections_provider_code;

        CREATE TABLE provider_connections_new (
          id TEXT PRIMARY KEY,
          template_code TEXT NOT NULL CHECK (template_code IN (${providerTemplateCodeSqlValues})),
          provider_code TEXT CHECK (provider_code IN (${providerCodeSqlValues})),
          display_name TEXT NOT NULL,
          base_url TEXT NOT NULL DEFAULT '',
          api_key_encrypted TEXT,
          is_system INTEGER NOT NULL DEFAULT 0,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'connected', 'error')),
          last_error TEXT,
          last_synced_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        ${
          hasConnectionId
            ? `INSERT INTO provider_connections_new (
          id,
          template_code,
          provider_code,
          display_name,
          base_url,
          api_key_encrypted,
          is_system,
          is_enabled,
          status,
          last_error,
          last_synced_at,
          created_at,
          updated_at
        )
        SELECT
          id,
          template_code,
          provider_code,
          display_name,
          base_url,
          api_key_encrypted,
          is_system,
          is_enabled,
          status,
          last_error,
          last_synced_at,
          created_at,
          updated_at
        FROM provider_connections;`
            : `INSERT INTO provider_connections_new (
          id,
          template_code,
          provider_code,
          display_name,
          base_url,
          api_key_encrypted,
          is_system,
          is_enabled,
          status,
          last_error,
          last_synced_at,
          created_at,
          updated_at
        )
        SELECT
          provider_code,
          provider_code,
          provider_code,
          display_name,
          base_url,
          api_key_encrypted,
          1,
          is_enabled,
          status,
          last_error,
          last_synced_at,
          created_at,
          updated_at
        FROM provider_connections;
        `
        }

        DROP TABLE provider_connections;
        ALTER TABLE provider_connections_new RENAME TO provider_connections;
      `);

        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    } finally {
      if (foreignKeysEnabled) {
        sqlite.exec("PRAGMA foreign_keys = ON");
      }
    }
  }

  const providerModelColumns = sqlite.prepare("PRAGMA table_info(provider_models)").all() as Array<{
    name: string;
  }>;
  const hasProviderModelConnectionId = providerModelColumns.some(
    (column) => column.name === "provider_connection_id",
  );
  const providerModelsNeedsRebuild =
    providerModelColumns.length > 0 &&
    (providerConnectionsNeedsRebuild ||
      !hasProviderModelConnectionId ||
      !tableSupportsAllProviderCodes(sqlite, "provider_models"));

  if (providerModelsNeedsRebuild) {
    const legacyProviderConnectionIdExpression = hasProviderModelConnectionId
      ? "COALESCE(provider_connection_id, provider_code)"
      : "provider_code";

    sqlite.exec("BEGIN");

    try {
      sqlite.exec(`
        DROP INDEX IF EXISTS idx_provider_models_provider;
        DROP INDEX IF EXISTS idx_provider_models_provider_remote;
        ALTER TABLE provider_models RENAME TO provider_models_legacy;

        CREATE TABLE provider_models (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
          provider_code TEXT CHECK (provider_code IN (${providerCodeSqlValues})),
          remote_model_id TEXT NOT NULL,
          model_name TEXT NOT NULL,
          raw_payload_json TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          synced_at TEXT NOT NULL,
          UNIQUE(provider_connection_id, remote_model_id)
        );

        INSERT INTO provider_models (
          provider_connection_id,
          provider_code,
          remote_model_id,
          model_name,
          raw_payload_json,
          is_active,
          synced_at
        )
        SELECT
          ${legacyProviderConnectionIdExpression},
          provider_code,
          remote_model_id,
          model_name,
          raw_payload_json,
          is_active,
          synced_at
        FROM provider_models_legacy
        WHERE ${legacyProviderConnectionIdExpression} IS NOT NULL;

        DROP TABLE provider_models_legacy;
      `);

      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  ensureModelConfigConnectionColumns(sqlite);
};

export const initializeModelConfigDatabase = (): void => {
  try {
    const sqlite = getSqlite();
    applySqliteConnectionPragmas(sqlite);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS model_configs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        type TEXT NOT NULL CHECK (type IN (${modelTypeSqlValues})),
        name TEXT NOT NULL DEFAULT '',
        provider_code TEXT CHECK (provider_code IN (${providerCodeSqlValues})),
        provider_connection_id TEXT REFERENCES provider_connections(id) ON DELETE SET NULL,
        remote_model_id TEXT,
        params TEXT NOT NULL DEFAULT '{}',
        is_default INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_type_default
      ON model_configs(type)
      WHERE is_default = 1
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS model_param_templates (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        model_type TEXT NOT NULL CHECK (model_type IN (${modelTypeSqlValues})),
        param_key TEXT NOT NULL,
        param_label TEXT NOT NULL,
        param_type TEXT NOT NULL CHECK (param_type IN ('number', 'select', 'boolean')),
        step REAL,
        options TEXT,
        default_value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(model_type, param_key)
      )
    `);

    recreateModelConfigTablesForCurrentRoles(sqlite);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS provider_connections (
        id TEXT PRIMARY KEY,
        template_code TEXT NOT NULL CHECK (template_code IN (${providerTemplateCodeSqlValues})),
        provider_code TEXT CHECK (provider_code IN (${providerCodeSqlValues})),
        display_name TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        api_key_encrypted TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'connected', 'error')),
        last_error TEXT,
        last_synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS provider_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        provider_code TEXT CHECK (provider_code IN (${providerCodeSqlValues})),
        remote_model_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        raw_payload_json TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        synced_at TEXT NOT NULL,
        UNIQUE(provider_connection_id, remote_model_id)
      )
    `);

    migrateProviderConnectionTables(sqlite);

    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_model_configs_type ON model_configs(type);
      CREATE INDEX IF NOT EXISTS idx_model_param_templates_type ON model_param_templates(model_type);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_model_param_templates_type_key ON model_param_templates(model_type, param_key);
      CREATE INDEX IF NOT EXISTS idx_provider_connections_status ON provider_connections(status);
      CREATE INDEX IF NOT EXISTS idx_provider_connections_template ON provider_connections(template_code);
      DROP INDEX IF EXISTS idx_provider_connections_provider_code_unique;
      CREATE INDEX IF NOT EXISTS idx_provider_connections_provider_code ON provider_connections(provider_code);
      CREATE INDEX IF NOT EXISTS idx_provider_models_connection ON provider_models(provider_connection_id);
      CREATE INDEX IF NOT EXISTS idx_provider_models_provider_code ON provider_models(provider_code);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_models_connection_remote ON provider_models(provider_connection_id, remote_model_id);
    `);

    for (const provider of DEFAULT_PROVIDER_CONNECTIONS) {
      const existingProvider = providerConnectionRepository.findById(provider.id);

      if (existingProvider) {
        continue;
      }

      providerConnectionRepository.upsertSystemConnection({
        id: provider.id,
        templateCode: provider.templateCode,
        providerCode: provider.providerCode,
        displayName: provider.displayName,
        baseUrl: provider.baseUrl,
        apiKeyEncrypted: null,
        isSystem: true,
        isEnabled: true,
        status: "idle",
        lastError: null,
        lastSyncedAt: null,
      });
    }

    sqlite.exec(`
      UPDATE model_configs
      SET provider_connection_id = provider_code
      WHERE provider_connection_id IS NULL
        AND provider_code IS NOT NULL
        AND provider_code IN (${providerCodeSqlValues})
    `);

    for (const config of DEFAULT_ROLE_CONFIGS) {
      const existing = modelConfigRepository.findDefaultByType(config.type);
      if (!existing) {
        modelConfigRepository.upsertDefault({
          type: config.type,
          name: config.name,
          params: JSON.stringify(config.params),
          providerCode: config.providerCode,
          providerConnectionId: config.providerCode,
          remoteModelId: config.remoteModelId,
        });
      }
    }

    const rerankDefault = DEFAULT_ROLE_CONFIGS.find(
      (config) => config.type === "rerank",
    );
    const existingRerank = modelConfigRepository.findDefaultByType("rerank");

    if (
      rerankDefault &&
      existingRerank &&
      !existingRerank.providerCode &&
      !existingRerank.remoteModelId
    ) {
      modelConfigRepository.upsertDefault({
        type: rerankDefault.type,
        name: rerankDefault.name,
        params: JSON.stringify(rerankDefault.params),
        providerCode: rerankDefault.providerCode,
        providerConnectionId: rerankDefault.providerCode,
        remoteModelId: rerankDefault.remoteModelId,
      });
    }

    const existingTask = modelConfigRepository.findDefaultByType("task");

    if (existingTask) {
      const currentTaskParams = parseParams(existingTask.params);
      if (needsManagedTaskParams(currentTaskParams)) {
        modelConfigRepository.updateDefault("task", {
          params: JSON.stringify({
            ...currentTaskParams,
            ...MANAGED_TASK_PARAMS,
          }),
        });
      }
    }

    const agentTaskDefault = DEFAULT_ROLE_CONFIGS.find(
      (config) => config.type === "agentTask",
    );
    const existingAgentTask = modelConfigRepository.findDefaultByType("agentTask");

    if (agentTaskDefault && existingAgentTask) {
      const currentAgentTaskParams = parseParams(existingAgentTask.params);
      const needsUpdate = Object.entries(MANAGED_AGENT_TASK_PARAMS).some(
        ([key, value]) => currentAgentTaskParams[key] !== value,
      );

      if (needsUpdate) {
        modelConfigRepository.updateDefault("agentTask", {
          params: JSON.stringify({
            ...currentAgentTaskParams,
            ...MANAGED_AGENT_TASK_PARAMS,
          }),
          providerConnectionId: existingAgentTask.providerConnectionId ?? null,
        });
      }
    }

    const imageGenerationDefault = DEFAULT_ROLE_CONFIGS.find(
      (config) => config.type === "imageGeneration",
    );
    const existingImageGeneration =
      modelConfigRepository.findDefaultByType("imageGeneration");

    if (imageGenerationDefault && existingImageGeneration) {
      const currentImageGenerationParams = parseParams(
        existingImageGeneration.params,
      );
      if (
        typeof currentImageGenerationParams.enabled !== "boolean" ||
        currentImageGenerationParams.enabled !==
          DEFAULT_IMAGE_GENERATION_PARAMS.enabled
      ) {
        modelConfigRepository.updateDefault("imageGeneration", {
          params: JSON.stringify({
            ...currentImageGenerationParams,
            ...DEFAULT_IMAGE_GENERATION_PARAMS,
          }),
          providerConnectionId: existingImageGeneration.providerConnectionId ?? null,
        });
      }
    }

    const voiceDefault = DEFAULT_ROLE_CONFIGS.find(
      (config) => config.type === "voice",
    );
    const existingVoice = modelConfigRepository.findDefaultByType("voice");

    if (voiceDefault && existingVoice) {
      const currentVoiceParams = parseParams(existingVoice.params);
      if (
        typeof currentVoiceParams.enabled !== "boolean" ||
        currentVoiceParams.enabled !== DEFAULT_VOICE_PARAMS.enabled
      ) {
        modelConfigRepository.updateDefault("voice", {
          params: JSON.stringify({
            ...currentVoiceParams,
            ...DEFAULT_VOICE_PARAMS,
          }),
          providerConnectionId: existingVoice.providerConnectionId ?? null,
        });
      }
    }

    for (const template of PARAM_TEMPLATES) {
      modelParamTemplateRepository.upsert({
        modelType: template.model_type,
        paramKey: template.param_key,
        paramLabel: template.param_label,
        paramType: template.param_type,
        step: template.step,
        options: template.options ? JSON.stringify(template.options) : null,
        defaultValue: JSON.stringify(template.default_value),
      });
    }
  } catch (err) {
    console.error("Failed to initialize model config database:", err);
    throw err;
  }
};
