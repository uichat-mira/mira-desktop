// @vitest-environment jsdom
import assert from "node:assert/strict";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, test, vi } from "vitest";
import "@/shared/i18n";
import i18n from "@/shared/i18n";
import UChatThread from "./UChatThread";

const sendMock = vi.fn();
const updateThreadRuntimeMock = vi.fn();
const refreshThreadMock = vi.fn();
const setComposerTextMock = vi.fn();
const setDraftWorkspaceIdMock = vi.fn();
const setDraftAgentEnabledMock = vi.fn();
const messageErrorMock = vi.hoisted(() => vi.fn());
const draftWorkspaceState = vi.hoisted(() => ({
  value: "workspace-1" as string | null,
}));
const draftAgentEnabledState = vi.hoisted(() => ({
  value: true as boolean,
}));
const runtimeSelectorState = vi.hoisted(() => ({
  activeThreadId: null as string | null,
  threads: [] as any[],
  runStatus: { type: "idle" } as { type: "idle" | "running" },
  activeRunThreadId: null as string | null,
}));

vi.mock("@/app/providers/ThemeProvider", () => ({
  useThemePreferences: () => ({
    colorTheme: "warm-neutral",
    themeMode: "light",
    setColorTheme: () => {},
    setThemeMode: () => {},
    themePresets: [],
  }),
}));

vi.mock("@/app/providers/RoleModelConfigProvider", () => ({
  useRoleModelConfigs: () => ({
    configMap: {
      llm: { name: "gpt-test" },
      task: null,
      embedding: null,
      rerank: null,
    },
    hasDefaultEmbedding: true,
    hasDefaultLlm: true,
  }),
}));

vi.mock("@/features/chat/core/knowledgeBaseState", () => ({
  useChatKnowledgeBaseState: () => ({
    knowledgeBases: [],
  }),
}));

vi.mock("@/features/chat/core/runtime", () => ({
  useChatRuntime: () => ({
    send: sendMock,
    cancelSend: vi.fn(),
    regenerate: vi.fn(),
    editUserMessage: vi.fn(),
    setComposerText: setComposerTextMock,
    setComposerAttachments: vi.fn(),
    appendComposerAttachments: vi.fn(),
    removeComposerAttachment: vi.fn(),
    updateThread: updateThreadRuntimeMock,
    refreshThread: refreshThreadMock,
  }),
  useChatRuntimeSelector: (selector: (state: any) => unknown) =>
    selector({
      activeThreadId: runtimeSelectorState.activeThreadId,
      threads: runtimeSelectorState.threads,
      composer: { text: composerTextState.value, attachments: [] },
      runStatus: runtimeSelectorState.runStatus,
      activeRunThreadId: runtimeSelectorState.activeRunThreadId,
      threadStatus: "ready",
      capabilities: { composerActions: [], messagePresentation: {} },
    }),
  useChatThreadDraftState: () => ({
    draftKnowledgeBaseId: null,
    draftRoleId: null,
    draftAgentEnabled: draftAgentEnabledState.value,
    draftWorkspaceId: draftWorkspaceState.value,
    setDraftKnowledgeBaseId: vi.fn(),
    setDraftRoleId: vi.fn(),
    setDraftAgentEnabled: setDraftAgentEnabledMock,
    setDraftWorkspaceId: setDraftWorkspaceIdMock,
  }),
}));

vi.mock("@/features/chat/core/composerPolicy", () => ({
  useUChatComposerState: ({
    hasRunningTask,
    isCurrentThreadRunning,
  }: {
    hasRunningTask: boolean;
    isCurrentThreadRunning: boolean;
  }) => ({
    isComposerDisabled: isCurrentThreadRunning,
    isSendDisabled: hasRunningTask,
    placeholder: isCurrentThreadRunning
      ? "Thinking..."
      : "Type a question and press Enter...",
  }),
}));

