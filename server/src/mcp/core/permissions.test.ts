import { describe, expect, it } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { evaluateInvocationApproval, hasExactApprovedInvocation } from "./permissions.js";

const terminalDefinition = {
  id: "terminal_session",
  title: "Terminal Session",
  description: "terminal",
  domain: "terminal" as const,
  source: "internal" as const,
  mode: "stream" as const,
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
      cwd: { type: "string" },
      env: { type: "object" },
      timeoutMs: { type: "number" },
      attachSessionId: { type: "string" },
    },
  },
  tags: ["terminal"],
  capabilities: {
    sideEffect: "process" as const,
    requiresApproval: true,
    workspaceBound: true,
    workspaceBoundary: {
      argKeys: ["cwd"],
    },
  },
};

describe("permissions exact approval reuse", () => {
  it("matches only the same toolId and exact inputHash", () => {
    const approvedArgs = {
      command: "pwd",
      cwd: ".",
    };

    expect(
      hasExactApprovedInvocation({
        toolId: "terminal_session",
        inputHash: createInvocationInputHash(approvedArgs),
        approvedInvocations: [
          {
            toolId: "terminal_session",
            inputHash: createInvocationInputHash(approvedArgs),
          },
        ],
      }),
    ).toBe(true);

    expect(
      hasExactApprovedInvocation({
        toolId: "delete",
        inputHash: createInvocationInputHash(approvedArgs),
        approvedInvocations: [
          {
            toolId: "terminal_session",
            inputHash: createInvocationInputHash(approvedArgs),
          },
        ],
      }),
    ).toBe(false);
  });

  it.each([
    {
      label: "new command",
      approvedArgs: {
        command: "pwd",
        attachSessionId: "session-1",
      },
      nextArgs: {
        command: "git status",
        attachSessionId: "session-1",
      },
    },
    {
      label: "new cwd",
      approvedArgs: {
        command: "pwd",
        cwd: "server",
      },
      nextArgs: {
        command: "pwd",
        cwd: "desktop",
      },
    },
    {
      label: "new env",
      approvedArgs: {
        command: "echo hi",
        env: {
          FOO: "1",
        },
      },
      nextArgs: {
        command: "echo hi",
        env: {
          FOO: "2",
        },
      },
    },
    {
      label: "new timeout",
      approvedArgs: {
        command: "pnpm check",
        timeoutMs: 2000,
      },
      nextArgs: {
        command: "pnpm check",
        timeoutMs: 5000,
      },
    },
  ])("requires approval again when terminal_session receives $label", ({ approvedArgs, nextArgs }) => {
    const result = evaluateInvocationApproval({
      definition: terminalDefinition,
      args: nextArgs,
      approvedInvocations: [
        {
          toolId: "terminal_session",
          inputHash: createInvocationInputHash(approvedArgs),
        },
      ],
      inputHash: createInvocationInputHash(nextArgs),
    });

    expect(result).toEqual({
      type: "require_approval",
      reason: "terminal_session requires explicit approval before execution.",
      scope: "terminal",
    });
  });
});
