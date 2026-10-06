import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodeGraphStudioService,
  setActiveCodeGraphStudioService,
} from "@/microapps/codegraph/index.js";
import { getTestArtifactDir } from "@/test-support/artifacts.js";
import { reconcileCodeGraphHarnessCapability } from "./codegraph-capability.js";
import { resolveHarnessToolExposure } from "./exposure.js";
import {
  clearHarnessRegistry,
  listToolDefinitions,
} from "./registry.js";
import { initializeHarnessRuntime, resetHarnessRuntime } from "./runtime.js";

const fixturePath = path.resolve(
  "src/mcp/managed-codegraph/__tests__/fixtures/fake-codegraph-provider.mjs",
);

const storageRoot = getTestArtifactDir("harness-runtime-codegraph-storage");
const appDataRoot = getTestArtifactDir("harness-runtime-codegraph-appdata");
let activeWorkspaceRoot = "";
let activeService: ReturnType<typeof createCodeGraphStudioService> | null = null;

const resetRuntime = () => {
  void activeService?.stop();
  activeService = null;
  setActiveCodeGraphStudioService(null);
  clearHarnessRegistry();
  resetHarnessRuntime();
  fs.rmSync(storageRoot, { recursive: true, force: true });
  fs.rmSync(appDataRoot, { recursive: true, force: true });
};

describe("initializeHarnessRuntime tool registration", () => {
  afterEach(resetRuntime);

  it("keeps codebase_explore registered by default", () => {
    initializeHarnessRuntime();

    expect(listToolDefinitions().map((definition) => definition.id)).toContain(
      "codebase_explore",
    );

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "请梳理 agent planner 和 tool node 的关系",
    });
    expect(decision.exposedToolIds).toContain("codebase_explore");
  });

  it("registers only canonical read tools and retires legacy read wrappers", () => {
    initializeHarnessRuntime();

    const toolIds = listToolDefinitions().map((definition) => definition.id);

    expect(toolIds).toEqual(
      expect.arrayContaining(["read", "list", "glob", "grep"]),
    );
    expect(toolIds).not.toEqual(
      expect.arrayContaining([
        "read_discover",
        "read_open",
        "read_list",
        "read_locate",
        "read_extract",
        "read_slice",
      ]),
    );
  });

  it("registers exactly four GitHub domain tools and no legacy read wrappers", () => {
    initializeHarnessRuntime();

    const githubToolIds = listToolDefinitions()
      .filter((definition) => definition.domain === "github")
      .map((definition) => definition.id)
      .sort();

    expect(githubToolIds).toEqual([
      "github_actions",
      "github_issue",
      "github_pull_request",
      "github_repository",
    ]);
    expect(githubToolIds).not.toEqual(
      expect.arrayContaining([
        "github_repo_read",
        "github_issue_read",
        "github_pr_read",
        "github_actions_status",
      ]),
    );
  });
});
