import fs from "node:fs/promises";
import { getAuthUserFromRequest } from "@/db/auth.db.js";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "@/db/auth.db.js";
import { errorResponse, ErrorCodes } from "@/utils/index.js";
import type { createMailCenterService } from "@/microapps/mail-center/index.js";
import type { createNewsHubService } from "@/microapps/news-hub/index.js";
import type { TtsService } from "@/microapps/tts/index.js";
import type { CodeGraphStudioService } from "@/microapps/codegraph/index.js";
import type {
  ComputerUseRuntimeState,
} from "@/microapps/computer-use/index.js";
import {
  ImageGenerationJobNotFoundError,
  ImageGenerationProviderNotFoundError,
  ImageGenerationRequestValidationError,
  ComfyUiStudioNotFoundError,
  ComfyUiStudioValidationError,
  type ImageGenerationProgressSnapshot,
  type ImageGenerationRealtimeEvent,
  type ComfyUiConnection,
  type ComfyUiFlow,
  type ImageGenerationCreateRequest,
  type ImageGenerationJob,
} from "@/microapps/image-generation/index.js";
import type { EvolvingKnowledgeService } from "@/microapps/evolving-knowledge/index.js";
import type { ExternalExpertService } from "@/microapps/external-expert/index.js";
import { success } from "@/utils/index.js";
import { badRequest, notFound, routeHandler } from "@/utils/route-errors.js";
import computerUseRoutes from "./computer-use/index.js";
import type { ComputerUseDebuggerService } from "./computer-use/debugger-service.js";
import codeGraphRoutes from "./codegraph/index.js";
import evolvingKnowledgeRoutes from "./evolving-knowledge/index.js";
import externalExpertRoutes from "./external-expert/index.js";
import mailCenterRoutes from "./mail-center/index.js";
import newsHubRoutes from "./news-hub/index.js";
import officeSuiteRoutes from "./office-suite/index.js";
import ttsRoutes from "./tts/index.js";
import { imageGenerationRouteSchemas } from "./schemas.js";
import { microAppCapabilityService } from "@/services/micro-app-capability.service.js";
import type { MicroAppProviderId } from "@/db/repositories/micro-app-capability-bindings.repository.js";
import { microAppProviderConfigsRepository } from "@/db/repositories/micro-app-provider-configs.repository.js";

export type ImageGenerationRouteService = {
  createGeneration(request: ImageGenerationCreateRequest): Promise<ImageGenerationJob>;
  getGeneration(jobId: string): Promise<ImageGenerationJob | null>;
  refreshGeneration?(jobId: string): Promise<ImageGenerationJob>;
  subscribeRealtime?(
    jobId: string,
    listener: (event: ImageGenerationRealtimeEvent) => void,
  ): () => void;
  getProgressSnapshot?(jobId: string): ImageGenerationProgressSnapshot | null;
};

export type ComfyUiStudioRouteService = {
  listConnections(): ComfyUiConnection[];
  createConnection(input: { baseUrl: string; clientId?: string }): ComfyUiConnection;
  updateConnection(
    id: string,
    input: { baseUrl: string; clientId?: string },
  ): ComfyUiConnection;
  testConnection(id: string): Promise<ComfyUiConnection>;
  listFlows(): ComfyUiFlow[];
  createFlow(input: {
    connectionId?: string | null;
    name: string;
    note?: string;
    source?: "template" | "upload" | "manual";
    workflowApiJson: string;
    mapping?: {
      promptPath?: string;
      seedPath?: string;
      widthPath?: string;
      heightPath?: string;
      outputNodeId?: string;
      previewNodeId?: string;
    };
  }): ComfyUiFlow;
  updateFlow(
    id: string,
    input: {
      connectionId?: string | null;
      name: string;
      note?: string;
      source?: "template" | "upload" | "manual";
      workflowApiJson: string;
      mapping?: {
        promptPath?: string;
        seedPath?: string;
        widthPath?: string;
        heightPath?: string;
        outputNodeId?: string;
        previewNodeId?: string;
      };
    },
  ): ComfyUiFlow;
};

