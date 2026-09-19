// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider, initReactI18next } from "react-i18next";
import i18next from "i18next";

const mockedApis = vi.hoisted(() => ({
  modalConfirmMock: vi.fn(),
  createChatWorkspaceMock: vi.fn(),
  deleteChatWorkspaceMock: vi.fn(),
  runtimeArchiveThreadMock: vi.fn(),
  runtimeDeleteThreadMock: vi.fn(),
  runtimeSetActiveThreadIdMock: vi.fn(),
  resetDraftMock: vi.fn(),
  navigateMock: vi.fn(),
  desktopPlatform: "win32",
}));

const mockSidebarState = {
  threads: [
    {
      id: "thread-1",
      title: "Alpha Thread",
      createdAt: "2026-06-27T08:00:00.000Z",
      updatedAt: "2026-06-27T08:00:00.000Z",
      workspaceId: null,
    },
  ],
  activeThreadId: null,
  threadListStatus: "ready",
  capabilities: {
    archiveThread: true,
    deleteThread: true,
  },
} as const;

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockedApis.navigateMock,
}));

vi.mock("@/features/chat/core/runtime", () => ({
  useChatRuntime: () => ({
    enterWelcomeState: vi.fn(),
    selectThread: vi.fn(),
    getState: () => ({ activeThreadId: mockSidebarState.activeThreadId }),
    archiveThread: mockedApis.runtimeArchiveThreadMock,
    deleteThread: mockedApis.runtimeDeleteThreadMock,
    refreshThread: vi.fn(),
    store: {
      getState: () => ({
        resetComposer: vi.fn(),
        setActiveThreadId: mockedApis.runtimeSetActiveThreadIdMock,
      }),
    },
  }),
  useChatThreadDraftState: () => ({
    resetDraft: mockedApis.resetDraftMock,
  }),
  useChatRuntimeSelector: (selector: (state: any) => any) =>
    selector(mockSidebarState),
}));

vi.mock("@/shared/api/thread", () => ({
  listChatWorkspaces: async () => [],
  createChatWorkspace: mockedApis.createChatWorkspaceMock,
  deleteChatWorkspace: mockedApis.deleteChatWorkspaceMock,
}));

vi.mock("@/shared/platform/desktopRuntime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/platform/desktopRuntime")>();
  return {
    ...actual,
    getDesktopRuntime: () => ({
      hostKind: "electron",
      platform: mockedApis.desktopPlatform,
      isPackaged: false,
      backendUrl: "http://127.0.0.1:3000",
    }),
  };
});

vi.mock("@/shared/ui", async () => {
  const actual = await vi.importActual("@/shared/ui");
  const actualModal = (actual as { Modal: unknown }).Modal;
  return {
    ...actual,
    Modal: Object.assign(actualModal as object, {
      confirm: mockedApis.modalConfirmMock,
    }),
  };
});

vi.mock("@/shared/uchat/ui", () => ({
  UChatSidebarView: ({
    sidebarEntries = [],
    onSidebarEntryClick,
    onCreateWorkspace,
    onDeleteWorkspace,
    onDeleteThread,
  }: {
    sidebarEntries?: Array<{ id: string; label: string }>;
    onSidebarEntryClick?: (entry: { id: string; label: string }) => void | Promise<void>;
    onCreateWorkspace?: () => void | Promise<void>;
    onDeleteWorkspace?: (workspaceId: string) => void | Promise<void>;
    onDeleteThread?: (threadId: string) => void | Promise<void>;
  }) => (
    <div>
      {sidebarEntries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => {
            void onSidebarEntryClick?.(entry);
          }}
        >
          {entry.label}
        </button>
      ))}
      <button type="button" onClick={() => void onCreateWorkspace?.()}>
        Create Workspace
      </button>
      <button type="button" onClick={() => void onDeleteWorkspace?.("workspace-1")}>
        Delete Workspace
      </button>
      <button type="button" onClick={() => void onDeleteThread?.("thread-1")}>
        Delete Thread
      </button>
    </div>
  ),
}));

vi.mock("./UChatSidebarToolsModal", () => ({
  UChatSidebarToolsModal: ({
    mode,
    open,
  }: {
    mode: string | null;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="sidebar-tools-modal">{mode}</div>
    ) : null,
}));

import { UChatThreadListSidebar } from "./UChatThreadListSidebar";

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        "chat.sidebar.newConversation": "New Conversation",
        "chat.sidebar.tools.search": "Chat Search",
        "chat.sidebar.workspaceCreate": "Create Workspace",
        "chat.sidebar.threadDeleteTitle": "Delete Conversation",
        "chat.sidebar.threadDeleteDescription":
          "Deleting this conversation will permanently remove all messages in it. This action cannot be undone.",
        "chat.sidebar.threadDeleteConfirm": "Delete Conversation",
        "chat.sidebar.workspaceName": "Workspace Name",
        "chat.sidebar.workspaceRootPath": "Workspace Root Path",
        "chat.sidebar.workspaceRootPathInvalid": "Enter a valid absolute directory path",
        "chat.sidebar.workspaceDeleteTitle": "Delete Workspace",
        "chat.sidebar.workspaceDeleteDescription":
          "Deleting this workspace will also delete all threads inside it. This action cannot be undone.",
        "chat.sidebar.workspaceDeleteConfirm": "Delete Workspace",
        "chat.sidebar.untitledConversation": "Untitled",
        "common.actions.cancel": "Cancel",
      },
    },
  },
});

