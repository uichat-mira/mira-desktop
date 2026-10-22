import "@/bootstrap-env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import {
  type ComputerUseRuntimeState,
} from "@/microapps/computer-use/index.js";
import { ComputerUseRuntimeManager } from "@/microapps/computer-use/runtime/manager.js";
import { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";
import { BrowserService } from "@/microapps/computer-use/browser/service.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import {
  createComfyUiLocalAdapter,
  createOpenAiImagesAdapter,
} from "@/microapps/image-generation/adapters/index.js";
import { LocalImageGenerationArtifactStore } from "@/microapps/image-generation/artifacts/index.js";
import {
  createImageGenerationService,
  createInMemoryImageGenerationRealtimeStore,
  comfyUiStudioService,
} from "@/microapps/image-generation/index.js";
import { createMailCenterService } from "@/microapps/mail-center/index.js";
import { createNewsHubService } from "@/microapps/news-hub/index.js";
import { resetDashboardNewsSummaryCache } from "@/dashboard/dashboard-service.js";
import {
  createCodeGraphStudioService,
  setActiveCodeGraphStudioService,
} from "@/microapps/codegraph/index.js";
import { createTtsService } from "@/microapps/tts/index.js";
import { createEvolvingKnowledgeService } from "@/microapps/evolving-knowledge/index.js";
import { externalExpertService } from "@/microapps/external-expert/index.js";
import healthRoute from "@/routes/health";
import appMetaRoute from "@/routes/app-meta";
import dbHealthRoute from "@/routes/dbHealth";
import generalSettingsRoute from "@/routes/general-settings";
import logsRoute from "@/routes/logs";
import loginRoute from "@/routes/login";
import oauthRoute from "@/routes/oauth";
import meRoute from "@/routes/me";
import attachmentRoute from "@/routes/attachments";
import proxyProviderRoute from "@/routes/proxy-provider/index.js";
import accountRoute from "@/routes/account";
import knowledgeBaseRoute from "@/routes/knowledge-base/index.js";
import modelConfigRoute from "@/routes/model-config";
import providerSettingsRoute from "@/routes/provider-settings/index.js";
import roleRoute from "@/routes/role/index.js";
import threadRoute from "@/routes/thread/index.js";
import chatRagRoute from "@/routes/chat-rag";
import ragRuntimeRoute from "@/routes/rag-runtime/index.js";
import evaluationRoute from "@/routes/evaluation/index.js";
import integrationsRoute from "@/routes/integrations/index.js";
import notionRoute from "@/routes/microapps/notion.js";
import microappsRoute from "@/routes/microapps/index.js";
import wecomRoute from "@/routes/integrations/wecom.js";
import agentRoute from "@/agent/routes.js";
import mcpRoutes from "@/mcp/routes.js";
import webbridgeRoute from "@/routes/webbridge.js";
import dashboardController from "@/dashboard/dashboard-controller.js";
import {
  initializeExternalMcpDatabase,
  registerAllExternalMcpCapabilities,
} from "@/mcp/external.js";
import { getAuthUserFromRequest, initializeAuthDatabase } from "@/db/auth.db";
import { initializeEvaluationDatabase } from "@/db/evaluation.db";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import { agentRunRepository } from "@/db/repositories/agent-run.repository.js";
import { integrationCapabilitiesRepository } from "@/db/repositories/integration-capabilities.repository.js";
import { externalExpertsRepository } from "@/db/repositories/external-experts.repository.js";
import { integrationCapabilityMicroAppsRepository } from "@/db/repositories/integration-capability-micro-apps.repository.js";
import { integrationInstancesRepository } from "@/db/repositories/integration-instances.repository.js";
import { notionConnectionRepository } from "@/db/repositories/notion-connection.repository.js";
import { notionAccessPointsRepository } from "@/db/repositories/notion-access-points.repository.js";
import { notionActivitiesRepository } from "@/db/repositories/notion-activities.repository.js";
import { mailAccountsRepository } from "@/db/repositories/mail-accounts.repository.js";
import { mailFoldersRepository } from "@/db/repositories/mail-folders.repository.js";
import { mailMessagesRepository } from "@/db/repositories/mail-messages.repository.js";
import { newsHubSettingsRepository } from "@/db/repositories/news-hub-settings.repository.js";
import { newsFeedSubscriptionsRepository } from "@/db/repositories/news-feed-subscriptions.repository.js";
import { comfyUiStudioRepository } from "@/db/repositories/comfyui-studio.repository.js";
import { microAppsRepository } from "@/db/repositories/micro-apps.repository.js";
import { evolvingKnowledgeRepository } from "@/db/repositories/evolving-knowledge.repository.js";
import { newsItemsRepository } from "@/db/repositories/news-items.repository.js";
import { generalSettingsRepository } from "@/db/repositories/general-settings.repository.js";
import { webSearchSettingsRepository } from "@/db/repositories/web-search-settings.repository.js";
import { wecomSettingsRepository } from "@/db/repositories/wecom-settings.repository.js";
import { ttsProviderConfigsRepository } from "@/db/repositories/tts-provider-configs.repository.js";
import { ttsSynthesisJobsRepository } from "@/db/repositories/tts-synthesis-jobs.repository.js";
import { chatMediaRepository } from "@/db/repositories/chat-media.repository.js";
import { imageGenerationJobsRepository } from "@/db/repositories/image-generation-jobs.repository.js";
import { microAppProviderConfigsRepository } from "@/db/repositories/micro-app-provider-configs.repository.js";
import { chatMediaService } from "@/services/chat-media.service.js";
import { hostNotificationDeliveryService } from "@/services/host-notification-delivery.service.js";
import { canonicalMessageCleanupService } from "@/services/canonical-message-cleanup.service.js";
import { managedMediaCleanupService } from "@/services/managed-media-cleanup.service.js";
import { microAppCapabilityBindingsRepository } from "@/db/repositories/micro-app-capability-bindings.repository.js";
import { ttsRefAudiosRepository } from "@/db/repositories/tts-ref-audios.repository.js";
import { ttsRefAudioBindingsRepository } from "@/db/repositories/tts-ref-audio-bindings.repository.js";
import { initializeVectorStore } from "@/db";
import CONFIG from "@/config";
import { isAuthExemptPath, OPENAPI_PUBLIC_TAGS } from "@/config/public-api.js";
import { getLoggerConfig } from "@/logger";
import { evaluationService } from "@/services/evaluation.service.js";
import { getAppMeta } from "@/utils/index.js";
import { sendRouteError, unauthorized } from "@/utils/route-errors.js";
import { MAX_UPLOAD_FILE_BYTES } from "@/constants/knowledge-base.js";
import { attachmentStorageRoot } from "@/services/attachment-storage.service.js";
import {
  ttsRefAudioPublicPrefix,
  ttsRefAudioStorageRoot,
} from "@/services/tts-ref-audio-storage.service.js";
import { configureAgentRunPersistence } from "@/agent/run-store.js";
import { agentRunStore } from "@/agent/run-store.js";
import { configureInvocationRetention } from "@/mcp/core/invocations.js";
import {
  migrateLegacyMicroAppBindings,
} from "@/microapps/legacy-sync.js";
import { reconcileCodeGraphHarnessCapability } from "@/harness/codegraph-capability.js";
import { createManagedBrowserRuntimeReadinessResolver } from "@/harness/managed-browser-readiness.js";
import { getToolImplementation } from "@/harness/registry.js";
import { registerTool } from "@/harness/registry.js";
import { computerUseRepository } from "@/db/repositories/computer-use/repository.js";
import {
  initializeForgeRuntime,
  shutdownForgeRuntime,
} from "@/forge/runtime/index.js";
import forgeRoutes from "@/forge/routes/index.js";