export type ComputerUseRuntimeRouteService = {
  getRuntimeState(): Promise<ComputerUseRuntimeState>;
  installRuntime(request?: { force?: boolean }): Promise<ComputerUseRuntimeState>;
};

export type MailCenterRouteService = ReturnType<typeof createMailCenterService>;
export type NewsHubRouteService = ReturnType<typeof createNewsHubService>;

type MicroappsRouteOptions = {
  imageGenerationService?: ImageGenerationRouteService;
  comfyUiStudioService?: ComfyUiStudioRouteService;
  computerUseRuntimeService?: ComputerUseRuntimeRouteService;
  computerUseDebuggerService?: ComputerUseDebuggerService;
  codeGraphStudioService?: CodeGraphStudioService;
  mailCenterService?: MailCenterRouteService;
  newsHubService?: NewsHubRouteService;
  ttsService?: TtsService;
  evolvingKnowledgeService?: EvolvingKnowledgeService;
  externalExpertService?: ExternalExpertService;
};

export type CodeGraphStudioRouteService = CodeGraphStudioService;

const toGenerationResponse = (job: ImageGenerationJob) => ({
  generationId: job.id,
  status: job.status,
  executionKind: job.executionKind,
  artifacts: job.artifacts,
  requestSummary: job.requestSummary,
  providerJobId: job.providerJobId,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  meta: job.meta,
});

const toGenerationProgressResponse = (progress: ImageGenerationProgressSnapshot) => ({
  generationId: progress.generationId,
  providerJobId: progress.providerJobId,
  status: progress.status,
  stage: progress.stage,
  progressPercent: progress.progressPercent,
  message: progress.message,
  updatedAt: progress.updatedAt,
});

const toComfyUiConnectionResponse = (connection: ComfyUiConnection) => ({
  id: connection.id,
  baseUrl: connection.baseUrl,
  clientId: connection.clientId,
  status: connection.status,
  lastError: connection.lastError,
  lastCheckedAt: connection.lastCheckedAt,
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt,
});

const toComfyUiFlowResponse = (flow: ComfyUiFlow) => ({
  id: flow.id,
  connectionId: flow.connectionId,
  name: flow.name,
  note: flow.note,
  source: flow.source,
  workflowApiJson: flow.workflowApiJson,
  mapping: flow.mapping,
  createdAt: flow.createdAt,
  updatedAt: flow.updatedAt,
});

const mapImageGenerationError = (error: unknown): never => {
  if (
    error instanceof ImageGenerationProviderNotFoundError ||
    error instanceof ImageGenerationRequestValidationError ||
    error instanceof ComfyUiStudioValidationError
  ) {
    throw badRequest(error.message, { cause: error });
  }

  if (
    error instanceof ImageGenerationJobNotFoundError ||
    error instanceof ComfyUiStudioNotFoundError
  ) {
    throw notFound(error.message, { cause: error });
  }

  throw error;
};

