// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ComputerUseStudioPage from "../index";

const guideLabels = { brandName: "Computer Use", title: "Computer Use user guide", intro: "Managed browser runtime", capabilityTitle: "Capabilities", capabilityBody: "Manage the runtime", environmentTitle: "Environment configuration", environmentBody: "Managed Chromium preferred", setupTitle: "How the Agent uses it", setupBody: "Atomic Browser Tools", stepsTitle: "Recommended flow", stepsBody: "Confirm runtime then ask the Agent", approvalTitle: "Approval", approvalBody: "Write actions require approval", boundaryTitle: "Product boundaries", boundaryBody: "Controlled browser only", close: "Close user guide" };
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { returnObjects?: boolean }) => options?.returnObjects ? guideLabels : key }) }));

const runtimeState = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));
const readyRuntime = { status: "ready", checkedAt: "2026-10-19T07:00:00.000Z", details: { executablePath: "C:/managed/chrome.exe", inspectedCandidates: [{ source: "managed", channel: "chromium", executablePath: "C:/managed/chrome.exe", version: "1", installedAt: "now" }] } };
vi.mock("../useComputerUseDebuggerState", () => ({
  useComputerUseRuntimeState: () => runtimeState.current ?? { status: readyRuntime, runtime: readyRuntime, busy: false, error: undefined, refreshStatus: vi.fn(), installRuntime: vi.fn() },
}));

describe("Computer Use Studio runtime management", () => {
  it("renders managed browser runtime state and offers an install action", () => {
    runtimeState.current = { status: readyRuntime, runtime: readyRuntime, busy: false, error: undefined, refreshStatus: vi.fn(), installRuntime: vi.fn() };
    render(<ComputerUseStudioPage />);
    expect(screen.getByText("settings.microApps.computerUseRuntime.runtimeCard.title")).toBeInTheDocument();
    expect(screen.getByText("C:/managed/chrome.exe")).toBeInTheDocument();
    expect(screen.queryByText("settings.microApps.computerUseRuntime.manual.title")).not.toBeInTheDocument();
    expect(screen.queryByText("settings.microApps.computerUseRuntime.feedback.title")).not.toBeInTheDocument();
    runtimeState.current = undefined;
  });

  it("installs the runtime directly when no browser is detected yet", () => {
    const installRuntime = vi.fn();
    const state = { status: "not_installed", checkedAt: "2026-10-19T07:00:00.000Z", details: {} };
    runtimeState.current = { status: state, runtime: state, busy: false, error: undefined, refreshStatus: vi.fn(), installRuntime };
    render(<ComputerUseStudioPage />);
    fireEvent.click(screen.getByRole("button", { name: "settings.microApps.computerUseRuntime.actions.installRuntime" }));
    expect(installRuntime).toHaveBeenCalledWith();
    runtimeState.current = undefined;
  });

  it("opens the user guide in the right drawer and closes it", async () => {
    runtimeState.current = { status: readyRuntime, runtime: readyRuntime, busy: false, error: undefined, refreshStatus: vi.fn(), installRuntime: vi.fn() };
    render(<ComputerUseStudioPage />);
    fireEvent.click(screen.getByRole("button", { name: "settings.microApps.computerUseRuntime.actions.openGuide" }));
    expect(screen.getByText("Computer Use user guide")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Close user guide" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    runtimeState.current = undefined;
  });
});