const app = Fastify({
  bodyLimit: MAX_UPLOAD_FILE_BYTES,
  logger: getLoggerConfig(),
  serializerOpts: { encoding: "utf8" },
});
const allowBackendReuse = process.env.UI_CHAT_ALLOW_BACKEND_REUSE === "1";
const builtinAvatarRoot = path.resolve(process.cwd(), "static", "avatars");
const clientCoverageRoot = path.resolve(process.cwd(), "client-coverage");
const serverCoverageRoot = path.resolve(process.cwd(), "server-coverage");
const swaggerLogoPath = path.resolve(process.cwd(), "static", "logo.png");
const imageGenerationArtifactRoot = path.resolve(
  process.cwd(),
  ".artifacts",
  "image-generation",
);
const imageGenerationArtifactPublicPrefix = "/artifacts/image-generation/";
const ttsArtifactRoot = path.resolve(process.cwd(), ".artifacts", "tts", "outputs");
const computerUseArtifactRoot = path.resolve(
  process.cwd(),
  ".artifacts",
  "computer-use",
);
const computerUseRuntimeRoot = path.resolve(
  computerUseArtifactRoot,
  "runtime",
);
const workspaceSwaggerLogoPath = path.resolve(
  process.cwd(),
  "..",
  "desktop",
  "src",
  "assets",
  "branding",
  "uichat-logo-icon.png",
);

