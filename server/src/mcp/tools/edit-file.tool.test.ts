import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { editFileTool } from "./edit-file.tool.js";
import {
  createTimestampedTestArtifactPath,
} from "@/test-support/artifacts.js";

const tempRoot = createTimestampedTestArtifactPath("workspace", "rag-demo-mcp-edit");

const createInvocationContext = (args: Record<string, unknown>) => {
  const events: string[] = [];
  const artifacts: Array<Record<string, unknown>> = [];

  return {
    events,
    artifacts,
    context: {
      invocationId: crypto.randomUUID(),
      args,
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent(event: { type: string; message?: string }) {
        events.push(event.type === "invocation:progress" ? String(event.message ?? "") : event.type);
      },
      addArtifact(artifact: Record<string, unknown>) {
        artifacts.push(artifact);
        return { id: crypto.randomUUID(), ...artifact };
      },
    },
  };
};

describe("edit_file tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("writes a workspace file through the harness edit capability", async () => {
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "write_file",
      content: "hello edit",
    });

    const result = await editFileTool.execute(invocation.context);

    expect(fs.readFileSync(path.join(tempRoot, "notes.txt"), "utf-8")).toBe("hello edit");
    expect(result.structuredContent).toEqual({
      path: "notes.txt",
      operation: "write_file",
      dryRun: false,
      bytes: Buffer.byteLength("hello edit", "utf-8"),
    });
    expect(invocation.events[0]).toBe("Edit plan: node-fs-write-file");
    expect(invocation.events[1]).toBe("Prepared file edit");
    expect(invocation.artifacts).toHaveLength(1);
    expect(invocation.artifacts[0]?.metadata).toMatchObject({
      dryRun: false,
      operation: "write_file",
      strategyId: "node-fs-write-file",
    });
  });

  it("creates an empty workspace file when write_file receives empty content", async () => {
    const targetPath = path.join(tempRoot, "empty.txt");
    const invocation = createInvocationContext({
      path: "empty.txt",
      operation: "write_file",
      content: "",
    });

    const result = await editFileTool.execute(invocation.context);

    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.readFileSync(targetPath, "utf-8")).toBe("");
    expect(result.structuredContent).toEqual({
      path: "empty.txt",
      operation: "write_file",
      dryRun: false,
      bytes: 0,
    });
    expect(invocation.artifacts[0]?.data).toBe("");
  });

  it("escalates existing-file overwrite to dry-run instead of writing immediately", async () => {
    const targetPath = path.join(tempRoot, "notes.txt");
    fs.writeFileSync(targetPath, "existing content", "utf-8");
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "write_file",
      content: "replacement content",
    });

    const result = await editFileTool.execute(invocation.context);

    expect(fs.readFileSync(targetPath, "utf-8")).toBe("existing content");
    expect(result.structuredContent).toEqual({
      path: "notes.txt",
      operation: "write_file",
      dryRun: true,
      bytes: Buffer.byteLength("replacement content", "utf-8"),
    });
    expect(invocation.events).toEqual([
      "Edit plan: node-fs-write-file",
      "Escalated existing-file overwrite to dry-run",
      "Prepared dry-run edit",
    ]);
    expect(invocation.artifacts[0]?.data).toBe("replacement content");
    expect(invocation.artifacts[0]?.metadata).toMatchObject({
      dryRun: true,
      operation: "write_file",
      strategyId: "node-fs-write-file",
    });
  });

  it("supports replace_block dry-run without changing the file", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "old value", "utf-8");
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "replace_block",
      expectedOldText: "old value",
      newText: "new value",
      dryRun: true,
    });

    const result = await editFileTool.execute(invocation.context);

    expect(fs.readFileSync(path.join(tempRoot, "notes.txt"), "utf-8")).toBe("old value");
    expect(result.structuredContent).toEqual({
      path: "notes.txt",
      operation: "replace_block",
      dryRun: true,
      bytes: Buffer.byteLength("new value", "utf-8"),
    });
    expect(invocation.events[0]).toBe("Edit plan: node-fs-replace-block");
    expect(invocation.events[1]).toBe("Prepared dry-run edit");
    expect(invocation.artifacts[0]?.data).toBe("new value");
  });

  it("replaces matching content in an existing file", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "before old value after", "utf-8");
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "replace_block",
      expectedOldText: "old value",
      newText: "new value",
    });

    await editFileTool.execute(invocation.context);

    expect(fs.readFileSync(path.join(tempRoot, "notes.txt"), "utf-8")).toBe(
      "before new value after",
    );
  });

  it("rejects write_file when content is missing", async () => {
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "write_file",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "content is required for write_file",
    );
  });

  it("rejects replace_block when required fields are missing", async () => {
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "replace_block",
      expectedOldText: "old value",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "expectedOldText and newText are required for replace_block",
    );
  });

  it("rejects replace_block when the expected text does not match", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "actual value", "utf-8");
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "replace_block",
      expectedOldText: "old value",
      newText: "new value",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "expectedOldText does not match current file content",
    );
  });

  it("rejects replace_block when expectedOldText matches more than once", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "repeat value and repeat value", "utf-8");
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "replace_block",
      expectedOldText: "repeat value",
      newText: "new value",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "expectedOldText must match exactly once",
    );
  });

  it("rejects unsupported mutation operations such as delete", async () => {
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "delete",
      content: "ignored",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "Unsupported edit operation",
    );
  });

  it("rejects unsupported mutation operations such as move", async () => {
    const invocation = createInvocationContext({
      path: "notes.txt",
      operation: "move",
      destinationPath: "renamed.txt",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "Unsupported edit operation",
    );
  });

  it("rejects directory-style paths to keep workspace mutation separate", async () => {
    const invocation = createInvocationContext({
      path: "nested/",
      operation: "write_file",
      content: "hello",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "edit_file does not support directory paths",
    );
  });

  it("rejects existing directory targets to keep workspace mutation separate", async () => {
    fs.mkdirSync(path.join(tempRoot, "nested"), { recursive: true });
    const invocation = createInvocationContext({
      path: "nested",
      operation: "write_file",
      content: "hello",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "edit_file does not support directory targets",
    );
  });

  it("rejects paths outside the workspace root", async () => {
    const invocation = createInvocationContext({
      path: "../outside.txt",
      operation: "write_file",
      content: "unsafe",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "path must stay inside workspace root",
    );
  });

  it("rejects absolute paths outside the workspace root", async () => {
    const outsidePath = createTimestampedTestArtifactPath(
      "outside",
      `rag-demo-edit-outside-${crypto.randomUUID()}`,
      ".txt",
    );
    const invocation = createInvocationContext({
      path: outsidePath,
      operation: "write_file",
      content: "unsafe",
    });

    await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
      "path must stay inside workspace root",
    );
  });

  it("rejects writes through linked directories that resolve outside the workspace root", async () => {
    const outsideDir = createTimestampedTestArtifactPath(
      "outside",
      `rag-demo-edit-linked-${crypto.randomUUID()}`,
    );
    try {
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.symlinkSync(outsideDir, path.join(tempRoot, "linked-outside"), "junction");
      const invocation = createInvocationContext({
        path: "linked-outside/escape.txt",
        operation: "write_file",
        content: "unsafe",
      });

      await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
        "path must stay inside workspace root",
      );
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects writes when the workspace target file is a symlink to an external file", async () => {
    const outsideDir = createTimestampedTestArtifactPath(
      "outside",
      `rag-demo-edit-linked-file-${crypto.randomUUID()}`,
    );
    try {
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideFile = path.join(outsideDir, "outside.txt");
      fs.writeFileSync(outsideFile, "outside", "utf-8");
      fs.symlinkSync(outsideFile, path.join(tempRoot, "linked-file.txt"), "file");

      const invocation = createInvocationContext({
        path: "linked-file.txt",
        operation: "write_file",
        content: "unsafe",
      });

      await expect(editFileTool.execute(invocation.context)).rejects.toThrow(
        "path must stay inside workspace root",
      );
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
