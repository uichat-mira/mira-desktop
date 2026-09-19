// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForgeTerminalIntro from "./ForgeTerminalIntro";

const installMatchMedia = (matches: boolean) => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const mediaQuery = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => mediaQuery),
  });

  return { addEventListener, removeEventListener };
};

describe("ForgeTerminalIntro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMatchMedia(false);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("renders the Mira Forge wordmark and real Forge execution flow", () => {
    render(
      <ForgeTerminalIntro
        workspaceState="pending"
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Mira Forge")).toBeInTheDocument();
    expect(screen.getByText("PROJECT")).toBeInTheDocument();
    expect(screen.getAllByText("MAIN THREAD").length).toBeGreaterThan(0);
    expect(screen.getByText("REPOSITORY TASK")).toBeInTheDocument();
    expect(screen.getByText("DISPATCH")).toBeInTheDocument();
    expect(screen.getByText("BUILDER")).toBeInTheDocument();
    expect(screen.getByText("REVIEW")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("waits after the minimum timeline until the workspace settles", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <ForgeTerminalIntro
        workspaceState="pending"
        onComplete={onComplete}
      />,
    );

    fireEvent.animationEnd(
      screen.getByTestId("forge-terminal-intro-timeline"),
    );

    expect(screen.getByText("WAITING FOR WORKSPACE")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    rerender(
      <ForgeTerminalIntro
        workspaceState="ready"
        onComplete={onComplete}
      />,
    );

    const intro = screen.getByTestId("forge-terminal-intro");
    expect(intro).toHaveAttribute("data-state", "exiting");
    fireEvent.transitionEnd(intro);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("uses the reduced motion timeline without removing the brand frame", () => {
    installMatchMedia(true);

    render(
      <ForgeTerminalIntro
        workspaceState="ready"
        onComplete={vi.fn()}
      />,
    );

    const intro = screen.getByTestId("forge-terminal-intro");
    expect(intro).toHaveAttribute("data-motion", "reduced");
    expect(intro.style.getPropertyValue("--forge-intro-duration")).toBe(
      "700ms",
    );
    expect(screen.getByLabelText("Mira Forge")).toBeInTheDocument();
  });

  it("cleans the timeline timer and media-query listener on unmount", () => {
    const media = installMatchMedia(false);
    const { unmount } = render(
      <ForgeTerminalIntro
        workspaceState="pending"
        onComplete={vi.fn()}
      />,
    );

    expect(media.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(media.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });
});