const readSwaggerLogo = async () => {
  const logoPath = fsSync.existsSync(swaggerLogoPath)
    ? swaggerLogoPath
    : workspaceSwaggerLogoPath;
  return fs.readFile(logoPath);
};

app.setErrorHandler(sendRouteError);

app.addHook("onClose", async () => {
  canonicalMessageCleanupService.stop();
  hostNotificationDeliveryService.stop();
  await shutdownForgeRuntime();
});

const createImageGenerationAdapterRegistry = () => {
  const resolveConfiguredImageProvider = (providerId: string) => {
    const microAppConfig = microAppProviderConfigsRepository.get("image_generation");
    if (microAppConfig && (providerId === "openai_images" || providerId === "api_provider")) {
      return {
        baseUrl: microAppConfig.baseUrl,
        apiKey: microAppConfig.apiKey,
        defaultModel: microAppConfig.modelId,
      };
    }

    return null;
  };

  return {
    getAdapter(providerId: string) {
      if (providerId === "comfyui_local") {
        return createComfyUiLocalAdapter({
          baseUrl: process.env.UI_CHAT_IMAGE_GENERATION_COMFYUI_BASE_URL ?? "",
          clientId: process.env.UI_CHAT_IMAGE_GENERATION_COMFYUI_CLIENT_ID,
        });
      }

      const configuredProvider = resolveConfiguredImageProvider(providerId);
      if (configuredProvider) {
        return createOpenAiImagesAdapter({
          apiKey: configuredProvider.apiKey,
          baseUrl: configuredProvider.baseUrl,
          defaultModel: configuredProvider.defaultModel,
        });
      }

      return null;
    },
  };
};

const imageGenerationRealtimeStore = createInMemoryImageGenerationRealtimeStore();

const imageGenerationService = createImageGenerationService({
  adapterRegistry: createImageGenerationAdapterRegistry(),
  artifactStore: new LocalImageGenerationArtifactStore({
    rootDir: imageGenerationArtifactRoot,
    publicBaseUrl: imageGenerationArtifactPublicPrefix.slice(0, -1),
  }),
  // Current strategy is intentionally temporary: jobs stay in process memory
  // until a dedicated persistent store is approved and implemented.
  jobStore: imageGenerationJobsRepository,
  realtimeStore: imageGenerationRealtimeStore,
});

const computerUseRuntimeManager = new ComputerUseRuntimeManager({
  storageRoot: computerUseRuntimeRoot,
});
const computerUseBrowserSessions = new BrowserSessionManager({
  runtime: { resolveRuntime: () => computerUseRuntimeManager.resolveRuntime() },
  artifactRoot: path.join(computerUseArtifactRoot, "browser"),
});
const computerUseBrowserService = new BrowserService(computerUseBrowserSessions);
const resolveComputerUseBrowserReadiness =
  createManagedBrowserRuntimeReadinessResolver(computerUseRuntimeManager);
for (const tool of createComputerUseBrowserTools(computerUseBrowserService, { sessionManager: computerUseBrowserSessions })) {
  registerTool(tool, { resolveReadiness: resolveComputerUseBrowserReadiness });
}
const nowIso = () => new Date().toISOString();

