import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, test, vi } from "vitest";
import { initializeModelConfigDatabase } from "@/db/model-config.db.js";
import { resetDatabaseClients } from "@/db/index.js";
import { microAppProviderConfigsRepository } from "@/db/repositories/micro-app-provider-configs.repository.js";
import { ttsProviderConfigsRepository } from "@/db/repositories/tts-provider-configs.repository.js";
import { ttsSynthesisJobsRepository } from "@/db/repositories/tts-synthesis-jobs.repository.js";
import { ttsRefAudiosRepository } from "@/db/repositories/tts-ref-audios.repository.js";
import { ttsRefAudioBindingsRepository } from "@/db/repositories/tts-ref-audio-bindings.repository.js";
import { llmService } from "@/services/llm.service.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const synthesizeWithGptSovitsMock = vi.fn();
const llmGenerateTextMock = vi.fn();

vi.mock("./gpt-sovits-gradio.js", async () => ({
  getDefaultGptSovitsServiceUrl: () => "http://127.0.0.1:9872",
  loadGptSovitsCatalog: vi.fn(),
  synthesizeWithGptSovits: synthesizeWithGptSovitsMock,
}));

vi.mock("@/services/llm.service.js", async () => ({
  llmService: {
    generateText: llmGenerateTextMock,
  },
}));

const testDbPath = createTimestampedTestArtifactPath(
  "db",
  "rag-demo-tts-gpt-sovits",
  ".sqlite",
);
const artifactRoot = createTimestampedTestArtifactPath(
  "server",
  "rag-demo-tts-gpt-sovits-output",
);
const refAudioPath = createTimestampedTestArtifactPath(
  "server",
  "rag-demo-tts-gpt-sovits-ref",
  ".wav",
);
const remoteSpeechResponse = Buffer.from("remote-speech-audio");

const configureApiProvider = (input: {
  kind: "volcengine" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  modelId: string;
}) => microAppProviderConfigsRepository.upsert("tts", input);

process.env.DATABASE_URL = `file:${testDbPath}`;

const { createTtsService } = await import("./index.js");

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetDatabaseClients();
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
  fs.mkdirSync(path.dirname(artifactRoot), { recursive: true });
  fs.writeFileSync(refAudioPath, Buffer.from("RIFF"));
  initializeModelConfigDatabase();
  ttsProviderConfigsRepository.initialize();
  ttsSynthesisJobsRepository.initialize();
  ttsRefAudiosRepository.initialize();
  ttsRefAudioBindingsRepository.initialize();
  synthesizeWithGptSovitsMock.mockReset();
  synthesizeWithGptSovitsMock.mockResolvedValue({
    mimeType: "audio/wav",
    providerMeta: {
      serviceUrl: "http://127.0.0.1:9872",
      sourcePath: null,
    },
  });
  llmGenerateTextMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? "audio/mpeg" : null),
      },
      arrayBuffer: async () => remoteSpeechResponse,
    }),
  );
});

afterAll(() => {
  resetDatabaseClients();
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(refAudioPath, { force: true });
  fs.rmSync(path.dirname(artifactRoot), { recursive: true, force: true });
});

