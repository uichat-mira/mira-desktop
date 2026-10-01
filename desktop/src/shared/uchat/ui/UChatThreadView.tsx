"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowUp,
  Copy,
  FileUp,
  Folder,
  LibraryBig,
  MessageSquareText,
  Paperclip,
  Plus,
  PencilLine,
  RefreshCcw,
  UserRound,
  Square,
  X,
} from "lucide-react";
import type {
  ChatComposerAction,
  ChatComposerState,
  ChatMessage,
  ChatMessagePresentationHints,
  ChatMessagePart,
  ChatRunStatus,
  ChatRuntimeCapabilities,
  ChatThreadContextTag,
} from "../core";
import ImagePreviewOverlay from "@/shared/ui/ImagePreviewOverlay";
import chatStartLogoLight from "@/assets/branding/chat-start-logo-light.png";
import chatStartLogoDark from "@/assets/branding/chat-start-logo-dark.png";
import { useThemePreferences } from "@/app/providers/ThemeProvider";
import MarkdownText from "@/shared/ui/MarkdownText";
import Badge from "@/shared/ui/Badge";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import Tooltip from "@/shared/ui/Tooltip";
import { Button, Skeleton } from "@/shared/ui";
import StreamingTextRenderer from "@/shared/ui/StreamingTextRenderer";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { message as uiMessage } from "@/shared/ui/Message";
import {
  getVisibleExecutionSources,
  type UChatExecutionProgressDetail,
  type UChatExecutionSourceDetail,
} from "./executionParsers";
import type { RagSourceLike } from "./ragTypes";
import {
  UChatAssistantAvatar,
  UChatAssistantBubbleShell,
  UChatUserBubbleShell,
} from "./UChatMessageBubbleShells";
import { UChatExecutionTrace } from "./UChatExecutionTrace";
import {
  resolveUChatAgentSubmission,
  resolveUChatTypingLabel,
  UChatAgentComposerTools,
  type UChatAgentUIController,
} from "./UChatAgentControls";
import { UChatAgentMessageStatus } from "./UChatAgentMessageStatus";
import { useUChatMessageTrace } from "./UChatMessageTrace";
import { UChatRagProgressDetailDrawer } from "./UChatRagProgressDetailDrawer";
import { UChatRagSourceDetailDrawer } from "./UChatRagSourceDetailDrawer";
import { UChatThreadHeader } from "./UChatThreadHeader";
import { UChatToolTrace } from "./UChatToolTrace";
import { UChatWelcomeEmptyState } from "./UChatWelcomeEmptyState";
import type { UChatThreadSlots } from "./UChatThreadSlots";

const shellClassName =
  "relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-secondary text-text-primary";

const resolveMessagePresentationKey = (
  message: ChatMessage,
  messageIndex: number,
) =>
  message.role === "assistant" && message.parentId
    ? `${message.threadId}:assistant:${message.parentId}:${messageIndex}`
    : message.id;

const backdropOrbsClassName =
  "pointer-events-none absolute inset-0 overflow-hidden";

const contentColumnClassName =
  "mx-auto flex w-full flex-1 flex-col px-4 pb-[12.5rem] pt-4 sm:px-6 lg:px-8";

const actionButtonClassName =
  "inline-flex h-chat-action w-chat-action items-center justify-center rounded-full border border-border/70 bg-surface-primary/92 text-text-secondary transition-colors hover:border-border hover:bg-surface-primary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20";

const messageMarkdownClassName =
  "space-y-chat-markdown-block text-chat-message [&_h1]:mb-chat-markdown-heading-bottom [&_h1]:mt-chat-markdown-heading-top [&_h1]:text-chat-markdown-h1 [&_h2]:mb-chat-markdown-heading-bottom [&_h2]:mt-chat-markdown-heading-top [&_h2]:text-chat-markdown-h2 [&_h3]:mb-chat-markdown-heading-bottom [&_h3]:mt-chat-markdown-heading-top [&_h3]:text-chat-markdown-h3 [&_h4]:mb-chat-markdown-heading-bottom [&_h4]:mt-chat-markdown-heading-top [&_h4]:text-chat-markdown-h4 [&_h5]:mb-chat-markdown-heading-bottom [&_h5]:mt-chat-markdown-heading-top [&_h5]:text-chat-markdown-h5 [&_h6]:mb-chat-markdown-heading-bottom [&_h6]:mt-chat-markdown-heading-top [&_h6]:text-chat-markdown-h6 [&_li]:py-chat-markdown-list-item-y [&_p]:leading-chat-markdown-paragraph";

type ImagePreviewState = {
  src: string;
};

type DisplayMessagePart = Exclude<ChatMessagePart, { type: "data" }>;

type EditingAttachmentPart = Extract<DisplayMessagePart, { type: "image" | "file" }>;

const buildEditedUserMessageParts = (
  originalParts: DisplayMessagePart[],
  nextText: string,
  removedAttachmentKeys: Set<string> = new Set(),
): DisplayMessagePart[] => {
  const trimmedText = nextText.trim();
  const nextParts: DisplayMessagePart[] = [];

  if (trimmedText) {
    nextParts.push({
      type: "text",
      text: trimmedText,
    });
  }

  return [
    ...nextParts,
    ...originalParts.filter((part): part is EditingAttachmentPart => {
      if (part.type !== "image" && part.type !== "file") {
        return false;
      }

      return true;
    }).filter((part, index) => !removedAttachmentKeys.has(`${part.type}-${index}`)),
  ];
};

