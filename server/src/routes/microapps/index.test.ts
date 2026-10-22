import assert from "node:assert/strict";
import fs from "node:fs";
import { afterAll, test } from "vitest";
import Fastify from "fastify";
import { createAccessToken, initializeAuthDatabase } from "@/db/auth.db";
import { resetDatabaseClients } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db";
import { initializeModelConfigDatabase } from "@/db/model-config.db";
import { userRepository } from "@/db/repositories/index.js";
import { initializeRoleDatabase } from "@/db/role.db";
import { initializeThreadDatabase } from "@/db/thread.db";
import {
  ImageGenerationJobNotFoundError,
  ImageGenerationRequestValidationError,
  type ImageGenerationJob,
} from "@/microapps/image-generation/index.js";
import type { MailCenterRouteService } from "./index.js";
import type { NewsHubRouteService } from "./index.js";
import { getLoggerConfig } from "@/logger";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { sendRouteError } from "@/utils/route-errors.js";
import microappsRoute, { type ImageGenerationRouteService } from "./index.js";
import type { ComfyUiStudioRouteService } from "./index.js";
import type { CodeGraphStudioRouteService } from "./index.js";
import type { TtsService } from "@/microapps/tts/index.js";
import { createImageGenerationService } from "@/microapps/image-generation/core/service.js";
import { LocalImageGenerationArtifactStore } from "@/microapps/image-generation/artifacts/store.js";
import { imageGenerationJobsRepository } from "@/db/repositories/image-generation-jobs.repository.js";

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "rag-demo-microapps-routes",
  ".sqlite",
);

process.env.DATABASE_URL = `file:${testDbPath}`;
resetDatabaseClients();

initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeThreadDatabase();
initializeRoleDatabase();
imageGenerationJobsRepository.initialize();

afterAll(() => {
  resetDatabaseClients();
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
});

const createTestJob = (
  overrides: Partial<ImageGenerationJob> = {},
): ImageGenerationJob => ({
  id: "job-1",
  providerId: "provider-sync",
  executionKind: "sync-http",
  status: "succeeded",
  requestSummary: {
    providerId: "provider-sync",
    prompt: "sunrise over the river",
    providerParamKeys: [],
    inputFileCount: 0,
    hasWorkflowApiJson: false,
  },
  artifacts: [
    {
      id: "artifact-1",
      type: "image",
      mimeType: "image/png",
      source: "remote-url",
      remoteUrl: "https://example.test/image.png",
    },
  ],
  createdAt: "2026-07-06T12:00:00.000Z",
  updatedAt: "2026-07-06T12:00:00.000Z",
  ...overrides,
});

const createMailCenterServiceStub = (): MailCenterRouteService => ({
  getOverview() {
    return {
      accounts: [],
      selectedAccountId: null,
      inbox: null,
    };
  },
  getMessageDetail() {
    throw new Error("not implemented");
  },
  deleteAccount() {
    throw new Error("not implemented");
  },
  saveAccount() {
    throw new Error("not implemented");
  },
  async sendTestMail() {
    throw new Error("not implemented");
  },
  async syncInbox() {
    throw new Error("not implemented");
  },
});

const createNewsHubServiceStub = (): NewsHubRouteService => ({
  async getOverview() {
    return {
      sources: [],
      items: [],
      total: 0,
      generatedAt: "2026-07-06T12:00:00.000Z",
    };
  },
  getConfig() {
    return {
      newsDataEnabled: false,
      newsDataApiKey: "",
      currentsEnabled: false,
      currentsApiKey: "",
      redditEnabled: false,
      redditClientId: "",
      redditClientSecret: "",
      redditUserAgent: "UIChat-Mira-NewsHub/0.1",
      redditSubreddits: "technology",
      refreshTtlMinutes: 60,
    };
  },
  updateConfig(input) {
    return {
      newsDataEnabled: input.newsDataEnabled ?? false,
      newsDataApiKey: input.newsDataApiKey ?? "",
      currentsEnabled: input.currentsEnabled ?? false,
      currentsApiKey: input.currentsApiKey ?? "",
      redditEnabled: input.redditEnabled ?? false,
      redditClientId: input.redditClientId ?? "",
      redditClientSecret: input.redditClientSecret ?? "",
      redditUserAgent: input.redditUserAgent ?? "UIChat-Mira-NewsHub/0.1",
      redditSubreddits: input.redditSubreddits ?? "technology",
      refreshTtlMinutes: input.refreshTtlMinutes ?? 60,
    };
  },
  async refresh() {
    return {
      startedAt: "2026-07-06T12:00:00.000Z",
      finishedAt: "2026-07-06T12:00:01.000Z",
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      ttlMinutes: 60,
      sources: [],
    };
  },
});

