// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ChatRuntime } from "@/shared/uchat/core";
import {
  AppChatRuntimeProvider,
  useChatRuntime,
  useChatRuntimeSelector,
  useChatThreadDraftState,
} from "./runtime";

const runtimeAdapterMocks = vi.hoisted(() => ({
  repositoryConstructions: 0,
  listThreads: vi.fn(async () => []),
  getThread: vi.fn(),
  getCreateThreadInput: undefined as undefined | (() => unknown),
}));

vi.mock("./protocol", () => ({
  DesktopChatRepository: class DesktopChatRepository {
    constructor(getCreateThreadInput: () => unknown) {
      runtimeAdapterMocks.repositoryConstructions += 1;
      runtimeAdapterMocks.getCreateThreadInput = getCreateThreadInput;
    }

    listThreads = runtimeAdapterMocks.listThreads;
    getThread = runtimeAdapterMocks.getThread;
  },
  DesktopChatRunDriver: class DesktopChatRunDriver {},
  DesktopChatAttachmentDriver: class DesktopChatAttachmentDriver {},
}));

vi.mock("./runtimePolicies", () => ({
  createDesktopThreadCreationPolicy: () => ({}),
  createDesktopComposerActions: () => [],
  desktopMessagePresentationHints: {},
  desktopSendLifecyclePolicy: {},
  desktopThreadSelectionPolicy: { autoSelectAfterLoad: "none" },
}));

vi.mock("../adapters/chatMediaOrchestration", () => ({
  createChatMediaLifecyclePolicy: (policy: unknown) => policy,
}));

function StateProbe({ label }: { label: string }) {
  const runtime = useChatRuntime();
  const composerText = useChatRuntimeSelector((state) => state.composer.text);
  const attachmentCount = useChatRuntimeSelector(
    (state) => state.composer.attachments.length,
  );
  const {
    draftRoleId,
    draftAgentEnabled,
    setDraftRoleId,
    setDraftAgentEnabled,
    resetDraft,
  } = useChatThreadDraftState();

  return (
    <div>
      <div data-testid="surface-label">{label}</div>
      <div data-testid="composer-text">{composerText}</div>
      <div data-testid="attachment-count">{attachmentCount}</div>
      <div data-testid="draft-role">{draftRoleId ?? ""}</div>
      <div data-testid="draft-agent-enabled">{String(draftAgentEnabled)}</div>
      <button type="button" onClick={() => runtime.setComposerText("draft text")}>
        set-composer
      </button>
      <button type="button" onClick={() => setDraftRoleId("role-1")}>
        set-role
      </button>
      <button type="button" onClick={() => setDraftAgentEnabled(false)}>
        disable-agent-draft
      </button>
      <button type="button" onClick={() => resetDraft()}>
        reset-draft
      </button>
      <button
        type="button"
        onClick={() =>
          runtime.setComposerAttachments([
            new File(["draft"], "draft.txt", { type: "text/plain" }),
          ])
        }
      >
        set-attachment
      </button>
    </div>
  );
}

beforeEach(() => {
  runtimeAdapterMocks.repositoryConstructions = 0;
  runtimeAdapterMocks.listThreads.mockClear();
  runtimeAdapterMocks.getThread.mockClear();
  runtimeAdapterMocks.getCreateThreadInput = undefined;
  globalThis.localStorage.clear();
});

test("new conversation draft defaults to Agent Runtime", async () => {
  render(
    <AppChatRuntimeProvider sessionKey="user-1">
      <StateProbe label="chat" />
    </AppChatRuntimeProvider>,
  );

  await waitFor(() => expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("draft-agent-enabled")).toHaveTextContent("true");
});

test("new conversation thread creation input selects Agent Runtime", async () => {
  render(
    <AppChatRuntimeProvider sessionKey="user-1">
      <StateProbe label="chat" />
    </AppChatRuntimeProvider>,
  );

  await waitFor(() => expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1));
  expect(runtimeAdapterMocks.getCreateThreadInput?.()).toEqual(
    expect.objectContaining({ agentEnabled: true }),
  );
});

