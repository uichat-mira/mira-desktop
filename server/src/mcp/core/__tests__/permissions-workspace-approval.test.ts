import path from "node:path";

import { describe, expect, it } from "vitest";

import { createHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import { terminalTool } from "../../tools/terminal-session.tool.js";
import { evaluateInvocationApproval } from "../permissions.js";

const workspaceRoot = path.resolve("workspace-root");
const outsideRoot = path.resolve("outside-root");
const environment = createHarnessEnvironmentSnapshot({
  workspace: {
    rootPath: workspaceRoot,
    source: "selected",
  },
});

describe("workspace boundary approval", () => {
  it("requests workspace approval before an outside cwd is authorized", () => {
    const decision = evaluateInvocationApproval({
      definition: terminalTool.definition,
      args: {
        command: "node --version",
        cwd: outsideRoot,
      },
      environment,
      inputHash: "outside-call",
    });

    expect(decision.type).toBe("require_approval");
    expect(decision.scope).toBe("workspace");
  });

  it("allows the exact outside invocation after approval", () => {
    const decision = evaluateInvocationApproval({
      definition: terminalTool.definition,
      args: {
        command: "node --version",
        cwd: outsideRoot,
      },
      environment,
      inputHash: "outside-call",
      approvedInvocations: [
        {
          toolId: "terminal",
          inputHash: "outside-call",
        },
      ],
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("does not reuse approval when any reviewed argument changes", () => {
    const decision = evaluateInvocationApproval({
      definition: terminalTool.definition,
      args: {
        command: "node --version",
        cwd: outsideRoot,
        timeoutMs: 30_000,
      },
      environment,
      inputHash: "changed-call",
      approvedInvocations: [
        {
          toolId: "terminal",
          inputHash: "outside-call",
        },
      ],
    });

    expect(decision.type).toBe("require_approval");
    expect(decision.scope).toBe("workspace");
  });
});
