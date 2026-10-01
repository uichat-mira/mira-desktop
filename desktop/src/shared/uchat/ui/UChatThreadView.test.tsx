// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, test, vi } from "vitest";
import "@/shared/i18n";
import i18n from "@/shared/i18n";
import { UChatThreadView } from "./UChatThreadView";
import type { ChatMessage } from "../core";
import type { UChatMessageExtensionProps } from "./UChatThreadSlots";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

afterAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

vi.mock("@/app/providers/ThemeProvider", () => ({
  useThemePreferences: () => ({
    colorTheme: "warm-neutral",
    themeMode: "light",
    setColorTheme: () => {},
    setThemeMode: () => {},
    themePresets: [],
  }),
}));

const baseAssistantMessage = (
  overrides: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: overrides.id ?? "assistant-1",
  threadId: overrides.threadId ?? "thread-1",
  role: "assistant",
  parts: overrides.parts ?? [{ type: "text", text: "answer" }],
  createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
  parentId: overrides.parentId ?? "user-1",
  status: overrides.status ?? "complete",
  metadata: overrides.metadata,
  toolTrace: overrides.toolTrace,
  errorMessage: overrides.errorMessage,
});

const baseUserMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: overrides.id ?? "user-1",
  threadId: overrides.threadId ?? "thread-1",
  role: "user",
  parts: overrides.parts ?? [{ type: "text", text: "question" }],
  createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
  parentId: overrides.parentId ?? null,
  status: overrides.status ?? "complete",
  metadata: overrides.metadata,
});

test("UChatThreadView hides legacy tool trace card when execution trace parts exist", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          parts: [
            {
              type: "data",
              name: "execution-node",
              value: {
                nodeId: "tool-1",
                nodeType: "tool",
                phase: "done",
                label: "web_search",
                summary: "web_search completed",
                details: {
                  toolName: "web_search",
                },
              },
            },
            { type: "text", text: "answer" },
          ],
          toolTrace: [
            {
              toolCallId: "tool-1",
              toolName: "web_search",
              status: "succeeded",
              output: { provider: "tavily", results: [{ title: "Today" }] },
            },
          ],
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  assert.ok(screen.getByText("web_search"));
  assert.equal(screen.queryByText("Tool Calls"), null);
});

test("UChatThreadView mounts named message extensions in content and action positions", () => {
  function TestMessageExtensions({
    message,
    placement,
  }: UChatMessageExtensionProps) {
    return (
      <span data-testid={`message-extension-${placement}`}>
        {message.id}:{placement}
      </span>
    );
  }

  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[baseAssistantMessage()]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
      slots={{ MessageExtensions: TestMessageExtensions }}
    />,
  );

  const answer = screen.getByText("answer");
  const contentExtension = screen.getByTestId("message-extension-content");
  assert.ok(
    answer.compareDocumentPosition(contentExtension) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.equal(
    screen.getByTestId("message-extension-actions").textContent,
    "assistant-1:actions",
  );
});

test("UChatThreadView keeps attachments functional in the compact user message editor", async () => {
  const onEditUserMessage = vi.fn();
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseUserMessage({
          parts: [
            { type: "text", text: "question" },
            {
              type: "image",
              source: "/attachments/diagram.png",
              name: "diagram.png",
              mimeType: "image/png",
              assetId: "image-1",
            },
            {
              type: "file",
              source: "/attachments/report.pdf",
              name: "report.pdf",
              mimeType: "application/pdf",
              assetId: "file-1",
            },
          ],
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onEditUserMessage={onEditUserMessage}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));

  const editor = screen.getByPlaceholderText("Edit");
  assert.equal(editor.getAttribute("rows"), "1");
  fireEvent.change(editor, {
    target: { value: "first line\nsecond line\nthird line" },
  });
  assert.equal(
    (editor as HTMLTextAreaElement).value,
    "first line\nsecond line\nthird line",
  );
  assert.ok(screen.getByRole("img", { name: "diagram.png" }));
  assert.ok(screen.getByText("report.pdf"));
  assert.ok(screen.getByRole("button", { name: "Reset" }));
  assert.ok(screen.getByRole("button", { name: "Cancel" }));

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  assert.equal(screen.queryByRole("img", { name: "diagram.png" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    assert.equal(onEditUserMessage.mock.calls.length, 1);
  });
  const submittedParts = onEditUserMessage.mock.calls[0]?.[2] as
    | ChatMessage["parts"]
    | undefined;
  assert.deepEqual(submittedParts?.[0], {
    type: "text",
    text: "first line\nsecond line\nthird line",
  });
  assert.equal(submittedParts?.some((part) => part.type === "image"), false);
  assert.equal(submittedParts?.some((part) => part.type === "file"), true);
});

test("UChatThreadView shows loading skeleton instead of welcome hero while hydrating a persisted thread", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="loading"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  assert.ok(screen.getByTestId("uchat-thread-loading-skeleton"));
  assert.equal(screen.queryByText(i18n.t("chat.thread.empty.heading")), null);
});

