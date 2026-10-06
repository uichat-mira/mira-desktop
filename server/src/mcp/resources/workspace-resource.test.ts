import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { workspaceResource } from "./workspace-resource.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-mcp-read");

describe("workspace resource", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
  });

  it("reads directories and text files", async () => {
    fs.mkdirSync(path.join(tempRoot, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "docs", "a.txt"), "hello");
    fs.writeFileSync(path.join(tempRoot, "docs", "app.log"), "line one\nline two");
    fs.writeFileSync(path.join(tempRoot, "docs", "notes"), "plain text without extension");

    const dirEvents: string[] = [];
    const dirResult = await workspaceResource.read!({
      args: { path: "docs" },
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event) {
        dirEvents.push(event.type === "invocation:progress" ? event.message : event.type);
      },
    });
    expect((dirResult.contents as { type: string }).type).toBe("list");
    const dirEntries = (
      dirResult.contents as { entries: Array<{ name: string; type: string }> }
    ).entries;
    expect(dirEntries.find((entry) => entry.name === "a.txt")).toMatchObject({
      name: "a.txt",
      type: "file",
    });
    expect(dirEvents[0]).toContain("List plan:");

    const fileResult = await workspaceResource.read!({
      args: { path: "docs/a.txt" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((fileResult.contents as { source: { text: string } }).source.text).toContain("hello");
    expect(
      (fileResult.contents as { source: { metadata: { encoding: string } } }).source.metadata
        .encoding,
    ).toBe("utf-8");

    const logResult = await workspaceResource.read!({
      args: { path: "docs/app.log" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((logResult.contents as { source: { text: string } }).source.text).toContain("line one");
    expect(
      (logResult.contents as { source: { metadata: { encoding: string } } }).source.metadata
        .encoding,
    ).toBe("utf-8");

    const extensionlessResult = await workspaceResource.read!({
      args: { path: "docs/notes" },
      environment: createHarnessEnvironmentSnapshot(),
    });
    expect((extensionlessResult.contents as { source: { text: string } }).source.text).toContain(
      "plain text without extension",
    );
    expect(
      (extensionlessResult.contents as { source: { metadata: { encoding: string } } }).source.metadata
        .encoding,
    ).toBe("utf-8");
  });

  it("returns an explicit unsupported outcome for binary files", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "blob.bin"),
      Buffer.from([0, 159, 146, 150, 1, 2, 3]),
    );

    const result = await workspaceResource.read!({
      args: { path: "blob.bin" },
      environment: createHarnessEnvironmentSnapshot(),
    });

    expect(result.contents).toMatchObject({
      type: "unsupported",
      path: "blob.bin",
      reason: "binary",
      fileType: "bin",
    });
  });

  it("routes Office files to their Skill-owned runtimes", async () => {
    for (const extension of ["docx", "pptx", "xlsx"]) {
      const fileName = `sample.${extension}`;
      fs.writeFileSync(path.join(tempRoot, fileName), "office fixture");

      const result = await workspaceResource.read!({
        args: { path: fileName },
        environment: createHarnessEnvironmentSnapshot(),
      });

      expect(result.contents).toMatchObject({
        type: "unsupported",
        path: fileName,
        reason: "office_owned",
        fileType: extension,
        suggestedSkill: extension,
      });
    }
  });

  it("rejects missing paths", async () => {
    await expect(
      workspaceResource.read!({
        args: { path: "missing.txt" },
        environment: createHarnessEnvironmentSnapshot(),
      }),
    ).rejects.toThrow("Path does not exist");
  });

  it("rejects reads when harness environment is missing", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "hello");

    await expect(workspaceResource.read!({ args: { path: "notes.txt" } })).rejects.toThrow(
      "Read execution requires a harness environment snapshot",
    );
  });
});
