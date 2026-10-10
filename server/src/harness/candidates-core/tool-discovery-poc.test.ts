/**
 * Targeted isolation POC test for issue #243.
 *
 * This test references the real Harness Registry / Exposure / candidate
 * contract and compares:
 *   A. the current Mira baseline exposure (`resolveHarnessToolCandidatesForTurn`);
 *   B. layered capability/domain progressive disclosure;
 *   C. Tool Search as an optional resolver inside the same loop.
 *
 * The catalog is a deterministic synthetic fixture built from real Tool
 * definitions. It is NOT a live model benchmark: model token usage, provider
 * transport cost, latency, and task win-rate are out of scope and are reported
 * as not measured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ToolDefinition,
  ToolImplementation,
  ToolSideEffect,
} from "../../mcp/core/definitions.js";
import { resolveHarnessToolExposure } from "../exposure-core/index.js";
import { clearHarnessRegistry, registerTool } from "../registry.js";
import { resolveHarnessToolCandidatesForTurn } from "./resolver.js";
import {
  PROGRESSIVE_RESOLUTION_BUDGET_DEFAULT,
  ProgressiveResolutionSession,
  measureDefinitionSchemaBytes,
} from "./tool-discovery-poc.js";

const { embeddingMock, rerankMock } = vi.hoisted(() => ({
  embeddingMock: vi.fn(),
  rerankMock: vi.fn(),
}));

vi.mock("@/services/internal-capabilities/local-embedding.js", () => ({
  executeLocalEmbedding: embeddingMock,
}));

vi.mock("./rerank.js", () => ({
  rerankHarnessCapabilityMatches: rerankMock,
}));

const GOLD_MCP_TOOL_ID = "mcp:github:tool:create-pull-request";

interface CoreFixture {
  id: string;
  title: string;
  description: string;
  domain: ToolDefinition["domain"];
  tags: string[];
  sideEffect: ToolSideEffect;
  requiresApproval: boolean;
}

const CORE_FIXTURES: CoreFixture[] = [
  { id: "read", title: "Read File", description: "Read a workspace file or directory content.", domain: "read", tags: ["read", "file", "workspace", "readme", "content"], sideEffect: "none", requiresApproval: false },
  { id: "glob", title: "Glob Files", description: "Find workspace files by glob pattern.", domain: "read", tags: ["glob", "files", "pattern", "workspace", "find"], sideEffect: "none", requiresApproval: false },
  { id: "grep", title: "Grep Content", description: "Search text content across workspace files.", domain: "read", tags: ["grep", "search", "text", "workspace", "content"], sideEffect: "none", requiresApproval: false },
  { id: "list", title: "List Directory", description: "List directory entries in the workspace.", domain: "read", tags: ["list", "directory", "workspace", "entries"], sideEffect: "none", requiresApproval: false },
  { id: "codebase_explore", title: "Codebase Explore", description: "Explore codebase architecture and dependencies through CodeGraph.", domain: "read", tags: ["codebase", "architecture", "dependency", "impact", "codegraph", "explore"], sideEffect: "none", requiresApproval: false },
  { id: "write", title: "Write File", description: "Write a new workspace file.", domain: "edit", tags: ["write", "file", "workspace", "overwrite", "new"], sideEffect: "local-write", requiresApproval: true },
  { id: "edit", title: "Edit File", description: "Replace text in a workspace file.", domain: "edit", tags: ["edit", "replace", "text", "file", "workspace", "modify"], sideEffect: "local-write", requiresApproval: true },
  { id: "delete", title: "Delete Path", description: "Delete a workspace path.", domain: "edit", tags: ["delete", "remove", "file", "workspace"], sideEffect: "local-write", requiresApproval: true },
  { id: "move", title: "Move Path", description: "Move or rename a workspace path.", domain: "edit", tags: ["move", "rename", "file", "workspace"], sideEffect: "local-write", requiresApproval: true },
  { id: "apply_patch", title: "Apply Patch", description: "Apply a unified diff patch to workspace files.", domain: "edit", tags: ["patch", "diff", "apply", "workspace", "edit"], sideEffect: "local-write", requiresApproval: true },
  { id: "web_search", title: "Web Search", description: "Search the public web for current information.", domain: "web_search", tags: ["web", "search", "public", "current", "internet"], sideEffect: "network", requiresApproval: false },
  { id: "web_fetch", title: "Web Fetch", description: "Retrieve a known public URL.", domain: "web_search", tags: ["web", "fetch", "url", "retrieve", "page"], sideEffect: "network", requiresApproval: false },
  { id: "browser_observe", title: "Browser Observe", description: "Open a webpage and inspect the page title and content.", domain: "browser_action", tags: ["browser", "observe", "inspect", "read", "title", "page"], sideEffect: "network", requiresApproval: false },
  { id: "browser_act", title: "Browser Act", description: "Operate a managed browser page.", domain: "browser_action", tags: ["browser", "act", "click", "type", "submit"], sideEffect: "network", requiresApproval: false },
  { id: "browser_assert", title: "Browser Assert", description: "Assert expectations on a managed browser page.", domain: "browser_action", tags: ["browser", "assert", "verify", "expectation"], sideEffect: "none", requiresApproval: false },
  { id: "browser_attached_look", title: "Attached Browser Look", description: "Inspect the user's current connected browser page.", domain: "browser_action", tags: ["attached-browser", "current-browser", "inspect", "read", "page", "chrome", "authenticated-session"], sideEffect: "none", requiresApproval: false },
  { id: "browser_attached_browse", title: "Attached Browser Browse", description: "Navigate tabs of the user's connected browser.", domain: "browser_action", tags: ["attached-browser", "browse", "navigate", "tabs", "chrome"], sideEffect: "network", requiresApproval: false },
  { id: "browser_attached_act", title: "Attached Browser Act", description: "Operate the user's connected browser.", domain: "browser_action", tags: ["attached-browser", "act", "click", "type"], sideEffect: "network", requiresApproval: true },
  { id: "browser_attached_transfer", title: "Attached Browser Transfer", description: "Transfer data from the user's connected browser.", domain: "browser_action", tags: ["attached-browser", "transfer", "download", "copy"], sideEffect: "network", requiresApproval: true },
  { id: "terminal", title: "Terminal Session", description: "Run a local terminal command in the workspace runtime.", domain: "terminal", tags: ["terminal", "command", "shell", "process"], sideEffect: "process", requiresApproval: true },
];

const EXTERNAL_FIXTURES: Array<{
  id: string;
  title: string;
  description: string;
  tags: string[];
}> = [
  {
    id: "mcp:github:tool:list-issues",
    title: "GitHub List Issues",
    description: "List issues for a GitHub repository.",
    tags: ["github", "issues", "list"],
  },
  {
    id: "mcp:notion:tool:create-page",
    title: "Notion Create Page",
    description: "Create a Notion page document in a workspace.",
    tags: ["notion", "page", "document", "create"],
  },
];

for (let index = 0; index < 37; index += 1) {
  EXTERNAL_FIXTURES.push({
    id: `mcp:synthetic-${index}:tool:operation-${index}`,
    title: `Synthetic Operation ${index}`,
    description: `Synthetic external capability ${index} for large-catalog stress.`,
    tags: ["synthetic", `operation-${index}`],
  });
}

// Registered last so the baseline first-20 fallback (embedding unavailable)
// deterministically excludes it, reproducing the real accessibility risk.
EXTERNAL_FIXTURES.push({
  id: GOLD_MCP_TOOL_ID,
  title: "GitHub Create Pull Request",
  description: "Create a GitHub pull request for a repository branch.",
  tags: ["github", "pull-request", "create"],
});

const createTool = (input: {
  id: string;
  title: string;
  description: string;
  domain: ToolDefinition["domain"];
  source: "internal" | "external";
  tags: string[];
  sideEffect: ToolSideEffect;
  requiresApproval: boolean;
}): ToolImplementation => ({
  definition: {
    id: input.id,
    title: input.title,
    description: input.description,
    domain: input.domain,
    source: input.source,
    mode: "sync",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        pattern: { type: "string" },
        options: { type: "object", properties: { dryRun: { type: "boolean" } } },
      },
      required: ["path"],
      additionalProperties: false,
    },
    tags: input.tags,
    capabilities: {
      sideEffect: input.sideEffect,
      requiresApproval: input.requiresApproval,
      ...(input.sideEffect === "network" ? { networkAccess: true } : {}),
    },
  },
  execute: async () => ({ structuredContent: { ok: true } }),
});

const EXTERNAL_TOOL_IDS = EXTERNAL_FIXTURES.map((fixture) => fixture.id);

const registerFixtures = () => {
  for (const fixture of CORE_FIXTURES) {
    registerTool(
      createTool({
        id: fixture.id,
        title: fixture.title,
        description: fixture.description,
        domain: fixture.domain,
        source: "internal",
        tags: fixture.tags,
        sideEffect: fixture.sideEffect,
        requiresApproval: fixture.requiresApproval,
      }),
    );
  }
  for (const fixture of EXTERNAL_FIXTURES) {
    registerTool(
      createTool({
        id: fixture.id,
        title: fixture.title,
        description: fixture.description,
        domain: "external_mcp",
        source: "external",
        tags: fixture.tags,
        sideEffect: "network",
        requiresApproval: true,
      }),
    );
  }
};

const createSession = (options?: {
  editFacade?: "primitives" | "apply_patch" | "all";
  resolutionBudget?: number;
  eagerToolIds?: string[];
  unavailableCapabilityIds?: string[];
  unavailableToolIds?: string[];
  allowExternal?: boolean;
}) =>
  new ProgressiveResolutionSession({
    exposure: {
      source: "agent_intent",
      ...(options?.editFacade ? { editFacade: options.editFacade } : {}),
      allowExternal: options?.allowExternal ?? false,
      allowedExternalToolIds: options?.allowExternal ? EXTERNAL_TOOL_IDS : [],
    },
    ...(options?.resolutionBudget !== undefined
      ? { resolutionBudget: options.resolutionBudget }
      : {}),
    ...(options?.eagerToolIds ? { eagerToolIds: options.eagerToolIds } : {}),
    ...(options?.unavailableCapabilityIds
      ? { unavailableCapabilityIds: options.unavailableCapabilityIds }
      : {}),
    ...(options?.unavailableToolIds
      ? { unavailableToolIds: options.unavailableToolIds }
      : {}),
  });

const ORACLE = [
  { prompt: "read the workspace README file", capabilityId: "workspace_lookup", goldToolId: "read" },
  { prompt: "replace text in a workspace file", capabilityId: "workspace_edit", goldToolId: "edit" },
  { prompt: "explore the codebase architecture and dependencies", capabilityId: "codebase_understanding", goldToolId: "codebase_explore" },
  { prompt: "search the web for current information", capabilityId: "web", goldToolId: "web_search" },
  { prompt: "open a webpage and read the title", capabilityId: "browser_computer_use", goldToolId: "browser_observe" },
  { prompt: "inspect my current chrome authenticated page", capabilityId: "browser_attached", goldToolId: "browser_attached_look" },
];

describe("#243 progressive tool discovery POC", () => {
  beforeEach(() => {
    clearHarnessRegistry();
    embeddingMock.mockReset();
    rerankMock.mockReset();
    registerFixtures();
  });

  afterEach(() => {
    clearHarnessRegistry();
  });

  describe("A. current Mira baseline (real resolver)", () => {
    it("exposes the whole eligible set without ranking when the public set is <= 20", async () => {
      embeddingMock.mockRejectedValue(new Error("ranking must not run"));

      const result = await resolveHarnessToolCandidatesForTurn({
        query: "anything",
        source: "agent_intent",
      });

      expect(embeddingMock).not.toHaveBeenCalled();
      expect(result.toolExposure.exposedToolIds).not.toContain("apply_patch");
      expect(result.toolExposure.exposedToolIds.length).toBeLessThanOrEqual(20);
      expect(result.toolExposure.exposedToolIds).toContain("read");
    });

    it("ranks and exposes exactly 20 when the public set exceeds 20", async () => {
      embeddingMock.mockImplementation(async ({ texts }: { texts: string[] }) => ({
        embeddings: texts.map(() => [1, 0]),
        embeddingModel: "controlled-test-embedding",
        embeddingModelConfigId: "controlled-test-embedding-config",
      }));
      rerankMock.mockImplementation(
        async ({ matches }: { matches: Array<{ capabilityId: string }> }) => ({
          matches: matches
            .map((match) => ({
              ...match,
              rerankScore: match.capabilityId === GOLD_MCP_TOOL_ID ? 0.99 : 0.1,
              finalScore: match.capabilityId === GOLD_MCP_TOOL_ID ? 0.99 : 0.1,
            }))
            .sort((left, right) => right.finalScore - left.finalScore),
          rerankModel: { model: "controlled-test-rerank" },
        }),
      );

      const result = await resolveHarnessToolCandidatesForTurn({
        query: "create github pull request",
        source: "agent_intent",
        allowExternal: true,
        allowedExternalToolIds: EXTERNAL_TOOL_IDS,
      });

      expect(result.toolExposure.exposedToolIds).toHaveLength(20);
      expect(result.toolExposure.exposedToolIds).toContain(GOLD_MCP_TOOL_ID);
      expect(result.toolCandidates[0]?.toolId).toBe(GOLD_MCP_TOOL_ID);
      expect(
        measureDefinitionSchemaBytes(result.toolExposure.exposedDefinitions),
      ).toBeGreaterThan(0);
    });

    it("records the real first-20 fallback risk when embedding is unavailable", async () => {
      embeddingMock.mockRejectedValue(new Error("embedding unavailable"));

      const result = await resolveHarnessToolCandidatesForTurn({
        query: "create github pull request",
        source: "agent_intent",
        allowExternal: true,
        allowedExternalToolIds: EXTERNAL_TOOL_IDS,
      });

      expect(result.retrievalError).toBe("embedding unavailable");
      expect(result.toolExposure.exposedToolIds).toHaveLength(20);
      expect(result.toolExposure.exposedToolIds).not.toContain(GOLD_MCP_TOOL_ID);
      expect(result.toolExposure.exposedToolIds).toContain("read");
    });
  });

  describe("B. layered capability progressive disclosure", () => {
    it("starts from a coarse catalog and never leaks schemas before disclosure", () => {
      const session = createSession();
      const catalog = session.compactCatalog();

      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.every((entry) => !("inputSchema" in entry))).toBe(true);
      expect(session.state.schemaDeclaredToolIds).toEqual([]);
      expect(session.initialContextBytes()).toBeGreaterThan(0);
    });

    it("discloses tool metadata and schema in separate budgeted steps", () => {
      const session = createSession();

      const capability = session.resolveCapability("replace text in a workspace file");
      expect(capability.outcome).toBe("disclosed");
      expect(capability.capability?.capabilityId).toBe("workspace_edit");
      expect(capability.schemaDeclaredTool).toBeUndefined();
      expect(capability.tools.map((tool) => tool.toolId).sort()).toEqual([
        "delete",
        "edit",
        "move",
        "write",
      ]);
      expect(capability.state.resolutionStepsUsed).toBe(1);
      // preferredToolId-style metadata must not silently declare or execute a
      // concrete action; only an explicit further resolve step declares schema.
      expect(capability.state.schemaDeclaredToolIds).toEqual([]);
      expect(capability.state.disclosedCapabilityIds).toEqual(["workspace_edit"]);

      const declared = session.declareToolSchema("edit");
      expect(declared.outcome).toBe("disclosed");
      expect(declared.schemaDeclaredTool?.toolId).toBe("edit");
      expect(declared.schemaDeclaredTool?.declarationOnly).toBe(true);
      expect(declared.schemaDeclaredTool?.inputSchema).toBeTruthy();
      expect("execute" in (declared.schemaDeclaredTool ?? {})).toBe(false);
      expect(declared.state.resolutionStepsUsed).toBe(2);
      expect(session.disclosedContextBytes()).toBeGreaterThanOrEqual(
        session.initialContextBytes(),
      );
    });

    it("selectively materializes one Workspace Edit facade without losing the capability", () => {
      const primitives = createSession({ editFacade: "primitives" });
      const patch = createSession({ editFacade: "apply_patch" });

      const primitiveTools = primitives
        .resolveCapability("replace text in a workspace file")
        .tools.map((tool) => tool.toolId)
        .sort();
      const patchTools = patch
        .resolveCapability("replace text in a workspace file")
        .tools.map((tool) => tool.toolId)
        .sort();

      expect(primitiveTools).toEqual(["delete", "edit", "move", "write"]);
      expect(patchTools).toEqual(["apply_patch"]);
      expect(primitives.compactCatalog().some((entry) => entry.capabilityId === "workspace_edit")).toBe(true);
      expect(patch.compactCatalog().some((entry) => entry.capabilityId === "workspace_edit")).toBe(true);
    });

    it("records a combined compact-catalog -> Tool Search -> concrete schema path", () => {
      const session = createSession({ editFacade: "apply_patch" });

      const capability = session.resolveCapability("replace text in a workspace file");
      expect(capability.outcome).toBe("disclosed");
      expect(capability.capability?.capabilityId).toBe("workspace_edit");

      const search = session.searchTools("apply a patch to the workspace file", {
        capabilityId: "workspace_edit",
      });
      expect(search.searchCandidates?.[0]?.toolId).toBe("apply_patch");

      const declared = session.declareToolSchema("apply_patch");
      expect(declared.schemaDeclaredTool?.toolId).toBe("apply_patch");
      expect(declared.schemaDeclaredTool?.declarationOnly).toBe(true);
      expect(session.state.schemaDeclaredToolIds).toContain("apply_patch");
    });

    it("keeps genuinely eager core schemas out of the resolution budget", () => {
      const session = createSession({
        eagerToolIds: ["read", "write", "edit", "terminal", "web_search"],
      });

      expect(session.state.schemaDeclaredToolIds).toEqual(
        expect.arrayContaining(["read", "write", "edit", "terminal", "web_search"]),
      );

      const declared = session.declareToolSchema("read");
      expect(declared.outcome).toBe("already_disclosed");
      expect(declared.consumedResolutionStep).toBe(false);
      expect(session.state.resolutionStepsUsed).toBe(0);
    });
  });

  describe("C. Tool Search resolver", () => {
    it("resolves a concrete tool from a large dynamic catalog when authorized", () => {
      const session = createSession({ allowExternal: true });

      const result = session.searchTools("create a github pull request for the repo");

      expect(result.outcome).toBe("disclosed");
      expect(result.searchCandidates?.[0]?.toolId).toBe(GOLD_MCP_TOOL_ID);
      expect(result.consumedResolutionStep).toBe(true);
      expect(result.schemaDeclaredTool).toBeUndefined();

      const declared = session.declareToolSchema(GOLD_MCP_TOOL_ID);
      expect(declared.outcome).toBe("disclosed");
      expect(declared.schemaDeclaredTool?.declarationOnly).toBe(true);
      expect(declared.schemaDeclaredTool?.source).toBe("external");
    });

    it("is idempotent and does not consume budget for already-disclosed candidates", () => {
      const session = createSession({ allowExternal: true });

      const first = session.searchTools("create a github pull request for the repo");
      expect(first.consumedResolutionStep).toBe(true);
      const stepsAfterFirst = session.state.resolutionStepsUsed;

      const second = session.searchTools("create a github pull request for the repo");
      expect(second.outcome).toBe("already_disclosed");
      expect(second.consumedResolutionStep).toBe(false);
      expect(session.state.resolutionStepsUsed).toBe(stepsAfterFirst);
    });

    it("produces a reproducible selection accuracy across the oracle prompts", () => {
      const layeredReachable: boolean[] = [];
      const toolSearchHits: boolean[] = [];

      for (const entry of ORACLE) {
        const layeredSession = createSession();
        const resolved = layeredSession.resolveCapability(entry.prompt);
        expect(resolved.capability?.capabilityId).toBe(entry.capabilityId);
        layeredReachable.push(
          resolved.tools.some((tool) => tool.toolId === entry.goldToolId),
        );

        const searchSession = createSession();
        const searched = searchSession.searchTools(entry.prompt);
        toolSearchHits.push(
          searched.searchCandidates?.[0]?.toolId === entry.goldToolId,
        );
      }

      expect(layeredReachable.every(Boolean)).toBe(true);
      expect(toolSearchHits.every(Boolean)).toBe(true);
      expect(layeredReachable).toHaveLength(ORACLE.length);
      expect(toolSearchHits).toHaveLength(ORACLE.length);
    });
  });

  describe("negative paths and governance separation", () => {
    it("returns not_found for an unknown capability without consuming budget", () => {
      const session = createSession();
      const result = session.resolveCapability("quantum entanglement telemetry chassis");

      expect(result.outcome).toBe("not_found");
      expect(result.consumedResolutionStep).toBe(false);
      expect(session.state.resolutionStepsUsed).toBe(0);
    });

    it("captures the baseline wrong/missing selection risk and recovers through progressive disclosure", async () => {
      embeddingMock.mockRejectedValue(new Error("embedding unavailable"));

      const degraded = await resolveHarnessToolCandidatesForTurn({
        query: "create github pull request",
        source: "agent_intent",
        allowExternal: true,
        allowedExternalToolIds: EXTERNAL_TOOL_IDS,
      });

      // Baseline degradation: the actionable tool is silently absent, so a
      // planner could pick the wrong or no tool with no way to tell.
      expect(degraded.retrievalError).toBe("embedding unavailable");
      expect(degraded.toolExposure.exposedToolIds).not.toContain(GOLD_MCP_TOOL_ID);

      const session = createSession({ allowExternal: true });
      const resolved = session.resolveCapability("create github pull request");
      expect(resolved.outcome).toBe("disclosed");
      expect(resolved.capability?.capabilityId).toBe(GOLD_MCP_TOOL_ID);

      const declared = session.declareToolSchema(GOLD_MCP_TOOL_ID);
      expect(declared.outcome).toBe("disclosed");
      expect(session.state.schemaDeclaredToolIds).toContain(GOLD_MCP_TOOL_ID);
    });

    it("marks registered-but-unauthorized MCP tools as not_authorized and never declares a schema", () => {
      const session = createSession({ allowExternal: false });

      const result = session.resolveCapability("create github pull request");
      expect(result.outcome).toBe("not_authorized");
      expect(result.consumedResolutionStep).toBe(false);

      const declared = session.declareToolSchema(GOLD_MCP_TOOL_ID);
      expect(declared.outcome).toBe("not_authorized");
      expect(declared.schemaDeclaredTool).toBeUndefined();
      expect(session.state.schemaDeclaredToolIds).not.toContain(GOLD_MCP_TOOL_ID);
    });

    it("marks a degraded runtime as unavailable rather than not_found", () => {
      const session = createSession({ unavailableCapabilityIds: ["browser_attached"] });

      const result = session.resolveCapability("inspect my current chrome authenticated page");
      expect(result.outcome).toBe("unavailable");
      expect(result.consumedResolutionStep).toBe(false);

      const declared = session.declareToolSchema("browser_attached_look");
      expect(declared.outcome).toBe("unavailable");
    });

    it("keeps MCP-adapted and native tools on the same governance path", () => {
      const exposure = resolveHarnessToolExposure({
        source: "agent_intent",
        allowExternal: true,
        allowedExternalToolIds: EXTERNAL_TOOL_IDS,
      });

      const exposedIds = new Set(exposure.exposedToolIds);
      expect(exposedIds.has("edit")).toBe(true);
      expect(exposedIds.has(GOLD_MCP_TOOL_ID)).toBe(true);

      const externalDefinition = exposure.exposedDefinitions.find(
        (definition) => definition.id === GOLD_MCP_TOOL_ID,
      );
      expect(externalDefinition?.source).toBe("external");
      expect(externalDefinition?.capabilities.requiresApproval).toBe(true);

      const nativeDefinition = exposure.exposedDefinitions.find(
        (definition) => definition.id === "edit",
      );
      expect(nativeDefinition?.source).toBe("internal");
      expect(nativeDefinition?.capabilities.requiresApproval).toBe(true);
    });
  });

  describe("resolution budget", () => {
    it("defaults to 8 and is configurable without changing Tool semantics", () => {
      expect(PROGRESSIVE_RESOLUTION_BUDGET_DEFAULT).toBe(8);

      const custom = createSession({ resolutionBudget: 3 });
      expect(custom.state.resolutionBudget).toBe(3);
      expect(custom.state.resolutionBudgetRemaining).toBe(3);
    });

    it("consumes the budget only for additional disclosure and never implies completion", () => {
      const session = createSession({ allowExternal: true });

      const distinct = [
        "read the workspace README file",
        "replace text in a workspace file",
        "explore the codebase architecture and dependencies",
        "search the web for current information",
        "open a webpage and read the title",
        "inspect my current chrome authenticated page",
        "run a terminal command shell",
        "create github pull request",
      ];

      for (const prompt of distinct) {
        const result = session.resolveCapability(prompt);
        expect(result.outcome).toBe("disclosed");
        expect(result.consumedResolutionStep).toBe(true);
      }

      expect(session.state.resolutionStepsUsed).toBe(8);
      expect(session.state.resolutionBudgetRemaining).toBe(0);
      expect(session.state.disclosedToolIds.length).toBeGreaterThan(0);
      expect(session.state.disclosedCapabilityIds).toHaveLength(8);

      const reResolve = session.resolveCapability("read the workspace README file");
      expect(reResolve.outcome).toBe("already_disclosed");
      expect(reResolve.consumedResolutionStep).toBe(false);
      expect(session.state.resolutionStepsUsed).toBe(8);

      const overflow = session.resolveCapability("create notion page document");
      expect(overflow.outcome).toBe("budget_exhausted");
      expect(overflow.consumedResolutionStep).toBe(false);
      expect(session.state.resolutionStepsUsed).toBe(8);
      expect(session.state.disclosedToolIds.length).toBeGreaterThan(0);
    });
  });
});
