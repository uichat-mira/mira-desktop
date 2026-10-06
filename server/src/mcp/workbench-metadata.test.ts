import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "./core/definitions.js";
import { withWorkbenchMetadata } from "./workbench-metadata.js";

const createBrowserTool = (id: string): ToolDefinition => ({
  id,
  title: id,
  description: id,
  domain: "browser_action",
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags: ["browser"],
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
  },
});

const createGitHubTool = (id: string): ToolDefinition => ({
  id,
  title: id,
  description: id,
  domain: "github",
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags: ["github"],
  capabilities: {
    sideEffect: "network",
    requiresApproval: false,
    networkAccess: true,
  },
});

describe("withWorkbenchMetadata", () => {
  it("projects different capability-owned product groups for the same runtime domain", () => {
    const definitions = [
      createBrowserTool("browser_observe"),
      createBrowserTool("browser_act"),
      createBrowserTool("browser_assert"),
      createBrowserTool("browser_attached_look"),
      createBrowserTool("browser_attached_browse"),
      createBrowserTool("browser_attached_act"),
      createBrowserTool("browser_attached_transfer"),
    ];

    const projected = withWorkbenchMetadata(definitions);

    expect(projected.every((tool) => tool.domain === "browser_action")).toBe(true);
    expect(
      projected
        .filter((tool) => tool.workbench?.groupId === "browser_computer_use")
        .map((tool) => tool.id),
    ).toEqual(["browser_observe", "browser_act", "browser_assert"]);
    expect(
      projected
        .filter((tool) => tool.workbench?.groupId === "browser_attached")
        .map((tool) => tool.id),
    ).toEqual([
      "browser_attached_look",
      "browser_attached_browse",
      "browser_attached_act",
      "browser_attached_transfer",
    ]);
    expect(projected.find((tool) => tool.id === "browser_observe")?.workbench).toMatchObject({
      groupLabel: "智控",
      groupOrder: 50,
    });
    expect(projected.find((tool) => tool.id === "browser_attached_look")?.workbench).toMatchObject({
      groupLabel: "触界",
      groupOrder: 60,
    });
  });

  it("uses the product label for the external expert workbench group", () => {
    const projected = withWorkbenchMetadata([
      {
        id: "ask_external_expert",
        title: "Ask External Expert",
        description: "Ask an external expert.",
        domain: "external_expert",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: [],
        capabilities: { sideEffect: "network", requiresApproval: false, networkAccess: true },
      },
    ]);

    expect(projected[0]?.workbench).toMatchObject({
      groupId: "external_expert",
      groupLabel: "问策",
      icon: "external-expert",
    });
  });

  it("uses complete registry ownership when projecting a filtered tool list", () => {
    const ownershipDefinitions = [
      createBrowserTool("browser_observe"),
      createBrowserTool("browser_act"),
      createBrowserTool("browser_assert"),
    ];

    expect(
      withWorkbenchMetadata(
        [createBrowserTool("browser_act")],
        ownershipDefinitions,
      )[0]?.workbench?.groupId,
    ).toBe("browser_computer_use");
  });

  it("registers terminal acceptance cases without changing the runtime contract", () => {
    const projected = withWorkbenchMetadata([
      {
        id: "terminal",
        title: "Terminal",
        description: "Run commands.",
        domain: "terminal",
        source: "internal",
        mode: "stream",
        inputSchema: {},
        tags: ["terminal"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
          workspaceBound: true,
          longRunning: true,
        },
      },
    ]);

    const cases = projected[0]?.workbench?.cases;
    expect(cases?.map((item) => item.id)).toEqual([
      "short-success",
      "short-failure",
      "persistent-start",
      "stale-session",
    ]);
    expect(cases?.find((item) => item.id === "persistent-start")?.args).toMatchObject({
      sessionMode: "persistent",
      timeoutMs: 700,
      outputLimitBytes: 4096,
    });
    expect(cases?.find((item) => item.id === "stale-session")?.args).toEqual({
      operation: "status",
      sessionId: "tool-lab-stale-session",
    });
  });

  it("groups exactly four GitHub domain tools and supplies operation drafts", () => {
    const projected = withWorkbenchMetadata([
      createGitHubTool("github_repository"),
      createGitHubTool("github_issue"),
      createGitHubTool("github_pull_request"),
      createGitHubTool("github_actions"),
    ]);

    expect(projected.every((tool) => tool.workbench?.groupId === "github")).toBe(true);
    expect(projected[0]?.workbench).toMatchObject({
      groupLabel: "GitHub",
      groupOrder: 50,
      icon: "github",
      defaultArgs: {
        operation: "get",
        repository: "owner/repository",
        includeReadme: true,
        commitLimit: 5,
      },
    });
    expect(projected[1]?.workbench?.defaultArgs).toMatchObject({
      operation: "list",
      repository: "owner/repository",
      state: "open",
      limit: 20,
    });
    expect(projected[2]?.workbench?.defaultArgs).toMatchObject({
      operation: "list",
      repository: "owner/repository",
      state: "open",
      limit: 20,
    });
    expect(projected[3]?.workbench?.defaultArgs).toEqual({
      operation: "list_runs",
      repository: "owner/repository",
      limit: 20,
      page: 1,
    });
  });
});