test("UChatThreadView still shows welcome hero for the draft welcome state", () => {
  const { container } = render(
    <UChatThreadView
      activeThreadId={null}
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="idle"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  const heroImage = container.querySelector('img[src*="welcome-astronaut-hero.png"]');
  assert.ok(heroImage);
  assert.equal(screen.queryByTestId("uchat-thread-loading-skeleton"), null);
});

test("UChatThreadView still shows legacy tool trace card when no execution trace exists", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          toolTrace: [
            {
              toolCallId: "tool-1",
              toolName: "web_search",
              status: "succeeded",
              output: { provider: "tavily", results: [{ title: "Today" }] },
            },
          ],
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  assert.ok(screen.getByText("Tool Calls"));
});

test("UChatThreadView calls onAgentSend when the Agent button is clicked", () => {
  const onAgentSend = vi.fn();

  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "hello", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      agent={{
        enabled: true,
        submissionAvailability: { enabled: true },
        onSubmit: onAgentSend,
        onApprove: () => {},
        onReject: () => {},
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  const submit = screen.getByRole("button", {
    name: i18n.t("chat.thread.actions.send"),
  });
  fireEvent.click(submit);
  assert.equal(onAgentSend.mock.calls.length, 1);
  assert.equal(
    screen.queryByRole("button", { name: i18n.t("chat.thread.agent.run") }),
    null,
  );
});

test("UChatThreadView renders Agent mode through the composer tools slot", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "hello", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      agent={{
        enabled: false,
        toggleAvailability: { enabled: true },
        onToggle: () => {},
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
      slots={{
        ComposerTools: () => <span>Additional composer tool</span>,
      }}
    />,
  );

  const toggle = screen.getByRole("button", { name: "Enable Agent" });
  const additionalTool = screen.getByText("Additional composer tool");
  const composerSurface = screen.getByRole("textbox").parentElement;
  assert.ok(composerSurface);
  assert.equal(composerSurface.contains(toggle), true);
  assert.equal(composerSurface.contains(additionalTool), true);
});

test("UChatThreadView disables send arrow when Agent is enabled but workspace is unavailable", () => {
  const onAgentSend = vi.fn();
  const onSend = vi.fn();

  render(
    <UChatThreadView
      activeThreadId={null}
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "hello", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={onSend}
      agent={{
        enabled: true,
        onSubmit: onAgentSend,
        onApprove: () => {},
        onReject: () => {},
        submissionAvailability: {
          enabled: false,
          disabledReason: "Bind a workspace before using Agent.",
        },
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  const button = screen.getByRole("button", {
    name: i18n.t("chat.thread.actions.send"),
  });
  assert.equal(button.hasAttribute("disabled"), true);
  fireEvent.click(button);
  assert.equal(onAgentSend.mock.calls.length, 0);
  assert.equal(onSend.mock.calls.length, 0);
});

test("UChatThreadView keeps normal send enabled when Agent toggle is off", () => {
  const onAgentSend = vi.fn();
  const onSend = vi.fn();

  render(
    <UChatThreadView
      activeThreadId={null}
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "hello", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={onSend}
      agent={{
        enabled: false,
        onSubmit: onAgentSend,
        onApprove: () => {},
        onReject: () => {},
        submissionAvailability: {
          enabled: false,
          disabledReason: "Bind a workspace before using Agent.",
        },
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  const button = screen.getByRole("button", {
    name: "chat.thread.actions.send",
  });
  assert.equal(button.hasAttribute("disabled"), false);
  fireEvent.click(button);
  assert.equal(onSend.mock.calls.length, 1);
  assert.equal(onAgentSend.mock.calls.length, 0);
});

test("UChatThreadView renders the ComposerTools slot", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "hello", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
      slots={{
        ComposerTools: () => <span>Injected composer tools</span>,
      }}
    />,
  );

  assert.ok(screen.getByText("Injected composer tools"));
});

test("UChatThreadView renders app-owned composer suggestions above the composer", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "$", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
      composerSuggestion={<span>Agent skill suggestions</span>}
    />,
  );

  const composerSurface = screen.getByRole("textbox").parentElement;
  const suggestion = screen.getByText("Agent skill suggestions");
  assert.equal(composerSurface?.contains(suggestion), false);
  assert.equal(
    composerSurface?.parentElement?.contains(suggestion),
    true,
  );
});

test("UChatThreadView exposes workspace submenu actions from composer menu", async () => {
  const user = userEvent.setup();

  render(
    <UChatThreadView
      activeThreadId={null}
      title="Thread"
      badges={[]}
      messages={[]}
      composer={{ text: "hello", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{
        composerActions: [
          {
            id: "workspace-actions",
            kind: "menu",
            label: "Workspace",
            title: "Workspace actions",
            children: [
              {
                id: "workspace-add-thread",
                kind: "command",
                label: "Add to workspace",
                title: "Add thread to workspace",
              },
              {
                id: "workspace-create",
                kind: "command",
                label: "Create workspace",
                title: "Create workspace",
              },
            ],
          },
        ],
        messagePresentation: {},
      }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Composer menu" }));
  await user.hover(screen.getByRole("menuitem", { name: "Workspace" }));

  assert.ok(await screen.findByRole("menuitem", { name: "Add to workspace" }));
  assert.ok(screen.getByRole("menuitem", { name: "Create workspace" }));
});

test("UChatThreadView renders blocked agent status", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          metadata: {
            agent: {
              status: "blocked",
              errorMessage: "Agent run did not produce an answer.",
            },
          },
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  assert.ok(screen.getByText(i18n.t("chat.thread.agent.blockedTitle")));
  assert.ok(screen.getByText("Agent run did not produce an answer."));
});

test("UChatThreadView renders failed agent status when failure card is not present", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          metadata: {
            agent: {
              status: "failed",
              errorMessage: "Agent tool execution failed.",
            },
          },
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  assert.ok(screen.getByText(i18n.t("chat.thread.agent.failedTitle")));
  assert.ok(screen.getByText("Agent tool execution failed."));
});

test("UChatThreadView shows agent running copy for streaming agent reply", () => {
  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          status: "streaming",
          parts: [],
          metadata: {
            agent: {
              status: "completed",
            },
          },
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "running" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      agent={{ enabled: true, running: true }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  assert.ok(screen.getByText(i18n.t("chat.thread.agent.running")));
});

test("UChatThreadView shows approve and reject actions for waiting approval agent messages", () => {
  const onApproveAgentRun = vi.fn();

  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          metadata: {
            agent: {
              status: "waiting_approval",
              runId: "run-1",
              pendingApproval: {
                toolId: "terminal_session",
                reason: "需要人工审批后继续。",
              },
            },
          },
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      agent={{
        enabled: true,
        onApprove: onApproveAgentRun,
        onReject: () => Promise.resolve(),
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  assert.ok(screen.getByRole("button", { name: "Approve" }));
  assert.ok(screen.getByRole("button", { name: "Reject" }));
});

test("UChatThreadView calls approve action for waiting approval agent messages", async () => {
  const onApproveAgentRun = vi.fn(() => Promise.resolve());

  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          metadata: {
            agent: {
              status: "waiting_approval",
              runId: "run-1",
              pendingApproval: {
                toolId: "terminal_session",
                reason: "需要人工审批后继续。",
              },
            },
          },
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      agent={{
        enabled: true,
        onApprove: onApproveAgentRun,
        onReject: () => Promise.resolve(),
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await Promise.resolve();
  });

  assert.equal(onApproveAgentRun.mock.calls.length, 1);
  assert.deepEqual(onApproveAgentRun.mock.calls[0], ["run-1"]);
});

test("UChatThreadView calls reject action for waiting approval agent messages", async () => {
  const onRejectAgentRun = vi.fn(() => Promise.resolve());

  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          metadata: {
            agent: {
              status: "waiting_approval",
              runId: "run-1",
              pendingApproval: {
                toolId: "terminal_session",
                reason: "需要人工审批后继续。",
              },
            },
          },
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      agent={{
        enabled: true,
        onApprove: () => Promise.resolve(),
        onReject: onRejectAgentRun,
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await Promise.resolve();
  });

  assert.equal(onRejectAgentRun.mock.calls.length, 1);
  assert.deepEqual(onRejectAgentRun.mock.calls[0], ["run-1"]);
});

test("UChatThreadView shows inline error and re-enables buttons when approval fails", async () => {
  const onApproveAgentRun = vi.fn(
    () => Promise.reject(new Error("审批服务暂时不可用")),
  );

  render(
    <UChatThreadView
      activeThreadId="thread-1"
      title="Thread"
      badges={[]}
      messages={[
        baseAssistantMessage({
          metadata: {
            agent: {
              status: "waiting_approval",
              runId: "run-1",
              pendingApproval: {
                toolId: "terminal_session",
                reason: "需要人工审批后继续。",
              },
            },
          },
        }),
      ]}
      composer={{ text: "", attachments: [] }}
      runStatus={{ type: "idle" }}
      threadStatus="ready"
      capabilities={{ composerActions: [], messagePresentation: {} }}
      hasKnowledgeBase={false}
      placeholder="Type"
      isSendDisabled={false}
      onComposerTextChange={() => {}}
      onComposerAttachmentsChange={() => {}}
      onSend={() => {}}
      agent={{
        enabled: true,
        onApprove: onApproveAgentRun,
        onReject: () => Promise.resolve(),
      }}
      onComposerAction={() => {}}
      threadContextTags={[]}
      resolveAttachmentSource={(value) => value}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  });

  await waitFor(() => {
    assert.ok(screen.getByText("审批服务暂时不可用"));
  });
  assert.equal(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled"), false);
  assert.equal(screen.getByRole("button", { name: "Reject" }).hasAttribute("disabled"), false);
});