test("resetting to a new conversation restores the Agent Runtime default", async () => {
  render(
    <AppChatRuntimeProvider sessionKey="user-1">
      <StateProbe label="chat" />
    </AppChatRuntimeProvider>,
  );

  await waitFor(() => expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "disable-agent-draft" }));
  expect(screen.getByTestId("draft-agent-enabled")).toHaveTextContent("false");

  fireEvent.click(screen.getByRole("button", { name: "reset-draft" }));
  expect(screen.getByTestId("draft-agent-enabled")).toHaveTextContent("true");
});

test("desktop integration preserves runtime and business drafts for the same session", async () => {
  const cancelSendSpy = vi.spyOn(ChatRuntime.prototype, "cancelSend");
  const { rerender } = render(
    <AppChatRuntimeProvider sessionKey="user-1">
      <StateProbe label="chat" />
    </AppChatRuntimeProvider>,
  );

  await waitFor(() => expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "set-composer" }));
  fireEvent.click(screen.getByRole("button", { name: "set-role" }));
  fireEvent.click(screen.getByRole("button", { name: "set-attachment" }));

  rerender(
    <AppChatRuntimeProvider sessionKey="user-1">
      <StateProbe label="settings-return" />
    </AppChatRuntimeProvider>,
  );

  expect(screen.getByTestId("surface-label")).toHaveTextContent("settings-return");
  expect(screen.getByTestId("composer-text")).toHaveTextContent("draft text");
  expect(screen.getByTestId("attachment-count")).toHaveTextContent("1");
  expect(screen.getByTestId("draft-role")).toHaveTextContent("role-1");
  expect(runtimeAdapterMocks.repositoryConstructions).toBe(1);
  expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1);
  expect(runtimeAdapterMocks.getThread).not.toHaveBeenCalled();
  expect(cancelSendSpy).not.toHaveBeenCalled();
  cancelSendSpy.mockRestore();
});

test("desktop integration does not duplicate runtime listeners on repeated route renders", async () => {
  const addEventListenerSpy = vi.spyOn(window, "addEventListener");
  const { rerender } = render(
    <AppChatRuntimeProvider sessionKey="user-1">
      <StateProbe label="chat" />
    </AppChatRuntimeProvider>,
  );

  await waitFor(() => expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1));
  const listenerCountAfterMount = addEventListenerSpy.mock.calls.length;

  for (let index = 0; index < 20; index += 1) {
    rerender(
      <AppChatRuntimeProvider sessionKey="user-1">
        <StateProbe label={`route-${index}`} />
      </AppChatRuntimeProvider>,
    );
  }

  expect(addEventListenerSpy).toHaveBeenCalledTimes(listenerCountAfterMount);
  expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1);
  addEventListenerSpy.mockRestore();
});

test("desktop integration resets runtime and business drafts for a different session", async () => {
  const cancelSendSpy = vi.spyOn(ChatRuntime.prototype, "cancelSend");
  const { rerender } = render(
    <AppChatRuntimeProvider sessionKey="user-1">
      <StateProbe label="user-1" />
    </AppChatRuntimeProvider>,
  );

  await waitFor(() => expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "set-composer" }));
  fireEvent.click(screen.getByRole("button", { name: "set-role" }));
  fireEvent.click(screen.getByRole("button", { name: "set-attachment" }));

  rerender(
    <AppChatRuntimeProvider sessionKey="user-2">
      <StateProbe label="user-2" />
    </AppChatRuntimeProvider>,
  );

  await waitFor(() => expect(runtimeAdapterMocks.listThreads).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("composer-text")).toBeEmptyDOMElement();
  expect(screen.getByTestId("attachment-count")).toHaveTextContent("0");
  expect(screen.getByTestId("draft-role")).toBeEmptyDOMElement();
  expect(runtimeAdapterMocks.repositoryConstructions).toBe(2);
  expect(cancelSendSpy).toHaveBeenCalledTimes(1);
  cancelSendSpy.mockRestore();
});