const toComputerUseRuntimeState = (
  checkedAt: string,
): ComputerUseRuntimeState => {
  const resolved = computerUseRuntimeManager.resolveRuntime();

  if (resolved.status === "ready") {
    return {
      status: "ready",
      browserEngine: resolved.runtime.channel,
      version: resolved.runtime.version,
      checkedAt,
      details: {
        strategy: resolved.strategy,
        executablePath: resolved.runtime.executablePath,
        source: resolved.runtime.source,
        inspectedCandidates: resolved.inspectedCandidates,
      },
    };
  }

  return {
    status: "not_installed",
    checkedAt,
    message: resolved.reason,
    details: {
      strategy: resolved.strategy,
      inspectedCandidates: resolved.inspectedCandidates,
    },
  };
};

const computerUseRuntimeService = {
  async getRuntimeState() {
    return toComputerUseRuntimeState(nowIso());
  },
  async installRuntime(request?: { force?: boolean }) {
    await computerUseRuntimeManager.installManagedRuntime(undefined, request);
    return toComputerUseRuntimeState(nowIso());
  },
};

const mailCenterService = createMailCenterService();
const newsHubService = createNewsHubService({
  onContentChanged: resetDashboardNewsSummaryCache,
});
const codeGraphStudioService = createCodeGraphStudioService({
  getCapabilityRegistrationState: () =>
    Boolean(getToolImplementation("codebase_explore")),
  onStateChanged: () => {
    reconcileCodeGraphHarnessCapability();
  },
});
setActiveCodeGraphStudioService(codeGraphStudioService);
const ttsService = createTtsService({ artifactRoot: ttsArtifactRoot });
chatMediaService.configureRoots({ imageGenerationRoot: imageGenerationArtifactRoot, ttsRoot: ttsArtifactRoot });
managedMediaCleanupService.configureRoots({ imageGenerationRoot: imageGenerationArtifactRoot, ttsRoot: ttsArtifactRoot });
const evolvingKnowledgeService = createEvolvingKnowledgeService();
const setupPlugins = async () => {
  const appMeta = getAppMeta();

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposedHeaders: ["Content-Disposition", "Content-Length"],
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: MAX_UPLOAD_FILE_BYTES,
    },
  });
  await app.register(fastifyWebsocket);

  await fs.mkdir(attachmentStorageRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: attachmentStorageRoot,
    prefix: "/attachments/",
    decorateReply: false,
    setHeaders(response) {
      response.setHeader(
        "Cache-Control",
        "private, max-age=31536000, immutable",
      );
    },
  });

  await fs.mkdir(ttsRefAudioStorageRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: ttsRefAudioStorageRoot,
    prefix: ttsRefAudioPublicPrefix,
    decorateReply: false,
    setHeaders(response) {
      response.setHeader("Cache-Control", "private, no-cache");
    },
  });

  await fs.mkdir(imageGenerationArtifactRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: imageGenerationArtifactRoot,
    prefix: imageGenerationArtifactPublicPrefix,
    decorateReply: false,
    setHeaders(response) {
      response.setHeader("Cache-Control", "private, no-cache");
    },
  });

  if (fsSync.existsSync(builtinAvatarRoot)) {
    await app.register(fastifyStatic, {
      root: builtinAvatarRoot,
      prefix: "/assets/avatars/",
      decorateReply: false,
      setHeaders(response) {
        response.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
      },
    });
  }

  if (fsSync.existsSync(clientCoverageRoot)) {
    await app.register(fastifyStatic, {
      root: clientCoverageRoot,
      prefix: "/client-coverage/",
      decorateReply: false,
      setHeaders(response) {
        response.setHeader("Cache-Control", "private, no-cache");
      },
    });
  }

  if (fsSync.existsSync(serverCoverageRoot)) {
    await app.register(fastifyStatic, {
      root: serverCoverageRoot,
      prefix: "/server-coverage/",
      decorateReply: false,
      setHeaders(response) {
        response.setHeader("Cache-Control", "private, no-cache");
      },
    });
  }

  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS" || isAuthExemptPath(request.url)) {
      return;
    }

    const user = getAuthUserFromRequest(request);
    if (!user) {
      const authHeader = request.headers.authorization;
      throw unauthorized(
        authHeader && authHeader.startsWith("Bearer ")
          ? "Invalid auth token"
          : "Missing auth token",
      );
    }

    request.authUser = user;
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "UIChat Mira Server API",
        description: "Backend APIs for UIChat Mira desktop/server integration",
        version: appMeta.version,
      },
      servers: [{ url: `http://127.0.0.1:${CONFIG.PORT}` }],
      tags: [
        { name: "System", description: "系统健康检查与状态" },
        { name: "Auth", description: "用户鉴权与账户管理" },
        {
          name: "Knowledge Base - Collections",
          description: "知识库集合的创建、查询、更新与删除",
        },
        {
          name: "Knowledge Base - Documents",
          description: "知识库文档列表、详情、状态与 CRUD",
        },
        {
          name: "Knowledge Base - Upload & Preview",
          description: "文档上传、分块预览与导入流程",
        },
        { name: "Model Settings", description: "模型配置与参数模板" },
        {
          name: "Provider Settings",
          description: "服务商连接与模型同步",
        },
        ...OPENAPI_PUBLIC_TAGS,
        { name: "Role", description: "角色原型与提示词素材管理" },
        { name: "Thread", description: "对话会话与消息管理" },
        { name: "Chat", description: "RAG 增强聊天与检索" },
        { name: "Evaluation", description: "评测工作台与评测任务" },
        { name: "Tools", description: "Built-in agent tools" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: CONFIG.SWAGGER_PREFIX,
    logo: {
      type: "image/png",
      content: await readSwaggerLogo(),
    },
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });
};

