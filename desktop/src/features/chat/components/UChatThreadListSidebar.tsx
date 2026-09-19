"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  useChatRuntime,
  useChatRuntimeSelector,
  useChatThreadDraftState,
} from "@/features/chat/core/runtime";
import type { ChatSidebarEntry, ChatThreadSummary } from "@/shared/uchat/core";
import { UChatSidebarView } from "@/shared/uchat/ui";
import { Modal, TextInput } from "@/shared/ui";
import {
  createChatWorkspace,
  deleteChatWorkspace,
  listChatWorkspaces,
  type ChatWorkspace,
} from "@/shared/api/thread";
import { getDesktopRuntime } from "@/shared/platform/desktopRuntime";
import { UChatSidebarToolsModal } from "./UChatSidebarToolsModal";
import { isValidWorkspaceRootPath } from "../core/runtimePolicies";

type WorkspaceGroup = {
  id: string;
  name: string;
  rootPath?: string | null;
  isDefault?: boolean;
  threads: ChatThreadSummary[];
};

const sortByUpdatedAtDesc = (left: { updatedAt: string }, right: { updatedAt: string }) =>
  right.updatedAt.localeCompare(left.updatedAt);

export function UChatThreadListSidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runtime = useChatRuntime();
  const { resetDraft } = useChatThreadDraftState();
  const threads = useChatRuntimeSelector((state) => state.threads);
  const activeThreadId = useChatRuntimeSelector((state) => state.activeThreadId);
  const threadListStatus = useChatRuntimeSelector((state) => state.threadListStatus);
  const capabilities = useChatRuntimeSelector((state) => state.capabilities);
  const [workspaces, setWorkspaces] = useState<ChatWorkspace[]>([]);
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroup[]>([]);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceNameError, setWorkspaceNameError] = useState("");
  const [workspaceRootPath, setWorkspaceRootPath] = useState("");
  const [workspaceRootPathError, setWorkspaceRootPathError] = useState("");
  const [toolsModalMode, setToolsModalMode] = useState<"search" | "workspace" | null>(null);

  const refreshWorkspaces = async () => {
    setWorkspaces(await listChatWorkspaces());
  };

  useEffect(() => {
    void refreshWorkspaces();
  }, []);

  const groupedThreadIds = useMemo(() => {
    const set = new Set<string>();
    for (const workspace of workspaceGroups) {
      for (const thread of workspace.threads) {
        set.add(thread.id);
      }
    }
    return set;
  }, [workspaceGroups]);

  const ungroupedThreads = useMemo(
    () =>
      [...threads]
        .filter((thread) => !groupedThreadIds.has(thread.id))
        .sort(sortByUpdatedAtDesc),
    [groupedThreadIds, threads],
  );

  useEffect(() => {
    const nextGroups = workspaces.map<WorkspaceGroup>((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      isDefault: workspace.isDefault,
      threads: [...threads]
        .filter((thread) => thread.workspaceId === workspace.id)
        .sort(sortByUpdatedAtDesc),
    }));
    setWorkspaceGroups(nextGroups);
  }, [threads, workspaces]);

  const sidebarEntries = useMemo<ChatSidebarEntry[]>(
    () => [
      { id: "chat-search", label: t("chat.sidebar.tools.search") },
      { id: "forge-open", label: "淬行", description: "Forge" },
    ],
    [t],
  );

  const handleCreateThread = () => {
    resetDraft();
    runtime.enterWelcomeState();
    runtime.store.getState().resetComposer();
  };

  const handleSelectThread = async (threadId: string) => {
    resetDraft();
    await runtime.selectThread(threadId);
  };

  const handleArchiveThread = async (threadId: string) => {
    if (!capabilities.archiveThread) return;
    const wasActive = runtime.getState().activeThreadId === threadId;
    await runtime.archiveThread(threadId);
    if (wasActive) {
      runtime.store.getState().setActiveThreadId(null);
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    if (!capabilities.deleteThread) return;
    const wasActive = runtime.getState().activeThreadId === threadId;
    Modal.confirm({
      title: t("chat.sidebar.threadDeleteTitle"),
      description: t("chat.sidebar.threadDeleteDescription"),
      confirmText: t("chat.sidebar.threadDeleteConfirm"),
      tone: "danger",
      onConfirm: async () => {
        await runtime.deleteThread(threadId);
        if (wasActive) {
          runtime.store.getState().setActiveThreadId(null);
        }
      },
    });
  };

  const handleSidebarEntryClick = async (entry: ChatSidebarEntry) => {
    if (entry.id === "chat-search") {
      setToolsModalMode("search");
      return;
    }
    if (entry.id === "forge-open") {
      navigate("/forge");
    }
  };

  const handleOpenCreateWorkspace = () => {
    setWorkspaceName("");
    setWorkspaceNameError("");
    setWorkspaceRootPath("");
    setWorkspaceRootPathError("");
    setCreateWorkspaceOpen(true);
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
      await refreshWorkspaces();
      setCreateWorkspaceOpen(false);
    } catch (error) {
      setWorkspaceRootPathError(
        t("chat.sidebar.workspaceRootPathInvalid"),
      );
    }
  };

  const handleWorkspaceDelete = async (workspaceId: string) => {
    Modal.confirm({
      title: t("chat.sidebar.workspaceDeleteTitle"),
      description: t("chat.sidebar.workspaceDeleteDescription"),
      confirmText: t("chat.sidebar.workspaceDeleteConfirm"),
      tone: "danger",
      onConfirm: async () => {
        await deleteChatWorkspace(workspaceId);
        await refreshWorkspaces();
      },
    });
  };

  return (
    <>
      <UChatSidebarView
        threads={ungroupedThreads}
        activeThreadId={activeThreadId}
        threadListStatus={threadListStatus}
        capabilities={capabilities}
        sidebarEntries={sidebarEntries}
        workspaceGroups={workspaceGroups}
        onCreateThread={handleCreateThread}
        onCreateWorkspace={handleOpenCreateWorkspace}
        onSidebarEntryClick={handleSidebarEntryClick}
        onToggleWorkspaceGroup={() => {}}
        onDeleteWorkspace={handleWorkspaceDelete}
        onSelectThread={handleSelectThread}
        onArchiveThread={handleArchiveThread}
        onDeleteThread={handleDeleteThread}
      />

      <UChatSidebarToolsModal
        mode={toolsModalMode}
        open={toolsModalMode !== null}
        threads={threads}
        activeThreadId={activeThreadId}
        workspaceSelection={null}
        workspaceInput={workspaceRootPath}
        isWorkspaceLoading={false}
        isWorkspaceSubmitting={false}
        onWorkspaceInputChange={setWorkspaceRootPath}
        onWorkspaceApply={() => {}}
        onSelectThread={handleSelectThread}
        onClose={() => setToolsModalMode(null)}
      />

      <Modal
        open={createWorkspaceOpen}
        title={t("chat.sidebar.workspaceCreate")}
        footer={null}
        onClose={() => setCreateWorkspaceOpen(false)}
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
            <button
              type="button"
              className="rounded-ui-control border border-border px-3 py-2 text-sm"
              onClick={() => setCreateWorkspaceOpen(false)}
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              className="rounded-ui-control bg-primary px-3 py-2 text-sm text-white"
              onClick={() => {
                void handleCreateWorkspace();
              }}
            >
              {t("chat.sidebar.workspaceCreate")}
            </button>
          </div>
        </div>
      </Modal>

    </>
  );
}
