// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ForgeWorkspaceSnapshot } from "../types";
import ForgeTerminalWorkspace from "./ForgeTerminalWorkspace";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const snapshot: ForgeWorkspaceSnapshot = {
  projects: [
    {
      id: "p1",
      name: "mira",
      repositoryPath: "C:/work/mira",
      branch: "dev",
      activeRuntimeCount: 1,
      attentionCount: 0,
    },
  ],
  selectedProjectId: "p1",
  tasks: [
    {
      id: "T009",
      title: "Terminal view",
      batchId: "B-1",
      repositoryState: "DOING",
      repositoryLedgerState: "DOING",
      runtimeState: "waiting",
      source: "docs/tasks/T009.md",
      dependencies: [],
      readiness: "ready",
      readinessReasons: [],
      warnings: [],
      currentSha: null,
      reviewedSha: null,
    },
  ],
  selectedTaskId: "T009",
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
      body: "Forge is ready.",
      createdAt: "17:00",
    },
  ],
  runtimes: [
    {
      id: "D-1",
      taskId: "T009",
      builder: "codex",
      state: "running",
      sourceThreadId: "MT-1",
      externalSessionId: "session-1",
    },
  ],
  events: [
    {
      id: "e1",
      timestamp: "17:00:00",
      kind: "dispatch.started",
      message: "builder started",
      taskId: "T009",
    },
  ],
  inspector: null,
  activeRuntimeCount: 1,
  attentionCount: 0,
  builderChoices: ["opencode", "piagent", "codex"],
  mainThreadAdapters: ["opencode", "codex-desktop", "codex"],
  taskSourceError: null,
};

describe("ForgeTerminalWorkspace", () => {
  it("renders the legacy TUI structure from the current Forge snapshot", () => {
    render(<ForgeTerminalWorkspace snapshot={snapshot} />);

    expect(screen.getByTestId("forge-terminal-view")).toBeInTheDocument();
    expect(screen.getByText("MIRA / FORGE")).toBeInTheDocument();
    expect(screen.getByText("PROJECT STATUS")).toBeInTheDocument();
    expect(screen.getByText("CURRENT WORK")).toBeInTheDocument();
    expect(screen.getByText("MAIN THREAD")).toBeInTheDocument();
    expect(screen.getByText("EVENT LOG")).toBeInTheDocument();
    expect(screen.getAllByText("T009").length).toBeGreaterThan(0);
    expect(screen.getByText("Forge is ready.")).toBeInTheDocument();
  });

  it("opens the terminal command palette with slash", () => {
    render(<ForgeTerminalWorkspace snapshot={snapshot} />);

    fireEvent.keyDown(window, { key: "/" });

    expect(
      screen.getByRole("dialog", { name: "Terminal command palette" }),
    ).toBeInTheDocument();
    expect(screen.getByText("register project")).toBeInTheDocument();
    expect(screen.getByText("dispatch selected task")).toBeInTheDocument();
  });

  it("executes command palette shortcuts instead of only displaying them", () => {
    const onRefresh = vi.fn();
    render(
      <ForgeTerminalWorkspace
        snapshot={snapshot}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.keyDown(window, { key: "/" });
    fireEvent.keyDown(window, { key: "r" });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", {
        name: "Terminal command palette",
      }),
    ).not.toBeInTheDocument();
  });

  it("switches back to the standard Forge view explicitly", () => {
    const onSwitchView = vi.fn();
    render(
      <ForgeTerminalWorkspace
        snapshot={snapshot}
        onSwitchView={onSwitchView}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Switch to standard Forge view",
      }),
    );

    expect(onSwitchView).toHaveBeenCalledTimes(1);
  });

  it("uses terminal-native modal skin for dispatch", () => {
    render(<ForgeTerminalWorkspace snapshot={snapshot} />);

    fireEvent.keyDown(window, { key: "d" });

    const dialog = screen.getByRole("dialog", {
      name: "DISPATCH T009",
    });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass("bg-ink");
    expect(screen.getByText("repository task · serial Builder")).toBeInTheDocument();
    expect(screen.getByText("dispatch task")).toBeInTheDocument();
  });

  it("uses terminal-native modal skin for register and cancel", () => {
    render(<ForgeTerminalWorkspace snapshot={snapshot} />);

    fireEvent.keyDown(window, { key: "n" });
    let dialog = screen.getByRole("dialog", {
      name: "REGISTER PROJECT",
    });
    expect(dialog).toHaveClass("bg-ink");

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "REGISTER PROJECT" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "x" });
    dialog = screen.getByRole("dialog", { name: "CANCEL T009" });
    expect(dialog).toHaveClass("bg-ink");
    expect(screen.getByText("cancel dispatch")).toBeInTheDocument();
  });
});
