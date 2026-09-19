import assert from "node:assert/strict";
import fs from "node:fs";
import Fastify from "fastify";
import { afterAll, test, vi } from "vitest";

import {
  createAccessToken,
  initializeAuthDatabase,
} from "@/db/auth.db.js";
import { resetDatabaseClients } from "@/db/index.js";
import { initializeKnowledgeBaseDatabase } from "@/db/knowledge-base.db.js";
import { initializeModelConfigDatabase } from "@/db/model-config.db.js";
import { initializeRoleDatabase } from "@/db/role.db.js";
import { userRepository } from "@/db/repositories/index.js";
import { initializeThreadDatabase } from "@/db/thread.db.js";
import { getLoggerConfig } from "@/logger.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { sendRouteError } from "@/utils/route-errors.js";
import { badRequest } from "@/utils/route-errors.js";
import microappsRoute, {
  type CodeGraphStudioRouteService,
  type ComfyUiStudioRouteService,
  type ImageGenerationRouteService,
  type MailCenterRouteService,
  type NewsHubRouteService,
} from "../index.js";
import type { TtsService } from "@/microapps/tts/index.js";

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "codegraph-microapps-routes",
  ".sqlite",
);

process.env.DATABASE_URL = `file:${testDbPath}`;
resetDatabaseClients();
initializeAuthDatabase();
initializeModelConfigDatabase();
initializeKnowledgeBaseDatabase();
initializeThreadDatabase();
initializeRoleDatabase();

afterAll(() => {
  resetDatabaseClients();
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // ignore cleanup failure on Windows file locking
  }
});

