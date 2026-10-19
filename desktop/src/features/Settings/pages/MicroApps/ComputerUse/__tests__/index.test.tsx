// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ComputerUseDebuggerPage, { buildActionInput, buildAssertionInput } from "../index";

const guideLabels = {
  title: "Computer Use user guide",
  intro: "Controlled browser actions",
  capabilityTitle: "Capabilities",
  capabilityBody: "Inspect and operate pages",
  environmentTitle: "Environment configuration",
  environmentBody: "Configure the browser runtime",
  setupTitle: "Before you start",
  setupBody: "Connect the model",
  stepsTitle: "How to use it",
  stepsBody: "Create, inspect, act, and assert",
  approvalTitle: "Approval and feedback",
  approvalBody: "Review write actions",
  boundaryTitle: "Product boundaries",
  boundaryBody: "Controlled browser only",
  close: "Close user guide",
};
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { returnObjects?: boolean }) => options?.returnObjects ? guideLabels : key }) }));
const debuggerState = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));
vi.mock("../useComputerUseDebuggerState", () => ({
  useComputerUseDebuggerState: () => debuggerState.current ?? ({
    config: { runtime: "managed", url: "https://example.com", allowedDomains: ["example.com"], limits: { timeoutMs: 30000, maxSnapshotChars: 12000 }, approvalPolicy: "write_actions" },
    setConfig: vi.fn(), status: { runtime: { status: "ready" } }, runtime: { status: "ready" }, session: undefined, busy: false, error: undefined, refreshStatus: vi.fn(), newSession: vi.fn(), observe: vi.fn(), executeAction: vi.fn(), assertState: vi.fn(), approve: vi.fn(), reject: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  }),
}));

describe("Computer Use Debugger", () => {
  it("renders browser state and complete execution feedback", () => {
    debuggerState.current = {
      config: { runtime: "managed", url: "https://example.com", allowedDomains: ["example.com"], limits: { timeoutMs: 30000, maxSnapshotChars: 12000 }, approvalPolicy: "write_actions" },
      setConfig: vi.fn(), status: { runtime: { status: "ready" } }, runtime: { status: "ready" }, busy: false, error: undefined, refreshStatus: vi.fn(), newSession: vi.fn(), observe: vi.fn(), executeAction: vi.fn(), assertState: vi.fn(), approve: vi.fn(), reject: vi.fn(), stop: vi.fn(), reset: vi.fn(),
      session: { sessionId: "session-1", status: "ready", config: {} as never, browser: { url: "https://example.com", title: "Example", snapshot: "ref=button-1", visibleText: "Visible heading", screenshotArtifact: "artifact-screenshot-1", snapshotHash: "hash-1" }, approval: { status: "pending", approvalId: "approval-1", reason: "Write action" }, invocations: [{ invocationId: "invocation-1", tool: "browser_act", args: { action: "click", ref: "button-1" }, status: "failed", artifactIds: ["artifact-screenshot-1"], error: { code: "REF_STALE", message: "The ref is stale" }, createdAt: "2026-07-14T00:00:00.000Z" }], evidence: { entries: [{ kind: "observation", message: "Observed page" }], artifacts: [{ id: "artifact-screenshot-1", kind: "screenshot" }] }, result: { status: "failed", summary: "Assertion failed" } },
    };
    render(<ComputerUseDebuggerPage />);
    expect(screen.getByText("Visible heading")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "settings.microApps.computerUseDebugger.browserState.screenshot" })).toBeInTheDocument();
    expect(screen.getByText(/REF_STALE: The ref is stale/)).toBeInTheDocument();
    expect(screen.getByText(/\"button-1\"/)).toBeInTheDocument();
    expect(screen.getByText(/approval-1/)).toBeInTheDocument();
    expect(screen.getByText(/Assertion failed/)).toBeInTheDocument();
    debuggerState.current = undefined;
  });

  it("shows structured debugger sections without a standalone Model Run", () => {
    render(<ComputerUseDebuggerPage />);
    expect(screen.getByText("settings.microApps.computerUseDebugger.runConfig.title")).toBeInTheDocument();
    expect(screen.getByText("settings.microApps.computerUseDebugger.browserState.title")).toBeInTheDocument();
    expect(screen.getByText("settings.microApps.computerUseDebugger.feedback.title")).toBeInTheDocument();
    expect(screen.queryByText("settings.microApps.computerUseDebugger.model.unavailable")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "settings.microApps.computerUseDebugger.modelRun.run" })).not.toBeInTheDocument();
    expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    expect(screen.queryByText("Create Plan")).not.toBeInTheDocument();
  });

  it("switches execution feedback to raw session JSON without restoring Model Run", () => {
    debuggerState.current = {
      config: { runtime: "managed", url: "https://example.com", allowedDomains: ["example.com"], limits: { timeoutMs: 30000, maxSnapshotChars: 12000 }, approvalPolicy: "write_actions" },
      setConfig: vi.fn(), status: { runtime: { status: "ready" } }, runtime: { status: "ready" }, busy: false, error: undefined, refreshStatus: vi.fn(), newSession: vi.fn(), observe: vi.fn(), executeAction: vi.fn(), assertState: vi.fn(), approve: vi.fn(), reject: vi.fn(), stop: vi.fn(), reset: vi.fn(),
      session: { sessionId: "session-json", status: "ready", config: {} as never, browser: {}, invocations: [] },
    };

    render(<ComputerUseDebuggerPage />);
    fireEvent.click(screen.getByRole("button", { name: "settings.microApps.computerUseDebugger.feedback.json" }));

    expect(screen.getByText(/session-json/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "settings.microApps.computerUseDebugger.modelRun.run" })).not.toBeInTheDocument();
    debuggerState.current = undefined;
  });

  it("maps manual fields to the browser action protocol", () => {
    expect(buildActionInput("navigate", "ignored", "https://example.com", "https://example.com", "hash")).toEqual({ pageUrl: "https://example.com", snapshotHash: "hash", action: { kind: "navigate", url: "https://example.com" } });
    expect(buildActionInput("click", "ref-1", "ignored", "https://example.com", "hash")).toEqual({ pageUrl: "https://example.com", snapshotHash: "hash", action: { kind: "click", ref: "ref-1" } });
    expect(buildActionInput("type", "ref-1", "hello", "https://example.com", "hash")).toEqual({ pageUrl: "https://example.com", snapshotHash: "hash", action: { kind: "type", ref: "ref-1", text: "hello" } });
    expect(buildAssertionInput("visible", "ref-1", "ignored")).toEqual({ assertion: { kind: "visible", ref: "ref-1" } });
    expect(buildAssertionInput("title", "ignored", "Example")).toEqual({ assertion: { kind: "title", expected: "Example" } });
  });

  it("opens the user guide in the right drawer and closes it", async () => {
    render(<ComputerUseDebuggerPage />);
    fireEvent.click(screen.getByRole("button", { name: "settings.microApps.computerUseDebugger.actions.openGuide" }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByText("Computer Use user guide")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Close user guide" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });
});
