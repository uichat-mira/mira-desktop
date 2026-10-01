"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BowArrow,
  EthernetPort,
  FileImage,
  MessageCircleCode,
} from "lucide-react";
import { useRoleModelConfigs } from "@/app/providers/RoleModelConfigProvider";
import { useChatKnowledgeBaseState } from "@/features/chat/core/knowledgeBaseState";
import {
  useChatRuntime,
  useChatRuntimeSelector,
  useChatThreadDraftState,
} from "@/features/chat/core/runtime";
import { useUChatComposerState } from "@/features/chat/core/composerPolicy";
import { resolveAttachmentSource } from "@/features/chat/core/protocol";
import type { KnowledgeBaseSummary } from "@/shared/api/knowledgeBase";
import { listRoles, type RoleSummary } from "@/shared/api/roles";
import {
  approveAgentRun,
  rejectAgentRun,
  createChatWorkspace,
  listChatWorkspaces,
  updateThread,
  type ChatWorkspace,
} from "@/shared/api/thread";
import { getBuiltinAvatarPack16Options } from "@/shared/avatars";
import { getDesktopRuntime } from "@/shared/platform/desktopRuntime";
import {
  UChatThreadView,
  type UChatThreadSlots,
} from "@/shared/uchat/ui";
import type { ChatComposerAction, ChatThreadContextTag } from "@/shared/uchat/core";
import { Modal, SearchSelectModal, message, TextInput, Button } from "@/shared/ui";
import {
  buildThreadContextTags,
  formatRoleReplyingLabel,
  resolveActiveRoleId,
  resolveRoleAvatarSrc,
  upsertRoleSummary,
} from "./roleChatState";
import { isValidWorkspaceRootPath } from "../core/runtimePolicies";
import ThreadContextSummaryModalContent from "./ThreadContextSummaryModalContent";
import {
  generateChatMessageImage,
  synthesizeChatMessageTts,
} from "../adapters/chatMediaOrchestration";
import {
  DesktopChatMessageExtensions,
  DesktopChatMessageExtensionsProvider,
} from "./DesktopChatMessageExtensions";
import {
  AgentSkillComposerEditor,
  AgentSkillComposerSuggestion,
  AgentToolkitComposerSuggestion,
  getExplicitToolkitIds,
  insertExplicitSkill,
  insertExplicitToolkit,
  resolveExplicitSkillsForSubmission,
} from "./AgentSkillComposerSuggestion";

const desktopChatThreadSlots = {
  MessageExtensions: DesktopChatMessageExtensions,
} satisfies UChatThreadSlots;

const modelBadgeMeta = {
  llm: { label: "LLM", icon: EthernetPort },
  task: { label: "Task", icon: MessageCircleCode },
  embedding: { label: "Embedding", icon: BowArrow },
  rerank: { label: "Rerank", icon: FileImage },
} as const;

const isConfiguredModelName = (name: string) => {
  const normalized = name.trim();
  return Boolean(
    normalized &&
      !normalized.startsWith("未配置") &&
      !normalized.startsWith("Unconfigured"),
  );
};

