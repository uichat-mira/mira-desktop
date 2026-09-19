import {
  index,
  integer,
  blob,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import {
  MESSAGE_ROLE_VALUES,
  MODEL_TYPE_VALUES,
  ROLE_STATUS_VALUES,
  THREAD_STATUS_VALUES,
  USER_ROLE_VALUES,
} from "@/constants/domain.js";
import {
  PROVIDER_CODE_VALUES,
  PROVIDER_TEMPLATE_CODE_VALUES,
  PROVIDER_STATUS_VALUES,
  type ProviderCodeValue,
  type ProviderTemplateCodeValue,
  type ProviderStatusValue,
} from "@/providers/codes.js";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: USER_ROLE_VALUES }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    usernameIdx: uniqueIndex("idx_users_username").on(table.username),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export const modelConfigs = sqliteTable(
  "model_configs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    type: text("type", { enum: MODEL_TYPE_VALUES }).notNull(),
    name: text("name").notNull().default(""),
    providerCode: text("provider_code", {
      enum: PROVIDER_CODE_VALUES,
    }),
    providerConnectionId: text("provider_connection_id").references(
      () => providerConnections.id,
      { onDelete: "set null" },
    ),
    remoteModelId: text("remote_model_id"),
    params: text("params").notNull().default("{}"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    typeIdx: index("idx_model_configs_type").on(table.type),
    typeDefaultIdx: uniqueIndex("idx_model_configs_type_default")
      .on(table.type)
      .where(sql`${table.isDefault} = 1`),
  }),
);

export const modelConfigsRelations = relations(modelConfigs, () => ({}));

export type ModelConfig = typeof modelConfigs.$inferSelect;
export type NewModelConfig = typeof modelConfigs.$inferInsert;

export const modelParamTemplates = sqliteTable(
  "model_param_templates",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    modelType: text("model_type", {
      enum: MODEL_TYPE_VALUES,
    }).notNull(),
    paramKey: text("param_key").notNull(),
    paramLabel: text("param_label").notNull(),
    paramType: text("param_type", {
      enum: ["number", "select", "boolean"],
    }).notNull(),
    step: real("step"),
    options: text("options"),
    defaultValue: text("default_value").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    modelTypeParamKeyIdx: uniqueIndex("idx_model_param_templates_type_key").on(
      table.modelType,
      table.paramKey,
    ),
    modelTypeIdx: index("idx_model_param_templates_type").on(table.modelType),
  }),
);

export const modelParamTemplatesRelations = relations(
  modelParamTemplates,
  () => ({}),
);

export type ModelParamTemplate = typeof modelParamTemplates.$inferSelect;
export type NewModelParamTemplate = typeof modelParamTemplates.$inferInsert;

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    templateCode: text("template_code", {
      enum: PROVIDER_TEMPLATE_CODE_VALUES,
    }).notNull(),
    providerCode: text("provider_code", {
      enum: PROVIDER_CODE_VALUES,
    }),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url").notNull().default(""),
    apiKeyEncrypted: text("api_key_encrypted"),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    isEnabled: integer("is_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    status: text("status", {
      enum: PROVIDER_STATUS_VALUES,
    })
      .notNull()
      .default("idle"),
    lastError: text("last_error"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    providerStatusIdx: index("idx_provider_connections_status").on(
      table.status,
    ),
    templateIdx: index("idx_provider_connections_template").on(table.templateCode),
    providerCodeIdx: index("idx_provider_connections_provider_code").on(
      table.providerCode,
    ),
  }),
);

export type ProviderConnection = typeof providerConnections.$inferSelect;
export type NewProviderConnection = typeof providerConnections.$inferInsert;

export const providerModels = sqliteTable(
  "provider_models",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerConnectionId: text("provider_connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    providerCode: text("provider_code", {
      enum: PROVIDER_CODE_VALUES,
    }),
    remoteModelId: text("remote_model_id").notNull(),
    modelName: text("model_name").notNull(),
    rawPayloadJson: text("raw_payload_json"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    syncedAt: text("synced_at").notNull(),
  },
  (table) => ({
    providerModelUniqueIdx: uniqueIndex(
      "idx_provider_models_connection_remote",
    ).on(table.providerConnectionId, table.remoteModelId),
    providerModelIdx: index("idx_provider_models_connection").on(
      table.providerConnectionId,
    ),
    providerCodeIdx: index("idx_provider_models_provider_code").on(table.providerCode),
  }),
);

export type ProviderModel = typeof providerModels.$inferSelect;
export type NewProviderModel = typeof providerModels.$inferInsert;

