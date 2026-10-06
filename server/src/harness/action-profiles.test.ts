import { describe, expect, it } from "vitest";
import {
  resolveActionProfileInvocation,
  resolveHarnessActionProfiles,
} from "./action-profiles.js";

describe("resolveHarnessActionProfiles", () => {
  it("returns terminal and edit action profiles when the backing runtime tools exist", () => {
    const profiles = resolveHarnessActionProfiles([
      {
        id: "terminal",
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
        id: "edit_file",
        title: "Edit File",
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
      "edit_create_file",
      "edit_overwrite_file",
      "edit_replace_block",
    ]);
    expect(profiles[0]).toMatchObject({
      id: "terminal_execute_command",
      runtimeToolId: "terminal",
    });
    expect(profiles[1]).toMatchObject({
      id: "edit_create_file",
      runtimeToolId: "edit_file",
    });
  });
});

describe("resolveActionProfileInvocation", () => {
  it("maps terminal_execute_command to terminal", () => {
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
      toolId: "terminal",
      args: {
        command: "pwd",
        cwd: "server",
        timeoutMs: 3000,
      },
    });
  });

  it("maps edit action profiles to edit_file with normalized runtime args", () => {
    expect(
      resolveActionProfileInvocation({
        actionProfileId: "edit_create_file",
        args: {
          path: "notes/todo.txt",
        },
      }),
    ).toEqual({
      toolId: "edit_file",
      args: {
        operation: "write_file",
        path: "notes/todo.txt",
        content: "",
      },
    });

    expect(
      resolveActionProfileInvocation({
        actionProfileId: "edit_overwrite_file",
        args: {
          path: "notes/todo.txt",
          content: "next",
          dryRun: true,
        },
      }),
    ).toEqual({
      toolId: "edit_file",
      args: {
        operation: "write_file",
        path: "notes/todo.txt",
        content: "next",
        dryRun: true,
      },
    });

    expect(
      resolveActionProfileInvocation({
        actionProfileId: "edit_replace_block",
        args: {
          path: "notes/todo.txt",
          expectedOldText: "old",
          newText: "new",
        },
      }),
    ).toEqual({
      toolId: "edit_file",
      args: {
        operation: "replace_block",
        path: "notes/todo.txt",
        expectedOldText: "old",
        newText: "new",
      },
    });
  });
});