export default function UChatThread() {
  const { t } = useTranslation();
  const runtime = useChatRuntime();
  const activeThreadId = useChatRuntimeSelector((state) => state.activeThreadId);
  const threads = useChatRuntimeSelector((state) => state.threads);
  const composer = useChatRuntimeSelector((state) => state.composer);
  const runStatus = useChatRuntimeSelector((state) => state.runStatus);
  const activeRunThreadId = useChatRuntimeSelector(
    (state) => state.activeRunThreadId,
  );
  const threadStatus = useChatRuntimeSelector((state) => state.threadStatus);
  const capabilities = useChatRuntimeSelector((state) => state.capabilities);
  const activeThread =
    threads.find((thread) => thread.id === activeThreadId) ?? null;
  const messages = activeThread?.messages ?? [];
  const hasRunningTask = runStatus.type === "running";
  const isRunning = hasRunningTask && activeRunThreadId === activeThreadId;
  const currentThreadRunStatus = isRunning
    ? runStatus
    : ({ type: "idle" } as const);
  const latestAssistantMessage =
    [...messages].reverse().find((message) => message.role === "assistant") ?? null;
  const latestAssistantAgentMetadata =
    latestAssistantMessage?.metadata?.agent &&
    typeof latestAssistantMessage.metadata.agent === "object" &&
    !Array.isArray(latestAssistantMessage.metadata.agent)
      ? (latestAssistantMessage.metadata.agent as {
          status?: "waiting_approval" | "blocked" | "completed" | "failed";
        })
      : null;
  const { configMap, hasDefaultEmbedding, hasDefaultLlm } =
    useRoleModelConfigs();
  const { knowledgeBases } = useChatKnowledgeBaseState();
  const {
    draftKnowledgeBaseId,
    draftRoleId,
    draftAgentEnabled,
    setDraftKnowledgeBaseId,
    setDraftRoleId,
    setDraftAgentEnabled,
    setDraftWorkspaceId,
    setDraftImageEnabled,
  } = useChatThreadDraftState();
  const [isKnowledgeBasePickerOpen, setKnowledgeBasePickerOpen] = useState(false);
  const [isRolePickerOpen, setRolePickerOpen] = useState(false);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<ChatWorkspace[]>([]);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceNameError, setWorkspaceNameError] = useState("");
  const [workspaceRootPath, setWorkspaceRootPath] = useState("");
  const [workspaceRootPathError, setWorkspaceRootPathError] = useState("");
  const [workspaceTargetThreadId, setWorkspaceTargetThreadId] = useState<string | null>(null);
  const avatarOptions = useMemo(() => getBuiltinAvatarPack16Options(), []);

  const activeThreadWorkspaceId =
    activeThread?.workspaceId ?? null;
  const isThreadAgentEnabled =
    typeof activeThread?.metadata?.agentEnabled === "boolean"
      ? activeThread.metadata.agentEnabled
      : false;
  const isAgentEnabled = activeThreadId ? isThreadAgentEnabled : draftAgentEnabled;
  const canRunAgent = isAgentEnabled;
  const isAgentRunning =
    isRunning &&
    Boolean(
      latestAssistantAgentMetadata?.status
        ? latestAssistantAgentMetadata.status !== "waiting_approval" &&
          latestAssistantAgentMetadata.status !== "blocked" &&
          latestAssistantAgentMetadata.status !== "failed"
        : isThreadAgentEnabled,
    );
  const threadKnowledgeBaseId =
    typeof activeThread?.metadata?.knowledgeBaseId === "string" ||
    activeThread?.metadata?.knowledgeBaseId === null
      ? activeThread.metadata.knowledgeBaseId
      : undefined;
  const activeKnowledgeBaseId =
    threadKnowledgeBaseId !== undefined
      ? threadKnowledgeBaseId
      : draftKnowledgeBaseId;
  const hasKnowledgeBase = Boolean(activeKnowledgeBaseId);
  const persistedRoleId =
    typeof activeThread?.metadata?.roleId === "string" ||
    activeThread?.metadata?.roleId === null
      ? activeThread.metadata.roleId
      : undefined;

  const { isComposerDisabled, isSendDisabled, placeholder } =
    useUChatComposerState({
      hasRunningTask,
      isCurrentThreadRunning: isRunning,
      hasKnowledgeBase,
      hasDefaultLlm,
      hasDefaultEmbedding,
    });

  const modelBadges = useMemo(() => {
    const items = [
      { key: "llm", name: configMap.llm?.name ?? t("chat.thread.models.llm") },
      { key: "task", name: configMap.task?.name ?? t("chat.thread.models.task") },
      { key: "embedding", name: configMap.embedding?.name ?? t("chat.thread.models.embedding") },
      { key: "rerank", name: configMap.rerank?.name ?? t("chat.thread.models.rerank") },
    ] as const;

    return items
      .filter((item) => isConfiguredModelName(item.name))
      .map((item) => ({
        ...item,
        label: modelBadgeMeta[item.key].label,
        icon: modelBadgeMeta[item.key].icon,
      }));
  }, [configMap, t]);

  const activeKnowledgeBase = useMemo(
    () =>
      activeKnowledgeBaseId
        ? knowledgeBases.find((item) => item.id === activeKnowledgeBaseId) ?? null
        : null,
    [activeKnowledgeBaseId, knowledgeBases],
  );

  useEffect(() => {
    let disposed = false;

    const loadRoleList = async () => {
      try {
        const nextRoles = await listRoles({
          status: "active",
          sortBy: "updatedAt",
          sortOrder: "desc",
        });
        if (!disposed) {
          setRoles(nextRoles);
        }
      } catch (error) {
        if (!disposed) {
          message.error(error instanceof Error ? error.message : t("chat.thread.roles.loadFailed"));
        }
      }
    };

    void loadRoleList();
    return () => {
      disposed = true;
    };
  }, [t]);

  useEffect(() => {
    const handleMediaUpdated = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (threadId && threadId === activeThreadId) void runtime.refreshThread(threadId);
    };
    window.addEventListener("uichat:chat-media-updated", handleMediaUpdated);
    return () => window.removeEventListener("uichat:chat-media-updated", handleMediaUpdated);
  }, [activeThreadId, runtime]);

  useEffect(() => {
    let disposed = false;
    const loadWorkspaces = async () => {
      try {
        setWorkspaces(await listChatWorkspaces());
      } catch (error) {
        if (!disposed) {
          message.error(
            error instanceof Error ? error.message : t("chat.sidebar.workspaceLoadFailed"),
          );
        }
      }
    };

    void loadWorkspaces();
    return () => {
      disposed = true;
    };
  }, [t]);

  const activeRoleId = resolveActiveRoleId({
    hasPersistedThread: Boolean(activeThreadId),
    persistedRoleId,
    welcomeRoleId: draftRoleId,
  });
  const activeRole = useMemo(
    () => roles.find((item) => item.id === activeRoleId) ?? null,
    [activeRoleId, roles],
  );
  const activeRoleAvatarSrc = useMemo(
    () => resolveRoleAvatarSrc(activeRole?.avatarId ?? null, avatarOptions),
    [activeRole?.avatarId, avatarOptions],
  );
  const assistantTypingLabel = formatRoleReplyingLabel(
    activeRole?.name ?? null,
    t("chat.thread.assistantTyping"),
    t("chat.thread.roles.replyingSuffix"),
  );

  const threadContextTags = useMemo<ChatThreadContextTag[]>(
    () =>
      buildThreadContextTags({
        knowledgeBase: activeKnowledgeBase,
        role: activeRole,
        roleAvatarSrc: activeRoleAvatarSrc,
      }),
    [activeKnowledgeBase, activeRole, activeRoleAvatarSrc],
  );

  const handleUpdateThreadKnowledgeBase = async (nextKnowledgeBaseId: string | null) => {
    if (!activeThreadId || !activeThread) return;
    await runtime.updateThread(activeThreadId, {
      metadata: {
        knowledgeBaseId: nextKnowledgeBaseId,
      },
    });
    await runtime.refreshThread(activeThreadId);
  };

  const openWorkspacePicker = (threadId: string | null) => {
    setWorkspaceTargetThreadId(threadId);
    setWorkspacePickerOpen(true);
  };

  const handleComposerAction = async (action: ChatComposerAction) => {
    if (action.id === "role-picker") {
      setRolePickerOpen(true);
      return;
    }

    if (action.id === "knowledge-base-picker") {
      setKnowledgeBasePickerOpen(true);
      return;
    }

    if (action.id === "workspace-add-thread") {
      openWorkspacePicker(activeThreadId);
      return;
    }

    if (action.id === "workspace-create") {
      setWorkspaceName("");
      setWorkspaceNameError("");
      setWorkspaceRootPath("");
      setWorkspaceRootPathError("");
      setWorkspaceCreateOpen(true);
      return;
    }

    if (action.id === "context-summary") {
      if (!activeThreadId || !activeThread) {
        message.error(t("chat.thread.contextSummary.requiresThread"));
        return;
      }

      let modalKey = "";
      modalKey = Modal.show({
        title: t("chat.thread.contextSummary.modalTitle"),
        width: 720,
        content: (
          <ThreadContextSummaryModalContent
            threadId={activeThreadId}
            initialSummary={
              typeof activeThread.metadata?.contextSummary === "string"
                ? activeThread.metadata.contextSummary
                : null
            }
            initialUpdatedAt={
              typeof activeThread.metadata?.contextSummaryUpdatedAt === "string"
                ? activeThread.metadata.contextSummaryUpdatedAt
                : null
            }
            onSaved={({ contextSummary, contextSummaryUpdatedAt }) => {
              void runtime.updateThread(activeThreadId, {
                metadata: {
                  ...((activeThread.metadata ?? {}) as Record<string, unknown>),
                  contextSummary,
                  contextSummaryUpdatedAt,
                },
              });
            }}
            onClose={() => Modal.close(modalKey)}
          />
        ),
        footer: null,
      });
    }
  };

  const handleSelectRole = async (roleId: string) => {
    const selectedRole = roles.find((item) => item.id === roleId) ?? null;
    if (selectedRole) {
      setRoles((currentRoles) => upsertRoleSummary(currentRoles, selectedRole));
    }
    if (activeThreadId) {
      await runtime.updateThread(activeThreadId, {
        metadata: {
          ...((activeThread?.metadata ?? {}) as Record<string, unknown>),
          roleId,
          ...(!hasKnowledgeBase ? { imageEnabled: true } : {}),
        },
      });
      await runtime.refreshThread(activeThreadId);
      setDraftRoleId(null);
    } else {
      setDraftRoleId(roleId);
      setDraftImageEnabled(true);
    }
    return true;
  };

  const handleSelectKnowledgeBase = async (knowledgeBaseId: string) => {
    if (!activeThreadId || !activeThread) {
      setDraftKnowledgeBaseId(knowledgeBaseId);
      return true;
    }
    await handleUpdateThreadKnowledgeBase(knowledgeBaseId);
    return true;
  };

  const handleRemoveThreadContextTag = async (tag: ChatThreadContextTag) => {
    if (tag.kind === "role") {
      if (activeThreadId) {
        await runtime.updateThread(activeThreadId, {
          metadata: {
            ...((activeThread?.metadata ?? {}) as Record<string, unknown>),
            roleId: null,
          },
        });
        await runtime.refreshThread(activeThreadId);
        setDraftRoleId(null);
      } else {
        setDraftRoleId(null);
        setDraftImageEnabled(false);
      }
      return;
    }

    if (!activeThreadId || !activeThread) {
      setDraftKnowledgeBaseId(null);
      return;
    }
    await handleUpdateThreadKnowledgeBase(null);
  };

  const handleCreateWorkspace = async () => {
    setWorkspaceNameError("");
    setWorkspaceRootPathError("");
    const name = workspaceName.trim();
    if (!name) {
      setWorkspaceNameError(t("chat.sidebar.workspaceNameRequired"));
      return;
    }
    const rootPath = workspaceRootPath.trim();
    if (!rootPath) {
      setWorkspaceRootPathError(t("chat.sidebar.workspaceRootPathRequired"));
      return;
    }
    if (!isValidWorkspaceRootPath(rootPath, getDesktopRuntime().platform)) {
      setWorkspaceRootPathError(t("chat.sidebar.workspaceRootPathInvalid"));
      return;
    }
    try {
      await createChatWorkspace({ name, rootPath });
      setWorkspaceCreateOpen(false);
      setWorkspaces(await listChatWorkspaces());
    } catch (error) {
      setWorkspaceRootPathError(t("chat.sidebar.workspaceRootPathInvalid"));
    }
  };

  const handleAssignWorkspace = async (workspaceId: string) => {
    const targetThreadId = workspaceTargetThreadId ?? activeThreadId;
    if (!targetThreadId) {
      const createdThread = await runtime.ensureThread(null, {
        metadata: {
          workspaceId,
        },
      });
      if (!createdThread) {
        throw new Error("Failed to create thread for workspace binding");
      }
      await runtime.refreshThread(createdThread.id);
      setWorkspacePickerOpen(false);
      setWorkspaceTargetThreadId(null);
      setDraftWorkspaceId(null);
      return;
    }
    await updateThread(targetThreadId, { workspaceId });
    await runtime.refreshThread(targetThreadId);
    setWorkspacePickerOpen(false);
    setWorkspaceTargetThreadId(null);
    setWorkspaces(await listChatWorkspaces());
  };

  const handleAgentSend = async () => {
    if (!isAgentEnabled) {
      message.error(t("chat.thread.agent.enableFirst"));
      return;
    }

    const requestedToolGroupIds = getExplicitToolkitIds(composer.text);
    const submissionText = resolveExplicitSkillsForSubmission(composer.text);
    if (submissionText !== composer.text) {
      runtime.setComposerText(submissionText);
    }
    await runtime.send({
      agentEnabled: true,
      ...(requestedToolGroupIds.length > 0 ? { requestedToolGroupIds } : {}),
    });
  };

  const handleToggleAgentEnabled = async () => {
    const nextEnabled = !isAgentEnabled;
    if (!nextEnabled) {
      const plainText = resolveExplicitSkillsForSubmission(composer.text);
      if (plainText !== composer.text) {
        runtime.setComposerText(plainText);
      }
    }
    if (activeThreadId && activeThread) {
      await runtime.updateThread(activeThreadId, {
        metadata: {
          ...((activeThread.metadata ?? {}) as Record<string, unknown>),
          agentEnabled: nextEnabled,
        },
      });
      await runtime.refreshThread(activeThreadId);
      return;
    }

    setDraftAgentEnabled(nextEnabled);
  };

  const handleApproveAgentRun = async (runId: string) => {
    try {
      await approveAgentRun(runId);
      if (activeThreadId) {
        await runtime.refreshThread(activeThreadId);
      }
      message.success(t("chat.thread.agent.approveSuccess"));
    } catch (error) {
      message.error(
        error instanceof Error
          ? `${t("chat.thread.agent.approveFailed")}: ${error.message}`
          : t("chat.thread.agent.approveFailed"),
      );
      throw error;
    }
  };

  const handleRejectAgentRun = async (runId: string) => {
    try {
      await rejectAgentRun(runId);
      if (activeThreadId) {
        await runtime.refreshThread(activeThreadId);
      }
      message.success(t("chat.thread.agent.rejectSuccess"));
    } catch (error) {
      message.error(
        error instanceof Error
          ? `${t("chat.thread.agent.rejectFailed")}: ${error.message}`
          : t("chat.thread.agent.rejectFailed"),
      );
      throw error;
    }
  };

  const handleRequestTts = async (assistantMessage: (typeof messages)[number]) => {
    if (!activeThread) return;
    await synthesizeChatMessageTts(activeThread, assistantMessage);
    if (activeThreadId) await runtime.refreshThread(activeThreadId);
  };

  const handleRequestImage = async (assistantMessage: (typeof messages)[number]) => {
    if (!activeThread || !activeRoleId || hasKnowledgeBase) return;
    try {
      await generateChatMessageImage(activeThread, assistantMessage);
      if (activeThreadId) await runtime.refreshThread(activeThreadId);
    } catch (error) {
      if (activeThreadId) {
        await runtime.refreshThread(activeThreadId).catch(() => undefined);
      }
      const detail = error instanceof Error ? error.message : t("chat.thread.media.unknownError");
      message.error(`${t("chat.thread.media.imageFailed")}: ${detail}`);
    }
  };
  const showImageAction = Boolean(activeRoleId && !hasKnowledgeBase && !isAgentEnabled);

  return (
    <>
      <DesktopChatMessageExtensionsProvider
        onRequestTts={handleRequestTts}
        onRequestImage={showImageAction ? handleRequestImage : undefined}
        showImageAction={showImageAction}
      >
        <UChatThreadView
          activeThreadId={activeThreadId}
          title={
            activeThread?.title ||
            (messages.length === 0
              ? t("chat.thread.header.newConversation")
              : t("chat.thread.header.untitledConversation"))
          }
          badges={modelBadges}
          messages={messages}
          composer={composer}
          runStatus={currentThreadRunStatus}
          threadStatus={threadStatus}
          capabilities={capabilities}
          hasKnowledgeBase={hasKnowledgeBase}
          placeholder={placeholder}
          isComposerDisabled={isComposerDisabled}
          isSendDisabled={isSendDisabled}
          onComposerTextChange={(value) => runtime.setComposerText(value)}
          onComposerAttachmentsChange={(files) =>
            runtime.setComposerAttachments(files)
          }
          onComposerAttachmentsAppend={(files) =>
            runtime.appendComposerAttachments(files)
          }
          onComposerAttachmentRemove={(attachmentId) =>
            runtime.removeComposerAttachment(attachmentId)
          }
          onSend={() => {
            if (isAgentEnabled) {
              return handleAgentSend();
            }
            const requestedToolGroupIds = getExplicitToolkitIds(composer.text);
            const submissionText = resolveExplicitSkillsForSubmission(composer.text);
            if (submissionText !== composer.text) {
              runtime.setComposerText(submissionText);
            }
            return requestedToolGroupIds.length > 0
              ? runtime.send({ requestedToolGroupIds })
              : runtime.send();
          }}
          onCancelSend={() => runtime.cancelSend()}
          onRegenerate={(messageId) => runtime.regenerate(messageId)}
          onEditUserMessage={(messageId, text, parts) =>
            runtime.editUserMessage(messageId, text, parts)
          }
          onComposerAction={handleComposerAction}
          threadContextTags={threadContextTags}
          onRemoveThreadContextTag={handleRemoveThreadContextTag}
          resolveAttachmentSource={resolveAttachmentSource}
          assistantAvatarSrc={activeRoleAvatarSrc}
          assistantDisplayName={activeRole?.name}
          assistantTypingLabel={assistantTypingLabel}
          agent={{
            enabled: isAgentEnabled,
            running: isAgentRunning,
            toggleAvailability: {
              enabled: true,
            },
            submissionAvailability: {
              enabled: canRunAgent,
              disabledReason: !isAgentEnabled
                ? t("chat.thread.agent.enableFirst")
                : undefined,
            },
            onToggle: handleToggleAgentEnabled,
            onSubmit: handleAgentSend,
            onApprove: handleApproveAgentRun,
            onReject: handleRejectAgentRun,
          }}
          renderComposerEditor={
            isAgentEnabled
              ? (props) => (
                  <AgentSkillComposerEditor
                    text={props.value}
                    placeholder={props.placeholder}
                    disabled={props.disabled}
                    onChange={props.onChange}
                    onSubmit={props.onSubmit}
                    onPasteFiles={props.onPasteFiles}
                  />
                )
              : undefined
          }
          composerSuggestion={
            isAgentEnabled ? (
              <div className="space-y-1">
                <AgentSkillComposerSuggestion
                  text={composer.text}
                  onSelect={(skillId) =>
                    runtime.setComposerText(insertExplicitSkill(composer.text, skillId))
                  }
                />
                <AgentToolkitComposerSuggestion
                  text={composer.text}
                  onSelect={(groupId) =>
                    runtime.setComposerText(insertExplicitToolkit(composer.text, groupId))
                  }
                />
              </div>
            ) : undefined
          }
          slots={desktopChatThreadSlots}
        />
      </DesktopChatMessageExtensionsProvider>

      <SearchSelectModal<RoleSummary[]>
        open={isRolePickerOpen}
        title={t("chat.thread.roles.title")}
        url="/roles?status=active&sortBy=updatedAt&sortOrder=desc"
        width={520}
        selectedId={activeRoleId}
        searchPlaceholder={t("chat.thread.roles.searchPlaceholder")}
        emptyText={t("chat.thread.roles.empty")}
        loadingText={t("chat.thread.roles.loading")}
        loadErrorText={t("chat.thread.roles.loadFailed")}
        normalizeItems={(items) =>
          items.map((item) => ({
            id: item.id,
            label: item.name,
            description: item.summary,
            keywords: [item.id, ...item.tags],
            meta: item.status,
            title: item.name,
            leadingAvatarSrc: resolveRoleAvatarSrc(item.avatarId, avatarOptions),
          }))
        }
        onCheck={(item) => handleSelectRole(item.id)}
        onClose={() => setRolePickerOpen(false)}
      />

      <SearchSelectModal<KnowledgeBaseSummary[]>
        open={isKnowledgeBasePickerOpen}
        title={t("chat.thread.knowledgeBase.title")}
        url="/knowledge-bases?status=active&sortBy=updatedAt&sortOrder=desc"
        width={520}
        selectedId={activeKnowledgeBaseId}
        searchPlaceholder={t("chat.thread.knowledgeBase.searchPlaceholder")}
        emptyText={t("chat.thread.knowledgeBase.empty")}
        loadingText={t("chat.thread.knowledgeBase.loading")}
        loadErrorText={t("chat.thread.knowledgeBase.loadFailed")}
        normalizeItems={(items) =>
          items.map((item) => ({
            id: item.id,
            label: item.name,
            description: item.description,
            keywords: [item.id, item.name, item.description ?? ""],
            meta: item.status,
            title: item.name,
          }))
        }
        onCheck={(item) => handleSelectKnowledgeBase(item.id)}
        onClose={() => setKnowledgeBasePickerOpen(false)}
      />

      <SearchSelectModal<ChatWorkspace[]>
        open={workspacePickerOpen}
        title={t("chat.sidebar.workspaceSelect")}
        url="/chat-workspaces"
        width={520}
        selectedId={activeThreadWorkspaceId}
        searchPlaceholder={t("chat.sidebar.workspaceSearchPlaceholder")}
        emptyText={t("chat.sidebar.workspaceEmpty")}
        loadingText={t("common.status.loading")}
        loadErrorText={t("chat.sidebar.workspaceLoadFailed")}
        normalizeItems={(items) =>
          items.map((item) => ({
            id: item.id,
            label: item.name,
            meta: item.isDefault
              ? `${item.status} · ${t("chat.sidebar.workspaceDefault")}`
              : item.status,
            title: item.name,
            keywords: [item.id, item.name],
            description: item.rootPath ?? undefined,
          }))
        }
        onCheck={(item) => {
          void handleAssignWorkspace(item.id);
          return true;
        }}
        onClose={() => {
          setWorkspacePickerOpen(false);
          setWorkspaceTargetThreadId(null);
        }}
      />

      <Modal
        open={workspaceCreateOpen}
        title={t("chat.sidebar.workspaceCreate")}
        footer={null}
        onClose={() => setWorkspaceCreateOpen(false)}
      >
        <div className="space-y-4">
          <TextInput
            label={t("chat.sidebar.workspaceName")}
            value={workspaceName}
            onChange={setWorkspaceName}
            placeholder={t("chat.sidebar.workspaceNamePlaceholder")}
            error={workspaceNameError || undefined}
          />
          <TextInput
            label={t("chat.sidebar.workspaceRootPath")}
            value={workspaceRootPath}
            onChange={setWorkspaceRootPath}
            placeholder={t("chat.sidebar.workspaceRootPathPlaceholder")}
            error={workspaceRootPathError || undefined}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setWorkspaceCreateOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void handleCreateWorkspace();
              }}
            >
              {t("chat.sidebar.workspaceCreate")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
