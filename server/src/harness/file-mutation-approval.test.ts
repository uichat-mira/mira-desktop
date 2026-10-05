import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInvocationInputHash } from "../agent/approval-fingerprint.js";
import { clearWorkspaceSelection } from "../mcp/workspace.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import { createHarnessEnvironmentSnapshot } from "./environment.js";
import {
  clearHarnessInvocations,
  executeHarnessInvocation,
} from "./invocations.js";
import {
  clearHarnessRegistry,
} from "./registry.js";
import {
  initializeHarnessRuntime,
  resetHarnessRuntime,
} from "./runtime.js";

const tempRoot = createTimestampedTestArtifactPath(
  "workspace",
  "file-mutation-harness-approval",
);

describe("canonical file mutation Harness approval", () => {
  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    process.env.UI_CHAT_WORKSPACE_ROOT = tempRoot;
    clearWorkspaceSelection();
    clearHarnessInvocations();
    clearHarnessRegistry();
    resetHarnessRuntime();
    initializeHarnessRuntime();
  });

  afterEach(() => {
    clearHarnessInvocations();
    clearHarnessRegistry();
    resetHarnessRuntime();
    delete process.env.UI_CHAT_WORKSPACE_ROOT;
    clearWorkspaceSelection();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("gates write, edit, move and delete before any filesystem mutation", async () => {
    fs.writeFileSync(path.join(tempRoot, "edit.txt"), "before\n", "utf8");
    fs.writeFileSync(path.join(tempRoot, "move-source.txt"), "move", "utf8");
    fs.writeFileSync(path.join(tempRoot, "delete.txt"), "delete", "utf8");

    const environment = createHarnessEnvironmentSnapshot();
    const cases = [
      {
        toolId: "write",
        args: { path: "created.txt", content: "created" },
      },
      {
        toolId: "edit",
        args: {
          path: "edit.txt",
          edits: [{ oldText: "before", newText: "after" }],
        },
      },
      {
        toolId: "move",
        args: {
          path: "move-source.txt",
          destinationPath: "move-destination.txt",
        },
      },
      {
        toolId: "delete",
        args: { path: "delete.txt" },
      },
    ] as const;

    for (const invocation of cases) {
      const record = await executeHarnessInvocation({
        toolId: invocation.toolId,
        args: { ...invocation.args },
        environment,
      });

      expect(record.status).toBe("awaiting_approval");
      expect(record.approval?.reason).toContain(
        `${invocation.toolId} requires explicit approval before execution.`,
      );
    }

    expect(fs.existsSync(path.join(tempRoot, "created.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(tempRoot, "edit.txt"), "utf8")).toBe(
      "before\n",
    );
    expect(fs.existsSync(path.join(tempRoot, "move-source.txt"))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, "move-destination.txt"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tempRoot, "delete.txt"))).toBe(true);
  });

  it("executes only the exact approved tool arguments", async () => {
    const environment = createHarnessEnvironmentSnapshot();
    const args = {
      path: "approved.txt",
      content: "approved",
    };
    const inputHash = createInvocationInputHash(args);

    const completed = await executeHarnessInvocation({
      toolId: "write",
      args,
      environment,
      approvedInvocations: [{ toolId: "write", inputHash }],
    });

    expect(completed.status).toBe("completed");
    expect(fs.readFileSync(path.join(tempRoot, "approved.txt"), "utf8")).toBe(
      "approved",
    );

    const changedArgs = {
      path: "changed.txt",
      content: "changed",
    };
    const changed = await executeHarnessInvocation({
      toolId: "write",
      args: changedArgs,
      environment,
      approvedInvocations: [{ toolId: "write", inputHash }],
    });

    expect(changed.status).toBe("awaiting_approval");
    expect(fs.existsSync(path.join(tempRoot, "changed.txt"))).toBe(false);
  });

  it("uses destinationPath in move workspace approval gating", async () => {
    fs.writeFileSync(path.join(tempRoot, "source.txt"), "source", "utf8");
    const environment = createHarnessEnvironmentSnapshot();
    const args = {
      path: "source.txt",
      destinationPath: "../outside.txt",
    };

    const pending = await executeHarnessInvocation({
      toolId: "move",
      args,
      environment,
    });

    expect(pending.status).toBe("awaiting_approval");
    expect(pending.approval?.reason).toContain(
      "move requests destinationPath outside the current workspace root",
    );
    expect(fs.existsSync(path.join(tempRoot, "source.txt"))).toBe(true);
  });

  it("does not turn approval into authority outside the workspace", async () => {
    fs.writeFileSync(path.join(tempRoot, "source.txt"), "source", "utf8");
    const environment = createHarnessEnvironmentSnapshot();
    const args = {
      path: "source.txt",
      destinationPath: "../outside.txt",
    };

    const record = await executeHarnessInvocation({
      toolId: "move",
      args,
      environment,
      approvedInvocations: [
        {
          toolId: "move",
          inputHash: createInvocationInputHash(args),
        },
      ],
    });

    expect(record.status).toBe("failed");
    expect(record.error?.message).toContain("path must stay inside workspace root");
    expect(fs.existsSync(path.join(tempRoot, "source.txt"))).toBe(true);
    expect(fs.existsSync(path.resolve(tempRoot, "../outside.txt"))).toBe(false);
  });
});
