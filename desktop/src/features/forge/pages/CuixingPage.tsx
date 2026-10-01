import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, FullPageStatus } from "@/shared/ui";
import ForgeWorkspace, {
  type ForgeWorkspaceProps,
} from "../components/ForgeWorkspace";
import ForgeTerminalWorkspace from "../components/ForgeTerminalWorkspace";
import ForgeTerminalIntro, {
  type ForgeTerminalIntroWorkspaceState,
} from "../components/ForgeTerminalIntro";
import useForgeWorkspace from "../hooks/useForgeWorkspace";

const FORGE_VIEW_MODE_KEY = "mira:forge:view-mode";

type ForgeViewMode = "standard" | "terminal";

const readForgeViewMode = (): ForgeViewMode => {
  if (typeof window === "undefined") return "standard";
  try {
    return window.localStorage.getItem(FORGE_VIEW_MODE_KEY) === "terminal"
      ? "terminal"
      : "standard";
  } catch {
    return "standard";
  }
};

export default function CuixingPage() {
  const navigate = useNavigate();
  const workspace = useForgeWorkspace();
  const initialViewMode = useMemo(readForgeViewMode, []);
  const [viewMode, setViewMode] =
    useState<ForgeViewMode>(initialViewMode);
  const [terminalIntroVisible, setTerminalIntroVisible] = useState(
    initialViewMode === "terminal",
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(FORGE_VIEW_MODE_KEY, viewMode);
    } catch {
      // Local appearance persistence is best effort only.
    }
  }, [viewMode]);

  const terminalIntroWorkspaceState: ForgeTerminalIntroWorkspaceState =
    workspace.loading && !workspace.snapshot
      ? "pending"
      : workspace.error && !workspace.snapshot
        ? "error"
        : "ready";

  if (viewMode === "terminal" && terminalIntroVisible) {
    return (
      <ForgeTerminalIntro
        workspaceState={terminalIntroWorkspaceState}
        onComplete={() => setTerminalIntroVisible(false)}
      />
    );
  }

  if (workspace.loading && !workspace.snapshot) {
    return <FullPageStatus message="正在打开淬行…" />;
  }

  if (workspace.error && !workspace.snapshot) {
    return (
      <main className="flex h-full min-h-0 items-center justify-center bg-surface-secondary p-6">
        <section className="w-full max-w-lg rounded-ui-panel border border-border bg-surface-primary p-5 text-sm text-text-secondary shadow-shadow-sm">
          <h1 className="text-base font-semibold text-text-primary">
            淬行加载失败
          </h1>
          <p className="mt-2 break-words leading-6">{workspace.error}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                void workspace.refresh();
              }}
            >
              重试
            </Button>
            <Button variant="ghost" onClick={() => navigate("/chat")}>
              返回聊天
            </Button>
          </div>
        </section>
      </main>
    );
  }

  const commonProps: ForgeWorkspaceProps = {
    snapshot: workspace.snapshot,
    busy: workspace.busy,
    onBackToChat: () => navigate("/chat"),
    onRefresh: () => workspace.refresh(),
    onSelectProject: (projectId) => workspace.selectProject(projectId),
    onSelectTask: (taskId) => workspace.selectTask(taskId),
    onRegisterProject: (values) => workspace.registerProject(values),
    onSendMessage: (value) => workspace.sendMessage(value),
    onDispatch: (task, builder) =>
      workspace.dispatchTask(task, builder),
    onCancel: (runtime) => workspace.cancelDispatch(runtime.id),
    onIntegrate: (task) => workspace.integrateTask(task),
  };

  if (viewMode === "terminal") {
    return (
      <ForgeTerminalWorkspace
        {...commonProps}
        onSwitchView={() => {
          setTerminalIntroVisible(false);
          setViewMode("standard");
        }}
      />
    );
  }

  return (
    <ForgeWorkspace
      {...commonProps}
      onSwitchView={() => {
        setTerminalIntroVisible(true);
        setViewMode("terminal");
      }}
    />
  );
}