test("synthesizeGptSovits merges saved provider config into sparse request payload", async () => {
  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    displayName: "GPT-SoVITS",
    config: {
      baseUrl: "http://127.0.0.1:9872",
      promptText: "保存的参考文本",
      promptLanguage: "中文",
      textLanguage: "中文",
      gptModel: "不训练直接推v2底模！",
      sovitsModel: "不训练直接推v2ProPlus底模！",
      cutMethod: "凑四句一切",
      sampleSteps: 8,
      speed: 1.1,
      pauseSecond: 0.3,
      temperature: 0,
      topK: 20,
      topP: 0,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesizeGptSovits({
    text: "你好",
    refAudioPath,
  });

  assert.equal(synthesizeWithGptSovitsMock.mock.calls.length, 1);
  const [input] = synthesizeWithGptSovitsMock.mock.calls[0] as Array<[{
    providerConfig: Record<string, unknown>;
    request: Record<string, unknown>;
    outputPath: string;
  }]>;

  assert.equal(input.request.gptModel, "不训练直接推v2底模！");
  assert.equal(input.request.sovitsModel, "不训练直接推v2ProPlus底模！");
  assert.equal(input.request.promptLanguage, "中文");
  assert.equal(input.request.textLanguage, "中文");
  assert.equal(input.request.cutMethod, "凑四句一切");
  assert.equal(input.request.sampleSteps, 8);
  assert.equal(input.request.speed, 1.1);
  assert.equal(input.request.pauseSecond, 0.3);
  assert.equal(input.request.temperature, 0);
  assert.equal(input.request.topK, 20);
  assert.equal(input.request.topP, 0);
  assert.equal(job.requestConfig.gptModel, "不训练直接推v2底模！");
  assert.equal(job.requestConfig.sovitsModel, "不训练直接推v2ProPlus底模！");
  assert.equal(job.requestConfig.temperature, 0);
  assert.equal(job.requestConfig.topP, 0);
});

test("synthesizeGptSovits resolves the server reference audio from the persisted binding", async () => {
  const stored = ttsRefAudiosRepository.saveOrGet({
    buffer: Buffer.from("RIFF-bound"),
    originalName: "bound.wav",
    mimeType: "audio/wav",
  });
  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    config: {
      selectedRefAudioId: "indexed-db-local-id",
      baseUrl: "http://127.0.0.1:9872",
      gptModel: "gpt-model",
      sovitsModel: "sovits-model",
    },
  });
  ttsRefAudioBindingsRepository.upsert("gpt_sovits", "indexed-db-local-id", stored.summary.id);

  const job = await createTtsService({ artifactRoot }).synthesizeGptSovits({ text: "你好" });
  const [input] = synthesizeWithGptSovitsMock.mock.calls[0] as Array<[{
    request: Record<string, unknown>;
  }]>;
  assert.match(String(input.request.refAudioPath), /\/microapps\/tts\/ref-audios\//u);
  assert.equal(job.requestConfig.refAudioId, stored.summary.id);
  assert.match(String(job.requestConfig.refAudioPath), /\/microapps\/tts\/ref-audios\//u);
});

test("synthesizeGptSovits uses the provider's persisted server reference audio id", async () => {
  const stored = ttsRefAudiosRepository.saveOrGet({
    buffer: Buffer.from("RIFF-configured"),
    originalName: "configured.wav",
    mimeType: "audio/wav",
  });
  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    config: {
      selectedRefAudioId: "indexed-db-local-id",
      serverRefAudioId: stored.summary.id,
      gptModel: "gpt-model",
      sovitsModel: "sovits-model",
    },
  });

  const job = await createTtsService({ artifactRoot }).synthesizeGptSovits({ text: "你好" });
  assert.equal(job.requestConfig.refAudioId, stored.summary.id);
  assert.equal(ttsRefAudioBindingsRepository.get("gpt_sovits", "indexed-db-local-id"), null);
});

test("synthesizeGptSovits resolves an unbound local selection from persisted reference metadata", async () => {
  const stored = ttsRefAudiosRepository.saveOrGet({
    buffer: Buffer.from("RIFF-metadata-match"),
    originalName: "[白洁]白洁，今年二十四岁，毕业于一所地方师范学院.wav",
    mimeType: "audio/wav",
  });
  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    config: {
      selectedRefAudioId: "indexed-db-local-id",
      promptText: "白洁，今年二十四岁，毕业于一所地方师范学院",
      gptModel: "gpt-model",
      sovitsModel: "sovits-model",
    },
  });

  const job = await createTtsService({ artifactRoot }).synthesizeGptSovits({ text: "你好" });
  assert.equal(job.requestConfig.refAudioId, stored.summary.id);
  assert.equal(
    ttsRefAudioBindingsRepository.get("gpt_sovits", "indexed-db-local-id")?.serverRefAudioId,
    stored.summary.id,
  );
});

test("synthesizeGptSovits rejects an unbound selected local reference audio id", async () => {
  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    config: { selectedRefAudioId: "unbound-indexed-db-id" },
  });

  await assert.rejects(
    () => createTtsService({ artifactRoot }).synthesizeGptSovits({ text: "你好" }),
    /GPT-SoVITS 参考音频未完成服务端绑定/u,
  );
  assert.equal(synthesizeWithGptSovitsMock.mock.calls.length, 0);
});

