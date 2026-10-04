import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { executeHarnessInvocation } from "../../harness/invocations.js";
import { clearHarnessInvocations } from "../../harness/invocations.js";
import { clearHarnessRegistry, registerTool } from "../../harness/registry.js";
import { clearWorkspaceSelection } from "../workspace.js";
import { workspaceMutationTool } from "./workspace-mutation.tool.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

const tempRoot = createTimestampedTestArtifactPath(
  "workspace",
  "rag-demo-mcp-workspace-mutation",
);

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

describe("workspace_mutation tool", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
    clearHarnessRegistry();
    clearHarnessInvocations();
    registerTool(workspaceMutationTool);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
  });

  it("deletes a workspace file through structured parameters", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "remove me", "utf-8");
    const invocation = createInvocationContext({
      operation: "delete",
      targetPath: "notes.txt",
    });

    const result = await workspaceMutationTool.execute(invocation.context);

    expect(fs.existsSync(path.join(tempRoot, "notes.txt"))).toBe(false);
    expect(result.structuredContent).toEqual({
      operation: "delete",
      targetPath: "notes.txt",
      dryRun: false,
      deletedType: "file",
      recursive: false,
    });
    expect(invocation.events).toEqual([
      "Workspace mutation plan: delete",
      "Applied workspace mutation",
    ]);
  });

  it("moves a workspace file with explicit destination parameters", async () => {
    fs.writeFileSync(path.join(tempRoot, "old.txt"), "move me", "utf-8");
    const invocation = createInvocationContext({
      operation: "move",
      targetPath: "old.txt",
      destinationPath: "nested/new.txt",
    });

    const result = await workspaceMutationTool.execute(invocation.context);

    expect(fs.existsSync(path.join(tempRoot, "old.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(tempRoot, "nested", "new.txt"), "utf-8")).toBe("move me");
    expect(result.structuredContent).toEqual({
      operation: "move",
      targetPath: "old.txt",
      destinationPath: "nested/new.txt",
      dryRun: false,
      overwrite: false,
    });
  });

  it("writes a workspace file with structured content parameters", async () => {
    const invocation = createInvocationContext({
      operation: "write",
      targetPath: "docs/notes.txt",
      content: "hello mutation",
    });

    const result = await workspaceMutationTool.execute(invocation.context);

    expect(fs.readFileSync(path.join(tempRoot, "docs", "notes.txt"), "utf-8")).toBe(
      "hello mutation",
    );
    expect(result.structuredContent).toEqual({
      operation: "write",
      targetPath: "docs/notes.txt",
      dryRun: false,
      overwrite: false,
      bytes: Buffer.byteLength("hello mutation", "utf-8"),
    });
  });

  it("rejects deletion outside the workspace root", async () => {
    const invocation = createInvocationContext({
      operation: "delete",
      targetPath: "../outside.txt",
    });

    await expect(workspaceMutationTool.execute(invocation.context)).rejects.toThrow(
      "path must stay inside workspace root",
    );
  });

  // Drive-letter and UNC targets are only absolute paths on Windows; on POSIX
  // hosts they are ordinary relative filenames resolved inside the workspace.
  it.skipIf(process.platform !== "win32")("rejects Windows absolute and UNC deletion targets outside the workspace root", async () => {
    const absoluteInvocation = createInvocationContext({
      operation: "delete",
      targetPath: "D:\\outside.txt",
    });
    const uncInvocation = createInvocationContext({
      operation: "delete",
      targetPath: "\\\\server\\share\\file.txt",
    });

    await expect(workspaceMutationTool.execute(absoluteInvocation.context)).rejects.toThrow(
      "path must stay inside workspace root",
    );
    await expect(workspaceMutationTool.execute(uncInvocation.context)).rejects.toThrow(
      "path must stay inside workspace root",
    );
  });

  it("rejects POSIX absolute deletion targets during execution", async () => {
    fs.writeFileSync(path.join(tempRoot, "notes.txt"), "remove me", "utf-8");
    const invocation = createInvocationContext({
      operation: "delete",
      targetPath: "/notes.txt",
    });

    await expect(workspaceMutationTool.execute(invocation.context)).rejects.toThrow(
      "path must stay inside workspace root",
    );
    expect(fs.existsSync(path.join(tempRoot, "notes.txt"))).toBe(true);
  });

  it("rejects directory deletion without recursive=true", async () => {
    fs.mkdirSync(path.join(tempRoot, "logs"), { recursive: true });
    const invocation = createInvocationContext({
      operation: "delete",
      targetPath: "logs",
    });

    await expect(workspaceMutationTool.execute(invocation.context)).rejects.toThrow(
      "recursive=true is required to delete a directory",
    );
  });

  it("uses definition-declared boundary keys for move destination approval gating", async () => {
    fs.writeFileSync(path.join(tempRoot, "old.txt"), "move me", "utf-8");

    const args = {
      operation: "move",
      targetPath: "old.txt",
      destinationPath: "../outside.txt",
    } as const;

    // Without an approved invocation, the declared destinationPath boundary
    // key must gate the move before any filesystem work happens.
    const gated = await executeHarnessInvocation({
      toolId: "workspace_mutation",
      args: { ...args },
      environment: createHarnessEnvironmentSnapshot(),
    });

    expect(gated.status).toBe("awaiting_approval");
    expect(gated.approval?.reason).toContain(
      "workspace_mutation requests destinationPath outside the current workspace root",
    );
    expect(fs.existsSync(path.join(tempRoot, "old.txt"))).toBe(true);
  });
});
