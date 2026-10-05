import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { grepTool } from "./grep.tool.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "grep-tool");

describe("grep tool", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "src", "planner.ts"),
      "const answerReadiness = true;\nexport { answerReadiness };\n",
    );
    fs.writeFileSync(path.join(tempRoot, "src", "notes.md"), "answerReadiness notes\n");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("searches workspace content through the canonical grep runtime", async () => {
    const artifactMetadata: Array<Record<string, unknown> | undefined> = [];
    const result = await grepTool.execute({
      invocationId: "grep-1",
      args: {
        pattern: "answerReadiness",
        root: "src",
        extensions: ["ts"],
        maxResults: 10,
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        artifactMetadata.push(artifact.metadata);
        return { id: "artifact-1", ...artifact };
      },
    });

    const output = result.structuredContent as {
      type: string;
      pattern: string;
      matches: Array<{ path: string; line: number; column: number }>;
    };

    expect(output.type).toBe("grep");
    expect(output.pattern).toBe("answerReadiness");
    expect(output.matches).toEqual([
      expect.objectContaining({
        path: "src/planner.ts",
        line: 1,
        column: 7,
      }),
    ]);
    expect(artifactMetadata[0]).toEqual(
      expect.objectContaining({
        pattern: "answerReadiness",
        root: "src",
        provider: expect.stringMatching(/ripgrep|node-content-scan/),
      }),
    );
  });

  it("keeps the existing Planner-facing input contract", () => {
    expect(grepTool.definition.inputSchema).toEqual(
      expect.objectContaining({
        required: ["pattern"],
        additionalProperties: false,
        properties: expect.objectContaining({
          pattern: { type: "string" },
          root: { type: "string" },
          extensions: { type: "array", items: { type: "string" } },
          maxResults: { type: "integer", minimum: 1, maximum: 100 },
        }),
      }),
    );
    expect(Object.keys(grepTool.definition.inputSchema.properties ?? {})).toEqual([
      "pattern",
      "root",
      "extensions",
      "maxResults",
    ]);
  });

  it("rejects a missing pattern", async () => {
    await expect(
      grepTool.execute({
        invocationId: "grep-2",
        args: {},
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "artifact-1", ...artifact };
        },
      }),
    ).rejects.toThrow("pattern is required");
  });
});