export const generalSettings = sqliteTable("general_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  socks5Host: text("socks5_host").notNull().default(""),
  socks5Port: integer("socks5_port").notNull().default(0),
  socks5Username: text("socks5_username").notNull().default(""),
  socks5PasswordEncrypted: text("socks5_password_encrypted"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type GeneralSettings = typeof generalSettings.$inferSelect;
export type NewGeneralSettings = typeof generalSettings.$inferInsert;

export const webSearchSettings = sqliteTable("web_search_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tavilyApiKeyEncrypted: text("tavily_api_key_encrypted"),
  searxngBaseUrl: text("searxng_base_url").notNull().default(""),
  maxResults: integer("max_results").notNull().default(4),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type WebSearchSettings = typeof webSearchSettings.$inferSelect;
export type NewWebSearchSettings = typeof webSearchSettings.$inferInsert;

export const wecomSettings = sqliteTable("wecom_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  corpId: text("corp_id").notNull().default(""),
  agentId: text("agent_id").notNull().default(""),
  appSecretEncrypted: text("app_secret_encrypted"),
  contactsSecretEncrypted: text("contacts_secret_encrypted"),
  robotWebhookUrlEncrypted: text("robot_webhook_url_encrypted"),
  robotWebhookSecretEncrypted: text("robot_webhook_secret_encrypted"),
  smartRobotBotIdEncrypted: text("smart_robot_bot_id_encrypted"),
  smartRobotSecretEncrypted: text("smart_robot_secret_encrypted"),
  smartRobotKnowledgeBaseIdEncrypted: text(
    "smart_robot_knowledge_base_id_encrypted",
  ),
  smartRobotReplyMode: text("smart_robot_reply_mode").notNull().default("stream"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type WecomSettings = typeof wecomSettings.$inferSelect;
export type NewWecomSettings = typeof wecomSettings.$inferInsert;

export const integrationInstances = sqliteTable(
  "integration_instances",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    provider: text("provider").notNull(),
    name: text("name").notNull().default(""),
    externalTenantId: text("external_tenant_id"),
    configJsonEncrypted: text("config_json_encrypted"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    providerIdx: index("idx_integration_instances_provider").on(table.provider),
    defaultIdx: uniqueIndex("idx_integration_instances_provider_default")
      .on(table.provider, table.isDefault)
      .where(sql`${table.isDefault} = 1`),
    enabledIdx: index("idx_integration_instances_enabled").on(table.enabled),
  }),
);

export type IntegrationInstance = typeof integrationInstances.$inferSelect;
export type NewIntegrationInstance = typeof integrationInstances.$inferInsert;

export const integrationCapabilities = sqliteTable(
  "integration_capabilities",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    instanceId: text("instance_id")
      .notNull()
      .references(() => integrationInstances.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    knowledgeBaseId: text("knowledge_base_id").references(() => knowledgeBases.id, {
      onDelete: "set null",
    }),
    configJsonEncrypted: text("config_json_encrypted"),
    runtimeJson: text("runtime_json").notNull().default("{}"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    instanceIdx: index("idx_integration_capabilities_instance").on(table.instanceId),
    providerIdx: index("idx_integration_capabilities_provider").on(table.provider),
    typeIdx: index("idx_integration_capabilities_type").on(table.type),
    instanceDefaultIdx: uniqueIndex(
      "idx_integration_capabilities_instance_default",
    )
      .on(table.instanceId, table.isDefault)
      .where(sql`${table.isDefault} = 1`),
  }),
);

export type IntegrationCapability = typeof integrationCapabilities.$inferSelect;
export type NewIntegrationCapability = typeof integrationCapabilities.$inferInsert;

export const microApps = sqliteTable(
  "micro_app_definitions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    type: text("type").notNull(),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    supportedAccessPointsJson: text("supported_access_points_json")
      .notNull()
      .default("[]"),
    bindingSchemaJson: text("binding_schema_json").notNull().default("{\"fields\":[]}"),
    runtimeKey: text("runtime_key").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    typeIdx: index("idx_micro_apps_type").on(table.type),
    enabledIdx: index("idx_micro_apps_enabled").on(table.enabled),
    typeUniqueIdx: uniqueIndex("idx_micro_apps_type_unique").on(table.type),
  }),
);

export type MicroApp = typeof microApps.$inferSelect;
export type NewMicroApp = typeof microApps.$inferInsert;

export const comfyUiConnections = sqliteTable(
  "comfyui_connections",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    baseUrl: text("base_url").notNull().default(""),
    clientId: text("client_id"),
    status: text("status", {
      enum: ["unconfigured", "unverified", "connectable", "failed"],
    })
      .notNull()
      .default("unconfigured"),
    lastErrorJson: text("last_error_json"),
    lastCheckedAt: text("last_checked_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index("idx_comfyui_connections_status").on(table.status),
    updatedAtIdx: index("idx_comfyui_connections_updated_at").on(table.updatedAt),
  }),
);

export type ComfyUiConnectionRow = typeof comfyUiConnections.$inferSelect;
export type NewComfyUiConnectionRow = typeof comfyUiConnections.$inferInsert;

export const comfyUiFlows = sqliteTable(
  "comfyui_flows",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    connectionId: text("connection_id").references(() => comfyUiConnections.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull().default(""),
    note: text("note").notNull().default(""),
    source: text("source", {
      enum: ["template", "upload", "manual"],
    })
      .notNull()
      .default("manual"),
    workflowApiJson: text("workflow_api_json").notNull().default("{}"),
    mappingJson: text("mapping_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    connectionIdx: index("idx_comfyui_flows_connection_id").on(table.connectionId),
    updatedAtIdx: index("idx_comfyui_flows_updated_at").on(table.updatedAt),
  }),
);

export type ComfyUiFlowRow = typeof comfyUiFlows.$inferSelect;
export type NewComfyUiFlowRow = typeof comfyUiFlows.$inferInsert;

export const integrationCapabilityMicroApps = sqliteTable(
  "integration_capability_micro_app_bindings",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => integrationCapabilities.id, { onDelete: "cascade" }),
    microAppDefinitionId: text("micro_app_definition_id")
      .notNull()
      .references(() => microApps.id, { onDelete: "cascade" }),
    bindingConfigJsonEncrypted: text("binding_config_json_encrypted"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    capabilityIdx: uniqueIndex("idx_integration_capability_micro_apps_capability").on(
      table.capabilityId,
    ),
    microAppIdx: index("idx_integration_capability_micro_apps_micro_app").on(
      table.microAppDefinitionId,
    ),
  }),
);

export const ttsProviderConfigs = sqliteTable(
  "tts_provider_configs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    providerId: text("provider_id").notNull(),
    displayName: text("display_name").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    configJson: text("config_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    providerUniqueIdx: uniqueIndex("idx_tts_provider_configs_provider_id").on(
      table.providerId,
    ),
  }),
);

export type TtsProviderConfigRow = typeof ttsProviderConfigs.$inferSelect;
export type NewTtsProviderConfigRow = typeof ttsProviderConfigs.$inferInsert;

export const ttsSynthesisJobs = sqliteTable(
  "tts_synthesis_jobs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    providerId: text("provider_id").notNull(),
    status: text("status").notNull(),
    text: text("text").notNull().default(""),
    voice: text("voice"),
    requestConfigJson: text("request_config_json").notNull().default("{}"),
    outputPath: text("output_path"),
    mimeType: text("mime_type"),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => ({
    createdAtIdx: index("idx_tts_synthesis_jobs_created_at").on(table.createdAt),
    providerStatusIdx: index("idx_tts_synthesis_jobs_provider_status").on(
      table.providerId,
      table.status,
    ),
  }),
);

export type TtsSynthesisJobRow = typeof ttsSynthesisJobs.$inferSelect;
export type NewTtsSynthesisJobRow = typeof ttsSynthesisJobs.$inferInsert;

export const ttsRefAudios = sqliteTable(
  "tts_ref_audios",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    originalName: text("original_name").notNull().default("ref-audio.wav"),
    mimeType: text("mime_type").notNull().default("audio/wav"),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    audioBlob: blob("audio_blob", { mode: "buffer" }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    hashIdx: uniqueIndex("idx_tts_ref_audios_sha256").on(table.sha256),
    lastUsedIdx: index("idx_tts_ref_audios_last_used_at").on(table.lastUsedAt),
  }),
);