const attachmentPlaceholderPattern = /\[(?:Image|File) attachment:[^\]]+\]/g;

const stripAttachmentPlaceholders = (text: string) =>
  text.replace(attachmentPlaceholderPattern, "").replace(/\n{3,}/g, "\n\n");

const imageFileExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
]);

const isImageFile = (file: File) =>
  file.type.startsWith("image/") ||
  imageFileExtensions.has(
    `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`,
  );

const widthClassMap = {
  compact: "max-w-[min(100%,28rem)] xl:max-w-[min(100%,30rem)]",
  regular: "max-w-[min(100%,38rem)] xl:max-w-[min(100%,42rem)]",
  wide: "max-w-[min(100%,46rem)] xl:max-w-[min(100%,52rem)]",
} as const;

const resolveBubbleWidthClassName = (
  width: ChatMessagePresentationHints["assistantMaxWidth"] | undefined,
) => widthClassMap[width ?? "regular"];

const collapseDisplayParts = (
  parts: ChatMessagePart[],
): DisplayMessagePart[] => {
  const collapsed: DisplayMessagePart[] = [];

  for (const part of parts) {
    if (part.type === "data") {
      continue;
    }

    const lastPart = collapsed.at(-1);
    if (part.type === "text" && lastPart?.type === "text") {
      const sanitizedText = stripAttachmentPlaceholders(part.text);
      if (!sanitizedText) {
        continue;
      }

      lastPart.text += sanitizedText;
      continue;
    }

    if (part.type === "text") {
      const sanitizedText = stripAttachmentPlaceholders(part.text);
      if (!sanitizedText) {
        continue;
      }

      collapsed.push({ type: "text", text: sanitizedText });
      continue;
    }

    collapsed.push(part);
  }

  return collapsed;
};

function UChatThreadLoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-5 py-4"
      data-testid="uchat-thread-loading-skeleton"
    >
      <div className="flex justify-start">
        <div className="max-w-[min(100%,38rem)] rounded-[24px] border border-border/60 bg-surface-primary/65 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-start gap-3">
            <Skeleton.Circle size={28} />
            <div className="min-w-0 flex-1">
              <Skeleton width="32%" height={12} className="mb-3" />
              <Skeleton.Text lines={3} lastLineWidth="72%" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[min(100%,30rem)] rounded-[24px] border border-border/60 bg-surface-primary/55 px-4 py-3">
          <Skeleton.Text lines={2} lastLineWidth="58%" />
        </div>
      </div>
      <div className="flex justify-start">
        <div className="max-w-[min(100%,40rem)] rounded-[24px] border border-border/60 bg-surface-primary/65 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-start gap-3">
            <Skeleton.Circle size={28} />
            <div className="min-w-0 flex-1">
              <Skeleton width="24%" height={12} className="mb-3" />
              <Skeleton.Text lines={4} lastLineWidth="64%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// MessagePartContent renders one canonical message part into visible content.
function MessagePartContent({
  part,
  preferMarkdownForText,
  isStreamingText = false,
  resolveAttachmentSource,
  onPreviewImage,
  onLoadMedia,
}: {
  part: ChatMessagePart;
  preferMarkdownForText: boolean;
  isStreamingText?: boolean;
  resolveAttachmentSource: (value: string) => string;
  onPreviewImage: (value: ImagePreviewState) => void;
  onLoadMedia?: () => void;
}) {
  if (part.type === "text") {
    if (preferMarkdownForText) {
      return (
        <StreamingTextRenderer
          text={part.text}
          isStreaming={isStreamingText}
        >
          {(visibleText) =>
            visibleText ? (
              <MarkdownText
                isAnimating={isStreamingText}
                className={messageMarkdownClassName}
              >
                {visibleText}
              </MarkdownText>
            ) : null
          }
        </StreamingTextRenderer>
      );
    }

    return <p className="whitespace-pre-wrap break-words">{part.text}</p>;
  }

  if (part.type === "image") {
    const imageUrl = resolveAttachmentSource(part.source);
    return (
      <button
        type="button"
        className="mb-2 block max-w-[min(100%,22rem)] overflow-hidden rounded-[14px] border border-border/70 bg-surface-primary shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
        onClick={() => onPreviewImage({ src: imageUrl })}
      >
        <img
          src={imageUrl}
          alt={part.name ?? ""}
          className="block max-h-[18rem] min-h-24 w-full cursor-zoom-in object-cover"
          onLoad={onLoadMedia}
          draggable={false}
        />
      </button>
    );
  }

  if (part.type === "file") {
    return (
      <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-2xl border border-border/70 bg-surface-primary/92 px-3 py-2 text-xs text-text-secondary shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <FileUp className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate font-medium text-text-primary">
          {part.name}
        </span>
      </div>
    );
  }

  return null;
}