test("synthesizeGptSovits stores uploaded ref audio under backend static route", async () => {
  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    displayName: "GPT-SoVITS",
    config: {
      baseUrl: "http://127.0.0.1:9872",
      promptText: "",
      promptLanguage: "中文",
      textLanguage: "中文",
      gptModel: "不训练直接推v2底模！",
      sovitsModel: "不训练直接推v2ProPlus底模！",
      cutMethod: "凑四句一切",
      sampleSteps: 8,
      speed: 1,
      pauseSecond: 0.3,
      temperature: 1,
      topK: 15,
      topP: 1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesizeGptSovits(
    {
      text: "你好",
      refAudioPath: "",
      promptText: "",
      promptLanguage: "",
      textLanguage: "",
      gptModel: "",
      sovitsModel: "",
      cutMethod: "",
      sampleSteps: Number.NaN,
      speed: Number.NaN,
      pauseSecond: Number.NaN,
      temperature: Number.NaN,
      topK: Number.NaN,
      topP: Number.NaN,
    },
    {
      buffer: Buffer.from("RIFF-upload"),
      fileName: "demo.wav",
    },
  );

  assert.equal(synthesizeWithGptSovitsMock.mock.calls.length, 1);
  const [input] = synthesizeWithGptSovitsMock.mock.calls[0] as Array<[{
    providerConfig: Record<string, unknown>;
    request: Record<string, unknown>;
    outputPath: string;
  }]>;

  assert.match(
    String(input.request.refAudioPath),
    /^http:\/\/127\.0\.0\.1:8787\/microapps\/tts\/ref-audios\//u,
  );
  assert.equal(job.requestConfig.serviceUrl, "http://127.0.0.1:9872");
  assert.match(
    String(job.requestConfig.refAudioPath),
    /^http:\/\/127\.0\.0\.1:8787\/microapps\/tts\/ref-audios\//u,
  );
});

test("synthesizeGptSovits rewrites cantonese texts through task model before synthesis", async () => {
  llmGenerateTextMock
    .mockResolvedValueOnce("噉样讲先啱")
    .mockResolvedValueOnce("你好，呢度系粤语版。");

  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    displayName: "GPT-SoVITS",
    config: {
      baseUrl: "http://127.0.0.1:9872",
      promptText: "这样说才对",
      promptLanguage: "粤语",
      textLanguage: "粤语+英文",
      gptModel: "不训练直接推v2底模！",
      sovitsModel: "不训练直接推v2ProPlus底模！",
      cutMethod: "凑四句一切",
      sampleSteps: 8,
      speed: 1.1,
      pauseSecond: 0.3,
      temperature: 0,
      topK: 20,
      topP: 0,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesizeGptSovits({
    text: "你好，这里是粤语版。",
    refAudioPath,
    promptText: "",
    promptLanguage: "",
    textLanguage: "",
    gptModel: "",
    sovitsModel: "",
    cutMethod: "",
    sampleSteps: Number.NaN,
    speed: Number.NaN,
    pauseSecond: Number.NaN,
    temperature: Number.NaN,
    topK: Number.NaN,
    topP: Number.NaN,
  });

  assert.equal(llmGenerateTextMock.mock.calls.length, 2);
  assert.equal(llmGenerateTextMock.mock.calls[0][0].roleType, "task");
  assert.equal(llmGenerateTextMock.mock.calls[1][0].roleType, "task");
  const [input] = synthesizeWithGptSovitsMock.mock.calls[0] as Array<[{
    providerConfig: Record<string, unknown>;
    request: Record<string, unknown>;
    outputPath: string;
  }]>;
  assert.equal(input.request.promptText, "噉样讲先啱");
  assert.equal(input.request.text, "你好，呢度系粤语版。");
  assert.equal(job.text, "你好，呢度系粤语版。");
});

test("synthesizeGptSovits does not rewrite non-cantonese texts", async () => {
  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    displayName: "GPT-SoVITS",
    config: {
      baseUrl: "http://127.0.0.1:9872",
      promptText: "保存的参考文本",
      promptLanguage: "中文",
      textLanguage: "中文",
      gptModel: "不训练直接推v2底模！",
      sovitsModel: "不训练直接推v2ProPlus底模！",
      cutMethod: "凑四句一切",
      sampleSteps: 8,
      speed: 1.1,
      pauseSecond: 0.3,
      temperature: 0,
      topK: 20,
      topP: 0,
    },
  });

  const service = createTtsService({ artifactRoot });
  await service.synthesizeGptSovits({
    text: "你好，这里是普通话版。",
    refAudioPath,
    promptText: "",
    promptLanguage: "",
    textLanguage: "",
    gptModel: "",
    sovitsModel: "",
    cutMethod: "",
    sampleSteps: Number.NaN,
    speed: Number.NaN,
    pauseSecond: Number.NaN,
    temperature: Number.NaN,
    topK: Number.NaN,
    topP: Number.NaN,
  });

  assert.equal(llmGenerateTextMock.mock.calls.length, 0);
});

