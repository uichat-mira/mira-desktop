import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { readListTool } from "./read-list.tool.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-read-list-tool");

describe("read_list tool", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tempRoot, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "docs", "a.txt"), "hello");
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("lists workspace directories", async () => {
    const events: string[] = [];
    const artifacts: unknown[] = [];

    const result = await readListTool.execute({
      invocationId: "read-list-1",
      args: { path: "docs" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        events.push(event.type === "invocation:progress" ? event.message : event.type);
      },
      addArtifact(artifact) {
        artifacts.push(artifact);
        return { id: "artifact-1", ...artifact };
      },
    });

    expect((result.structuredContent as { type: string }).type).toBe("list");
    expect((result.structuredContent as { entries: Array<{ name: string }> }).entries[0]?.name).toBe("a.txt");
    expect(events[0]).toContain("Directory listing plan");
    expect(artifacts).toHaveLength(1);
  });

  it("rejects missing path", async () => {
    await expect(
      readListTool.execute({
        invocationId: "read-list-2",
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
});
