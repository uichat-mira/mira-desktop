import { describe, expect, it } from "vitest";
import { resolveSubAgentExecutionProfile } from "./profiles.js";

describe("resolveSubAgentExecutionProfile", () => {
  it("creates exactly one pure-instruction subAgent profile for an arbitrary Skill", () => {
    const profile = resolveSubAgentExecutionProfile({
      id: "decision-review",
      execution: {
        context: "fork",
        agent: "subAgent",
        allowedTools: [],
        runtimeBindings: [],
        workspaceBound: false,
      },
    });

    expect(profile).toEqual({
      skillId: "decision-review",
      mode: "forked-agent",
      engine: "pi-agent-core",
      allowedHarnessToolIds: [],
      runtimeBindings: [],
      workspaceBound: false,
    });
  });

  it("keeps declared Harness tools as requirements without changing their identity", () => {
    const profile = resolveSubAgentExecutionProfile({
      id: "github-collaboration",
      execution: {
        context: "fork",
        agent: "subAgent",
        allowedTools: [
          "github_repository",
          "github_issue",
          "github_pull_request",
          "github_actions",
        ],
        runtimeBindings: [],
        workspaceBound: false,
      },
    });

    expect(profile.allowedHarnessToolIds).toEqual([
      "github_repository",
      "github_issue",
      "github_pull_request",
      "github_actions",
    ]);
    expect(profile.runtimeBindings).toEqual([]);
  });

  it("preserves the existing Office private-runtime boundary", () => {
    const profile = resolveSubAgentExecutionProfile("docx");

    expect(profile.skillId).toBe("docx");
    expect(profile.workspaceBound).toBe(true);
    expect(profile.allowedHarnessToolIds).toEqual(["read_open", "read_extract"]);
    expect(profile.runtimeBindings).toEqual([
      expect.objectContaining({
        id: "office_document",
        kind: "skill-private-runtime",
        status: "ready",
      }),
    ]);
  });

  it("merges the Office read surface into a Scanner-derived runtime declaration", () => {
    const profile = resolveSubAgentExecutionProfile({
      id: "docx",
      execution: {
        context: "fork",
        agent: "subAgent",
        allowedTools: [],
        runtimeBindings: ["office_document"],
        workspaceBound: true,
      },
    });

    expect(profile.allowedHarnessToolIds).toEqual(["read_open", "read_extract"]);
    expect(profile.runtimeBindings).toEqual([
      expect.objectContaining({ id: "office_document", status: "ready" }),
    ]);
  });

  it("marks unknown private runtimes pending instead of granting execution", () => {
    const profile = resolveSubAgentExecutionProfile({
      id: "custom-runtime-skill",
      execution: {
        context: "fork",
        agent: "subAgent",
        allowedTools: [],
        runtimeBindings: ["unknown_private_runtime"],
        workspaceBound: true,
      },
    });

    expect(profile.runtimeBindings).toEqual([
      expect.objectContaining({
        id: "unknown_private_runtime",
        status: "pending",
      }),
    ]);
  });
});