export type TtsRefAudioRow = typeof ttsRefAudios.$inferSelect;
export type NewTtsRefAudioRow = typeof ttsRefAudios.$inferInsert;

export const chatMedia = sqliteTable(
  "chat_media",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    messageId: text("message_id").notNull(),
    taskId: text("task_id").notNull(),
    mediaType: text("media_type", { enum: ["audio", "image"] }).notNull(),
    absolutePath: text("absolute_path").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    messageIdx: index("idx_chat_media_message_id").on(table.messageId),
    threadIdx: index("idx_chat_media_thread_id").on(table.threadId),
    taskIdx: index("idx_chat_media_task_id").on(table.taskId),
    pathUniqueIdx: uniqueIndex("idx_chat_media_absolute_path").on(table.absolutePath),
  }),
);

export type ChatMediaRow = typeof chatMedia.$inferSelect;
export type NewChatMediaRow = typeof chatMedia.$inferInsert;

export const imageGenerationJobs = sqliteTable("image_generation_jobs", {
  id: text("id").primaryKey(),
  jobJson: text("job_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ImageGenerationJobRow = typeof imageGenerationJobs.$inferSelect;
export type NewImageGenerationJobRow = typeof imageGenerationJobs.$inferInsert;

export type IntegrationCapabilityMicroApp =
  typeof integrationCapabilityMicroApps.$inferSelect;
export type NewIntegrationCapabilityMicroApp =
  typeof integrationCapabilityMicroApps.$inferInsert;

export const microAppCapabilityBindings = sqliteTable(
  "micro_app_capability_bindings",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    microAppCode: text("micro_app_code").notNull(),
    capabilityCode: text("capability_code").notNull(),
    providerId: text("provider_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    capabilityIdx: uniqueIndex("idx_micro_app_capability_bindings_capability").on(
      table.microAppCode,
      table.capabilityCode,
    ),
    providerIdx: index("idx_micro_app_capability_bindings_provider").on(
      table.providerId,
    ),
  }),
);

export const computerUseTasks = sqliteTable(
  "computer_use_tasks",
  {
    id: text("id").primaryKey(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({ updatedAtIdx: index("idx_computer_use_tasks_updated_at").on(table.updatedAt) }),
);

export type ComputerUseTaskRow = typeof computerUseTasks.$inferSelect;
export type NewComputerUseTaskRow = typeof computerUseTasks.$inferInsert;

export const computerUseInvocations = sqliteTable(
  "computer_use_invocations",
  {
    id: text("id").primaryKey(),
    payloadJson: text("payload_json").notNull(),
    updatedAt: text("updated_at").notNull(),
    traceJson: text("trace_json"),
    eventsJson: text("events_json"),
  },
  (table) => ({ updatedAtIdx: index("idx_computer_use_invocations_updated_at").on(table.updatedAt) }),
);

export type ComputerUseInvocationRow = typeof computerUseInvocations.$inferSelect;

export type MicroAppCapabilityBindingRow =
  typeof microAppCapabilityBindings.$inferSelect;
export type NewMicroAppCapabilityBindingRow =
  typeof microAppCapabilityBindings.$inferInsert;

export const mailAccounts = sqliteTable(
  "mail_accounts",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    emailAddress: text("email_address").notNull().default(""),
    smtpHost: text("smtp_host").notNull().default(""),
    smtpPort: integer("smtp_port").notNull().default(587),
    smtpSecure: integer("smtp_secure", { mode: "boolean" }).notNull().default(false),
    smtpUsername: text("smtp_username").notNull().default(""),
    smtpPasswordEncrypted: text("smtp_password_encrypted"),
    imapHost: text("imap_host").notNull().default(""),
    imapPort: integer("imap_port").notNull().default(993),
    imapSecure: integer("imap_secure", { mode: "boolean" }).notNull().default(true),
    imapUsername: text("imap_username").notNull().default(""),
    imapPasswordEncrypted: text("imap_password_encrypted"),
    inboxFolderPath: text("inbox_folder_path").notNull().default("INBOX"),
    status: text("status", { enum: ["idle", "connected", "error"] })
      .notNull()
      .default("idle"),
    lastError: text("last_error"),
    lastSyncedAt: text("last_synced_at"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index("idx_mail_accounts_user_id").on(table.userId),
    statusIdx: index("idx_mail_accounts_status").on(table.status),
    defaultIdx: uniqueIndex("idx_mail_accounts_user_default")
      .on(table.userId, table.isDefault)
      .where(sql`${table.isDefault} = 1`),
  }),
);

export type MailAccount = typeof mailAccounts.$inferSelect;
export type NewMailAccount = typeof mailAccounts.$inferInsert;

export const mailFolders = sqliteTable(
  "mail_folders",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    accountId: text("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    folderKey: text("folder_key").notNull().default("inbox"),
    folderName: text("folder_name").notNull().default("Inbox"),
    folderPath: text("folder_path").notNull().default("INBOX"),
    messageCount: integer("message_count").notNull().default(0),
    unreadCount: integer("unread_count").notNull().default(0),
    syncStatus: text("sync_status", {
      enum: ["idle", "syncing", "succeeded", "failed"],
    })
      .notNull()
      .default("idle"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    accountIdx: index("idx_mail_folders_account_id").on(table.accountId),
    uniqueFolderIdx: uniqueIndex("idx_mail_folders_account_folder_key").on(
      table.accountId,
      table.folderKey,
    ),
  }),
);

export type MailFolder = typeof mailFolders.$inferSelect;
export type NewMailFolder = typeof mailFolders.$inferInsert;

export const mailMessages = sqliteTable(
  "mail_messages",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    accountId: text("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    folderId: text("folder_id")
      .notNull()
      .references(() => mailFolders.id, { onDelete: "cascade" }),
    remoteUid: integer("remote_uid").notNull(),
    messageId: text("message_id"),
    subject: text("subject").notNull().default(""),
    fromDisplay: text("from_display").notNull().default(""),
    fromAddress: text("from_address").notNull().default(""),
    toJson: text("to_json").notNull().default("[]"),
    previewText: text("preview_text").notNull().default(""),
    textContent: text("text_content").notNull().default(""),
    htmlContent: text("html_content").notNull().default(""),
    sentAt: text("sent_at"),
    receivedAt: text("received_at"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    isFlagged: integer("is_flagged", { mode: "boolean" }).notNull().default(false),
    hasAttachments: integer("has_attachments", { mode: "boolean" })
      .notNull()
      .default(false),
    rawHeadersJson: text("raw_headers_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    folderReceivedIdx: index("idx_mail_messages_folder_received").on(
      table.folderId,
      table.receivedAt,
    ),
    accountIdx: index("idx_mail_messages_account_id").on(table.accountId),
    uniqueRemoteUidIdx: uniqueIndex("idx_mail_messages_folder_remote_uid").on(
      table.folderId,
      table.remoteUid,
    ),
  }),
);

export type MailMessage = typeof mailMessages.$inferSelect;
export type NewMailMessage = typeof mailMessages.$inferInsert;

export const newsItems = sqliteTable(
  "news_items",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    sourceType: text("source_type").notNull().default("rss"),
    sourceName: text("source_name").notNull().default(""),
    sourceKey: text("source_key").notNull().default(""),
    externalId: text("external_id").notNull().default(""),
    title: text("title").notNull().default(""),
    summary: text("summary").notNull().default(""),
    contentText: text("content_text").notNull().default(""),
    url: text("url").notNull().default(""),
    author: text("author"),
    publishedAt: text("published_at"),
    ingestedAt: text("ingested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lang: text("lang").notNull().default("en"),
    topic: text("topic").notNull().default("technology"),
    tagsJson: text("tags_json").notNull().default("[]"),
    rawPayloadJson: text("raw_payload_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sourceKeyIdx: index("idx_news_items_source_key").on(table.sourceKey),
    sourceTypeIdx: index("idx_news_items_source_type").on(table.sourceType),
    publishedIdx: index("idx_news_items_published_at").on(table.publishedAt),
    ingestedIdx: index("idx_news_items_ingested_at").on(table.ingestedAt),
    sourceExternalUniqueIdx: uniqueIndex("idx_news_items_source_external").on(
      table.sourceKey,
      table.externalId,
    ),
  }),
);

export type NewsItem = typeof newsItems.$inferSelect;
export type NewNewsItem = typeof newsItems.$inferInsert;

export const externalIdentityBindings = sqliteTable(
  "external_identity_bindings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id").notNull(),
    externalUnionId: text("external_union_id"),
    bindSource: text("bind_source").notNull().default("manual"),
    bindStatus: text("bind_status").notNull().default("bound"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    providerUserUniqueIdx: uniqueIndex("idx_external_identity_bindings_provider_user").on(
      table.provider,
      table.userId,
    ),
    providerExternalUserUniqueIdx: uniqueIndex(
      "idx_external_identity_bindings_provider_external_user",
    ).on(table.provider, table.externalUserId),
    userIdIdx: index("idx_external_identity_bindings_user_id").on(table.userId),
    providerIdx: index("idx_external_identity_bindings_provider").on(table.provider),
  }),
);