test("synthesizeGptSovits falls back to source text when task model is not configured", async () => {
  llmGenerateTextMock.mockRejectedValueOnce(new Error("No TASK model configured"));

  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    displayName: "GPT-SoVITS",
    config: {
      baseUrl: "http://127.0.0.1:9872",
      promptText: "这样说才对",
      promptLanguage: "粤语",
      textLanguage: "中文",
      gptModel: "不训练直接推v2底模！",
      sovitsModel: "不训练直接推v2ProPlus底模！",
      cutMethod: "凑四句一切",
      sampleSteps: 8,
      speed: 1.1,
      pauseSecond: 0.3,
      temperature: 0,
      topK: 20,
      topP: 0,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesizeGptSovits({
    text: "你好，这里是普通话版。",
    refAudioPath,
    promptText: "",
    promptLanguage: "",
    textLanguage: "",
    gptModel: "",
    sovitsModel: "",
    cutMethod: "",
    sampleSteps: Number.NaN,
    speed: Number.NaN,
    pauseSecond: Number.NaN,
    temperature: Number.NaN,
    topK: Number.NaN,
    topP: Number.NaN,
  });

  const [input] = synthesizeWithGptSovitsMock.mock.calls[0] as Array<[{
    providerConfig: Record<string, unknown>;
    request: Record<string, unknown>;
    outputPath: string;
  }]>;
  assert.equal(llmGenerateTextMock.mock.calls.length, 1);
  assert.equal(input.request.promptText, "这样说才对");
  assert.equal(job.requestConfig.promptText, "这样说才对");
});

test("synthesizeGptSovits falls back to source text when task model request fails", async () => {
  llmGenerateTextMock.mockRejectedValueOnce(new Error("task provider timeout"));

  ttsProviderConfigsRepository.upsert("gpt_sovits", {
    enabled: true,
    displayName: "GPT-SoVITS",
    config: {
      baseUrl: "http://127.0.0.1:9872",
      promptText: "这样说才对",
      promptLanguage: "粤语",
      textLanguage: "中文",
      gptModel: "不训练直接推v2底模！",
      sovitsModel: "不训练直接推v2ProPlus底模！",
      cutMethod: "凑四句一切",
      sampleSteps: 8,
      speed: 1.1,
      pauseSecond: 0.3,
      temperature: 0,
      topK: 20,
      topP: 0,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesizeGptSovits({
    text: "你好，这里是普通话版。",
    refAudioPath,
    promptText: "",
    promptLanguage: "",
    textLanguage: "",
    gptModel: "",
    sovitsModel: "",
    cutMethod: "",
    sampleSteps: Number.NaN,
    speed: Number.NaN,
    pauseSecond: Number.NaN,
    temperature: Number.NaN,
    topK: Number.NaN,
    topP: Number.NaN,
  });

  const [input] = synthesizeWithGptSovitsMock.mock.calls[0] as Array<[{
    providerConfig: Record<string, unknown>;
    request: Record<string, unknown>;
    outputPath: string;
  }]>;
  assert.equal(llmGenerateTextMock.mock.calls.length, 1);
  assert.equal(input.request.promptText, "这样说才对");
  assert.equal(job.requestConfig.promptText, "这样说才对");
});

test("synthesize uses the configured microapp provider for API provider tab", async () => {
  configureApiProvider({
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-openai-key",
    modelId: "gpt-4o-mini-tts",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "alloy",
      responseFormat: "mp3",
      speed: 1.1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，远程语音。",
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.providerId, "api_provider");
  assert.equal(job.mimeType, "audio/mpeg");
  assert.equal(job.voice, "alloy");
  assert.equal(job.requestConfig.responseFormat, "mp3");
  assert.equal(job.requestConfig.speed, 1.1);
  assert.match(String(job.outputPath), /\.mp3$/u);

  const fetchMock = vi.mocked(fetch);
  assert.equal(fetchMock.mock.calls.length, 1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  assert.equal(url, "https://api.openai.com/v1/audio/speech");
  assert.equal(init.method, "POST");
  assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-openai-key");
  assert.deepEqual(JSON.parse(String(init.body)), {
    model: "gpt-4o-mini-tts",
    input: "你好，远程语音。",
    voice: "alloy",
    response_format: "mp3",
    speed: 1.1,
  });
});

test("synthesize routes volcengine voice model through unidirectional ark endpoint", async () => {
  const audioBytes = Buffer.from([11, 22, 33, 44]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? "text/plain; charset=utf-8" : null),
      },
      arrayBuffer: async () =>
        Buffer.from(
          `${JSON.stringify({ code: 0, message: "ok", data: audioBytes.toString("base64") })}\n`,
          "utf-8",
        ),
    }),
  );

  configureApiProvider({
    kind: "volcengine",
    baseUrl: "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
    apiKey: "test-volcengine-key",
    modelId: "doubao-seed-tts-2.0",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "zh_female_yujie_mars_bigtts",
      responseFormat: "wav",
      speed: 1.2,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，火山方舟语音。",
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.mimeType, "audio/wav");

  const fetchMock = vi.mocked(fetch);
  assert.equal(fetchMock.mock.calls.length, 1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  assert.equal(url, "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    "Content-Type": "application/json",
    "X-Api-Key": "test-volcengine-key",
    "X-Api-Resource-Id": "doubao-seed-tts-2.0",
    "X-Api-Request-Id": (init.headers as Record<string, string>)["X-Api-Request-Id"],
  });
  assert.deepEqual(JSON.parse(String(init.body)), {
    user: {
      uid: "uichat-mira-tts-studio",
    },
    req_params: {
      text: "你好，火山方舟语音。",
      speaker: "zh_female_yujie_mars_bigtts",
      audio_params: {
        format: "wav",
        sample_rate: 24000,
      },
    },
  });
});

test("synthesize surfaces actionable volcengine auth guidance on 401", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: {
        get: () => "text/plain",
      },
      text: async () => "Unauthorized",
      json: async () => null,
    }),
  );

  configureApiProvider({
    kind: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
    apiKey: "test-volcengine-key",
    modelId: "doubao-seed-tts-2.0",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "zh_female_yujie_mars_bigtts",
      responseFormat: "wav",
      speed: 1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，火山方舟语音。",
  });

  assert.equal(job.status, "failed");
  assert.match(String(job.errorMessage), /Unauthorized|X-Api-Key/u);
});

