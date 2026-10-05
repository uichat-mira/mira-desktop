import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearHarnessRegistry } from "../../harness/registry.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { readTool } from "./read.tool.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-read-tool");

describe("read tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearHarnessRegistry();
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearHarnessRegistry();
    clearWorkspaceSelection();
  });

  it("reads a workspace file with path-only input", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.log"), "hello read tool");

    const artifacts: unknown[] = [];
    const events: string[] = [];
    const result = await readTool.execute({
      invocationId: "read-1",
      args: {
        path: "notes.log",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        events.push(event.type);
      },
      addArtifact(artifact) {
        artifacts.push(artifact);
        return { id: "artifact-1", ...artifact };
      },
    });

    expect((result.structuredContent as { type: string }).type).toBe("open");
    expect((result.structuredContent as { source: { text: string } }).source.text).toContain("hello read tool");
    expect(artifacts).toHaveLength(1);
    expect(events).toContain("invocation:progress");
  });

  it("rejects empty path input", async () => {
    await expect(
      readTool.execute({
        invocationId: "read-2",
        args: {},
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "artifact-1", ...artifact };
        },
      }),
    ).rejects.toThrow("path is required");
  });

  it("is the canonical read tool rather than a compatibility alias", () => {
    expect(readTool.definition.id).toBe("read");
    expect(readTool.definition.description).not.toContain("Compatibility alias");
    expect(readTool.definition.tags).not.toContain("alias");
  });

  it("rejects execution without harness environment", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.log"), "hello read tool");

    await expect(
      readTool.execute({
        invocationId: "read-4",
        args: {
          path: "notes.log",
        },
        signal: new AbortController().signal,
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "artifact-1", ...artifact };
        },
      }),
    ).rejects.toThrow("Read execution requires a harness environment snapshot");
  });
});