const setupRoutes = async () => {
  await app.register(proxyProviderRoute);
  await app.register(healthRoute);
  await app.register(appMetaRoute);
  await app.register(dbHealthRoute);
  await app.register(generalSettingsRoute);
  await app.register(logsRoute);
  await app.register(loginRoute);
  await app.register(oauthRoute);
  await app.register(meRoute);
  await app.register(attachmentRoute);
  await app.register(accountRoute);
  await app.register(knowledgeBaseRoute);
  await app.register(modelConfigRoute);
  await app.register(providerSettingsRoute);
  await app.register(roleRoute);
  await app.register(threadRoute);
  await app.register(chatRagRoute);
  await app.register(ragRuntimeRoute);
  await app.register(evaluationRoute);
  await app.register(integrationsRoute);
  await app.register(notionRoute);
  await app.register(microappsRoute, {
    imageGenerationService,
    comfyUiStudioService,
    computerUseRuntimeService,
    codeGraphStudioService,
    mailCenterService,
    newsHubService,
    ttsService,
    evolvingKnowledgeService,
    externalExpertService,
  });
  await app.register(wecomRoute);
  await app.register(agentRoute);
  await app.register(mcpRoutes);
  await app.register(webbridgeRoute);
  await app.register(forgeRoutes);
  await app.register(dashboardController, { newsHubService, mailCenterService });
};