const createApp = async (
  service: ImageGenerationRouteService,
  mailCenterService: MailCenterRouteService = createMailCenterServiceStub(),
  newsHubService: NewsHubRouteService = createNewsHubServiceStub(),
  comfyUiStudioService: ComfyUiStudioRouteService = {
    listConnections() {
      return [];
    },
    createConnection(input) {
      return {
        id: "conn-1",
        baseUrl: input.baseUrl,
        clientId: input.clientId ?? "",
        status: "unverified",
        lastError: null,
        lastCheckedAt: null,
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      };
    },
    updateConnection(id, input) {
      return {
        id,
        baseUrl: input.baseUrl,
        clientId: input.clientId ?? "",
        status: "unverified",
        lastError: null,
        lastCheckedAt: null,
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      };
    },
    async testConnection(id) {
      return {
        id,
        baseUrl: "http://127.0.0.1:8188",
        clientId: "",
        status: "connectable",
        lastError: null,
        lastCheckedAt: "2026-07-06T12:00:00.000Z",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      };
    },
    listFlows() {
      return [];
    },
    createFlow(input) {
      return {
        id: "flow-1",
        connectionId: input.connectionId ?? null,
        name: input.name,
        note: input.note ?? "",
        source: input.source ?? "manual",
        workflowApiJson: input.workflowApiJson,
        mapping: {
          promptPath: input.mapping?.promptPath ?? "",
          seedPath: input.mapping?.seedPath ?? "",
          widthPath: input.mapping?.widthPath ?? "",
          heightPath: input.mapping?.heightPath ?? "",
          outputNodeId: input.mapping?.outputNodeId ?? "",
          previewNodeId: input.mapping?.previewNodeId ?? "",
        },
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      };
    },
    updateFlow(id, input) {
      return {
        id,
        connectionId: input.connectionId ?? null,
        name: input.name,
        note: input.note ?? "",
        source: input.source ?? "manual",
        workflowApiJson: input.workflowApiJson,
        mapping: {
          promptPath: input.mapping?.promptPath ?? "",
          seedPath: input.mapping?.seedPath ?? "",
          widthPath: input.mapping?.widthPath ?? "",
          heightPath: input.mapping?.heightPath ?? "",
          outputNodeId: input.mapping?.outputNodeId ?? "",
          previewNodeId: input.mapping?.previewNodeId ?? "",
        },
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      };
    },
  },
  ttsService: TtsService = {
    async getOverview() {
      return {
        providers: [],
        recentJobs: [],
      };
    },
    getProvider() {
      return null;
    },
    updateProvider(providerId) {
      return {
        id: providerId,
        providerId,
        displayName: providerId,
        enabled: true,
        config: {},
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      };
    },
    async listVoices() {
      return [];
    },
    async getGptSovitsCatalog() {
      return {
        serviceUrl: "http://127.0.0.1:9872",
        gptModelOptions: [],
        sovitsModelOptions: [],
        languageOptions: [],
        cutMethodOptions: [],
        sampleStepOptions: [],
        defaults: {
          serviceUrl: "http://127.0.0.1:9872",
          promptText: "",
          gptModel: "",
          sovitsModel: "",
          promptLanguage: "中文",
          textLanguage: "中文",
          cutMethod: "不切",
          sampleSteps: 8,
          speed: 1,
          pauseSecond: 0.3,
          temperature: 1,
          topK: 15,
          topP: 1,
        },
      };
    },
    getApiProviderCatalog() {
      return {
        configured: false,
        supported: false,
        providerConnectionId: null,
        providerDisplayName: "",
        providerCode: null,
        providerTemplateCode: null,
        baseUrl: "",
        modelId: "",
        modelName: "",
        errorMessage: "voice model is not configured",
      };
    },
    getSynthesis() {
      return null;
    },
    async synthesize() {
      throw new Error("not implemented");
    },
    async synthesizeGptSovits() {
      throw new Error("not implemented");
    },
  },
  codeGraphStudioService: CodeGraphStudioRouteService = {
    async getReport() {
      return {
        status: "stopped",
        blockedReasons: [],
        config: {
          workspaceRoot: "D:\\workspace\\rag-demo",
          appDataRoot: "",
          appDataRootResolved: null,
          logRoot: null,
          indexRoot: null,
          microAppEnabled: true,
          agentCapabilityEnabled: false,
          command: "codegraph",
          startArgs: [],
          versionProbeArgs: ["--version"],
          telemetryProbeArgs: ["--telemetry-status"],
          timeoutMs: 2000,
          maxResults: 5,
          queryLimit: 5,
          capabilityRegistered: false,
        },
        capability: {
          available: false,
          registered: false,
          reasons: [],
          checks: {
            microAppEnabled: true,
            agentCapabilityEnabled: false,
            runtimeReady: false,
            telemetryVerifiedOff: false,
            workspaceMatched: true,
            repoPollutionSafe: true,
            appDataRootValid: false,
            capabilityRegistrationReady: false,
          },
        },
        pollutionGuard: {
          status: "ready",
          repoDataDirName: ".codegraph",
          repoDataDirPath: "D:\\workspace\\rag-demo\\.codegraph",
          exists: false,
          blockedReason: null,
        },
        runtime: {
          providerVersion: null,
          telemetryStatus: "unavailable",
          handshakeStatus: "not_started",
          initializedNotificationSent: false,
          processAlive: false,
          startedAt: null,
          stoppedAt: null,
          durationMs: null,
          exitCode: null,
          lastStatus: null,
          lastError: null,
          crashCount: 0,
          startDisposition: null,
        },
        debug: {
          workspaceHash: "workspace-hash",
          plannerStorage: {},
          externalIndexSupport: {},
          detectReasons: [],
          rawManagerStatus: "stopped",
        },
      };
    },
    saveConfig() {},
    async detect() {
      return { report: await this.getReport() };
    },
    async start() {
      return { report: await this.getReport() };
    },
    async health() {
      return { report: await this.getReport() };
    },
    async stop() {
      return { report: await this.getReport() };
    },
    async smokeStatus() {
      return {
        kind: "status",
        ok: true,
        message: "ok",
        payload: {},
        report: await this.getReport(),
      };
    },
    async smokeQuery(query) {
      return {
        kind: "query",
        ok: true,
        message: query,
        payload: {},
        report: await this.getReport(),
      };
    },
    getDraft() {
      throw new Error("not implemented");
    },
    getStoragePath() {
      return "";
    },
    getCapabilityGate() {
      throw new Error("not implemented");
    },
    getManagedCapabilityContext() {
      throw new Error("not implemented");
    },
  },
) => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(microappsRoute, {
    imageGenerationService: service,
    comfyUiStudioService,
    computerUseRuntimeService: {
      async getRuntimeState() {
        return {
          status: "not_installed",
          checkedAt: new Date().toISOString(),
        };
      },
      async installRuntime() {
        return {
          status: "ready",
          checkedAt: new Date().toISOString(),
        };
      },
    },
    codeGraphStudioService,
    mailCenterService,
    newsHubService,
    ttsService,
  });
  return app;
};