export type ExternalIdentityBinding = typeof externalIdentityBindings.$inferSelect;
export type NewExternalIdentityBinding = typeof externalIdentityBindings.$inferInsert;

export const knowledgeBases = sqliteTable(
  "knowledge_bases",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    embeddingModelConfigId: text("embedding_model_config_id").references(
      () => modelConfigs.id,
      { onDelete: "set null" },
    ),
    chunkingConfigJson: text("chunking_config_json").notNull().default("{}"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index("idx_knowledge_bases_status").on(table.status),
  }),
);

export const knowledgeBasesRelations = relations(
  knowledgeBases,
  ({ many, one }) => ({
    documents: many(documents),
    embeddingModelConfig: one(modelConfigs, {
      fields: [knowledgeBases.embeddingModelConfigId],
      references: [modelConfigs.id],
    }),
    vectorIndexes: many(knowledgeBaseVectorIndexes),
  }),
);

export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type NewKnowledgeBase = typeof knowledgeBases.$inferInsert;

export const documents = sqliteTable(
  "documents",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceType: text("source_type", { enum: ["upload", "sync", "api"] })
      .notNull()
      .default("upload"),
    sourceLabel: text("source_label"),
    fileExt: text("file_ext").notNull(),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    contentText: text("content_text").notNull().default(""),
    indexStatus: text("index_status", {
      enum: ["processing", "ready", "failed"],
    })
      .notNull()
      .default("processing"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    chunkCount: integer("chunk_count").notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    tokenCount: integer("token_count"),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    knowledgeBaseIdx: index("idx_documents_knowledge_base").on(
      table.knowledgeBaseId,
    ),
    statusIdx: index("idx_documents_index_status").on(table.indexStatus),
    enabledIdx: index("idx_documents_enabled").on(table.enabled),
    createdAtIdx: index("idx_documents_created_at").on(table.createdAt),
  }),
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  knowledgeBase: one(knowledgeBases, {
    fields: [documents.knowledgeBaseId],
    references: [knowledgeBases.id],
  }),
  chunks: many(documentChunks),
}));

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export const documentChunks = sqliteTable(
  "document_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    charCount: integer("char_count").notNull().default(0),
    tokenCount: integer("token_count"),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    documentChunkUniqueIdx: uniqueIndex(
      "idx_document_chunks_document_index",
    ).on(table.documentId, table.chunkIndex),
    knowledgeBaseIdx: index("idx_document_chunks_knowledge_base").on(
      table.knowledgeBaseId,
    ),
    documentIdx: index("idx_document_chunks_document").on(table.documentId),
  }),
);

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  knowledgeBase: one(knowledgeBases, {
    fields: [documentChunks.knowledgeBaseId],
    references: [knowledgeBases.id],
  }),
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;

export const knowledgeBaseVectorIndexes = sqliteTable(
  "knowledge_base_vector_indexes",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    embeddingModelConfigId: text("embedding_model_config_id").references(
      () => modelConfigs.id,
      { onDelete: "set null" },
    ),
    dimensions: integer("dimensions").notNull(),
    distanceMetric: text("distance_metric", {
      enum: ["cosine", "l2", "inner_product"],
    })
      .notNull()
      .default("cosine"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    tableNameUniqueIdx: uniqueIndex("idx_kb_vector_indexes_table_name").on(
      table.tableName,
    ),
    knowledgeBaseIdx: index("idx_kb_vector_indexes_knowledge_base").on(
      table.knowledgeBaseId,
    ),
  }),
);

