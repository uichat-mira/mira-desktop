// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ForgeWorkspace from "./ForgeWorkspace";
import type { ForgeWorkspaceSnapshot } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const snapshot: ForgeWorkspaceSnapshot = {
  projects: [
    {
      id: "p1",
      name: "moBuzzer",
      repositoryPath: "C:/work/moBuzzer",
      branch: "main",
      activeRuntimeCount: 1,
      attentionCount: 1,
    },
  ],
  selectedProjectId: "p1",
  tasks: [
    {
      id: "MOB-031",
      title: "修复消息线程首屏加载延迟",
      batchId: "B-1",
      repositoryState: "REVIEW",
      repositoryLedgerState: "REVIEW",
      runtimeState: "reviewing",
      source: "docs/tasks/MOB-031.md",
      dependencies: [],
      readiness: "unavailable",
      readinessReasons: [],
      warnings: [],
      currentSha: "abc123",
      reviewedSha: null,
    },
  ],
  selectedTaskId: "MOB-031",
  selectedThreadId: "MT-1",
  mainThread: {
    adapter: "codex",
    status: "idle",
  },
  messages: [
    {
      id: "m1",
      kind: "message",
      author: "mira",
      body: "Builder 已 Completed，Task 仍等待 Review。",
      createdAt: "14:10",
    },
    {
      id: "h1",
      kind: "builder-result",
      author: "mira",
      body: "3 tests passed",
      createdAt: "14:11",
      handoff: {
        taskId: "MOB-031",
        adapterId: "codex-desktop-local",
        dispatchId: "D-1",
        dispatchStatus: "completed",
        taskStatus: "reviewing",
        sessionStatus: "completed",
        resultText: "3 tests passed",
        error: null,
      },
    },
  ],
  runtimes: [
    {
      id: "D-1",
      taskId: "MOB-031",
      builder: "codex-desktop-local",
      state: "completed",
      sourceThreadId: "MT-1",
      externalSessionId: "codex-thread-1",
      summary: "3 tests passed",
    },
  ],
  events: [
    {
      id: "e1",
      timestamp: "14:10:00",
      kind: "dispatch.completed",
      message: "builder_result received",
      taskId: "MOB-031",
    },
  ],
  inspector: {
    taskId: "MOB-031",
    dispatchId: "D-1",
    sessionId: "S-1",
    reviewStatus: null,
    reviewedSha: null,
    currentSha: "abc123",
    detailLines: ["Task · MOB-031 · reviewing"],
  },
  activeRuntimeCount: 0,
  attentionCount: 1,
  builderChoices: ["opencode", "piagent", "codex"],
  mainThreadAdapters: ["opencode", "codex-desktop", "codex"],
  taskSourceError: null,
};

describe("ForgeWorkspace", () => {
  it("keeps repository and runtime state separate in the task context", () => {
    render(<ForgeWorkspace snapshot={snapshot} />);

    expect(screen.getByText("REVIEW")).toBeInTheDocument();
    expect(screen.getByText("Reviewing")).toBeInTheDocument();
    expect(screen.queryByText("PASS")).not.toBeInTheDocument();
    expect(screen.getByText("Main Thread")).toBeInTheDocument();
    expect(
      screen.getByText(/Builder Result 不等于 Repository PASS/),
    ).toBeInTheDocument();
  });

  it("renders Builder Result Handoff independently from ordinary messages", () => {
    render(<ForgeWorkspace snapshot={snapshot} />);

    expect(screen.getByText("Builder Result Handoff")).toBeInTheDocument();
    expect(screen.getByText("3 tests passed")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("opens the event log through the keyboard shortcut", () => {
    render(<ForgeWorkspace snapshot={snapshot} />);

    fireEvent.keyDown(window, { key: "e", metaKey: true });

    expect(screen.getByText("Event Log")).toBeInTheDocument();
    expect(screen.getByText("builder_result received")).toBeInTheDocument();
  });

  it("derives blocked presentation from readiness without forging task status", () => {
    const blocked: ForgeWorkspaceSnapshot = {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          repositoryState: "TODO",
          repositoryLedgerState: "TODO",
          runtimeState: "waiting",
          readiness: "blocked",
          readinessReasons: ["dependency_not_integrated"],
          dependencies: ["MOB-032"],
        },
      ],
      selectedTaskId: "MOB-031",
    };

    render(<ForgeWorkspace snapshot={blocked} />);

    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("Dispatch unavailable")).toBeInTheDocument();
    expect(screen.getByText("dependency_not_integrated")).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("shows readiness transport failures separately from domain blocking", () => {
    const unavailable: ForgeWorkspaceSnapshot = {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          runtimeState: "waiting",
          readiness: "unavailable",
          readinessReasons: [
            "readiness_check_failed: readiness endpoint unavailable",
          ],
        },
      ],
    };

    render(<ForgeWorkspace snapshot={unavailable} />);

    expect(screen.getByText("Readiness check unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(
        "readiness_check_failed: readiness endpoint unavailable",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("exposes an explicit switch to the terminal Forge view", () => {
    const onSwitchView = vi.fn();
    render(
      <ForgeWorkspace
        snapshot={snapshot}
        onSwitchView={onSwitchView}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "终端" }));

    expect(onSwitchView).toHaveBeenCalledTimes(1);
  });

  it("renders the real empty state when the API snapshot is absent", () => {
    render(<ForgeWorkspace snapshot={null} />);

    expect(screen.getByRole("heading", { name: "淬行" })).toBeInTheDocument();
    expect(screen.getByText(/Register a local repository/)).toBeInTheDocument();
  });
});