const microappsRoute: FastifyPluginAsync<MicroappsRouteOptions> = async (
  app,
  options,
) => {
  app.addHook("preHandler", async (request, reply) => {
    if (
      (request.url.includes("/microapps/image-generation/generations/") &&
        request.url.includes("/events")) ||
      request.url.includes("/microapps/tts/ref-audios/")
    ) {
      return;
    }

    const authUser = getAuthUserFromRequest(request);
    if (authUser) {
      request.authUser = authUser;
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply
        .code(401)
        .send(errorResponse("Missing auth token", ErrorCodes.UNAUTHORIZED));
    }

    return reply
      .code(401)
      .send(errorResponse("Invalid auth token", ErrorCodes.UNAUTHORIZED));
  });

  app.get<{ Params: { app: "image_generation" | "tts" } }>(
    "/microapps/provider-config/:app",
    async (request) =>
      success(
        microAppProviderConfigsRepository.get(request.params.app),
        "Micro-app provider config loaded",
      ),
  );
  app.put<{
    Params: { app: "image_generation" | "tts" };
    Body: { kind: "volcengine" | "openai-compatible"; baseUrl: string; apiKey: string; modelId: string };
  }>("/microapps/provider-config/:app", async (request) =>
    success(
      microAppProviderConfigsRepository.upsert(request.params.app, request.body),
      "Micro-app provider config saved",
    ),
  );

  const imageGenerationService = options.imageGenerationService;
  const comfyUiStudioService = options.comfyUiStudioService;
  const computerUseRuntimeService = options.computerUseRuntimeService;
  const computerUseDebuggerService = options.computerUseDebuggerService;
  const codeGraphStudioService = options.codeGraphStudioService;
  const mailCenterService = options.mailCenterService;
  const newsHubService = options.newsHubService;
  const ttsService = options.ttsService;
  if (!imageGenerationService) {
    throw new Error(
      "microappsRoute requires imageGenerationService to be injected from the server composition root.",
    );
  }
  if (!comfyUiStudioService) {
    throw new Error(
      "microappsRoute requires comfyUiStudioService to be injected from the server composition root.",
    );
  }
  if (!computerUseRuntimeService) {
    throw new Error(
      "microappsRoute requires computerUseRuntimeService to be injected from the server composition root.",
    );
  }
  if (!mailCenterService) {
    throw new Error(
      "microappsRoute requires mailCenterService to be injected from the server composition root.",
    );
  }
  if (!newsHubService) {
    throw new Error(
      "microappsRoute requires newsHubService to be injected from the server composition root.",
    );
  }
  if (!codeGraphStudioService) {
    throw new Error(
      "microappsRoute requires codeGraphStudioService to be injected from the server composition root.",
    );
  }
  if (!ttsService) {
    throw new Error(
      "microappsRoute requires ttsService to be injected from the server composition root.",
    );
  }
  const evolvingKnowledgeService = options.evolvingKnowledgeService;
  const externalExpertService = options.externalExpertService;

  app.get(
    "/microapps/capabilities",
    routeHandler("Failed to load micro-app capabilities", async () =>
      success(microAppCapabilityService.list()),
    ),
  );

  app.put<{
    Params: { capability: "imageGeneration" | "tts" };
    Body: { providerId: string };
  }>(
    "/microapps/capabilities/:capability",
    routeHandler("Failed to save micro-app capability", async (request) => {
      const params = request.params as { capability: "imageGeneration" | "tts" };
      const body = request.body as {
        providerId: string;
      };
      if (params.capability !== "imageGeneration" && params.capability !== "tts") {
        throw badRequest(`不支持的微应用能力：${params.capability}`);
      }
      return success(
        microAppCapabilityService.save({
          capabilityCode: params.capability,
          providerId: body.providerId as MicroAppProviderId,
        }),
        "Micro-app capability saved",
      );
    }),
  );

  app.post<{ Body: ImageGenerationCreateRequest }>(
    "/microapps/image-generation/generations",
    { schema: imageGenerationRouteSchemas.createGeneration },
    routeHandler("Failed to create image generation job", async (request) => {
      try {
        const job = await imageGenerationService.createGeneration(request.body);
        return success(toGenerationResponse(job), "Image generation job created");
      } catch (error) {
        return mapImageGenerationError(error);
      }
    }),
  );

  app.get<{
    Params: { id: string };
  }>(
    "/microapps/image-generation/generations/:id/progress",
    { schema: imageGenerationRouteSchemas.getGenerationProgress },
    routeHandler("Failed to get image generation job progress", async (request) => {
      try {
        const job = await imageGenerationService.getGeneration(request.params.id);
        if (!job) {
          throw new ImageGenerationJobNotFoundError(request.params.id);
        }

        const progress = imageGenerationService.getProgressSnapshot?.(request.params.id) ?? {
          generationId: job.id,
          providerJobId: job.providerJobId,
          status: job.status,
          stage: job.status,
          progressPercent: job.status === "succeeded" ? 100 : job.status === "running" ? 66 : 12,
          message: job.error?.message,
          updatedAt: job.updatedAt,
        };

        return success(toGenerationProgressResponse(progress));
      } catch (error) {
        return mapImageGenerationError(error);
      }
    }),
  );

  app.get<{
    Params: { id: string };
    Querystring: { token?: string };
  }>(
    "/microapps/image-generation/generations/:id/events",
    {
      websocket: true,
    },
    (connection, request) => {
      const generationId = request.params.id;
      const sendEvent = (payload: unknown) => {
        connection.socket.send(
          JSON.stringify({
            success: true,
            data: payload,
            timestamp: new Date().toISOString(),
          }),
        );
      };

      const unsubscribe = imageGenerationService.subscribeRealtime?.(
        generationId,
        (event) => {
          if (event.type === "job") {
            sendEvent({
              type: "job",
              generation: toGenerationResponse(event.generation),
            });
            return;
          }

          sendEvent({
            type: "progress",
            progress: toGenerationProgressResponse(event.progress),
          });
        },
      );

      void imageGenerationService
        .getGeneration(generationId)
        .then((job) => {
          if (!job) {
            connection.socket.close(4404, "Not found");
            return;
          }

          sendEvent({
            type: "job",
            generation: toGenerationResponse(job),
          });
          const progress = imageGenerationService.getProgressSnapshot?.(generationId);
          if (progress) {
            sendEvent({
              type: "progress",
              progress: toGenerationProgressResponse(progress),
            });
          }
        })
        .catch(() => {
          connection.socket.close(1011, "Failed to load generation");
        });
      connection.socket.on("close", () => {
        unsubscribe?.();
      });
    },
  );

  app.get(
    "/microapps/image-generation/comfyui/connections",
    { schema: imageGenerationRouteSchemas.listComfyUiConnections },
    routeHandler("Failed to list ComfyUI connections", async () =>
      success(
        comfyUiStudioService.listConnections().map(toComfyUiConnectionResponse),
      )),
  );

  app.post<{ Body: { baseUrl: string; clientId?: string } }>(
    "/microapps/image-generation/comfyui/connections",
    { schema: imageGenerationRouteSchemas.createComfyUiConnection },
    routeHandler("Failed to create ComfyUI connection", async (request) =>
      success(
        toComfyUiConnectionResponse(
          comfyUiStudioService.createConnection(request.body),
        ),
        "ComfyUI connection created",
      )),
  );

  app.patch<{
    Params: { id: string };
    Body: { baseUrl: string; clientId?: string };
  }>(
    "/microapps/image-generation/comfyui/connections/:id",
    { schema: imageGenerationRouteSchemas.updateComfyUiConnection },
    routeHandler("Failed to update ComfyUI connection", async (request) =>
      success(
        toComfyUiConnectionResponse(
          comfyUiStudioService.updateConnection(request.params.id, request.body),
        ),
        "ComfyUI connection updated",
      )),
  );

  app.post<{ Params: { id: string } }>(
    "/microapps/image-generation/comfyui/connections/:id/test",
    { schema: imageGenerationRouteSchemas.testComfyUiConnection },
    routeHandler("Failed to test ComfyUI connection", async (request) =>
      success(
        toComfyUiConnectionResponse(
          await comfyUiStudioService.testConnection(request.params.id),
        ),
        "ComfyUI connection tested",
      )),
  );

  app.get(
    "/microapps/image-generation/comfyui/flows",
    { schema: imageGenerationRouteSchemas.listComfyUiFlows },
    routeHandler("Failed to list ComfyUI flows", async () =>
      success(comfyUiStudioService.listFlows().map(toComfyUiFlowResponse))),
  );

  app.post<{
    Body: {
      connectionId?: string | null;
      name: string;
      note?: string;
      source?: "template" | "upload" | "manual";
      workflowApiJson: string;
      mapping?: {
        promptPath?: string;
        seedPath?: string;
        widthPath?: string;
        heightPath?: string;
        outputNodeId?: string;
        previewNodeId?: string;
      };
    };
  }>(
    "/microapps/image-generation/comfyui/flows",
    { schema: imageGenerationRouteSchemas.createComfyUiFlow },
    routeHandler("Failed to create ComfyUI flow", async (request) =>
      success(
        toComfyUiFlowResponse(comfyUiStudioService.createFlow(request.body)),
        "ComfyUI flow created",
      )),
  );

  app.patch<{
    Params: { id: string };
    Body: {
      connectionId?: string | null;
      name: string;
      note?: string;
      source?: "template" | "upload" | "manual";
      workflowApiJson: string;
      mapping?: {
        promptPath?: string;
        seedPath?: string;
        widthPath?: string;
        heightPath?: string;
        outputNodeId?: string;
        previewNodeId?: string;
      };
    };
  }>(
    "/microapps/image-generation/comfyui/flows/:id",
    { schema: imageGenerationRouteSchemas.updateComfyUiFlow },
    routeHandler("Failed to update ComfyUI flow", async (request) =>
      success(
        toComfyUiFlowResponse(
          comfyUiStudioService.updateFlow(request.params.id, request.body),
        ),
        "ComfyUI flow updated",
      )),
  );

  app.get<{
    Params: { id: string };
    Querystring: { refresh?: "true" | "false" };
  }>(
    "/microapps/image-generation/generations/:id",
    { schema: imageGenerationRouteSchemas.getGeneration },
    routeHandler("Failed to get image generation job", async (request) => {
      try {
        const job =
          request.query.refresh === "true" &&
          imageGenerationService.refreshGeneration
            ? await imageGenerationService.refreshGeneration(request.params.id)
            : await imageGenerationService.getGeneration(request.params.id);

        if (!job) {
          throw new ImageGenerationJobNotFoundError(request.params.id);
        }

        return success(toGenerationResponse(job));
      } catch (error) {
        return mapImageGenerationError(error);
      }
    }),
  );

  app.get<{
    Params: { id: string; artifactId: string };
  }>(
    "/microapps/image-generation/generations/:id/artifacts/:artifactId/content",
    { schema: imageGenerationRouteSchemas.getGenerationArtifactContent },
    routeHandler("Failed to get image generation artifact content", async (request, reply) => {
      try {
        const job = await imageGenerationService.getGeneration(request.params.id);
        if (!job) {
          throw new ImageGenerationJobNotFoundError(request.params.id);
        }

        const artifact = job.artifacts.find(
          (item) => item.id === request.params.artifactId,
        );
        if (!artifact?.localPath) {
          throw notFound(
            `Image generation artifact was not found: ${request.params.artifactId}`,
          );
        }

        const bytes = await fs.readFile(artifact.localPath);
        reply.header("Cache-Control", "no-store");
        reply.type(artifact.mimeType || "application/octet-stream");
        return reply.send(bytes);
      } catch (error) {
        return mapImageGenerationError(error);
      }
    }),
  );

  await app.register(officeSuiteRoutes);
  await app.register(computerUseRoutes, {
    computerUseRuntimeService,
    computerUseDebuggerService,
  });
  await app.register(codeGraphRoutes, {
    codeGraphStudioService,
  });
  await app.register(mailCenterRoutes, {
    mailCenterService,
  });
  await app.register(newsHubRoutes, {
    newsHubService,
  });
  await app.register(ttsRoutes, {
    ttsService,
  });

  if (evolvingKnowledgeService) {
    await app.register(evolvingKnowledgeRoutes, {
      service: evolvingKnowledgeService,
    });
  }
  if (externalExpertService) {
    await app.register(externalExpertRoutes, { service: externalExpertService });
  }
};

export default microappsRoute;
