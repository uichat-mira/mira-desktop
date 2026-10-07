import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolImplementation } from "../../mcp/core/definitions.js";
import {
  clearHarnessRegistry,
  registerTool,
} from "../registry.js";
import { resolveHarnessToolCandidatesForTurn } from "./resolver.js";

const { executeLocalEmbeddingMock, rerankMock } = vi.hoisted(() => ({
  executeLocalEmbeddingMock: vi.fn(),
  rerankMock: vi.fn(),
}));

vi.mock("@/services/internal-capabilities/local-embedding.js", () => ({
  executeLocalEmbedding: executeLocalEmbeddingMock,
}));

vi.mock("./rerank.js", () => ({
  rerankHarnessCapabilityMatches: rerankMock,
}));

const testEmbedding = (text: string) => [
  /browser|chrome|webpage|网页|页面|后台/iu.test(text) ? 1 : 0,
  /attached|current-browser|already-connected|authenticated-session|当前|已登录/iu.test(text) ? 1 : 0,
  /edit|write|workspace|保存|写入|工作区/iu.test(text) ? 1 : 0,
  /terminal|shell|终端/iu.test(text) ? 1 : 0,
];

const createTool = (input: {
  id: string;
  domain: "browser_action" | "edit" | "terminal";
  tags: string[];
  sideEffect: "none" | "local-write" | "process" | "network";
  requiresApproval: boolean;
  networkAccess?: boolean;
  longRunning?: boolean;
}): ToolImplementation => ({
  definition: {
    id: input.id,
    title: input.id,
    description: `${input.id} test tool`,
    domain: input.domain,
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    tags: input.tags,
    capabilities: {
      sideEffect: input.sideEffect,
      requiresApproval: input.requiresApproval,
      ...(input.networkAccess === undefined
        ? {}
        : { networkAccess: input.networkAccess }),
      ...(input.longRunning === undefined
        ? {}
        : { longRunning: input.longRunning }),
    },
  },
  execute: async () => ({ result: { ok: true } }),
});

describe("browser-intent Harness candidate exposure", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    executeLocalEmbeddingMock.mockImplementation(
      async ({ texts }: { texts: string[] }) => ({
        embeddings: texts.map(testEmbedding),
        embeddingModel: "controlled-test-embedding",
      }),
    );
    rerankMock.mockImplementation(async ({ matches }) => ({ matches }));

    registerTool(
      createTool({
        id: "browser_observe",
        domain: "browser_action",
        tags: ["browser", "computer-use"],
        sideEffect: "network",
        requiresApproval: false,
        networkAccess: true,
      }),
    );
    registerTool(
      createTool({
        id: "browser_act",
        domain: "browser_action",
        tags: ["browser", "computer-use"],
        sideEffect: "network",
        requiresApproval: false,
        networkAccess: true,
      }),
    );
    registerTool(
      createTool({
        id: "browser_assert",
        domain: "browser_action",
        tags: ["browser", "computer-use"],
        sideEffect: "network",
        requiresApproval: false,
        networkAccess: true,
      }),
    );
    for (const id of [
      "browser_attached_look",
      "browser_attached_browse",
      "browser_attached_act",
      "browser_attached_transfer",
    ]) {
      registerTool(
        createTool({
          id,
          domain: "browser_action",
          tags: [
            "browser",
            "attached-browser",
            "current-browser",
            "authenticated-session",
            "chrome",
            "当前浏览器",
            "已登录",
          ],
          sideEffect: id === "browser_attached_look" ? "none" : "network",
          requiresApproval:
            id === "browser_attached_act" || id === "browser_attached_transfer",
          networkAccess: true,
        }),
      );
    }
    registerTool(
      createTool({
        id: "write",
        domain: "edit",
        tags: ["edit", "write"],
        sideEffect: "local-write",
        requiresApproval: true,
      }),
    );
    registerTool(
      createTool({
        id: "terminal",
        domain: "terminal",
        tags: ["terminal", "shell"],
        sideEffect: "process",
        requiresApproval: true,
        longRunning: true,
      }),
    );
    for (let index = 0; index < 13; index += 1) {
      registerTool(
        createTool({
          id: `unrelated_tool_${index}`,
          domain: "terminal",
          tags: ["unrelated"],
          sideEffect: "none",
          requiresApproval: false,
        }),
      );
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearHarnessRegistry();
  });

  it("does not isolate Browser tools when a multi-step browser task also needs Edit or Terminal", async () => {
    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "打开公众号网页，整理成 HTML，然后保存到当前工作区；必要时用终端处理。",
    });

    expect(result.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining([
        "browser_observe",
        "browser_act",
        "browser_assert",
        "write",
        "terminal",
      ]),
    );
    expect(result.toolExposure.reason).not.toContain(
      "Browser intent is isolated to the Computer Use browser tool set.",
    );
  });

  it("exposes Attached Browser for the user's current Chrome page", async () => {
    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "看看我现在 Chrome 打开的这个页面",
    });

    expect(result.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining([
        "browser_attached_look",
        "browser_attached_browse",
        "browser_attached_act",
        "browser_attached_transfer",
      ]),
    );
    expect(result.toolCandidates.map((candidate) => candidate.toolId)).toEqual(
      expect.arrayContaining([
        "browser_attached_look",
        "browser_attached_browse",
        "browser_attached_act",
        "browser_attached_transfer",
      ]),
    );
  });

  it("retains Edit exposure for an attached-browser and workspace compound task", async () => {
    const result = await resolveHarnessToolCandidatesForTurn({
      source: "agent_intent",
      query: "读取我当前已登录后台的数据，然后写入工作区 Markdown",
    });

    expect(result.toolExposure.exposedToolIds).toEqual(
      expect.arrayContaining([
        "browser_attached_look",
        "browser_attached_act",
        "write",
      ]),
    );
  });
});
