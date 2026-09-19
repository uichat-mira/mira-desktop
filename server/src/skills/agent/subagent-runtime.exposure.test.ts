import { afterEach, describe, expect, it } from "vitest";
import {
  clearHarnessRegistry,
  registerCapability,
} from "@/harness/registry.js";
import {
  githubActionsTool,
  githubIssueTool,
  githubPullRequestTool,
  githubRepositoryTool,
} from "@/mcp/tools/github-domain.tool.js";
import type { SkillContext, SkillPackageOrigin } from "@/skills/context/types.js";
import {
  prepareSubAgent,
  resolveSkillResourceRequest,
  resolveSubAgentHarnessToolIds,
} from "./subagent-runtime.js";
import { projectProviderVisibleToolSchema as projectPiProviderVisibleToolSchema } from "./pi-core.js";

const githubTools = [
  "github_repository",
  "github_issue",
  "github_pull_request",
  "github_actions",
];

const createGitHubSkillContext = (
  origin: SkillPackageOrigin,
  withResource = false,
): SkillContext => ({
  instruction: "Use the GitHub collaboration Skill.",
  primary: {
    id: "github-collaboration",
    version: "0.1.0",
    name: "GitHub 协作",
    body: "Inspect the requested repository using governed GitHub tools.",
    origin,
    execution: {
      context: "fork",
      agent: "subAgent",
      allowedTools: githubTools,
      runtimeBindings: [],
      workspaceBound: false,
    },
  },
  resources: withResource
    ? [
        {
          uri: "skill://github-collaboration/references/project-pulse.md",
          skillId: "github-collaboration",
          name: "project-pulse.md",
          kind: "reference",
        },
      ]
    : [],
  disclosedResources: [],
  match: {
    source: "explicit",
    reason: "Explicit Skill invocation",
    score: 1,
    secondarySkillIds: [],
  },
});

const registerGitHubTools = () => {
  registerCapability(githubRepositoryTool);
  registerCapability(githubIssueTool);
  registerCapability(githubPullRequestTool);
  registerCapability(githubActionsTool);
};

afterEach(() => {
  clearHarnessRegistry();
});

describe("resolveSubAgentHarnessToolIds", () => {
  it("lets a built-in Skill select its declared subAgent tools", () => {
    expect(
      resolveSubAgentHarnessToolIds({
        origin: "built-in",
        declaredToolIds: githubTools,
        canonicalToolIds: [],
      }),
    ).toEqual(githubTools);
  });

  it("still preserves canonical exposure without duplicating tools", () => {
    expect(
      resolveSubAgentHarnessToolIds({
        origin: "built-in",
        declaredToolIds: githubTools,
        canonicalToolIds: ["github_repository", "read_open"],
      }),
    ).toEqual([
      "github_repository",
      "read_open",
      "github_issue",
      "github_pull_request",
      "github_actions",
    ]);
  });

  it.each(["user", "external"] as const)(
    "does not grant declared tools to a %s Skill",
    (origin) => {
      expect(
        resolveSubAgentHarnessToolIds({
          origin,
          declaredToolIds: githubTools,
          canonicalToolIds: ["github_repository"],
        }),
      ).toEqual(["github_repository"]);
    },
  );
});

describe("Skill resource request resolution", () => {
  const availableUris = [
    "skill://wechat-post-craft/references/writing-guide.md",
    "skill://wechat-post-craft/templates/article-outline.md",
  ];

  it.each([
    [
      "skill://wechat-post-craft/references/writing-guide.md",
      "skill://wechat-post-craft/references/writing-guide.md",
    ],
    [
      "references/writing-guide.md",
      "skill://wechat-post-craft/references/writing-guide.md",
    ],
    [
      "./references/writing-guide.md",
      "skill://wechat-post-craft/references/writing-guide.md",
    ],
    [
      "writing-guide.md",
      "skill://wechat-post-craft/references/writing-guide.md",
    ],
  ])("resolves %s to the canonical active-Skill URI", (requested, uri) => {
    expect(
      resolveSkillResourceRequest({
        skillId: "wechat-post-craft",
        requested,
        availableUris,
      }),
    ).toEqual({ status: "resolved", uri });
  });

  it("rejects cross-Skill resource access without resolving it", () => {
    expect(
      resolveSkillResourceRequest({
        skillId: "wechat-post-craft",
        requested: "skill://wechat-article-layout/scripts/build_wechat_html.py",
        availableUris,
      }),
    ).toMatchObject({
      status: "rejected",
      requested: "skill://wechat-article-layout/scripts/build_wechat_html.py",
      availableUris,
    });
  });

  it("returns a recoverable not_found result for an unavailable resource", () => {
    expect(
      resolveSkillResourceRequest({
        skillId: "wechat-post-craft",
        requested: "references/missing.md",
        availableUris,
      }),
    ).toMatchObject({
      status: "not_found",
      requested: "references/missing.md",
      availableUris,
    });
  });
});