export const knowledgeBaseVectorIndexesRelations = relations(
  knowledgeBaseVectorIndexes,
  ({ one }) => ({
    knowledgeBase: one(knowledgeBases, {
      fields: [knowledgeBaseVectorIndexes.knowledgeBaseId],
      references: [knowledgeBases.id],
    }),
    embeddingModelConfig: one(modelConfigs, {
      fields: [knowledgeBaseVectorIndexes.embeddingModelConfigId],
      references: [modelConfigs.id],
    }),
  }),
);

export type KnowledgeBaseVectorIndex =
  typeof knowledgeBaseVectorIndexes.$inferSelect;
export type NewKnowledgeBaseVectorIndex =
  typeof knowledgeBaseVectorIndexes.$inferInsert;

export const roles = sqliteTable(
  "roles",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    avatarId: text("avatar_id"),
    status: text("status", { enum: ROLE_STATUS_VALUES })
      .notNull()
      .default("draft"),
    tagsJson: text("tags_json").notNull().default("[]"),
    promptJson: text("prompt_json").notNull().default("{}"),
    llmProfileJson: text("llm_profile_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index("idx_roles_user_id").on(table.userId),
    statusIdx: index("idx_roles_status").on(table.status),
    updatedAtIdx: index("idx_roles_updated_at").on(table.updatedAt),
  }),
);

export const rolesRelations = relations(roles, ({ one }) => ({
  user: one(users, {
    fields: [roles.userId],
    references: [users.id],
  }),
}));

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

export const chatWorkspaces = sqliteTable(
  "chat_workspaces",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rootPath: text("root_path"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index("idx_chat_workspaces_user_id").on(table.userId),
    statusIdx: index("idx_chat_workspaces_status").on(table.status),
    updatedAtIdx: index("idx_chat_workspaces_updated_at").on(table.updatedAt),
  }),
);

export type ChatWorkspace = typeof chatWorkspaces.$inferSelect;
export type NewChatWorkspace = typeof chatWorkspaces.$inferInsert;

export const threads = sqliteTable(
  "threads",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    modelName: text("model_name"),
    workspaceId: text("workspace_id").references(() => chatWorkspaces.id, {
      onDelete: "set null",
    }),
    knowledgeBaseId: text("knowledge_base_id")
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    roleId: text("role_id").references(() => roles.id, {
      onDelete: "set null",
    }),
    agentEnabled: integer("agent_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    ttsEnabled: integer("tts_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    imageEnabled: integer("image_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    evolvingKnowledgeEnabled: integer("evolving_knowledge_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    contextSummary: text("context_summary"),
    contextSummaryUpdatedAt: text("context_summary_updated_at"),
    status: text("status", { enum: THREAD_STATUS_VALUES })
      .notNull()
      .default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index("idx_threads_user_id").on(table.userId),
    workspaceIdx: index("idx_threads_workspace_id").on(table.workspaceId),
    knowledgeBaseIdx: index("idx_threads_knowledge_base").on(table.knowledgeBaseId),
    roleIdx: index("idx_threads_role_id").on(table.roleId),
    statusIdx: index("idx_threads_status").on(table.status),
    updatedAtIdx: index("idx_threads_updated_at").on(table.updatedAt),
  }),
);

export const threadsRelations = relations(threads, ({ many, one }) => ({
  messages: many(messages),
  workspace: one(chatWorkspaces, {
    fields: [threads.workspaceId],
    references: [chatWorkspaces.id],
  }),
  knowledgeBase: one(knowledgeBases, {
    fields: [threads.knowledgeBaseId],
    references: [knowledgeBases.id],
  }),
  role: one(roles, {
    fields: [threads.roleId],
    references: [roles.id],
  }),
  user: one(users, {
    fields: [threads.userId],
    references: [users.id],
  }),
}));

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;

export const conversationWorkdirs = sqliteTable(
  "conversation_workdirs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rootPath: text("root_path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    threadIdIdx: uniqueIndex("idx_conversation_workdirs_thread_id").on(
      table.threadId,
    ),
    userIdIdx: index("idx_conversation_workdirs_user_id").on(table.userId),
    rootPathIdx: uniqueIndex("idx_conversation_workdirs_root_path").on(
      table.rootPath,
    ),
  }),
);

export type ConversationWorkdir = typeof conversationWorkdirs.$inferSelect;
export type NewConversationWorkdir = typeof conversationWorkdirs.$inferInsert;

export const conversationArtifacts = sqliteTable(
  "conversation_artifacts",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workdirId: text("workdir_id").notNull().references(() => conversationWorkdirs.id, { onDelete: "cascade" }),
    sourceRelativePath: text("source_relative_path").notNull(),
    lifecycle: text("lifecycle", { enum: ["temporary", "final"] as const }).notNull(),
    mimeType: text("mime_type"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    threadIdx: index("idx_conversation_artifacts_thread_id").on(table.threadId),
    workdirIdx: index("idx_conversation_artifacts_workdir_id").on(table.workdirId),
  }),
);

export type ConversationArtifact = typeof conversationArtifacts.$inferSelect;
export type NewConversationArtifact = typeof conversationArtifacts.$inferInsert;

export const chatWorkspacesRelations = relations(
  chatWorkspaces,
  ({ many, one }) => ({
    threads: many(threads),
    user: one(users, {
      fields: [chatWorkspaces.userId],
      references: [users.id],
    }),
  }),
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    threadId: text("thread_id").notNull(),
    userId: integer("user_id").notNull(),
    goalJson: text("goal_json").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "waiting_approval",
        "waiting_user",
        "completed",
        "failed",
        "blocked",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    observationsJson: text("observations_json").notNull().default("[]"),
    traceId: text("trace_id").notNull(),
    blockedReason: text("blocked_reason"),
    terminalReason: text("terminal_reason"),
    pendingApprovalJson: text("pending_approval_json"),
    approvedInvocationsJson: text("approved_invocations_json").notNull().default("[]"),
    contextBudgetJson: text("context_budget_json"),
    selectedToolId: text("selected_tool_id"),
    pendingToolCallJson: text("pending_tool_call_json"),
    lastToolExecutionJson: text("last_tool_execution_json"),
    assistantMessageId: text("assistant_message_id"),
    assistantParentId: text("assistant_parent_id"),
    runtimeInputJson: text("runtime_input_json"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    threadIdx: index("idx_agent_runs_thread_id").on(table.threadId),
    userIdx: index("idx_agent_runs_user_id").on(table.userId),
    statusIdx: index("idx_agent_runs_status").on(table.status),
    traceIdx: index("idx_agent_runs_trace_id").on(table.traceId),
    updatedAtIdx: index("idx_agent_runs_updated_at").on(table.updatedAt),
  }),
);

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type NewAgentRunRow = typeof agentRuns.$inferInsert;