// UChatThreadView is the pure presentational thread surface. It receives a
// fully prepared view model and emits user intents through callbacks.
export function UChatThreadView({
  activeThreadId,
  title,
  badges,
  messages,
  composer,
  runStatus,
  threadStatus,
  capabilities,
  hasKnowledgeBase,
  placeholder,
  isSendDisabled,
  isComposerDisabled = isSendDisabled,
  onComposerTextChange,
  onComposerAttachmentsChange,
  onComposerAttachmentsAppend,
  onComposerAttachmentRemove,
  onSend,
  onCancelSend,
  onRegenerate,
  onEditUserMessage,
  onComposerAction,
  threadContextTags,
  onRemoveThreadContextTag,
  resolveAttachmentSource,
  assistantAvatarSrc,
  assistantDisplayName,
  assistantTypingLabel,
  agent,
  renderComposerEditor,
  composerSuggestion,
  slots,
}: {
  activeThreadId: string | null;
  title: string;
  badges: Array<{
    key: string;
    name: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  }>;
  messages: ChatMessage[];
  composer: ChatComposerState;
  runStatus: ChatRunStatus;
  threadStatus: "idle" | "loading" | "ready" | "error";
  capabilities: ChatRuntimeCapabilities;
  hasKnowledgeBase: boolean;
  placeholder: string;
  isComposerDisabled?: boolean;
  isSendDisabled: boolean;
  onComposerTextChange: (value: string) => void;
  onComposerAttachmentsChange: (files: File[]) => void;
  onComposerAttachmentsAppend?: (files: File[]) => void | Promise<void>;
  onComposerAttachmentRemove?: (attachmentId: string) => void | Promise<void>;
  onSend: () => void | Promise<void>;
  onCancelSend?: () => void | Promise<void>;
  onRegenerate?: (messageId: string) => void | Promise<void>;
  onEditUserMessage?: (
    messageId: string,
    text: string,
    parts?: DisplayMessagePart[],
  ) => void | Promise<void>;
  onComposerAction: (action: ChatComposerAction) => void | Promise<void>;
  threadContextTags: ChatThreadContextTag[];
  onRemoveThreadContextTag?: (
    tag: ChatThreadContextTag,
  ) => void | Promise<void>;
  resolveAttachmentSource: (value: string) => string;
  assistantAvatarSrc?: string | null;
  assistantDisplayName?: string;
  assistantTypingLabel?: string;
  agent?: UChatAgentUIController;
  /** Optional app-owned editor replacing the default textarea. */
  renderComposerEditor?: (props: {
    value: string;
    placeholder: string;
    disabled: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onPasteFiles: (files: File[]) => void | Promise<void>;
  }) => React.ReactNode;
  /** Optional app-owned content rendered in a panel above the composer. */
  composerSuggestion?: React.ReactNode;
  slots?: UChatThreadSlots;
}) {
  const { t } = useTranslation();
  const { themeMode } = useThemePreferences();
  const chatStartLogo = themeMode === "dark" ? chatStartLogoDark : chatStartLogoLight;
  const isRunning = runStatus.type === "running";
  const isHydratingPersistedThread =
    activeThreadId !== null && threadStatus === "loading" && messages.length === 0;
  const showWelcomeEmptyState =
    activeThreadId === null && threadStatus !== "loading" && messages.length === 0;
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(
    null,
  );
  const [selectedRagProgressDetail, setSelectedRagProgressDetail] =
    useState<UChatExecutionProgressDetail | null>(null);
  const [selectedRagSourceDetail, setSelectedRagSourceDetail] =
    useState<UChatExecutionSourceDetail | null>(null);
  const [editingUserMessage, setEditingUserMessage] = useState<{
    id: string;
    draftText: string;
    originalText: string;
  } | null>(null);
  const messagePresentation = capabilities.messagePresentation ?? {};
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const isRunningRef = useRef(isRunning);
  const agentSubmission = resolveUChatAgentSubmission({
    controller: agent,
    isSendDisabled,
    onSend,
  });

  const scrollToBottom = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  const requestScrollToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    scheduleScrollToBottom();
  }, [scheduleScrollToBottom]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    const handleScroll = () => {
      const distanceToBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldStickToBottomRef.current = distanceToBottom <= 48;
    };

    handleScroll();
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    setSelectedRagProgressDetail(null);
    setSelectedRagSourceDetail(null);
  }, [activeThreadId]);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || !shouldStickToBottomRef.current) {
      return;
    }

    scheduleScrollToBottom();
  }, [activeThreadId, messages, runStatus.type, scheduleScrollToBottom]);

  return (
    <div className="w-full">
      <div className={shellClassName}>
        <div className={backdropOrbsClassName} aria-hidden="true">
          <div className="absolute left-[-6rem] top-[-7rem] h-44 w-44 rounded-full bg-pampas-5/55 blur-3xl" />
          <div className="absolute right-[-8rem] top-10 h-52 w-52 rounded-full bg-pampas-4/60 blur-3xl" />
        </div>

        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-l-[28px] border border-border/70 bg-surface-secondary shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <UChatThreadHeader title={title} badges={badges} />

            <div className="relative flex min-h-0 min-w-0 flex-1">
              <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div
                  ref={scrollViewportRef}
                  className="stable-scrollbar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-surface-secondary"
                >
                  <div
                    key={activeThreadId ?? "empty-thread"}
                    className="flex min-h-0 flex-1 flex-col bg-surface-secondary pt-14"
                  >
                    <div
                      className={`${contentColumnClassName} max-w-3xl xl:max-w-4xl`}
                    >
                      <div className={showWelcomeEmptyState ? "hidden" : undefined}>
                        <UChatWelcomeEmptyState
                          activeThreadId={activeThreadId}
                          isVisible={showWelcomeEmptyState}
                        />
                      </div>

                      {isHydratingPersistedThread ? (
                        <UChatThreadLoadingSkeleton />
                      ) : null}

                      {messages.map((message, messageIndex) => (
                        <UChatMessageRow
                          key={resolveMessagePresentationKey(
                            message,
                            messageIndex,
                          )}
                          presentationKey={resolveMessagePresentationKey(
                            message,
                            messageIndex,
                          )}
                          message={message}
                          isRunning={isRunning}
                          assistantAvatarSrc={assistantAvatarSrc}
                          assistantDisplayName={assistantDisplayName}
                          assistantTypingLabel={assistantTypingLabel}
                          agent={agent}
                          editingUserMessage={editingUserMessage}
                          messagePresentation={messagePresentation}
                          resolveAttachmentSource={resolveAttachmentSource}
                          onRequestScrollToBottom={requestScrollToBottom}
                          slots={slots}
                          onPreviewImage={setImagePreview}
                          onOpenProgressDetail={(detail) => {
                            setSelectedRagSourceDetail(null);
                            setSelectedRagProgressDetail(detail);
                          }}
                          onOpenSourceDetail={(detail) => {
                            setSelectedRagProgressDetail(null);
                            setSelectedRagSourceDetail(detail);
                          }}
                          onRegenerate={onRegenerate}
                          onEditUserMessage={onEditUserMessage}
                          onRequestEditUserMessage={(messageId, text) => {
                            setEditingUserMessage({
                              id: messageId,
                              draftText: text,
                              originalText: text,
                            });
                          }}
                          onUpdateEditUserMessage={(messageId, text) => {
                            setEditingUserMessage((current) =>
                              current?.id === messageId
                                ? {
                                    ...current,
                                    draftText: text,
                                  }
                                : current,
                            );
                          }}
                          onResetEditUserMessage={(messageId) => {
                            setEditingUserMessage((current) =>
                              current?.id === messageId
                                ? {
                                    ...current,
                                    draftText: current.originalText,
                                  }
                                : current,
                            );
                          }}
                          onCancelEditUserMessage={() =>
                            setEditingUserMessage(null)
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div
                  className={`pointer-events-none absolute inset-x-0 z-20 ${
                    showWelcomeEmptyState
                      ? "inset-y-0 flex translate-y-[10px] items-center"
                      : "bottom-0"
                  }`}
                >
                  <div
                    className={
                      showWelcomeEmptyState
                        ? "w-full px-4 py-5 sm:px-6 lg:px-8"
                        : "bg-gradient-to-t from-surface-secondary via-surface-secondary/95 to-transparent px-4 pb-5 pt-8 sm:px-6 lg:px-8"
                    }
                  >
                    <div className="pointer-events-auto mx-auto w-full max-w-3xl xl:max-w-4xl">
                      {showWelcomeEmptyState ? (
                        <div className="mb-[80px] flex translate-y-[30px] items-center justify-center gap-3 font-serif text-[36px] font-semibold leading-tight tracking-[0.02em] text-ink">
                          <img
                            src={chatStartLogo}
                            alt=""
                            aria-hidden="true"
                            className="h-9 w-auto shrink-0 object-contain sm:h-10"
                            draggable={false}
                          />
                          <span>{t("chat.thread.welcome.emptyComposerTitle")}</span>
                        </div>
                      ) : null}
                      {composerSuggestion ? (
                        <div className="mb-2">{composerSuggestion}</div>
                      ) : null}

                      <div className="overflow-hidden rounded-[20px] border border-cloudy-4/70 bg-pampas-2/90 shadow-[0_8px_22px_rgba(15,23,42,0.035)] backdrop-blur-xl">
                        {composer.attachments.length > 0 ? (
                          <div className="flex flex-wrap gap-2 border-b border-cloudy-4/55 px-4 pb-3 pt-3">
                            {composer.attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-primary/92 px-3 py-1.5 text-xs text-text-secondary"
                              >
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-secondary text-text-secondary">
                                  <Paperclip className="h-3 w-3" />
                                </span>
                                <span className="max-w-44 truncate font-medium text-text-primary">
                                  {attachment.file.name}
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none"
                                  aria-label={`Remove ${attachment.file.name}`}
                                  onClick={() => {
                                    void onComposerAttachmentRemove?.(
                                      attachment.id,
                                    );
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {renderComposerEditor ? (
                          renderComposerEditor({
                            value: composer.text,
                            placeholder,
                            disabled: isComposerDisabled,
                            onChange: onComposerTextChange,
                            onSubmit: () => {
                              if (isSendDisabled) return;
                              requestScrollToBottom();
                              void onSend();
                            },
                            onPasteFiles: (files) =>
                              onComposerAttachmentsAppend?.(files),
                          })
                        ) : (
                          <textarea
                            value={composer.text}
                            onChange={(event) =>
                              onComposerTextChange(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                event.ctrlKey &&
                                !isSendDisabled
                              ) {
                                event.preventDefault();
                                requestScrollToBottom();
                                void onSend();
                              }
                            }}
                            onPaste={(event) => {
                              const files = Array.from(
                                event.clipboardData?.files ?? [],
                              ).filter(isImageFile);

                              if (files.length > 0) {
                                event.preventDefault();
                                void onComposerAttachmentsAppend?.(files);
                              }
                            }}
                            placeholder={placeholder}
                            className={`h-16 min-h-[40px] w-full resize-none bg-transparent px-4 py-2.5 text-[15px] leading-6 text-text-primary placeholder:text-cloudy-6 focus:outline-none ${
                              isComposerDisabled
                                ? "cursor-not-allowed opacity-60"
                                : ""
                            }`}
                            rows={3}
                            disabled={isComposerDisabled}
                          />
                        )}

                        <UChatComposerActions
                          composerActions={capabilities.composerActions ?? []}
                          threadContextTags={threadContextTags}
                          isRunning={isRunning}
                          submitDisabled={agentSubmission.disabled}
                          submitDisabledReason={
                            agentSubmission.disabledReason
                          }
                          submitLabel={t("chat.thread.actions.send")}
                          composerTools={
                            <UChatAgentComposerTools
                              controller={agent}
                              Extension={slots?.ComposerTools}
                            />
                          }
                          onComposerAction={onComposerAction}
                          onRemoveThreadContextTag={onRemoveThreadContextTag}
                          onSubmit={() => {
                            requestScrollToBottom();
                            return agentSubmission.submit();
                          }}
                          onCancelSend={onCancelSend}
                          onComposerAttachmentsChange={
                            onComposerAttachmentsChange
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <UChatRagProgressDetailDrawer
                open={selectedRagProgressDetail !== null}
                detail={selectedRagProgressDetail}
                onClose={() => setSelectedRagProgressDetail(null)}
              />
              <UChatRagSourceDetailDrawer
                open={selectedRagSourceDetail !== null}
                detail={selectedRagSourceDetail}
                onClose={() => setSelectedRagSourceDetail(null)}
              />
            </div>
          </div>
        </div>
      </div>

      <ImagePreviewOverlay
        open={Boolean(imagePreview)}
        src={imagePreview?.src ?? null}
        onClose={() => setImagePreview(null)}
      />
    </div>
  );
}

// UChatMessageRow renders either a user or assistant message row from the
// canonical message model.
function UChatMessageRow({
  presentationKey,
  message,
  isRunning,
  assistantAvatarSrc,
  assistantDisplayName,
  assistantTypingLabel,
  agent,
  editingUserMessage,
  messagePresentation,
  resolveAttachmentSource,
  onPreviewImage,
  onOpenProgressDetail,
  onOpenSourceDetail,
  onRegenerate,
  onEditUserMessage,
  onRequestEditUserMessage,
  onUpdateEditUserMessage,
  onResetEditUserMessage,
  onCancelEditUserMessage,
  onRequestScrollToBottom,
  slots,
}: {
  presentationKey: string;
  message: ChatMessage;
  isRunning: boolean;
  assistantAvatarSrc?: string | null;
  assistantDisplayName?: string;
  assistantTypingLabel?: string;
  agent?: UChatAgentUIController;
  editingUserMessage: {
    id: string;
    draftText: string;
    originalText: string;
  } | null;
  messagePresentation: ChatMessagePresentationHints;
  resolveAttachmentSource: (value: string) => string;
  onPreviewImage: (value: ImagePreviewState) => void;
  onOpenProgressDetail: (detail: UChatExecutionProgressDetail) => void;
  onOpenSourceDetail: (detail: UChatExecutionSourceDetail) => void;
  onRegenerate?: (messageId: string) => void | Promise<void>;
  onEditUserMessage?: (
    messageId: string,
    text: string,
    parts?: DisplayMessagePart[],
  ) => void | Promise<void>;
  onRequestEditUserMessage?: (messageId: string, text: string) => void;
  onUpdateEditUserMessage?: (messageId: string, text: string) => void;
  onResetEditUserMessage?: (messageId: string) => void;
  onCancelEditUserMessage?: () => void;
  onRequestScrollToBottom: () => void;
  slots?: UChatThreadSlots;
}) {
  const { t } = useTranslation();
  const messageTrace = useUChatMessageTrace(message);
  const metadataSources = Array.isArray(
    message.metadata?.rag &&
      typeof message.metadata.rag === "object" &&
      !Array.isArray(message.metadata.rag)
      ? (message.metadata.rag as { sources?: unknown }).sources
      : undefined,
  )
    ? (((message.metadata?.rag as { sources?: unknown }).sources ??
        []) as RagSourceLike[])
    : [];
  const sources = getVisibleExecutionSources(metadataSources, messageTrace.steps);
  const textAndMediaParts = useMemo(
    () => collapseDisplayParts(message.parts),
    [message.parts],
  );
  const failurePresentation = messageTrace.failurePresentation;
  const toolTraceEntries = message.toolTrace ?? [];
  const hasExecutionTrace = messageTrace.hasTrace;
  const preferMarkdownForText =
    messagePresentation.preferMarkdownForText !== false;
  const assistantBubbleWidthClassName = resolveBubbleWidthClassName(
    messagePresentation.assistantMaxWidth,
  );
  const userBubbleWidthClassName = resolveBubbleWidthClassName(
    messagePresentation.userMaxWidth,
  );
  const MessageExtensions = slots?.MessageExtensions;
  const assistantContentParts =
    message.role === "assistant" &&
    message.status === "streaming" &&
    textAndMediaParts.length === 0
      ? ([{ type: "text", text: "" }] satisfies ChatMessagePart[])
      : textAndMediaParts;

  if (message.role === "user") {
    const isEditingThisMessage = editingUserMessage?.id === message.id;

    if (isEditingThisMessage && editingUserMessage) {
      return (
        <div className="group flex justify-end px-0 py-chat-message-row-y sm:py-chat-message-row-y-sm">
          <div
            className={`flex ${userBubbleWidthClassName} w-full max-w-[min(100%,34rem)] flex-col items-end`}
          >
            <InlineUserMessageEditor
              parts={textAndMediaParts}
              value={editingUserMessage.draftText}
              resolveAttachmentSource={resolveAttachmentSource}
              onChange={(value) => onUpdateEditUserMessage?.(message.id, value)}
              onCancel={() => onCancelEditUserMessage?.()}
              onSubmit={(nextParts) => {
                onCancelEditUserMessage?.();
                void onEditUserMessage?.(
                  message.id,
                  editingUserMessage.draftText,
                  nextParts,
                );
              }}
              onReset={() => onResetEditUserMessage?.(message.id)}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="group flex justify-end px-0 py-chat-message-row-y sm:py-chat-message-row-y-sm">
        <div className={`flex ${userBubbleWidthClassName} flex-col items-end`}>
          <UChatUserBubbleShell>
            {textAndMediaParts.map((part, index) => (
              <MessagePartContent
                key={`${presentationKey}-${part.type}-${index}`}
                part={part}
                preferMarkdownForText={preferMarkdownForText}
                resolveAttachmentSource={resolveAttachmentSource}
                onPreviewImage={onPreviewImage}
                onLoadMedia={onRequestScrollToBottom}
              />
            ))}
          </UChatUserBubbleShell>
          <div className=" transition-all duration-150 opacity-0 group-hover:opacity-100 group-hover:flex group-hover:items-center group-hover:gap-chat-action-gap">
            <button
              type="button"
              className="mt-chat-action-top inline-flex h-chat-action w-chat-action items-center justify-center rounded-full border border-border/70 bg-surface-primary/92 text-text-secondary transition-colors hover:border-border hover:bg-surface-primary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              onClick={() => {
                const content = textAndMediaParts
                  .filter(
                    (
                      part,
                    ): part is Extract<ChatMessagePart, { type: "text" }> =>
                      part.type === "text",
                  )
                  .map((part) => part.text)
                  .join("\n");
                void copyTextToClipboard(content)
                  .then((ok) => {
                    uiMessage[ok ? "success" : "error"](
                      ok
                        ? t("chat.thread.actions.copySuccess")
                        : t("chat.thread.actions.copyFailed"),
                    );
                  })
                  .catch(() => {
                    uiMessage.error(t("chat.thread.actions.copyFailed"));
                  });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {onEditUserMessage ? (
              <button
                type="button"
                className="mt-chat-action-top inline-flex h-chat-action w-chat-action items-center justify-center rounded-full border border-border/70 bg-surface-primary/92 text-text-secondary transition-colors hover:border-border hover:bg-surface-primary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                onClick={() => {
                  const content = textAndMediaParts
                    .filter(
                      (
                        part,
                      ): part is Extract<ChatMessagePart, { type: "text" }> =>
                        part.type === "text",
                    )
                    .map((part) => part.text)
                    .join("\n");
                  onRequestEditUserMessage?.(message.id, content);
                }}
                aria-label={t("chat.thread.actions.edit")}
                title={t("chat.thread.actions.edit")}
              >
                <PencilLine className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-start px-0 py-chat-message-row-y sm:py-chat-message-row-y-sm">
      <div className="flex w-full items-start gap-chat-avatar-gap">
        <UChatAssistantAvatar
          src={assistantAvatarSrc}
          name={assistantDisplayName}
        />
        <div className={`min-w-0 w-full ${assistantBubbleWidthClassName}`}>
          <UChatExecutionTrace
            messageId={message.id}
            steps={messageTrace.steps}
            onOpenDetail={onOpenProgressDetail}
          />
          <UChatAssistantBubbleShell>
            {textAndMediaParts.length === 0 && isRunning ? (
              <div className="inline-flex items-center gap-2 text-sm text-text-secondary">
                <span
                  className="inline-flex items-center gap-1"
                  aria-hidden="true"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-secondary/85" />
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-secondary/85"
                    style={{ animationDelay: "120ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-secondary/85"
                    style={{ animationDelay: "240ms" }}
                  />
                </span>
                <span>
                  {resolveUChatTypingLabel({
                    controller: agent,
                    agentRunningLabel: t("chat.thread.agent.running"),
                    assistantTypingLabel:
                      assistantTypingLabel ?? t("chat.thread.assistantTyping"),
                  })}
                </span>
              </div>
            ) : null}

            {assistantContentParts.map((part, index) => (
              <MessagePartContent
                key={`${presentationKey}-${part.type}-${index}`}
                part={part}
                preferMarkdownForText={preferMarkdownForText}
                isStreamingText={message.status === "streaming" && isRunning}
                resolveAttachmentSource={resolveAttachmentSource}
                onPreviewImage={onPreviewImage}
                onLoadMedia={onRequestScrollToBottom}
              />
            ))}

            {MessageExtensions ? (
              <MessageExtensions
                message={message}
                placement="content"
                onPreviewImage={(src) => onPreviewImage({ src })}
                onRequestLayout={onRequestScrollToBottom}
              />
            ) : null}

            {failurePresentation ? (
              <div
                className={`${
                  textAndMediaParts.length > 0 ? "mt-3" : ""
                } inline-flex max-w-full items-start gap-2 rounded-2xl border border-warning-border bg-warning-soft px-3 py-2.5 text-sm text-warning-text`}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">{failurePresentation.title}</div>
                  {failurePresentation.detail ? (
                    <div className="mt-1 break-words text-xs text-warning-text/90">
                      {failurePresentation.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <UChatAgentMessageStatus
              message={message}
              hideFailedStatus={Boolean(failurePresentation)}
              controller={agent}
            />

            {toolTraceEntries.length > 0 && !hasExecutionTrace ? (
              <UChatToolTrace entries={toolTraceEntries} />
            ) : null}
          </UChatAssistantBubbleShell>

          <div className="mt-chat-action-top flex items-center gap-chat-action-gap pl-chat-action-left">
            {MessageExtensions ? (
              <MessageExtensions
                message={message}
                placement="actions"
                onPreviewImage={(src) => onPreviewImage({ src })}
                onRequestLayout={onRequestScrollToBottom}
              />
            ) : null}
            <button
              type="button"
              className={actionButtonClassName}
              onClick={() => {
                const content = textAndMediaParts
                  .filter(
                    (
                      part,
                    ): part is Extract<ChatMessagePart, { type: "text" }> =>
                      part.type === "text",
                  )
                  .map((part) => part.text)
                  .join("\n");
                void copyTextToClipboard(content)
                  .then((ok) => {
                    uiMessage[ok ? "success" : "error"](
                      ok
                        ? t("chat.thread.actions.copySuccess")
                        : t("chat.thread.actions.copyFailed"),
                    );
                  })
                  .catch(() => {
                    uiMessage.error(t("chat.thread.actions.copyFailed"));
                  });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {onRegenerate ? (
              <button
                type="button"
                onClick={() => {
                  void onRegenerate(message.id);
                }}
                className={actionButtonClassName}
                aria-label={t("chat.thread.actions.regenerate")}
                title={t("chat.thread.actions.regenerate")}
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            ) : null}

            {sources.length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  onOpenSourceDetail({
                    messageId: message.id,
                    sources,
                  })
                }
                className="inline-flex h-7 items-center gap-2 rounded-[10px] border border-border/70 bg-surface-primary/92 px-3 text-[12px] text-text-secondary transition-colors hover:border-border hover:bg-surface-primary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <span>{t("chat.thread.sources.title")}</span>
                <span className="text-text-tertiary">{sources.length}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineUserMessageEditor({
  parts,
  value,
  resolveAttachmentSource,
  onChange,
  onCancel,
  onSubmit,
  onReset,
}: {
  parts: DisplayMessagePart[];
  value: string;
  resolveAttachmentSource: (value: string) => string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (parts: DisplayMessagePart[]) => void | Promise<void>;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [removedAttachmentKeys, setRemovedAttachmentKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const attachmentParts = parts.filter(
    (part): part is Extract<DisplayMessagePart, { type: "image" | "file" }> =>
      part.type === "image" || part.type === "file",
  );
  const visibleAttachmentParts = attachmentParts.filter(
    (part, index) => !removedAttachmentKeys.has(`${part.type}-${index}`),
  );
  const visibleImageAttachmentParts = visibleAttachmentParts.filter(
    (part): part is Extract<DisplayMessagePart, { type: "image" }> =>
      part.type === "image",
  );
  const visibleFileAttachmentParts = visibleAttachmentParts.filter(
    (part): part is Extract<DisplayMessagePart, { type: "file" }> =>
      part.type === "file",
  );

  useEffect(() => {
    setRemovedAttachmentKeys(new Set());
  }, [parts, value]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.style.height = "auto";
    const contentHeight = Math.max(44, Math.min(editor.scrollHeight, 192));
    editor.style.height = `${contentHeight}px`;
    editor.style.overflowY = editor.scrollHeight > 192 ? "auto" : "hidden";
  }, [value]);

  const nextParts = buildEditedUserMessageParts(
    parts,
    value,
    removedAttachmentKeys,
  );

  return (
    <div className="w-full rounded-ui-panel border border-border/80 bg-surface-secondary/85 p-2 shadow-shadow-sm">
      <div className="space-y-2">
        <div className="rounded-ui-control border border-border bg-surface-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            ref={editorRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }

              if (event.key === "Enter" && event.ctrlKey) {
                event.preventDefault();
                void onSubmit(nextParts);
              }
            }}
            rows={1}
            className="min-h-[44px] max-h-48 w-full resize-none rounded-ui-control border-0 bg-transparent px-3 py-2 text-[14px] leading-5 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-0"
            placeholder={t("chat.thread.actions.edit")}
            autoFocus
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {visibleAttachmentParts.length > 0 ? (
            <div className="min-w-0 flex-1 rounded-ui-control border border-border/60 bg-surface-primary/75 p-1.5">
              <div className="flex flex-wrap gap-1.5">
                {visibleImageAttachmentParts.map((part, index) => {
                  const imageUrl = resolveAttachmentSource(part.source);
                  const attachmentKey = `${part.type}-${index}`;

                  return (
                    <div
                      key={attachmentKey}
                      className="group relative h-10 w-10 overflow-hidden rounded-ui-control border border-border/60 bg-surface-primary shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                    >
                      <img
                        src={imageUrl}
                        alt={part.name ?? ""}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                      <button
                        type="button"
                        className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white/95 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                        aria-label={t("common.actions.delete")}
                        title={t("common.actions.delete")}
                        onClick={() => {
                          setRemovedAttachmentKeys((current) => {
                            const next = new Set(current);
                            next.add(attachmentKey);
                            return next;
                          });
                        }}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/35 px-1 py-0.5 text-[9px] text-white/95 opacity-0 transition-opacity group-hover:opacity-100">
                        {part.name ??
                          part.source.split("/").pop() ??
                          t("chat.thread.actions.imageAttachment")}
                      </span>
                    </div>
                  );
                })}

                {visibleFileAttachmentParts.map((part, index) => (
                  <div
                    key={`${part.type}-${index}`}
                    className="inline-flex min-w-[8.5rem] max-w-full items-center gap-2 rounded-ui-control border border-border/60 bg-surface-primary px-2.5 py-1.5 text-xs text-text-secondary"
                  >
                    <FileUp className="h-4 w-4 shrink-0" />
                    <span className="block truncate">{part.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div />
          )}
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="min-w-[4.5rem] justify-center"
              onClick={onReset}
            >
              {t("common.actions.reset")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="min-w-[4.5rem] justify-center"
              onClick={onCancel}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="min-w-[4.5rem] justify-center"
              onClick={() => void onSubmit(nextParts)}
            >
              {t("common.actions.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// UChatComposerActions renders the attachment, knowledge-base, and send
// buttons without coupling to any specific runtime implementation.
function UChatComposerActions({
  composerActions,
  threadContextTags,
  isRunning,
  submitDisabled,
  submitDisabledReason,
  submitLabel,
  composerTools,
  onComposerAction,
  onRemoveThreadContextTag,
  onSubmit,
  onCancelSend,
  onComposerAttachmentsChange,
}: {
  composerActions: ChatComposerAction[];
  threadContextTags: ChatThreadContextTag[];
  isRunning: boolean;
  submitDisabled: boolean;
  submitDisabledReason?: string;
  submitLabel: string;
  onComposerAction: (action: ChatComposerAction) => void | Promise<void>;
  onRemoveThreadContextTag?: (
    tag: ChatThreadContextTag,
  ) => void | Promise<void>;
  composerTools?: React.ReactNode;
  onSubmit: () => void | Promise<void>;
  onCancelSend?: () => void | Promise<void>;
  onComposerAttachmentsChange: (files: File[]) => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingAttachmentAction, setPendingAttachmentAction] =
    useState<ChatComposerAction | null>(null);
  const primaryActionLabel = isRunning
    ? t("chat.thread.composer.cancelGeneration")
    : submitLabel;

  const handleAction = (action: ChatComposerAction) => {
    if (action.disabled) {
      return;
    }

    if (action.kind === "attachment") {
      setPendingAttachmentAction(action);
      fileInputRef.current?.click();
      return;
    }

    if (action.kind === "command") {
      void onComposerAction(action);
    }
  };

  const menuItems = composerActions.map((action) => ({
    id: action.id,
    label: action.label,
    title: action.title,
    disabled: action.disabled,
    children: action.children?.map((child) => ({
      id: child.id,
      label: child.label,
      title: child.title,
      disabled: child.disabled,
      leadingIcon: child.id.includes("knowledge-base") ? (
        <LibraryBig className="h-4 w-4" />
      ) : child.id.includes("role") ? (
        <UserRound className="h-4 w-4" />
      ) : child.id.includes("context-summary") ? (
        <MessageSquareText className="h-4 w-4" />
      ) : child.kind === "attachment" ? (
        <Paperclip className="h-4 w-4" />
      ) : null,
    })),
    leadingIcon: action.id.includes("knowledge-base") ? (
      <LibraryBig className="h-4 w-4" />
    ) : action.id.includes("role") ? (
      <UserRound className="h-4 w-4" />
    ) : action.id.includes("workspace") ? (
      <Folder className="h-4 w-4" />
    ) : action.id.includes("context-summary") ? (
      <MessageSquareText className="h-4 w-4" />
    ) : action.kind === "attachment" ? (
      <Paperclip className="h-4 w-4" />
    ) : null,
  }));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cloudy-4/55 px-4 pb-3.5 pt-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1 text-xs text-text-tertiary">
        {composerActions.length > 0 ? (
          <DropdownMenu
            items={menuItems}
            onSelect={(item) => {
              const directAction =
                composerActions.find((action) => action.id === item.id) ??
                composerActions
                  .flatMap((action) => action.children ?? [])
                  .find((action) => action.id === item.id);

              if (directAction) {
                handleAction(directAction);
              }
            }}
            trigger={
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-surface-primary/90 text-text-secondary transition-all duration-150 hover:border-border hover:bg-surface-primary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
                title="Composer menu"
                aria-label="Composer menu"
              >
                <Plus className="h-4 w-4" />
              </button>
            }
          />
        ) : null}
        {composerTools}

        {threadContextTags.map((tag) => (
          <Tooltip key={tag.id} text={tag.tooltip ?? tag.label} placement="top">
            <Badge
              variant="primary"
              size="sm"
              className="gap-1.5 border border-primary/20 bg-primary/10 pr-1 text-primary shadow-none"
            >
              {tag.kind === "role" && tag.avatarSrc ? (
                <img
                  src={tag.avatarSrc}
                  alt=""
                  className="h-4 w-4 rounded-full object-cover"
                  draggable={false}
                />
              ) : (
                <LibraryBig className="h-3.5 w-3.5" />
              )}
              <span className="max-w-28 truncate">{tag.label}</span>
              {tag.removable ? (
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-primary/80 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none"
                  aria-label={`Remove ${tag.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onRemoveThreadContextTag?.(tag);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </Badge>
          </Tooltip>
        ))}

        <input
          ref={fileInputRef}
          type="file"
          accept={pendingAttachmentAction?.accept}
          multiple={pendingAttachmentAction?.multiple ?? true}
          className="hidden"
          onChange={(event) => {
            const selectedFiles = Array.from(event.target.files ?? []);
            const files =
              pendingAttachmentAction?.attachmentKind === "image"
                ? selectedFiles.filter(isImageFile)
                : selectedFiles;
            onComposerAttachmentsChange(files);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Tooltip
          text={!isRunning ? submitDisabledReason ?? "" : ""}
          placement="top"
        >
          <button
            type="button"
            disabled={!isRunning && submitDisabled}
            onClick={() => {
              if (isRunning) {
                void onCancelSend?.();
                return;
              }

              void onSubmit();
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-text-inverted transition-all duration-150 hover:scale-[1.02] hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={primaryActionLabel}
            title={primaryActionLabel}
          >
            {isRunning ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
