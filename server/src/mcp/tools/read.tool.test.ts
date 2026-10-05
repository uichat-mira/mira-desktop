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

    expect((result.structuredContent as { type: string }).type).toBe("read");
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

  it("bounds implicit full reads and reports line continuation metadata", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "large.txt"),
      Array.from({ length: 450 }, (_, index) => `line-${index + 1}`).join("\n"),
    );

    const result = await readTool.execute({
      invocationId: "read-bounded-1",
      args: { path: "large.txt" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });

    const contents = result.structuredContent as {
      source: { text: string };
      window: {
        startLine: number;
        endLine: number;
        totalLines: number;
        truncated: boolean;
        nextStartLine?: number;
      };
    };
    expect(contents.source.text).toContain("line-400");
    expect(contents.source.text).not.toContain("line-401");
    expect(contents.window).toEqual({
      startLine: 1,
      endLine: 400,
      totalLines: 450,
      truncated: true,
      nextStartLine: 401,
    });
  });

  it("routes Office-native files out of generic read without parsing them", async () => {
    fs.writeFileSync(path.join(tempRoot, "sample.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const artifacts: unknown[] = [];
    const result = await readTool.execute({
      invocationId: "read-office-1",
      args: { path: "sample.docx" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        artifacts.push(artifact);
        return { id: "artifact-1", ...artifact };
      },
    });

    expect(result.structuredContent).toMatchObject({
      type: "unsupported",
      path: "sample.docx",
      reason: "office_owned",
      fileType: "docx",
      suggestedSkill: "docx",
    });
    expect(artifacts).toHaveLength(0);
  });

  it("decodes UTF-8 BOM and UTF-16LE text in canonical read", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "utf8-bom.txt"),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello bom", "utf8")]),
    );
    fs.writeFileSync(
      path.join(tempRoot, "utf16.txt"),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好 Mira", "utf16le")]),
    );

    const execute = async (filePath: string) =>
      await readTool.execute({
        invocationId: `read-${filePath}`,
        args: { path: filePath },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "artifact-1", ...artifact };
        },
      });

    const utf8 = await execute("utf8-bom.txt");
    expect(utf8.structuredContent).toMatchObject({
      source: { text: "hello bom", metadata: { encoding: "utf-8-bom" } },
    });

    const utf16 = await execute("utf16.txt");
    expect(utf16.structuredContent).toMatchObject({
      source: { text: "你好 Mira", metadata: { encoding: "utf-16le" } },
    });
  });

  it("returns a structured unsupported outcome for generic binary files", async () => {
    fs.writeFileSync(path.join(tempRoot, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const result = await readTool.execute({
      invocationId: "read-binary-1",
      args: { path: "blob.bin" },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "artifact-1", ...artifact };
      },
    });

    expect(result.structuredContent).toMatchObject({
      type: "unsupported",
      path: "blob.bin",
      reason: "binary",
    });
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