export const messages = sqliteTable(
  "messages",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    role: text("role", { enum: MESSAGE_ROLE_VALUES }).notNull(),
    content: text("content").notNull(),
    partsJson: text("parts_json"),
    metadata: text("metadata").default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    threadIdIdx: index("idx_messages_thread_id").on(table.threadId),
    createdAtIdx: index("idx_messages_created_at").on(table.createdAt),
  }),
);

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id],
  }),
}));

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type ModelType =
  | "llm"
  | "embedding"
  | "rerank"
  | "task"
  | "agentTask"
  | "evaluation"
  | "imageGeneration"
  | "voice";
export type UserRole = "admin" | "user";
export type ParamType = "number" | "select" | "boolean";
export type ProviderCode = ProviderCodeValue;
export type ProviderTemplateCode = ProviderTemplateCodeValue;
export type ProviderStatus = ProviderStatusValue;
export type KnowledgeBaseStatus = "active" | "archived";
export type DocumentSourceType = "upload" | "sync" | "api";
export type DocumentIndexStatus = "processing" | "ready" | "failed";
export type VectorDistanceMetric = "cosine" | "l2" | "inner_product";
export type RoleStatus = "active" | "draft";
export type ThreadStatus = "active" | "archived" | "deleted";
export type MessageRole = "user" | "assistant" | "system";

// ── Evolving Knowledge (智识进化库) ────────────────────────────────

export const knowledgeCaptures = sqliteTable(
  "knowledge_captures",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull().default(""),
    title: text("title").notNull().default(""),
    favicon: text("favicon").notNull().default(""),
    capturedAt: text("captured_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    contentType: text("content_type", {
      enum: ["webpage"],
    })
      .notNull()
      .default("webpage"),
    rawContent: text("raw_content").notNull().default(""),
    rewrittenSummary: text("rewritten_summary").notNull().default(""),
    aiTagsJson: text("ai_tags_json").notNull().default("[]"),
    aiEntitiesJson: text("ai_entities_json").notNull().default("[]"),
    userEdited: integer("user_edited", { mode: "boolean" })
      .notNull()
      .default(false),
    captureMetadataJson: text("capture_metadata_json")
      .notNull()
      .default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    processingStatus: text("processing_status", {
      enum: ["pending", "processing", "completed", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    processingError: text("processing_error"),
  },
  (table) => ({
    capturedAtIdx: index("idx_knowledge_captures_captured_at").on(
      table.capturedAt,
    ),
    contentTypeIdx: index("idx_knowledge_captures_content_type").on(
      table.contentType,
    ),
    userIdx: index("idx_knowledge_captures_user_id").on(table.userId),
  }),
);

export type KnowledgeCapture = typeof knowledgeCaptures.$inferSelect;
export type NewKnowledgeCapture = typeof knowledgeCaptures.$inferInsert;

export const knowledgeAttachments = sqliteTable(
  "knowledge_attachments",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    captureId: text("capture_id")
      .notNull()
      .references(() => knowledgeCaptures.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    aiExtractedText: text("ai_extracted_text").notNull().default(""),
    processingStatus: text("processing_status", {
      enum: ["done", "pending", "failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    captureIdIdx: index("idx_knowledge_attachments_capture_id").on(
      table.captureId,
    ),
  }),
);

export type KnowledgeAttachment = typeof knowledgeAttachments.$inferSelect;
export type NewKnowledgeAttachment = typeof knowledgeAttachments.$inferInsert;

export const knowledgeEvidenceUnits = sqliteTable(
  "knowledge_evidence_units",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    captureId: text("capture_id")
      .notNull()
      .references(() => knowledgeCaptures.id, { onDelete: "cascade" }),
    unitType: text("unit_type", { enum: ["text"] })
      .notNull()
      .default("text"),
    content: text("content").notNull().default(""),
    sourceLocatorJson: text("source_locator_json").notNull().default("{}"),
    extractionMethod: text("extraction_method").notNull().default("capture"),
    processingVersion: text("processing_version").notNull().default("v1"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    captureIdx: index("idx_knowledge_evidence_units_capture").on(table.captureId),
    userIdx: index("idx_knowledge_evidence_units_user_id").on(table.userId),
  }),
);

export type KnowledgeEvidenceUnit = typeof knowledgeEvidenceUnits.$inferSelect;
export type NewKnowledgeEvidenceUnit = typeof knowledgeEvidenceUnits.$inferInsert;

export const knowledgeTagsEvolution = sqliteTable(
  "knowledge_tags_evolution",
  {
    tagName: text("tag_name").notNull(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    usageCount: integer("usage_count").notNull().default(1),
    mergedIntoTag: text("merged_into_tag"),
    mergedAt: text("merged_at"),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tagName, table.userId] }),
    lastSeenIdx: index("idx_knowledge_tags_last_seen").on(table.lastSeenAt),
    userIdx: index("idx_knowledge_tags_user_id").on(table.userId),
  }),
);

export type KnowledgeTagEvolution =
  typeof knowledgeTagsEvolution.$inferSelect;
export type NewKnowledgeTagEvolution =
  typeof knowledgeTagsEvolution.$inferInsert;

export const knowledgeRelations = sqliteTable(
  "knowledge_relations",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    sourceCaptureId: text("source_capture_id")
      .notNull()
      .references(() => knowledgeCaptures.id, { onDelete: "cascade" }),
    targetCaptureId: text("target_capture_id")
      .notNull()
      .references(() => knowledgeCaptures.id, { onDelete: "cascade" }),
    relationType: text("relation_type", {
      enum: ["similar", "contradicts", "evolves", "references"],
    }).notNull(),
    confidence: real("confidence").notNull().default(0.5),
    aiReasoning: text("ai_reasoning").notNull().default(""),
    evidenceUnitIdsJson: text("evidence_unit_ids_json")
      .notNull()
      .default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sourceIdx: index("idx_knowledge_relations_source").on(
      table.sourceCaptureId,
    ),
    targetIdx: index("idx_knowledge_relations_target").on(
      table.targetCaptureId,
    ),
    typeIdx: index("idx_knowledge_relations_type").on(table.relationType),
    userIdx: index("idx_knowledge_relations_user_id").on(table.userId),
  }),
);

