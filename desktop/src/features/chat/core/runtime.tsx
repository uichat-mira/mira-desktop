import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChatRuntime } from "@/shared/uchat/core";
import {
  UChatApplicationStateProvider,
  useUChatRuntime,
  useUChatSelector,
} from "@/shared/uchat/ui";
import {
  AGENT_RUN_UPDATED_EVENT,
  type AgentRun,
  type AgentRunUpdatedEventDetail,
} from "@/shared/api/thread";
import { useChatKnowledgeBaseState } from "./knowledgeBaseState";
import {
  DesktopChatAttachmentDriver,
  DesktopChatRepository,
  DesktopChatRunDriver,
} from "./protocol";
import {
  createDesktopThreadCreationPolicy,
  createDesktopComposerActions,
  desktopMessagePresentationHints,
  desktopSendLifecyclePolicy,
  desktopThreadSelectionPolicy,
} from "./runtimePolicies";
import { createChatMediaLifecyclePolicy } from "../adapters/chatMediaOrchestration";

type ChatThreadDraftStateValue = {
  draftKnowledgeBaseId: string | null;
  draftRoleId: string | null;
  draftAgentEnabled: boolean;
  draftTtsEnabled: boolean;
  draftImageEnabled: boolean;
  draftWorkspaceId: string | null;
  setDraftKnowledgeBaseId: (knowledgeBaseId: string | null) => void;
  setDraftRoleId: (roleId: string | null) => void;
  setDraftAgentEnabled: (enabled: boolean) => void;
  setDraftTtsEnabled: (enabled: boolean) => void;
  setDraftImageEnabled: (enabled: boolean) => void;
  setDraftWorkspaceId: (workspaceId: string | null) => void;
  resetDraft: () => void;
};

const ChatThreadDraftStateContext =
  createContext<ChatThreadDraftStateValue | null>(null);

const activeThreadStorageKey = (sessionKey: string | number) =>
  `rag-demo-chat-active-thread-id:${String(sessionKey)}`;

const desktopRuntimeBaseCapabilities = {
  renameThread: true,
  archiveThread: true,
  deleteThread: true,
  attachments: true,
  messagePresentation: desktopMessagePresentationHints,
} as const;

const syncRuntimeStatusFromAgentRun = (runtime: ChatRuntime, run: AgentRun) => {
  if (run.status === "queued" || run.status === "running") {
    runtime.store
      .getState()
      .setRunStatus({ type: "running" }, run.threadId);
    return;
  }
  if (run.status === "failed") {
    runtime.store.getState().setRunStatus({
      type: "error",
      message: run.blockedReason ?? "Agent run failed",
    });
    return;
  }
  if (run.status === "cancelled") {
    runtime.store.getState().setRunStatus({ type: "cancelled" });
    return;
  }

  runtime.store.getState().setRunStatus({ type: "idle" });
};

export const createStableAppChatRuntime = (
  getCreateThreadInput: () =>
        | {
          workspaceId?: string | null;
          knowledgeBaseId?: string | null;
          roleId?: string | null;
          agentEnabled?: boolean | null;
          ttsEnabled?: boolean | null;
          imageEnabled?: boolean | null;
        }
    | undefined,
) =>
  new ChatRuntime({
    repository: new DesktopChatRepository(getCreateThreadInput),
    runDriver: new DesktopChatRunDriver(),
    attachmentDriver: new DesktopChatAttachmentDriver(),
    policies: {
      threadCreation: createDesktopThreadCreationPolicy(getCreateThreadInput),
      threadSelection: desktopThreadSelectionPolicy,
      sendLifecycle: createChatMediaLifecyclePolicy(desktopSendLifecyclePolicy),
      composerActions: createDesktopComposerActions({}),
      messagePresentation: desktopMessagePresentationHints,
    },
  });

function AppChatRuntimeEffects({
  sessionKey,
}: {
  sessionKey: string | number;
}) {
  const runtime = useChatRuntime();
  const hasBootstrappedActiveThreadRef = useRef(false);
  const storageKey = activeThreadStorageKey(sessionKey);

  useEffect(() => {
    return runtime.store.subscribe((state) => {
      if (!hasBootstrappedActiveThreadRef.current) {
        return;
      }

      if (state.activeThreadId) {
        globalThis.localStorage.setItem(storageKey, state.activeThreadId);
        return;
      }

      globalThis.localStorage.removeItem(storageKey);
    });
  }, [runtime, storageKey]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const persistedActiveThreadId =
        globalThis.localStorage.getItem(storageKey);
      const threads = await runtime.loadThreads();
      if (cancelled) {
        return;
      }
      if (!persistedActiveThreadId) {
        hasBootstrappedActiveThreadRef.current = true;
        return;
      }

      if (!threads.some((thread) => thread.id === persistedActiveThreadId)) {
        globalThis.localStorage.removeItem(storageKey);
        hasBootstrappedActiveThreadRef.current = true;
        return;
      }

      await runtime.selectThread(persistedActiveThreadId);
      hasBootstrappedActiveThreadRef.current = true;
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [runtime, storageKey]);

  useEffect(() => {
    const handleThreadsCleaned = () => {
      void runtime.loadThreads().then(() => {
        if (!runtime.getState().activeThreadId) {
          runtime.enterWelcomeState();
        }
      });
    };

    window.addEventListener("uichat:threads-cleaned", handleThreadsCleaned);
    return () => {
      window.removeEventListener("uichat:threads-cleaned", handleThreadsCleaned);
    };
  }, [runtime]);

  useEffect(() => {
    let refreshChain = Promise.resolve();

    const handleAgentRunUpdated = (event: Event) => {
      const run = (event as CustomEvent<AgentRunUpdatedEventDetail>).detail?.run;
      if (!run?.threadId) {
        return;
      }

      syncRuntimeStatusFromAgentRun(runtime, run);
      refreshChain = refreshChain
        .then(async () => {
          await runtime.refreshThread(run.threadId);
          if (run.status !== "queued" && run.status !== "running") {
            await runtime.loadThreads();
          }
        })
        .catch(() => undefined);
    };

    window.addEventListener(AGENT_RUN_UPDATED_EVENT, handleAgentRunUpdated);
    return () => {
      window.removeEventListener(AGENT_RUN_UPDATED_EVENT, handleAgentRunUpdated);
    };
  }, [runtime]);

  return null;
}