const createToken = () => {
  const user = userRepository.create({
    username: `image-generation-user-${crypto.randomUUID()}`,
    passwordHash: "hash",
    role: "user",
    isActive: true,
  });

  return createAccessToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
};

test("microapps provider config routes save and reload TTS configuration", async () => {
  const app = await createApp({
    async createGeneration() {
      return createTestJob();
    },
    async getGeneration() {
      return createTestJob();
    },
  });
  const token = createToken();
  const payload = {
    kind: "volcengine",
    baseUrl: "https://openspeech.bytedance.com/api/v3/tts",
    apiKey: "test-api-key",
    modelId: "seed-tts-2.0",
  } as const;

  const saveResponse = await app.inject({
    method: "PUT",
    url: "/microapps/provider-config/tts",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload,
  });

  assert.equal(saveResponse.statusCode, 200, saveResponse.body);
  assert.equal(saveResponse.json().data.kind, payload.kind);
  assert.equal(saveResponse.json().data.modelId, payload.modelId);

  const getResponse = await app.inject({
    method: "GET",
    url: "/microapps/provider-config/tts",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(getResponse.statusCode, 200, getResponse.body);
  assert.equal(getResponse.json().data.baseUrl, payload.baseUrl);
  assert.equal(getResponse.json().data.apiKey, payload.apiKey);

  const imageSaveResponse = await app.inject({
    method: "PUT",
    url: "/microapps/provider-config/image_generation",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      ...payload,
      kind: "openai-compatible",
      modelId: "gpt-image-1",
    },
  });

  assert.equal(imageSaveResponse.statusCode, 200, imageSaveResponse.body);
  assert.equal(imageSaveResponse.json().data.app, "image_generation");
  assert.equal(imageSaveResponse.json().data.modelId, "gpt-image-1");

  await app.close();
});

test("microapps image generation routes create and query jobs", async () => {
  const createdJob = createTestJob();
  const service: ImageGenerationRouteService = {
    async createGeneration(request) {
      assert.equal(request.providerId, "provider-sync");
      assert.equal(request.prompt, "sunrise over the river");
      return createdJob;
    },
    async getGeneration(jobId) {
      assert.equal(jobId, createdJob.id);
      return createdJob;
    },
  };
  const app = await createApp(service);
  const token = createToken();

  const createResponse = await app.inject({
    method: "POST",
    url: "/microapps/image-generation/generations",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      providerId: "provider-sync",
      prompt: "sunrise over the river",
    },
  });

  assert.equal(createResponse.statusCode, 200, createResponse.body);
  assert.equal(createResponse.json().data.generationId, createdJob.id);
  assert.equal("providerId" in createResponse.json().data, false);
  assert.equal(
    createResponse.json().data.requestSummary.prompt,
    "sunrise over the river",
  );

  const getResponse = await app.inject({
    method: "GET",
    url: `/microapps/image-generation/generations/${createdJob.id}`,
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(getResponse.statusCode, 200, getResponse.body);
  assert.equal(getResponse.json().data.generationId, createdJob.id);
  assert.equal("providerId" in getResponse.json().data, false);
  assert.equal(getResponse.json().data.status, "succeeded");
  assert.equal(
    getResponse.json().data.artifacts[0].remoteUrl,
    "https://example.test/image.png",
  );

  await app.close();
});

test("HTTP job query and artifact content survive an image service restart", async () => {
  const artifactRoot = createTimestampedTestArtifactPath("media", "http-image-restart");
  const artifactStore = new LocalImageGenerationArtifactStore({ rootDir: artifactRoot });
  const adapter = { providerId: "http-restart-provider", executionKind: "sync-http" as const, async startGeneration() {
    return { status: "succeeded" as const, artifacts: [{ type: "image" as const, mimeType: "image/png", source: "base64" as const, base64Data: Buffer.from("http-png").toString("base64"), fileName: "http.png" }] };
  } };
  const makeService = () => createImageGenerationService({ adapterRegistry: { getAdapter: (id) => id === adapter.providerId ? adapter : null }, artifactStore, jobStore: imageGenerationJobsRepository, createId: () => "http-restart-job" });
  const created = await makeService().createGeneration({ providerId: adapter.providerId, prompt: "http restart" });
  resetDatabaseClients();
  imageGenerationJobsRepository.initialize();
  const app = await createApp(makeService());
  const token = createToken();
  const jobResponse = await app.inject({ method: "GET", url: `/microapps/image-generation/generations/${created.id}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(jobResponse.statusCode, 200);
  const artifactId = created.artifacts[0]!.id;
  const contentResponse = await app.inject({ method: "GET", url: `/microapps/image-generation/generations/${created.id}/artifacts/${artifactId}/content`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(contentResponse.statusCode, 200);
  assert.equal(contentResponse.body, "http-png");
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});

test("microapps image generation routes reject missing auth", async () => {
  const service: ImageGenerationRouteService = {
    async createGeneration() {
      return createTestJob();
    },
    async getGeneration() {
      return createTestJob();
    },
  };
  const app = await createApp(service);

  const response = await app.inject({
    method: "POST",
    url: "/microapps/image-generation/generations",
    headers: {
      "content-type": "application/json",
    },
    payload: {
      providerId: "provider-sync",
      prompt: "missing auth",
    },
  });

  assert.equal(response.statusCode, 401, response.body);
  assert.equal(response.json().message, "Missing auth token");

  await app.close();
});

test("microapps image generation routes map job not found to 404", async () => {
  const service: ImageGenerationRouteService = {
    async createGeneration() {
      return createTestJob();
    },
    async getGeneration() {
      throw new ImageGenerationJobNotFoundError("job-missing");
    },
  };
  const app = await createApp(service);
  const token = createToken();

  const response = await app.inject({
    method: "GET",
    url: "/microapps/image-generation/generations/job-missing",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 404, response.body);
  assert.equal(
    response.json().message,
    "Image generation job was not found: job-missing",
  );

  await app.close();
});

test("microapps image generation routes map request validation errors to 400", async () => {
  const service: ImageGenerationRouteService = {
    async createGeneration() {
      throw new ImageGenerationRequestValidationError(
        "Prompt or workflow is required.",
      );
    },
    async getGeneration() {
      return createTestJob();
    },
  };
  const app = await createApp(service);
  const token = createToken();

  const response = await app.inject({
    method: "POST",
    url: "/microapps/image-generation/generations",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      providerId: "provider-sync",
      prompt: "   ",
    },
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().message, "Prompt or workflow is required.");

  await app.close();
});

test("microapps image generation artifact content route serves materialized local files", async () => {
  const artifactPath = createTimestampedTestArtifactPath(
    "image-generation",
    "microapps-artifact-content",
    ".png",
  );
  fs.writeFileSync(artifactPath, Buffer.from("png-bytes"));

  const service: ImageGenerationRouteService = {
    async createGeneration() {
      return createTestJob();
    },
    async getGeneration(jobId) {
      assert.equal(jobId, "job-artifact-1");
      return createTestJob({
        id: "job-artifact-1",
        artifacts: [
          {
            id: "artifact-local-1",
            type: "image",
            mimeType: "image/png",
            source: "local-file",
            localPath: artifactPath,
            fileName: "artifact-local-1.png",
          },
        ],
      });
    },
  };
  const app = await createApp(service);
  const token = createToken();

  const response = await app.inject({
    method: "GET",
    url: "/microapps/image-generation/generations/job-artifact-1/artifacts/artifact-local-1/content",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["content-type"], "image/png");
  assert.deepEqual(response.rawPayload, Buffer.from("png-bytes"));

  try {
    fs.rmSync(artifactPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }

  await app.close();
});

test("microapps comfyui connection routes list, create, update, and test connections", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    createMailCenterServiceStub(),
    createNewsHubServiceStub(),
    {
      listConnections() {
        return [
          {
            id: "conn-1",
            baseUrl: "http://127.0.0.1:8188",
            clientId: "",
            status: "unverified",
            lastError: null,
            lastCheckedAt: null,
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        ];
      },
      createConnection(input) {
        assert.equal(input.baseUrl, "http://127.0.0.1:8188");
        return {
          id: "conn-1",
          baseUrl: input.baseUrl,
          clientId: input.clientId ?? "",
          status: "unverified",
          lastError: null,
          lastCheckedAt: null,
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:00:00.000Z",
        };
      },
      updateConnection(id, input) {
        assert.equal(id, "conn-1");
        assert.equal(input.baseUrl, "http://127.0.0.1:8288");
        return {
          id,
          baseUrl: input.baseUrl,
          clientId: input.clientId ?? "",
          status: "unverified",
          lastError: null,
          lastCheckedAt: null,
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:05:00.000Z",
        };
      },
      async testConnection(id) {
        assert.equal(id, "conn-1");
        return {
          id,
          baseUrl: "http://127.0.0.1:8288",
          clientId: "",
          status: "connectable",
          lastError: null,
          lastCheckedAt: "2026-07-06T12:06:00.000Z",
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:06:00.000Z",
        };
      },
      listFlows() {
        return [];
      },
      createFlow() {
        throw new Error("not implemented");
      },
      updateFlow() {
        throw new Error("not implemented");
      },
    },
  );
  const token = createToken();

  const listResponse = await app.inject({
    method: "GET",
    url: "/microapps/image-generation/comfyui/connections",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(listResponse.statusCode, 200, listResponse.body);
  assert.equal(listResponse.json().data[0].baseUrl, "http://127.0.0.1:8188");

  const createResponse = await app.inject({
    method: "POST",
    url: "/microapps/image-generation/comfyui/connections",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      baseUrl: "http://127.0.0.1:8188",
    },
  });

  assert.equal(createResponse.statusCode, 200, createResponse.body);
  assert.equal(createResponse.json().data.status, "unverified");

  const updateResponse = await app.inject({
    method: "PATCH",
    url: "/microapps/image-generation/comfyui/connections/conn-1",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      baseUrl: "http://127.0.0.1:8288",
    },
  });

  assert.equal(updateResponse.statusCode, 200, updateResponse.body);
  assert.equal(updateResponse.json().data.baseUrl, "http://127.0.0.1:8288");

  const testResponse = await app.inject({
    method: "POST",
    url: "/microapps/image-generation/comfyui/connections/conn-1/test",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(testResponse.statusCode, 200, testResponse.body);
  assert.equal(testResponse.json().data.status, "connectable");

  await app.close();
});

test("microapps comfyui flow routes list, create, and update flows", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    createMailCenterServiceStub(),
    createNewsHubServiceStub(),
    {
      listConnections() {
        return [];
      },
      createConnection() {
        throw new Error("not implemented");
      },
      updateConnection() {
        throw new Error("not implemented");
      },
      async testConnection() {
        throw new Error("not implemented");
      },
      listFlows() {
        return [
          {
            id: "flow-1",
            connectionId: null,
            name: "SDXL",
            note: "",
            source: "template",
            workflowApiJson: "{\"6\":{}}",
            mapping: {
              promptPath: "6.text",
              seedPath: "3.seed",
              widthPath: "13.width",
              heightPath: "13.height",
              outputNodeId: "9",
              previewNodeId: "9",
            },
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        ];
      },
      createFlow(input) {
        assert.equal(input.name, "New Flow");
        return {
          id: "flow-2",
          connectionId: input.connectionId ?? null,
          name: input.name,
          note: input.note ?? "",
          source: input.source ?? "manual",
          workflowApiJson: input.workflowApiJson,
          mapping: {
            promptPath: input.mapping?.promptPath ?? "",
            seedPath: input.mapping?.seedPath ?? "",
            widthPath: input.mapping?.widthPath ?? "",
            heightPath: input.mapping?.heightPath ?? "",
            outputNodeId: input.mapping?.outputNodeId ?? "",
            previewNodeId: input.mapping?.previewNodeId ?? "",
          },
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:00:00.000Z",
        };
      },
      updateFlow(id, input) {
        assert.equal(id, "flow-1");
        assert.equal(input.name, "Updated Flow");
        return {
          id,
          connectionId: input.connectionId ?? null,
          name: input.name,
          note: input.note ?? "",
          source: input.source ?? "manual",
          workflowApiJson: input.workflowApiJson,
          mapping: {
            promptPath: input.mapping?.promptPath ?? "",
            seedPath: input.mapping?.seedPath ?? "",
            widthPath: input.mapping?.widthPath ?? "",
            heightPath: input.mapping?.heightPath ?? "",
            outputNodeId: input.mapping?.outputNodeId ?? "",
            previewNodeId: input.mapping?.previewNodeId ?? "",
          },
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:10:00.000Z",
        };
      },
    },
  );
  const token = createToken();

  const listResponse = await app.inject({
    method: "GET",
    url: "/microapps/image-generation/comfyui/flows",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(listResponse.statusCode, 200, listResponse.body);
  assert.equal(listResponse.json().data[0].name, "SDXL");

  const createResponse = await app.inject({
    method: "POST",
    url: "/microapps/image-generation/comfyui/flows",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      name: "New Flow",
      workflowApiJson: "{\"6\":{}}",
      mapping: {
        promptPath: "6.text",
      },
    },
  });

  assert.equal(createResponse.statusCode, 200, createResponse.body);
  assert.equal(createResponse.json().data.id, "flow-2");

  const updateResponse = await app.inject({
    method: "PATCH",
    url: "/microapps/image-generation/comfyui/flows/flow-1",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      name: "Updated Flow",
      workflowApiJson: "{\"6\":{}}",
      mapping: {
        promptPath: "6.text",
      },
    },
  });

  assert.equal(updateResponse.statusCode, 200, updateResponse.body);
  assert.equal(updateResponse.json().data.name, "Updated Flow");

  await app.close();
});

test("microapps mail center overview route returns sanitized account list", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    {
      getOverview() {
        return {
          accounts: [
            {
              id: "mail-1",
              userId: 1,
              name: "Main Inbox",
              emailAddress: "main@example.com",
              smtpHost: "smtp.example.com",
              smtpPort: 465,
              smtpSecure: true,
              smtpUsername: "main@example.com",
              smtpPassword: "smtp-secret",
              imapHost: "imap.example.com",
              imapPort: 993,
              imapSecure: true,
              imapUsername: "main@example.com",
              imapPassword: "imap-secret",
              inboxFolderPath: "INBOX",
              status: "connected",
              lastError: null,
              lastSyncedAt: "2026-07-06T12:00:00.000Z",
              isDefault: true,
              createdAt: "2026-07-06T10:00:00.000Z",
              updatedAt: "2026-07-06T12:00:00.000Z",
            },
          ],
          selectedAccountId: "mail-1",
          inbox: {
            messageCount: 20,
            unreadCount: 2,
            lastSyncedAt: "2026-07-06T12:00:00.000Z",
            syncStatus: "succeeded",
            lastError: null,
            messages: [
              {
                id: "msg-1",
                remoteUid: 101,
                messageId: "<message-1@example.com>",
                subject: "Hello",
                fromDisplay: "Sender",
                fromAddress: "sender@example.com",
                previewText: "Preview",
                sentAt: "2026-07-06T11:58:00.000Z",
                receivedAt: "2026-07-06T11:59:00.000Z",
                isRead: false,
                isFlagged: false,
                hasAttachments: false,
              },
            ],
          },
        };
      },
      saveAccount() {
        throw new Error("not implemented");
      },
      getMessageDetail() {
        throw new Error("not implemented");
      },
      deleteAccount() {
        throw new Error("not implemented");
      },
      async sendTestMail() {
        throw new Error("not implemented");
      },
      async syncInbox() {
        throw new Error("not implemented");
      },
    },
  );
  const token = createToken();

  const response = await app.inject({
    method: "GET",
    url: "/microapps/mail-center/overview",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.accounts[0].hasSmtpPassword, true);
  assert.equal(response.json().data.accounts[0].hasImapPassword, true);
  assert.equal(response.json().data.inbox.messages[0].subject, "Hello");

  await app.close();
});

test("microapps news hub overview route returns aggregated items", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    createMailCenterServiceStub(),
    {
      async getOverview() {
        return {
          sources: [
            {
              key: "hn-frontpage",
              name: "Hacker News Front Page",
              sourceType: "api",
              fetchUrl: "https://hn.algolia.com/api/v1/search?tags=front_page",
              siteUrl: "https://news.ycombinator.com/",
              topic: "technology",
              lang: "en",
              tags: ["hacker-news", "community"],
              itemCount: 12,
              lastPublishedAt: "2026-07-06T11:00:00.000Z",
              lastIngestedAt: "2026-07-06T11:05:00.000Z",
              lastFetchedAt: "2026-07-06T11:05:00.000Z",
              lastFetchStatus: "succeeded",
              lastFetchError: null,
            },
          ],
          items: [
            {
              id: "news-1",
              sourceType: "api",
              sourceName: "Hacker News Front Page",
              sourceKey: "hn-frontpage",
              externalId: "123",
              title: "A good post",
              summary: "Short summary",
              contentText: "Longer summary",
              url: "https://example.com/post",
              author: "dang",
              publishedAt: "2026-07-06T11:00:00.000Z",
              ingestedAt: "2026-07-06T11:05:00.000Z",
              lang: "en",
              topic: "technology",
              tags: ["hacker-news"],
              rawPayload: {},
              createdAt: "2026-07-06T11:05:00.000Z",
              updatedAt: "2026-07-06T11:05:00.000Z",
            },
          ],
          total: 1,
          generatedAt: "2026-07-06T11:05:00.000Z",
        };
      },
      getConfig() {
        return createNewsHubServiceStub().getConfig();
      },
      updateConfig(input) {
        return createNewsHubServiceStub().updateConfig(input);
      },
      async refresh() {
        return {
          startedAt: "2026-07-06T11:00:00.000Z",
          finishedAt: "2026-07-06T11:05:00.000Z",
          fetchedCount: 1,
          insertedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          ttlMinutes: 60,
          sources: [],
        };
      },
    },
  );
  const token = createToken();

  const response = await app.inject({
    method: "GET",
    url: "/microapps/news-hub/overview?limit=20",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.total, 1);
  assert.equal(response.json().data.items[0].title, "A good post");
  assert.equal(response.json().data.sources[0].key, "hn-frontpage");

  await app.close();
});

test("microapps news hub config routes return and persist provider config", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    createMailCenterServiceStub(),
    {
      async getOverview() {
        return {
          sources: [],
          items: [],
          total: 0,
          generatedAt: "2026-07-06T12:00:00.000Z",
        };
      },
      getConfig() {
        return {
          newsDataEnabled: false,
          newsDataApiKey: "",
          currentsEnabled: true,
          currentsApiKey: "currents-key",
          redditEnabled: false,
          redditClientId: "",
          redditClientSecret: "",
          redditUserAgent: "UIChat-Mira-NewsHub/0.1",
          redditSubreddits: "technology",
          refreshTtlMinutes: 60,
        };
      },
      updateConfig(input) {
        assert.equal(input.newsDataEnabled, true);
        assert.equal(input.newsDataApiKey, "newsdata-key");
        assert.equal(input.redditEnabled, true);
        assert.equal(input.redditClientId, "reddit-client-id");
        assert.equal(input.refreshTtlMinutes, 180);
        return input;
      },
      async refresh() {
        return {
          startedAt: "2026-07-06T11:00:00.000Z",
          finishedAt: "2026-07-06T11:05:00.000Z",
          fetchedCount: 0,
          insertedCount: 0,
          updatedCount: 0,
          skippedCount: 2,
          ttlMinutes: 60,
          sources: [],
        };
      },
    },
  );
  const token = createToken();

  const getResponse = await app.inject({
    method: "GET",
    url: "/microapps/news-hub/config",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(getResponse.statusCode, 200, getResponse.body);
  assert.equal(getResponse.json().data.currentsEnabled, true);
  assert.equal(getResponse.json().data.refreshTtlMinutes, 60);

  const payload = {
    newsDataEnabled: true,
    newsDataApiKey: "newsdata-key",
    currentsEnabled: true,
    currentsApiKey: "currents-key",
    redditEnabled: true,
    redditClientId: "reddit-client-id",
    redditClientSecret: "reddit-client-secret",
    redditUserAgent: "UIChat-Mira-NewsHub/0.2",
    redditSubreddits: "technology+programming",
    refreshTtlMinutes: 180,
  };

  const saveResponse = await app.inject({
    method: "PUT",
    url: "/microapps/news-hub/config",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload,
  });

  assert.equal(saveResponse.statusCode, 200, saveResponse.body);
  assert.equal(saveResponse.json().data.redditEnabled, true);
  assert.equal(saveResponse.json().data.newsDataApiKey, "newsdata-key");
  assert.equal(saveResponse.json().data.refreshTtlMinutes, 180);

  await app.close();
});

test("microapps mail center message detail route returns stored plain text body", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    {
      getOverview() {
        return {
          accounts: [],
          selectedAccountId: null,
          inbox: null,
        };
      },
      getMessageDetail(_userId, accountId, messageId) {
        assert.equal(accountId, "mail-1");
        assert.equal(messageId, "msg-1");

        return {
          id: "msg-1",
          remoteUid: 101,
          messageId: "<message-1@example.com>",
          subject: "Hello",
          fromDisplay: "Sender",
          fromAddress: "sender@example.com",
          to: [
            {
              name: "Receiver",
              address: "receiver@example.com",
            },
          ],
          previewText: "Preview",
          textContent: "Full plain text body",
          htmlContent: "<p>Full <strong>HTML</strong> body</p>",
          sentAt: "2026-07-06T11:58:00.000Z",
          receivedAt: "2026-07-06T11:59:00.000Z",
          isRead: false,
          isFlagged: false,
          hasAttachments: false,
          rawHeaders: {
            subject: "Hello",
          },
        };
      },
      saveAccount() {
        throw new Error("not implemented");
      },
      deleteAccount() {
        throw new Error("not implemented");
      },
      async sendTestMail() {
        throw new Error("not implemented");
      },
      async syncInbox() {
        throw new Error("not implemented");
      },
    },
  );
  const token = createToken();

  const response = await app.inject({
    method: "GET",
    url: "/microapps/mail-center/accounts/mail-1/messages/msg-1",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.message.textContent, "Full plain text body");
  assert.equal(response.json().data.message.htmlContent, "<p>Full <strong>HTML</strong> body</p>");
  assert.equal(response.json().data.message.to[0].address, "receiver@example.com");

  await app.close();
});

test("microapps mail center delete account route returns deletion result", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    {
      getOverview() {
        return {
          accounts: [],
          selectedAccountId: null,
          inbox: null,
        };
      },
      getMessageDetail() {
        throw new Error("not implemented");
      },
      deleteAccount(_userId, accountId) {
        assert.equal(accountId, "mail-1");
        return {
          accountId: "mail-1",
          deleted: true,
        };
      },
      saveAccount() {
        throw new Error("not implemented");
      },
      async sendTestMail() {
        throw new Error("not implemented");
      },
      async syncInbox() {
        throw new Error("not implemented");
      },
    },
  );
  const token = createToken();

  const response = await app.inject({
    method: "DELETE",
    url: "/microapps/mail-center/accounts/mail-1",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.accountId, "mail-1");
  assert.equal(response.json().data.deleted, true);

  await app.close();
});

test("microapps tts overview route returns provider and recent job state", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    createMailCenterServiceStub(),
    createNewsHubServiceStub(),
    undefined,
    {
      async getOverview() {
        return {
          providers: [
            {
              id: "provider-1",
              providerId: "windows_builtin",
              displayName: "Windows Built-in Voice",
              enabled: true,
              config: {},
              createdAt: "2026-07-06T12:00:00.000Z",
              updatedAt: "2026-07-06T12:00:00.000Z",
            },
          ],
          recentJobs: [
            {
              id: "tts-job-1",
              providerId: "windows_builtin",
              status: "succeeded",
              text: "hello",
              voice: "Voice-A",
              requestConfig: { rate: 0, volume: 100 },
              outputPath: "D:\\tmp\\tts-job-1.wav",
              mimeType: "audio/wav",
              errorMessage: null,
              createdAt: "2026-07-06T12:00:00.000Z",
              updatedAt: "2026-07-06T12:00:00.000Z",
              completedAt: "2026-07-06T12:00:01.000Z",
            },
          ],
        };
      },
      getProvider() {
        return null;
      },
      updateProvider(providerId) {
        return {
          id: "provider-1",
          providerId,
          displayName: "Windows Built-in Voice",
          enabled: true,
          config: {},
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:00:00.000Z",
        };
      },
      async listVoices() {
        return [];
      },
      async getGptSovitsCatalog() {
        return {
          serviceUrl: "http://127.0.0.1:9872",
          gptModelOptions: [],
          sovitsModelOptions: [],
          languageOptions: [],
          cutMethodOptions: [],
          sampleStepOptions: [],
          defaults: {
            serviceUrl: "http://127.0.0.1:9872",
            promptText: "",
            gptModel: "",
            sovitsModel: "",
            promptLanguage: "中文",
            textLanguage: "中文",
            cutMethod: "不切",
            sampleSteps: 8,
            speed: 1,
            pauseSecond: 0.3,
            temperature: 1,
            topK: 15,
            topP: 1,
          },
        };
      },
      getApiProviderCatalog() {
        return {
          configured: false,
          supported: false,
          providerConnectionId: null,
          providerDisplayName: "",
          providerCode: null,
          providerTemplateCode: null,
          baseUrl: "",
          modelId: "",
          modelName: "",
          errorMessage: "voice model is not configured",
        };
      },
      getSynthesis() {
        return null;
      },
      async synthesize() {
        throw new Error("not implemented");
      },
      async synthesizeGptSovits() {
        throw new Error("not implemented");
      },
    },
  );
  const token = createToken();

  const response = await app.inject({
    method: "GET",
    url: "/microapps/tts/overview",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.providers[0].providerId, "windows_builtin");
  assert.equal(response.json().data.recentJobs[0].id, "tts-job-1");

  await app.close();
});

test("microapps GPT-SoVITS synthesis route returns bad request when synthesis job failed", async () => {
  const app = await createApp(
    {
      async createGeneration() {
        return createTestJob();
      },
      async getGeneration() {
        return createTestJob();
      },
    },
    createMailCenterServiceStub(),
    createNewsHubServiceStub(),
    undefined,
    {
      async getOverview() {
        return {
          providers: [],
          recentJobs: [],
        };
      },
      getProvider() {
        return null;
      },
      updateProvider(providerId) {
        return {
          id: "provider-1",
          providerId,
          displayName: "GPT-SoVITS",
          enabled: true,
          config: {},
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:00:00.000Z",
        };
      },
      async listVoices() {
        return [];
      },
      async getGptSovitsCatalog() {
        return {
          serviceUrl: "http://127.0.0.1:9872",
          gptModelOptions: [],
          sovitsModelOptions: [],
          languageOptions: [],
          cutMethodOptions: [],
          sampleStepOptions: [],
          defaults: {
            serviceUrl: "http://127.0.0.1:9872",
            promptText: "",
            gptModel: "",
            sovitsModel: "",
            promptLanguage: "中文",
            textLanguage: "中文",
            cutMethod: "不切",
            sampleSteps: 8,
            speed: 1,
            pauseSecond: 0.3,
            temperature: 1,
            topK: 15,
            topP: 1,
          },
        };
      },
      getApiProviderCatalog() {
        return {
          configured: false,
          supported: false,
          providerConnectionId: null,
          providerDisplayName: "",
          providerCode: null,
          providerTemplateCode: null,
          baseUrl: "",
          modelId: "",
          modelName: "",
          errorMessage: "voice model is not configured",
        };
      },
      getSynthesis() {
        return null;
      },
      async synthesize() {
        throw new Error("not implemented");
      },
      async synthesizeGptSovits() {
        return {
          id: "tts-job-gpt-failed",
          providerId: "gpt_sovits",
          status: "failed",
          text: "hello",
          voice: null,
          requestConfig: {},
          outputPath: null,
          mimeType: null,
          errorMessage: "upstream get_tts_wav failed",
          createdAt: "2026-07-06T12:00:00.000Z",
          updatedAt: "2026-07-06T12:00:00.000Z",
          completedAt: "2026-07-06T12:00:01.000Z",
        };
      },
    },
  );
  const token = createToken();

  const response = await app.inject({
    method: "POST",
    url: "/microapps/tts/gpt-sovits/syntheses",
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: {
      text: "hello",
      refAudioPath: "D:\\voice\\ref.wav",
      promptText: "",
      promptLanguage: "中文",
      textLanguage: "中文",
      gptModel: "",
      sovitsModel: "",
      cutMethod: "不切",
      sampleSteps: 8,
      speed: 1,
      pauseSecond: 0.3,
      temperature: 1,
      topK: 15,
      topP: 1,
    },
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().message, "upstream get_tts_wav failed");

  await app.close();
});