const createToken = () => {
  const user = userRepository.create({
    username: `codegraph-user-${crypto.randomUUID()}`,
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

const createApp = async (codeGraphStudioService: CodeGraphStudioRouteService) => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  const imageGenerationService: ImageGenerationRouteService = {
    async createGeneration() {
      throw new Error("not implemented");
    },
    async getGeneration() {
      return null;
    },
  };
  const comfyUiStudioService: ComfyUiStudioRouteService = {
    listConnections: () => [],
    createConnection() {
      throw new Error("not implemented");
    },
    updateConnection() {
      throw new Error("not implemented");
    },
    async testConnection() {
      throw new Error("not implemented");
    },
    listFlows: () => [],
    createFlow() {
      throw new Error("not implemented");
    },
    updateFlow() {
      throw new Error("not implemented");
    },
  };
  const mailCenterService: MailCenterRouteService = {
    getOverview() {
      throw new Error("not implemented");
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
  };
  const newsHubService: NewsHubRouteService = {
    async getOverview() {
      throw new Error("not implemented");
    },
    getConfig() {
      throw new Error("not implemented");
    },
    updateConfig() {
      throw new Error("not implemented");
    },
    async refresh() {
      throw new Error("not implemented");
    },
  };
  const ttsService: TtsService = {
    async getOverview() {
      throw new Error("not implemented");
    },
    getProvider() {
      throw new Error("not implemented");
    },
    updateProvider() {
      throw new Error("not implemented");
    },
    async listVoices() {
      throw new Error("not implemented");
    },
    async getGptSovitsCatalog() {
      throw new Error("not implemented");
    },
    getApiProviderCatalog() {
      throw new Error("not implemented");
    },
    getSynthesis() {
      throw new Error("not implemented");
    },
    async synthesize() {
      throw new Error("not implemented");
    },
    async synthesizeGptSovits() {
      throw new Error("not implemented");
    },
  };

  await app.register(microappsRoute, {
    imageGenerationService,
    comfyUiStudioService,
    computerUseService: {
      async createPlan() {
        throw new Error("not implemented");
      },
      async getTask() {
        return null;
      },
      async startTask() {
        throw new Error("not implemented");
      },
      async resolveApproval() {
        throw new Error("not implemented");
      },
      async cancelTask() {
        throw new Error("not implemented");
      },
    },
    computerUseRuntimeService: {
      async getRuntimeState() {
        throw new Error("not implemented");
      },
      async installRuntime() {
        throw new Error("not implemented");
      },
    },
    codeGraphStudioService,
    mailCenterService,
    newsHubService,
    ttsService,
  });
  return app;
};

test("CodeGraph microapp routes expose report, config save, and smoke query actions", async () => {
  const codeGraphStudioService: CodeGraphStudioRouteService = {
    getReport: vi.fn(async () => ({
      status: "blocked",
      blockedReasons: [
        {
          code: "external_index_root_unsupported",
          label: "External Index Root Unsupported",
          message: "real provider blocked",
        },
      ],
      config: {
        workspaceRoot: "D:\\workspace\\rag-demo",
        appDataRoot: "",
        appDataRootResolved: null,
        logRoot: null,
        indexRoot: null,
        microAppEnabled: true,
        agentCapabilityEnabled: false,
        command: "codegraph",
        startArgs: ["serve", "--mcp"],
        versionProbeArgs: ["--version"],
        telemetryProbeArgs: ["telemetry", "status"],
        timeoutMs: 2000,
        maxResults: 5,
        queryLimit: 5,
        capabilityRegistered: false,
      },
      capability: {
        available: false,
        registered: false,
        reasons: [
          {
            code: "agent_capability_disabled",
            message: "Owner has not allowed the agent to use CodeGraph.",
          },
        ],
        checks: {
          microAppEnabled: true,
          agentCapabilityEnabled: false,
          runtimeReady: false,
          telemetryVerifiedOff: false,
          workspaceMatched: true,
          repoPollutionSafe: false,
          appDataRootValid: false,
          capabilityRegistrationReady: false,
        },
      },
      pollutionGuard: {
        status: "blocked",
        repoDataDirName: ".codegraph",
        repoDataDirPath: "D:\\workspace\\rag-demo\\.codegraph",
        exists: true,
        blockedReason: "blocked",
      },
      runtime: {
        providerVersion: "1.3.0",
        telemetryStatus: "not_verified",
        handshakeStatus: "not_started",
        initializedNotificationSent: false,
        processAlive: false,
        startedAt: null,
        stoppedAt: null,
        durationMs: null,
        exitCode: null,
        lastStatus: null,
        lastError: "blocked",
        crashCount: 0,
        startDisposition: null,
      },
      debug: {
        workspaceHash: "workspace-hash",
        plannerStorage: {
          status: "blocked",
          source: "unresolved",
          appDataRoot: null,
          logRoot: null,
          indexRoot: null,
          reason: "missing app data root",
        },
        externalIndexSupport: {
          status: "blocked",
          externalIndexRootSupported: false,
          repoDataDirName: ".codegraph",
          reason: "blocked",
          investigation: {
            cliArgSupported: false,
            envPathSupported: false,
            configFilePathSupported: false,
            cwdProjectSeparationSupported: true,
            serveMcpProjectIndexSeparationSupported: false,
            dataDirEnvName: "CODEGRAPH_DIR",
          },
        },
        detectReasons: ["provider_missing"],
        rawManagerStatus: "blocked",
      },
    })),
    saveConfig: vi.fn(),
    detect: vi.fn(async () => ({ report: await codeGraphStudioService.getReport() })),
    start: vi.fn(async () => ({ report: await codeGraphStudioService.getReport() })),
    health: vi.fn(async () => ({ report: await codeGraphStudioService.getReport() })),
    stop: vi.fn(async () => ({ report: await codeGraphStudioService.getReport() })),
    smokeStatus: vi.fn(async () => ({
      kind: "status",
      ok: false,
      message: "blocked",
      payload: null,
      report: await codeGraphStudioService.getReport(),
    })),
    smokeQuery: vi.fn(async (query: string) => ({
      kind: "query",
      ok: false,
      message: `blocked:${query}`,
      payload: null,
      report: await codeGraphStudioService.getReport(),
    })),
    getDraft: vi.fn(() => ({
      microAppEnabled: true,
      agentCapabilityEnabled: true,
      command: "mock-codegraph",
      startArgs: ["serve", "--mcp"],
      versionProbeArgs: ["--version"],
      telemetryProbeArgs: ["telemetry", "status"],
      appDataRoot: "",
      timeoutMs: 2000,
      maxResults: 5,
      queryLimit: 5,
    })),
    getStoragePath: vi.fn(),
    getCapabilityGate: vi.fn(),
    getManagedCapabilityContext: vi.fn(),
  };

  const app = await createApp(codeGraphStudioService);
  const token = createToken();

  const reportResponse = await app.inject({
    method: "GET",
    url: "/microapps/codegraph/report",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(reportResponse.statusCode, 200, reportResponse.body);
  const report = reportResponse.json().data;
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockedReasons, []);
  assert.equal(report.config.agentCapabilityEnabled, true);
  assert.equal(report.capability.checks.agentCapabilityEnabled, true);
  assert.equal(report.capability.checks.repoPollutionSafe, true);
  assert.equal(report.pollutionGuard.status, "ready");
  assert.equal(report.pollutionGuard.blockedReason, null);

  const configResponse = await app.inject({
    method: "PUT",
    url: "/microapps/codegraph/config",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      command: process.execPath,
      appDataRoot: "D:\\tmp\\codegraph",
      timeoutMs: 1500,
    },
  });

  assert.equal(configResponse.statusCode, 200, configResponse.body);
  assert.equal(codeGraphStudioService.saveConfig.mock.calls[0]?.[0].command, process.execPath);

  const smokeQueryResponse = await app.inject({
    method: "POST",
    url: "/microapps/codegraph/smoke/query",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      query: "microapps architecture",
    },
  });

  assert.equal(smokeQueryResponse.statusCode, 200, smokeQueryResponse.body);
  assert.equal(smokeQueryResponse.json().data.kind, "query");
  assert.equal(
    smokeQueryResponse.json().data.message,
    "blocked:microapps architecture",
  );

  await app.close();
});

test("CodeGraph config route returns 400 when appDataRoot validation fails", async () => {
  const codeGraphStudioService: CodeGraphStudioRouteService = {
    getReport: vi.fn(async () => {
      throw new Error("not needed");
    }),
    saveConfig: vi.fn(() => {
      throw badRequest("App Data Root must stay outside the workspace root.");
    }),
    detect: vi.fn(async () => {
      throw new Error("not needed");
    }),
    start: vi.fn(async () => {
      throw new Error("not needed");
    }),
    health: vi.fn(async () => {
      throw new Error("not needed");
    }),
    stop: vi.fn(async () => {
      throw new Error("not needed");
    }),
    smokeStatus: vi.fn(async () => {
      throw new Error("not needed");
    }),
    smokeQuery: vi.fn(async () => {
      throw new Error("not needed");
    }),
    getDraft: vi.fn(),
    getStoragePath: vi.fn(),
    getCapabilityGate: vi.fn(),
    getManagedCapabilityContext: vi.fn(),
  };

  const app = await createApp(codeGraphStudioService);
  const token = createToken();

  const configResponse = await app.inject({
    method: "PUT",
    url: "/microapps/codegraph/config",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: {
      appDataRoot: "D:\\workspace\\rag-demo\\server\\tmp\\codegraph",
    },
  });

  assert.equal(configResponse.statusCode, 400, configResponse.body);
  assert.equal(
    configResponse.json().message,
    "App Data Root must stay outside the workspace root.",
  );
  assert.equal(codeGraphStudioService.saveConfig.mock.calls.length, 1);

  await app.close();
});