test("synthesize fails when volcengine returns 200 with json error payload", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? "text/plain; charset=utf-8" : null),
      },
      arrayBuffer: async () =>
        Buffer.from(
          JSON.stringify({
            reqid: "debug-req-id",
            code: 45000030,
            message:
              "Forbidden.AgentPlanDeductNotEnabled: Agent Plan deduction is not enabled for this account or seat.",
          }),
          "utf-8",
        ),
    }),
  );

  configureApiProvider({
    kind: "volcengine",
    baseUrl: "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
    apiKey: "test-volcengine-key",
    modelId: "seed-tts-2.0",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "zh_female_cancan_uranus_bigtts",
      responseFormat: "wav",
      speed: 1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，火山方舟语音。",
  });

  assert.equal(job.status, "failed");
  assert.match(
    String(job.errorMessage),
    /Forbidden\.AgentPlanDeductNotEnabled|deduction is not enabled/u,
  );
});

test("synthesize decodes volcengine chunked audio payload into playable bytes", async () => {
  const audioBytes = Buffer.from([1, 2, 3, 4, 5, 6]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? "text/plain; charset=utf-8" : null),
      },
      arrayBuffer: async () =>
        Buffer.from(
          `${JSON.stringify({ code: 0, message: "ok", data: audioBytes.toString("base64") })}\n`,
          "utf-8",
        ),
    }),
  );

  configureApiProvider({
    kind: "volcengine",
    baseUrl: "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
    apiKey: "test-volcengine-key",
    modelId: "seed-tts-2.0",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "zh_female_gaolengyujie_uranus_bigtts",
      responseFormat: "mp3",
      speed: 1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，火山方舟语音。",
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.mimeType, "audio/mpeg");
  const written = fs.readFileSync(String(job.outputPath));
  assert.deepEqual(written, audioBytes);
});