export type KnowledgeRelation = typeof knowledgeRelations.$inferSelect;
export type NewKnowledgeRelation = typeof knowledgeRelations.$inferInsert;

export const knowledgeInsights = sqliteTable(
  "knowledge_insights",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    insightType: text("insight_type", {
      enum: ["synthesis", "contradiction", "resurfacing", "gap"],
    }).notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    triggerCaptureId: text("trigger_capture_id").references(
      () => knowledgeCaptures.id,
      { onDelete: "set null" },
    ),
    relatedCaptureIdsJson: text("related_capture_ids_json")
      .notNull()
      .default("[]"),
    relatedConceptIdsJson: text("related_concept_ids_json")
      .notNull()
      .default("[]"),
    dismissedByUser: integer("dismissed_by_user", { mode: "boolean" })
      .notNull()
      .default(false),
    confidence: real("confidence").notNull().default(0.5),
    evidenceUnitIdsJson: text("evidence_unit_ids_json")
      .notNull()
      .default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at"),
  },
  (table) => ({
    typeIdx: index("idx_knowledge_insights_type").on(table.insightType),
    dismissedIdx: index("idx_knowledge_insights_dismissed").on(
      table.dismissedByUser,
    ),
    createdAtIdx: index("idx_knowledge_insights_created_at").on(
      table.createdAt,
    ),
    userIdx: index("idx_knowledge_insights_user_id").on(table.userId),
  }),
);

export type KnowledgeInsight = typeof knowledgeInsights.$inferSelect;
export type NewKnowledgeInsight = typeof knowledgeInsights.$inferInsert;

export const knowledgeMaintenanceRuns = sqliteTable(
  "knowledge_maintenance_runs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    runType: text("run_type").notNull().default("rebuild"),
    status: text("status", {
      enum: ["running", "completed", "failed"],
    })
      .notNull()
      .default("running"),
    scopeJson: text("scope_json").notNull().default("{}"),
    capturesScanned: integer("captures_scanned").notNull().default(0),
    relationsCreated: integer("relations_created").notNull().default(0),
    insightsCreated: integer("insights_created").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index("idx_knowledge_maintenance_runs_user_id").on(table.userId),
    statusIdx: index("idx_knowledge_maintenance_runs_status").on(table.status),
    createdAtIdx: index("idx_knowledge_maintenance_runs_created_at").on(
      table.createdAt,
    ),
  }),
);

export type KnowledgeMaintenanceRun = typeof knowledgeMaintenanceRuns.$inferSelect;
export type NewKnowledgeMaintenanceRun = typeof knowledgeMaintenanceRuns.$inferInsert;

export const knowledgeQueryLogs = sqliteTable(
  "knowledge_query_logs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    query: text("query").notNull().default(""),
    intent: text("intent").notNull().default("mixed"),
    resultCount: integer("result_count").notNull().default(0),
    sourceIdsJson: text("source_ids_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index("idx_knowledge_query_logs_user_id").on(table.userId),
    createdAtIdx: index("idx_knowledge_query_logs_created_at").on(table.createdAt),
  }),
);

export type KnowledgeQueryLog = typeof knowledgeQueryLogs.$inferSelect;
export type NewKnowledgeQueryLog = typeof knowledgeQueryLogs.$inferInsert;

export const knowledgeConcepts = sqliteTable(
  "knowledge_concepts",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    canonicalName: text("canonical_name").notNull(),
    displayName: text("display_name").notNull(),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    status: text("status", { enum: ["active", "merged", "hidden"] })
      .notNull()
      .default("active"),
    mergedIntoConceptId: text("merged_into_concept_id"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    sourceCount: integer("source_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userCanonicalIdx: uniqueIndex("idx_knowledge_concepts_user_canonical").on(
      table.userId,
      table.canonicalName,
    ),
    userIdx: index("idx_knowledge_concepts_user_id").on(table.userId),
    statusIdx: index("idx_knowledge_concepts_status").on(table.status),
  }),
);

export type KnowledgeConcept = typeof knowledgeConcepts.$inferSelect;
export type NewKnowledgeConcept = typeof knowledgeConcepts.$inferInsert;

export const knowledgeConceptEvidence = sqliteTable(
  "knowledge_concept_evidence",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => knowledgeConcepts.id, { onDelete: "cascade" }),
    captureId: text("capture_id")
      .notNull()
      .references(() => knowledgeCaptures.id, { onDelete: "cascade" }),
    evidenceUnitId: text("evidence_unit_id").references(
      () => knowledgeEvidenceUnits.id,
      { onDelete: "set null" },
    ),
    mentionText: text("mention_text").notNull(),
    mentionType: text("mention_type", { enum: ["tag", "entity", "manual"] })
      .notNull()
      .default("tag"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    conceptIdx: index("idx_knowledge_concept_evidence_concept").on(table.conceptId),
    captureIdx: index("idx_knowledge_concept_evidence_capture").on(table.captureId),
    uniqueMentionIdx: uniqueIndex("idx_knowledge_concept_evidence_unique_mention").on(
      table.conceptId,
      table.captureId,
      table.mentionText,
      table.mentionType,
    ),
  }),
);

export type KnowledgeConceptEvidence = typeof knowledgeConceptEvidence.$inferSelect;
export type NewKnowledgeConceptEvidence = typeof knowledgeConceptEvidence.$inferInsert;