describe("prepareSubAgent GitHub exposure", () => {
  it("binds registered GitHub tools without a fake resource reader when the Skill has no resources", () => {
    registerGitHubTools();

    const prepared = prepareSubAgent({
      goal: "Inspect dangjingtao/uichat-mira",
      skillContext: createGitHubSkillContext("built-in"),
      exposedHarnessToolIds: [],
    });

    expect(prepared.tools.map((tool) => tool.id)).toEqual(githubTools);
    expect(prepared.availableCapabilityCount).toBe(4);
    expect(prepared.missingCapabilities).toEqual([]);
  });

  it("preserves the parent AgentRun cancellation signal in subAgent execution", () => {
    registerGitHubTools();
    const controller = new AbortController();

    const prepared = prepareSubAgent({
      goal: "Inspect dangjingtao/uichat-mira",
      skillContext: createGitHubSkillContext("built-in"),
      exposedHarnessToolIds: [],
      signal: controller.signal,
    });

    expect(prepared.execution.signal).toBe(controller.signal);
    controller.abort();
    expect(prepared.execution.signal?.aborted).toBe(true);
  });

  it("adds the resource reader only when the active Skill actually has resources", () => {
    registerGitHubTools();

    const prepared = prepareSubAgent({
      goal: "Inspect dangjingtao/uichat-mira",
      skillContext: createGitHubSkillContext("built-in", true),
      exposedHarnessToolIds: [],
    });

    expect(prepared.tools.map((tool) => tool.id)).toEqual([
      "skill_read_resource",
      ...githubTools,
    ]);
  });

  it("returns a recoverable tool result instead of throwing for a missing resource", async () => {
    const prepared = prepareSubAgent({
      goal: "Read the writing guide",
      skillContext: createGitHubSkillContext("built-in", true),
      exposedHarnessToolIds: [],
    });
    const resourceTool = prepared.tools.find(
      (tool) => tool.id === "skill_read_resource",
    );
    expect(resourceTool).toBeDefined();

    const executed = await resourceTool!.execute({
      uri: "references/missing.md",
    });

    expect(executed.result).toMatchObject({
      status: "not_found",
      requested: "references/missing.md",
      availableUris: [
        "skill://github-collaboration/references/project-pulse.md",
      ],
    });
    expect(executed.evidence).toBeUndefined();
  });

  it("binds the canonical oneOf schema before provider-specific projection", () => {
    registerGitHubTools();

    const prepared = prepareSubAgent({
      goal: "Write a file to dangjingtao/uichat-mira",
      skillContext: createGitHubSkillContext("built-in"),
      exposedHarnessToolIds: [],
    });
    const repositoryTool = prepared.tools.find(
      (tool) => tool.id === "github_repository",
    );
    const schema = repositoryTool?.inputSchema as Record<string, unknown>;

    expect(schema).toBe(githubRepositoryTool.definition.inputSchema);
    expect(schema).toHaveProperty("oneOf");
    expect(githubRepositoryTool.definition.inputSchemaByExposure?.agent_intent).toBeUndefined();
  });

  it("does not let a user Skill grant itself GitHub tools", () => {
    registerGitHubTools();

    const prepared = prepareSubAgent({
      goal: "Inspect dangjingtao/uichat-mira",
      skillContext: createGitHubSkillContext("user"),
      exposedHarnessToolIds: [],
    });

    expect(prepared.tools.map((tool) => tool.id)).toEqual([]);
    expect(prepared.availableCapabilityCount).toBe(0);
    expect(prepared.missingCapabilities).toHaveLength(4);
  });
});

describe("Ark Plan provider-visible schemas", () => {
  const composedSchema = {
    oneOf: [
      {
        type: "object",
        required: ["operation", "repository"],
        properties: { operation: { const: "get" }, repository: { type: "string" } },
      },
      {
        type: "object",
        required: ["operation", "repository"],
        properties: {
          operation: { const: "list_commits" },
          repository: { type: "string" },
          limit: { type: "integer" },
        },
      },
    ],
  };

  it("projects composition only for Ark Plan while preserving every variant field", () => {
    expect(
      projectPiProviderVisibleToolSchema({
        schema: composedSchema,
        projectComplexToolSchemas: true,
      }),
    ).toEqual({
      type: "object",
      additionalProperties: true,
      required: ["operation", "repository"],
      properties: {
        operation: {
          type: "string",
          enum: ["get", "list_commits"],
          description:
            "Selects the operation-specific runtime contract. Supply the fields required by that operation.",
        },
        repository: { type: "string" },
        limit: { type: "integer" },
      },
    });
    expect(composedSchema).toHaveProperty("oneOf");
    expect(
      projectPiProviderVisibleToolSchema({
        schema: composedSchema,
        projectComplexToolSchemas: false,
      }),
    ).toBe(composedSchema);
  });

  it("retains GitHub write fields in the Ark-only compatibility projection", () => {
    const projected = projectPiProviderVisibleToolSchema({
      schema: githubRepositoryTool.definition.inputSchema,
      projectComplexToolSchemas: true,
    });
    const properties = projected.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(projected).not.toHaveProperty("oneOf");
    expect(properties.operation.enum).toEqual(
      expect.arrayContaining([
        "create",
        "write_file",
        "ensure_installation_access",
        "get_pages",
        "configure_pages",
      ]),
    );
    expect(properties).toMatchObject({
      repository: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
      commitMessage: { type: "string" },
      branch: { type: "string" },
      owner: { type: "string" },
      name: { type: "string" },
      visibility: { type: "string" },
      mode: { type: "string" },
    });

    expect(githubRepositoryTool.definition.inputSchema).toHaveProperty("oneOf");
  });
});