// ChatRuntimeKnowledgeBaseBinding maps app-owned knowledge-base availability
// into generic UChat capabilities without making UChat import app modules.
export function ChatRuntimeKnowledgeBaseBinding() {
  const runtime = useChatRuntime();
  const { knowledgeBases } = useChatKnowledgeBaseState();

  useEffect(() => {
    runtime.setCapabilities({
      ...runtime.getState().capabilities,
      ...desktopRuntimeBaseCapabilities,
      composerActions: createDesktopComposerActions({
        knowledgeBases,
      }),
    });
  }, [knowledgeBases, runtime]);

  return null;
}

// AppChatRuntimeProvider wires the protocol-agnostic runtime to the current
// desktop app adapters and exposes it through React context.
export function AppChatRuntimeProvider({
  sessionKey,
  children,
}: {
  sessionKey: string | number;
  children: ReactNode;
}) {
  const scopeKey = `${typeof sessionKey}:${String(sessionKey)}`;

  return (
    <AppChatRuntimeScope key={scopeKey} sessionKey={sessionKey}>
      {children}
    </AppChatRuntimeScope>
  );
}

function AppChatRuntimeScope({
  sessionKey,
  children,
}: {
  sessionKey: string | number;
  children: ReactNode;
}) {
  const [draftKnowledgeBaseId, setDraftKnowledgeBaseId] = useState<string | null>(
    null,
  );
  const [draftRoleId, setDraftRoleId] = useState<string | null>(null);
  const [draftAgentEnabled, setDraftAgentEnabled] = useState(true);
  const [draftTtsEnabled, setDraftTtsEnabled] = useState(false);
  const [draftImageEnabled, setDraftImageEnabled] = useState(false);
  const [draftWorkspaceId, setDraftWorkspaceId] = useState<string | null>(null);
  const draftWorkspaceIdRef = useRef<string | null>(draftWorkspaceId);
  const draftKnowledgeBaseIdRef = useRef<string | null>(draftKnowledgeBaseId);
  const draftRoleIdRef = useRef<string | null>(draftRoleId);
  const draftAgentEnabledRef = useRef<boolean>(draftAgentEnabled);
  const draftTtsEnabledRef = useRef<boolean>(draftTtsEnabled);
  const draftImageEnabledRef = useRef<boolean>(draftImageEnabled);
  draftWorkspaceIdRef.current = draftWorkspaceId;
  draftKnowledgeBaseIdRef.current = draftKnowledgeBaseId;
  draftRoleIdRef.current = draftRoleId;
  draftAgentEnabledRef.current = draftAgentEnabled;
  draftTtsEnabledRef.current = draftTtsEnabled;
  draftImageEnabledRef.current = draftImageEnabled;
  const draftState = useMemo<ChatThreadDraftStateValue>(
    () => ({
      draftKnowledgeBaseId,
      draftRoleId,
      draftAgentEnabled,
      draftTtsEnabled,
      draftImageEnabled,
      draftWorkspaceId,
      setDraftKnowledgeBaseId,
      setDraftRoleId,
      setDraftAgentEnabled,
      setDraftTtsEnabled,
      setDraftImageEnabled,
      setDraftWorkspaceId,
      resetDraft: () => {
        setDraftWorkspaceId(null);
        setDraftKnowledgeBaseId(null);
        setDraftRoleId(null);
        setDraftAgentEnabled(true);
        setDraftTtsEnabled(false);
        setDraftImageEnabled(false);
      },
    }),
    [
      draftAgentEnabled,
      draftImageEnabled,
      draftKnowledgeBaseId,
      draftRoleId,
      draftTtsEnabled,
      draftWorkspaceId,
    ],
  );

  return (
    <ChatThreadDraftStateContext.Provider value={draftState}>
      <UChatApplicationStateProvider
        sessionKey={sessionKey}
        createRuntime={() =>
          createStableAppChatRuntime(() => ({
            workspaceId: draftWorkspaceIdRef.current,
            knowledgeBaseId: draftKnowledgeBaseIdRef.current,
            roleId: draftRoleIdRef.current,
            agentEnabled: draftAgentEnabledRef.current,
            ttsEnabled: draftTtsEnabledRef.current,
            imageEnabled: draftImageEnabledRef.current,
          }))
        }
        disposeRuntime={(runtime) => runtime.cancelSend()}
      >
        <AppChatRuntimeEffects sessionKey={sessionKey} />
        {children}
      </UChatApplicationStateProvider>
    </ChatThreadDraftStateContext.Provider>
  );
}

// useChatRuntime returns the bound app runtime instance.
export function useChatRuntime() {
  return useUChatRuntime();
}

// useChatRuntimeSelector re-exports the shared React selector helper with a
// feature-local name so existing chat code can migrate incrementally.
export function useChatRuntimeSelector<T>(
  selector: Parameters<typeof useUChatSelector<T>>[0],
) {
  return useUChatSelector(selector);
}

export function useChatThreadDraftState() {
  const context = useContext(ChatThreadDraftStateContext);
  if (!context) {
    throw new Error(
      "useChatThreadDraftState must be used within AppChatRuntimeProvider",
    );
  }

  return context;
}