export const knowledgeConceptEdges = sqliteTable(
  "knowledge_concept_edges",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    sourceConceptId: text("source_concept_id")
      .notNull()
      .references(() => knowledgeConcepts.id, { onDelete: "cascade" }),
    targetConceptId: text("target_concept_id")
      .notNull()
      .references(() => knowledgeConcepts.id, { onDelete: "cascade" }),
    relationType: text("relation_type", {
      enum: ["related", "part_of", "contradicts", "evolves", "references"],
    }).notNull(),
    confidence: real("confidence").notNull().default(0.5),
    evidenceUnitIdsJson: text("evidence_unit_ids_json")
      .notNull()
      .default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sourceIdx: index("idx_knowledge_concept_edges_source").on(table.sourceConceptId),
    targetIdx: index("idx_knowledge_concept_edges_target").on(table.targetConceptId),
    uniqueEdgeIdx: uniqueIndex("idx_knowledge_concept_edges_unique").on(
      table.userId,
      table.sourceConceptId,
      table.targetConceptId,
      table.relationType,
    ),
  }),
);

export type KnowledgeConceptEdge = typeof knowledgeConceptEdges.$inferSelect;
export type NewKnowledgeConceptEdge = typeof knowledgeConceptEdges.$inferInsert;

export const knowledgeTopics = sqliteTable(
  "knowledge_topics",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    conceptId: text("concept_id").references(() => knowledgeConcepts.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    pendingQuestionsJson: text("pending_questions_json")
      .notNull()
      .default("[]"),
    status: text("status", { enum: ["active", "stale", "archived"] })
      .notNull()
      .default("active"),
    currentVersion: integer("current_version").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userNameIdx: uniqueIndex("idx_knowledge_topics_user_name").on(
      table.userId,
      table.name,
    ),
    conceptIdx: index("idx_knowledge_topics_concept").on(table.conceptId),
    statusIdx: index("idx_knowledge_topics_status").on(table.status),
  }),
);

export type KnowledgeTopic = typeof knowledgeTopics.$inferSelect;
export type NewKnowledgeTopic = typeof knowledgeTopics.$inferInsert;

export const knowledgeTopicEvidence = sqliteTable(
  "knowledge_topic_evidence",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => knowledgeTopics.id, { onDelete: "cascade" }),
    captureId: text("capture_id").references(() => knowledgeCaptures.id, {
      onDelete: "cascade",
    }),
    evidenceUnitId: text("evidence_unit_id").references(
      () => knowledgeEvidenceUnits.id,
      { onDelete: "set null" },
    ),
    insightId: text("insight_id").references(() => knowledgeInsights.id, {
      onDelete: "set null",
    }),
    evidenceRole: text("evidence_role", {
      enum: ["supports", "opposes", "context"],
    })
      .notNull()
      .default("context"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    topicIdx: index("idx_knowledge_topic_evidence_topic").on(table.topicId),
    captureIdx: index("idx_knowledge_topic_evidence_capture").on(table.captureId),
    uniqueEvidenceIdx: uniqueIndex("idx_knowledge_topic_evidence_unique").on(
      table.topicId,
      table.captureId,
      table.evidenceUnitId,
      table.insightId,
      table.evidenceRole,
    ),
  }),
);

export type KnowledgeTopicEvidence = typeof knowledgeTopicEvidence.$inferSelect;
export type NewKnowledgeTopicEvidence = typeof knowledgeTopicEvidence.$inferInsert;

export const knowledgeViewpoints = sqliteTable(
  "knowledge_viewpoints",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    topicId: text("topic_id").references(() => knowledgeTopics.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    statement: text("statement").notNull().default(""),
    status: text("status", {
      enum: ["draft", "active", "needs_review", "revised", "split", "retired", "rejected"],
    })
      .notNull()
      .default("draft"),
    currentVersionId: text("current_version_id"),
    confidence: real("confidence").notNull().default(0.5),
    userConfirmed: integer("user_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index("idx_knowledge_viewpoints_user_id").on(table.userId),
    topicIdx: index("idx_knowledge_viewpoints_topic").on(table.topicId),
    statusIdx: index("idx_knowledge_viewpoints_status").on(table.status),
  }),
);

export type KnowledgeViewpoint = typeof knowledgeViewpoints.$inferSelect;
export type NewKnowledgeViewpoint = typeof knowledgeViewpoints.$inferInsert;

export const knowledgeViewpointVersions = sqliteTable(
  "knowledge_viewpoint_versions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    viewpointId: text("viewpoint_id")
      .notNull()
      .references(() => knowledgeViewpoints.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    statement: text("statement").notNull(),
    changeType: text("change_type", {
      enum: ["formed", "strengthened", "revised", "split", "retired"],
    }).notNull(),
    triggerReason: text("trigger_reason").notNull().default(""),
    inputScopeJson: text("input_scope_json").notNull().default("{}"),
    schemaVersion: text("schema_version").notNull().default("phase4-v1"),
    modelInfoJson: text("model_info_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    viewpointVersionIdx: uniqueIndex("idx_knowledge_viewpoint_versions_unique").on(
      table.viewpointId,
      table.versionNumber,
    ),
    userIdx: index("idx_knowledge_viewpoint_versions_user_id").on(table.userId),
  }),
);

export type KnowledgeViewpointVersion = typeof knowledgeViewpointVersions.$inferSelect;
export type NewKnowledgeViewpointVersion = typeof knowledgeViewpointVersions.$inferInsert;

export const knowledgeViewpointEvidence = sqliteTable(
  "knowledge_viewpoint_evidence",
  {
    id: text("id")
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    viewpointVersionId: text("viewpoint_version_id")
      .notNull()
      .references(() => knowledgeViewpointVersions.id, { onDelete: "cascade" }),
    captureId: text("capture_id").references(() => knowledgeCaptures.id, {
      onDelete: "cascade",
    }),
    evidenceUnitId: text("evidence_unit_id").references(
      () => knowledgeEvidenceUnits.id,
      { onDelete: "set null" },
    ),
    insightId: text("insight_id").references(() => knowledgeInsights.id, {
      onDelete: "set null",
    }),
    stance: text("stance", { enum: ["supports", "opposes", "context"] })
      .notNull()
      .default("context"),
    locatorJson: text("locator_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    versionIdx: index("idx_knowledge_viewpoint_evidence_version").on(
      table.viewpointVersionId,
    ),
    uniqueEvidenceIdx: uniqueIndex("idx_knowledge_viewpoint_evidence_unique").on(
      table.viewpointVersionId,
      table.captureId,
      table.evidenceUnitId,
      table.insightId,
      table.stance,
    ),
  }),
);

export type KnowledgeViewpointEvidence = typeof knowledgeViewpointEvidence.$inferSelect;
export type NewKnowledgeViewpointEvidence = typeof knowledgeViewpointEvidence.$inferInsert;