vi.mock("@/features/chat/core/protocol", () => ({
  resolveAttachmentSource: (value: string) => value,
}));

vi.mock("@/shared/api/roles", () => ({
  listRoles: vi.fn().mockResolvedValue([]),
}));
const composerTextState = vi.hoisted(() => ({ value: "hello" }));

vi.mock("@/shared/api/officeSuiteSkills", () => ({
  getWenshuSkillCatalog: vi.fn().mockResolvedValue({ skills: [] }),
}));

vi.mock("@/shared/api/tools", () => ({
  getMcpTools: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/shared/api/thread", () => ({
  listChatWorkspaces: vi.fn().mockResolvedValue([]),
  createChatWorkspace: vi.fn(),
  updateThread: vi.fn(),
  approveAgentRun: vi.fn(),
  rejectAgentRun: vi.fn(),
}));

vi.mock("@/shared/avatars", () => ({
  getBuiltinAvatarPack16Options: () => [],
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  getDesktopRuntime: () => ({
    platform: "win32",
  }),
  getApiBaseUrl: () => "http://127.0.0.1:3000",
  getChatApiUrl: () => "http://127.0.0.1:3000/proxy/chat/default",
}));

vi.mock("@/shared/ui", async () => {
  const actual = await vi.importActual("@/shared/ui");
  return {
    ...actual,
    message: {
      error: messageErrorMock,
    },
  };
});

vi.mock("./ThreadContextSummaryModalContent", () => ({
  default: () => null,
}));

vi.mock("@/shared/ui/SearchSelectModal", () => ({
  default: () => null,
}));