test("synthesize detects volcengine speech protocol from openspeech base url even on openai connection code", async () => {
  const audioBytes = Buffer.from([7, 8, 9, 10]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? "text/plain; charset=utf-8" : null),
      },
      arrayBuffer: async () =>
        Buffer.from(
          `${JSON.stringify({ code: 0, message: "OK", data: audioBytes.toString("base64") })}\n`,
          "utf-8",
        ),
    }),
  );

  configureApiProvider({
    kind: "openai-compatible",
    baseUrl: "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
    apiKey: "test-volcengine-key",
    modelId: "seed-tts-2.0",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "zh_female_gaolengyujie_uranus_bigtts",
      responseFormat: "mp3",
      speed: 1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，火山方舟语音。",
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.mimeType, "audio/mpeg");

  const fetchMock = vi.mocked(fetch);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  assert.equal(url, "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional");
  assert.deepEqual(init.headers, {
    "Content-Type": "application/json",
    "X-Api-Key": "test-volcengine-key",
    "X-Api-Resource-Id": "seed-tts-2.0",
    "X-Api-Request-Id": (init.headers as Record<string, string>)["X-Api-Request-Id"],
  });
  assert.deepEqual(fs.readFileSync(String(job.outputPath)), audioBytes);
});

test("synthesize accepts volcengine successful terminal status after audio chunks", async () => {
  const audioBytes = Buffer.from([11, 12, 13]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? "text/plain; charset=utf-8" : null),
      },
      arrayBuffer: async () =>
        Buffer.from(
          [
            JSON.stringify({ code: 0, message: "", data: audioBytes.toString("base64") }),
            JSON.stringify({ code: 20000000, message: "OK", data: null }),
          ].join("\n"),
          "utf-8",
        ),
    }),
  );

  configureApiProvider({
    kind: "volcengine",
    baseUrl: "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
    apiKey: "test-volcengine-key",
    modelId: "seed-tts-2.0",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "zh_female_gaolengyujie_uranus_bigtts",
      responseFormat: "wav",
      speed: 1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，火山方舟语音。",
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.mimeType, "audio/wav");
  assert.deepEqual(fs.readFileSync(String(job.outputPath)), audioBytes);
});

test("synthesize surfaces clear guidance when volcengine returns success without audio data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? "text/plain; charset=utf-8" : null),
      },
      arrayBuffer: async () =>
        Buffer.from(
          `${JSON.stringify({ code: 0, message: "OK" })}\n`,
          "utf-8",
        ),
    }),
  );

  configureApiProvider({
    kind: "volcengine",
    baseUrl: "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
    apiKey: "test-volcengine-key",
    modelId: "seed-tts-2.0",
  });
  ttsProviderConfigsRepository.upsert("api_provider", {
    enabled: true,
    displayName: "API 服务商",
    config: {
      voice: "zh_female_gaolengyujie_uranus_bigtts",
      responseFormat: "mp3",
      speed: 1,
    },
  });

  const service = createTtsService({ artifactRoot });
  const job = await service.synthesize({
    providerId: "api_provider",
    text: "你好，火山方舟语音。",
  });

  assert.equal(job.status, "failed");
  assert.match(
    String(job.errorMessage),
    /没有返回音频数据|speaker \/ 音色 ID|voice 模型 ID/u,
  );
});