describe("UChatThreadListSidebar", () => {
  beforeEach(() => {
    mockedApis.createChatWorkspaceMock.mockReset();
    mockedApis.navigateMock.mockReset();
    mockedApis.desktopPlatform = "win32";
  });

  it("shows confirmation before deleting a thread", async () => {
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={i18n}>
        <UChatThreadListSidebar />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Delete Thread" }));

    expect(mockedApis.modalConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete Conversation",
        description:
          "Deleting this conversation will permanently remove all messages in it. This action cannot be undone.",
        confirmText: "Delete Conversation",
        tone: "danger",
      }),
    );
    expect(mockedApis.runtimeDeleteThreadMock).not.toHaveBeenCalled();
  });

  it("clears the active thread after deleting the selected history thread", async () => {
    const user = userEvent.setup();
    mockSidebarState.activeThreadId = "thread-1";

    render(
      <I18nextProvider i18n={i18n}>
        <UChatThreadListSidebar />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Delete Thread" }));
    const confirmConfig = mockedApis.modalConfirmMock.mock.calls.at(-1)?.[0];
    expect(confirmConfig).toEqual(
      expect.objectContaining({
        onConfirm: expect.any(Function),
      }),
    );

    await confirmConfig.onConfirm();

    expect(mockedApis.runtimeDeleteThreadMock).toHaveBeenCalledWith("thread-1");
    expect(mockedApis.runtimeSetActiveThreadIdMock).toHaveBeenCalledWith(null);
    mockSidebarState.activeThreadId = null;
  });

  it("clears the active thread after archiving the selected history thread", async () => {
    mockSidebarState.activeThreadId = "thread-1";

    const runtime = (await import("@/features/chat/core/runtime")).useChatRuntime();
    await runtime.archiveThread("thread-1");
    runtime.store.getState().setActiveThreadId(null);

    expect(mockedApis.runtimeArchiveThreadMock).toHaveBeenCalledWith("thread-1");
    expect(mockedApis.runtimeSetActiveThreadIdMock).toHaveBeenCalledWith(null);
    mockSidebarState.activeThreadId = null;
  });

  it("shows confirmation before deleting a workspace", async () => {
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={i18n}>
        <UChatThreadListSidebar />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    expect(mockedApis.modalConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete Workspace",
        description:
          "Deleting this workspace will also delete all threads inside it. This action cannot be undone.",
        confirmText: "Delete Workspace",
        tone: "danger",
      }),
    );
    expect(mockedApis.deleteChatWorkspaceMock).not.toHaveBeenCalled();
  });

  it("opens the search modal from the sidebar entry", async () => {
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={i18n}>
        <UChatThreadListSidebar />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Chat Search" }));

    expect(screen.getByTestId("sidebar-tools-modal")).toHaveTextContent("search");
  });

  it("opens Cuixing through the app integration sidebar entry", async () => {
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={i18n}>
        <UChatThreadListSidebar />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "淬行" }));

    expect(mockedApis.navigateMock).toHaveBeenCalledWith("/forge");
  });

  it("shows inline validation for invalid workspace root paths", async () => {
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={i18n}>
        <UChatThreadListSidebar />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Create Workspace" }));
    await user.type(await screen.findByRole("textbox", { name: "Workspace Name" }), "Project Alpha");
    await user.type(await screen.findByRole("textbox", { name: "Workspace Root Path" }), "D");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create Workspace" }));

    expect(screen.getByText("Enter a valid absolute directory path")).toBeInTheDocument();
  });

  it("creates a workspace with a POSIX absolute path on macOS", async () => {
    mockedApis.desktopPlatform = "darwin";
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={i18n}>
        <UChatThreadListSidebar />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Create Workspace" }));
    await user.type(
      await screen.findByRole("textbox", { name: "Workspace Name" }),
      "Mac Project",
    );
    await user.type(
      await screen.findByRole("textbox", { name: "Workspace Root Path" }),
      "/Users/tao/Documents/UIChat Mira/中文工作区",
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Create Workspace" }),
    );

    await waitFor(() => {
      expect(mockedApis.createChatWorkspaceMock).toHaveBeenCalledWith({
        name: "Mac Project",
        rootPath: "/Users/tao/Documents/UIChat Mira/中文工作区",
      });
    });
  });
});