const setupDatabase = async () => {
  if (!process.env.DATABASE_URL) {
    const dbDir = path.resolve(process.cwd(), CONFIG.DATABASE_DIR);
    await fs.mkdir(dbDir, { recursive: true });

    const dbPath = path.join(dbDir, CONFIG.DATABASE_NAME);
    const handle = await fs.open(dbPath, "a");
    await handle.close();

    process.env.DATABASE_URL = `file:${dbPath}`;
    app.log.info(`Database initialized at ${dbPath}`);
  }

  initializeAuthDatabase();
  initializeEvaluationDatabase();
  initializeModelConfigDatabase();
  initializeKnowledgeBaseDatabase();
  initializeRoleDatabase();
  initializeThreadDatabase();
  configureInvocationRetention({
    maxEntries: CONFIG.HARNESS_RETENTION_MAX_ENTRIES,
    ttlMs: CONFIG.HARNESS_RETENTION_TTL_MS,
  });
  agentRunStore.configureRetention?.({
    maxEntries: CONFIG.HARNESS_RETENTION_MAX_ENTRIES,
    ttlMs: CONFIG.HARNESS_RETENTION_TTL_MS,
  });
  configureAgentRunPersistence({
    create: (run) => {
      agentRunRepository.createPersistedRun(run);
    },
    get: agentRunRepository.get.bind(agentRunRepository),
    update: agentRunRepository.update.bind(agentRunRepository),
    addObservation: agentRunRepository.addObservation.bind(agentRunRepository),
    complete: agentRunRepository.complete.bind(agentRunRepository),
  });
  webSearchSettingsRepository.initialize();
  wecomSettingsRepository.initialize();
  generalSettingsRepository.initialize();
  integrationInstancesRepository.initialize();
  notionConnectionRepository.initialize();
  notionAccessPointsRepository.initialize();
  notionActivitiesRepository.initialize();
  integrationCapabilitiesRepository.initialize();
  microAppsRepository.initialize();
  evolvingKnowledgeRepository.initialize();
  comfyUiStudioRepository.initialize();
  integrationCapabilityMicroAppsRepository.initialize();
  mailAccountsRepository.initialize();
  mailFoldersRepository.initialize();
  mailMessagesRepository.initialize();
  newsHubSettingsRepository.initialize();
  newsFeedSubscriptionsRepository.initialize();
  newsItemsRepository.initialize();
  ttsProviderConfigsRepository.initialize();
  ttsSynthesisJobsRepository.initialize();
  chatMediaRepository.initialize();
  imageGenerationJobsRepository.initialize();
  microAppProviderConfigsRepository.initialize();
  microAppCapabilityBindingsRepository.initialize();
  ttsRefAudiosRepository.initialize();
  ttsRefAudioBindingsRepository.initialize();
  computerUseRepository.initialize();
  externalExpertsRepository.initialize();
  migrateLegacyMicroAppBindings();
  initializeExternalMcpDatabase();
  registerAllExternalMcpCapabilities();
  evaluationService.initializePersistence();
  reconcileCodeGraphHarnessCapability();

  const vectorStoreHealth = initializeVectorStore();
  if (vectorStoreHealth.ok) {
    app.log.info(
      {
        provider: vectorStoreHealth.provider,
        extensionPath: vectorStoreHealth.extensionPath,
      },
      vectorStoreHealth.detail,
    );
  } else {
    app.log.warn(
      {
        provider: vectorStoreHealth.provider,
      },
      vectorStoreHealth.detail,
    );
  }
};

const setupForgeRuntime = async () => {
  const runtime = await initializeForgeRuntime();
  const report = await runtime.initialize();
  app.log.info(
    {
      stateFile: report.stateFile,
      interruptedDispatches: report.reconcile.interruptedDispatchIds.length,
      interruptedMainThreads: report.reconcile.interruptedThreadIds.length,
    },
    "Forge runtime initialized under Mira Server lifecycle",
  );
};

const isExistingBackendHealthy = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
};

const startServer = async () => {
  await app.listen({ host: CONFIG.HOST, port: CONFIG.PORT });
  app.log.info(`Server running on http://${CONFIG.HOST}:${CONFIG.PORT}`);
  app.log.info(
    `API docs available at http://127.0.0.1:${CONFIG.PORT}${CONFIG.SWAGGER_PREFIX}`,
  );
};

const start = async () => {
  try {
    await setupPlugins();
    await setupDatabase();
    await setupRoutes();
    await startServer();
    canonicalMessageCleanupService.start();
    hostNotificationDeliveryService.start();
    await setupForgeRuntime();
  } catch (error) {
    if (
      allowBackendReuse &&
      error instanceof Error &&
      "code" in error &&
      error.code === "EADDRINUSE" &&
      (await isExistingBackendHealthy(CONFIG.PORT))
    ) {
      app.log.info(
        `Port ${CONFIG.PORT} is already in use by a healthy backend. Reusing existing service.`,
      );
      return;
    }

    app.log.error({ err: error as Error }, "Failed to start server");
    process.exit(1);
  }
};

process.on("SIGINT", async () => {
  app.log.info("Shutting down gracefully...");
  await app.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  app.log.info("Shutting down gracefully...");
  await app.close();
  process.exit(0);
});

void start();
