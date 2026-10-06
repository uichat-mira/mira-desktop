import { describe, expect, it } from "vitest";
import {
  resolveActionProfileInvocation,
  resolveHarnessActionProfiles,
} from "./action-profiles.js";

describe("resolveHarnessActionProfiles", () => {
  it("returns only independently justified action profiles", () => {
    const profiles = resolveHarnessActionProfiles([
      {
        id: "terminal_session",
        title: "Terminal Session",
        description: "terminal",
        domain: "terminal",
        source: "internal",
        mode: "stream",
        inputSchema: {},
        tags: ["terminal"],
        capabilities: {
          sideEffect: "process",
          requiresApproval: true,
        },
      },
      {
        id: "write",
        title: "Write",
        description: "write",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["edit", "write"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
      {
        id: "edit",
        title: "Edit",
        description: "edit",
        domain: "edit",
        source: "internal",
        mode: "sync",
        inputSchema: {},
        tags: ["edit"],
        capabilities: {
          sideEffect: "local-write",
          requiresApproval: true,
        },
      },
    ]);

    expect(profiles.map((profile) => profile.id)).toEqual([
      "terminal_execute_command",
    ]);
    expect(profiles[0]).toMatchObject({
      id: "terminal_execute_command",
      runtimeToolId: "terminal_session",
    });
  });
});

describe("resolveActionProfileInvocation", () => {
  it("maps terminal_execute_command to terminal_session", () => {
    expect(
      resolveActionProfileInvocation({
        actionProfileId: "terminal_execute_command",
        args: {
          command: "pwd",
          cwd: "server",
          timeoutMs: 3000,
        },
      }),
    ).toEqual({
      toolId: "terminal_session",
      args: {
        command: "pwd",
        cwd: "server",
        timeoutMs: 3000,
      },
    });
  });

  it("does not retain obsolete edit action aliases", () => {
    expect(() =>
      resolveActionProfileInvocation({
        actionProfileId: "edit_create_file",
        args: { path: "notes/todo.txt" },
      }),
    ).toThrow(/Unknown action profile/);
  });
});