describe("UChatThread", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  afterAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  beforeEach(() => {
    sendMock.mockReset();
    updateThreadRuntimeMock.mockReset();
    refreshThreadMock.mockReset();
    setComposerTextMock.mockReset();
    setDraftWorkspaceIdMock.mockReset();
    setDraftAgentEnabledMock.mockReset();
    messageErrorMock.mockReset();
    draftWorkspaceState.value = "workspace-1";
    draftAgentEnabledState.value = true;
    runtimeSelectorState.activeThreadId = null;
    runtimeSelectorState.threads = [];
    runtimeSelectorState.runStatus = { type: "idle" };
    runtimeSelectorState.activeRunThreadId = null;
    composerTextState.value = "hello";
  });

  test("welcome state can run agent without an explicit workspace", async () => {
    draftWorkspaceState.value = null;

    await act(async () => {
      render(<UChatThread />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Run in Agent mode" }));

    await waitFor(() => {
      assert.equal(sendMock.mock.calls.length, 1);
    });
    assert.deepEqual(sendMock.mock.calls[0]?.[0], { agentEnabled: true });
  });

  test("restores applied Skill mentions before Agent submission", async () => {
    composerTextState.value = "请使用 @(xlsx) 分析";

    await act(async () => {
      render(<UChatThread />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Run in Agent mode" }));

    await waitFor(() => assert.equal(sendMock.mock.calls.length, 1));
    assert.deepEqual(setComposerTextMock.mock.calls[0], ["请使用 $xlsx 分析"]);
    assert.deepEqual(sendMock.mock.calls[0]?.[0], { agentEnabled: true });
  });

  test("agent toggle stays available in welcome state when workspace is missing", async () => {
    draftWorkspaceState.value = null;
    draftAgentEnabledState.value = false;

    await act(async () => {
      render(<UChatThread />);
    });

    const button = screen.getByRole("button", { name: "Enable Agent" });
    assert.equal(button.hasAttribute("disabled"), false);

    fireEvent.click(button);
    await waitFor(() => {
      assert.deepEqual(setDraftAgentEnabledMock.mock.calls[0], [true]);
    });
    assert.equal(messageErrorMock.mock.calls.length, 0);
  });

  test("agent toggle stays enabled once workspace is bound even if agent mode is still off", async () => {
    draftWorkspaceState.value = "workspace-1";
    draftAgentEnabledState.value = false;

    await act(async () => {
      render(<UChatThread />);
    });

    const button = screen.getByRole("button", { name: "Enable Agent" });
    assert.equal(button.hasAttribute("disabled"), false);
    fireEvent.click(button);

    await waitFor(() => {
      assert.deepEqual(setDraftAgentEnabledMock.mock.calls[0], [true]);
    });
  });

  test("welcome state falls back to normal send when agent toggle is off", async () => {
    draftAgentEnabledState.value = false;

    await act(async () => {
      render(<UChatThread />);
    });

    const button = screen.getByRole("button", { name: "chat.thread.actions.send" });
    assert.equal(button.hasAttribute("disabled"), false);
    fireEvent.click(button);

    await waitFor(() => {
      assert.equal(sendMock.mock.calls.length, 1);
    });
    assert.equal(sendMock.mock.calls[0]?.length ?? 0, 0);
  });

  test("thread agent enabled plus running status passes agent running state to view", async () => {
    runtimeSelectorState.activeThreadId = "thread-1";
    runtimeSelectorState.runStatus = { type: "running" };
    runtimeSelectorState.activeRunThreadId = "thread-1";
    runtimeSelectorState.threads = [
      {
        id: "thread-1",
        title: "Thread",
        workspaceId: "workspace-1",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        metadata: {
          agentEnabled: true,
        },
        messages: [
          {
            id: "assistant-1",
            threadId: "thread-1",
            role: "assistant",
            parts: [],
            createdAt: "2025-01-01T00:00:00.000Z",
            parentId: "user-1",
            status: "streaming",
            metadata: {},
          },
        ],
      },
    ];

    await act(async () => {
      render(<UChatThread />);
    });

    assert.ok(screen.getByText(i18n.t("chat.thread.agent.running")));
  });

  test("keeps Role image action available when Agent is enabled and no Knowledge Base is bound", async () => {
    runtimeSelectorState.activeThreadId = "thread-1";
    runtimeSelectorState.threads = [
      {
        id: "thread-1",
        title: "Role Thread",
        workspaceId: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        metadata: {
          agentEnabled: true,
          roleId: "role-1",
          knowledgeBaseId: null,
        },
        messages: [
          {
            id: "assistant-1",
            threadId: "thread-1",
            role: "assistant",
            parts: [{ type: "text", text: "A cinematic portrait." }],
            createdAt: "2025-01-01T00:00:01.000Z",
            parentId: "user-1",
            status: "complete",
            metadata: {},
          },
        ],
      },
    ];

    await act(async () => {
      render(<UChatThread />);
    });

    assert.ok(
      screen.getByRole("button", {
        name: i18n.t("chat.thread.media.generateImage"),
      }),
    );
  });

  test("keeps another thread editable while a different thread is running", async () => {
    runtimeSelectorState.activeThreadId = "thread-2";
    runtimeSelectorState.runStatus = { type: "running" };
    runtimeSelectorState.activeRunThreadId = "thread-1";
    runtimeSelectorState.threads = [
      {
        id: "thread-2",
        title: "Thread Two",
        workspaceId: "workspace-1",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        metadata: { agentEnabled: false },
        messages: [],
      },
    ];

    await act(async () => {
      render(<UChatThread />);
    });

    const editor = screen.getByRole("textbox");
    assert.equal(editor.hasAttribute("disabled"), false);
    fireEvent.change(editor, { target: { value: "thread two draft" } });
    assert.deepEqual(setComposerTextMock.mock.calls.at(-1), ["thread two draft"]);
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    assert.equal(sendMock.mock.calls.length, 0);
    const sendButton = screen.getByRole("button", {
      name: "chat.thread.actions.send",
    });
    assert.equal(sendButton.hasAttribute("disabled"), true);
    assert.equal(
      screen.queryByRole("button", { name: "chat.thread.composer.cancelGeneration" }),
      null,
    );
  });

});
