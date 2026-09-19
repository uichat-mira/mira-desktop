// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CuixingPage from "./CuixingPage";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refresh: vi.fn(),
  workspace: {
    loading: false,
    error: "backend unavailable" as string | null,
    snapshot: null as object | null,
    busy: false,
    refresh: vi.fn(),
    selectProject: vi.fn(),
    selectTask: vi.fn(),
    registerProject: vi.fn(),
    sendMessage: vi.fn(),
    dispatchTask: vi.fn(),
    cancelDispatch: vi.fn(),
    integrateTask: vi.fn(),
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("../hooks/useForgeWorkspace", () => ({
  default: () => mocks.workspace,
}));

vi.mock("../components/ForgeWorkspace", () => ({
  default: ({ onSwitchView }: { onSwitchView: () => void }) => (
    <div data-testid="forge-standard-view">
      <button type="button" onClick={onSwitchView}>
        switch to terminal
      </button>
    </div>
  ),
}));

vi.mock("../components/ForgeTerminalWorkspace", () => ({
  default: ({ onSwitchView }: { onSwitchView: () => void }) => (
    <div data-testid="forge-terminal-view">
      <button type="button" onClick={onSwitchView}>
        switch to standard
      </button>
    </div>
  ),
}));

vi.mock("../components/ForgeTerminalIntro", () => ({
  default: ({
    workspaceState,
    onComplete,
  }: {
    workspaceState: string;
    onComplete: () => void;
  }) => (
    <div
      data-testid="forge-terminal-intro"
      data-workspace-state={workspaceState}
    >
      <button type="button" onClick={onComplete}>
        finish intro
      </button>
    </div>
  ),
}));

describe("CuixingPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    Object.assign(mocks.workspace, {
      loading: false,
      error: "backend unavailable",
      snapshot: null,
      busy: false,
      refresh: mocks.refresh,
    });
  });

  it("keeps retry and back actions available after the initial load fails", () => {
    render(<CuixingPage />);

    expect(screen.getByText("淬行加载失败")).toBeInTheDocument();
    expect(screen.getByText("backend unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "返回聊天" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/chat");
  });

  it("does not play the terminal intro in the standard view", () => {
    Object.assign(mocks.workspace, {
      error: null,
      snapshot: {},
    });

    render(<CuixingPage />);

    expect(screen.getByTestId("forge-standard-view")).toBeInTheDocument();
    expect(
      screen.queryByTestId("forge-terminal-intro"),
    ).not.toBeInTheDocument();
  });

  it("plays the intro while a persisted terminal view loads", () => {
    window.localStorage.setItem("mira:forge:view-mode", "terminal");
    Object.assign(mocks.workspace, {
      loading: true,
      error: null,
      snapshot: null,
    });

    render(<CuixingPage />);

    expect(screen.getByTestId("forge-terminal-intro")).toHaveAttribute(
      "data-workspace-state",
      "pending",
    );
    expect(screen.queryByText("正在打开淬行…")).not.toBeInTheDocument();
  });

  it("shows the terminal workspace after the intro completes", () => {
    window.localStorage.setItem("mira:forge:view-mode", "terminal");
    Object.assign(mocks.workspace, {
      error: null,
      snapshot: {},
    });

    render(<CuixingPage />);
    fireEvent.click(screen.getByRole("button", { name: "finish intro" }));

    expect(screen.getByTestId("forge-terminal-view")).toBeInTheDocument();
  });

  it("preserves the existing error actions after a terminal intro", () => {
    window.localStorage.setItem("mira:forge:view-mode", "terminal");

    render(<CuixingPage />);

    expect(screen.getByTestId("forge-terminal-intro")).toHaveAttribute(
      "data-workspace-state",
      "error",
    );
    fireEvent.click(screen.getByRole("button", { name: "finish intro" }));

    expect(screen.getByText("淬行加载失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "返回聊天" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/chat");
  });

  it("replays the intro each time the user enters Terminal View", () => {
    Object.assign(mocks.workspace, {
      error: null,
      snapshot: {},
    });

    render(<CuixingPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "switch to terminal" }),
    );
    expect(screen.getByTestId("forge-terminal-intro")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "finish intro" }));
    fireEvent.click(
      screen.getByRole("button", { name: "switch to standard" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "switch to terminal" }),
    );

    expect(screen.getByTestId("forge-terminal-intro")).toBeInTheDocument();
  });
});
