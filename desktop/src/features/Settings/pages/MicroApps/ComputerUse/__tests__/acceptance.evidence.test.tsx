// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ComputerUseDebuggerPage from "../index";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../useComputerUseDebuggerState", () => ({
  useComputerUseDebuggerState: () => ({
    config: { runtime: "managed", url: "https://example.com", allowedDomains: ["example.com"], limits: { timeoutMs: 30000, maxSnapshotChars: 12000 }, approvalPolicy: "write_actions" },
    setConfig: vi.fn(),
    status: { runtime: { status: "ready" } },
    runtime: { status: "ready" },
    session: { sessionId: "acceptance-session", status: "ready", config: {}, browser: { url: "https://example.com/", title: "Example Domain", snapshot: "button ref=e1", visibleText: "Example Domain", screenshotArtifact: "https://example.com/image.png", snapshotHash: "hash-1" }, invocations: [{ invocationId: "invocation-1", tool: "browser_observe", args: { sessionId: "acceptance-session" }, status: "succeeded", artifactIds: ["artifact-1"], createdAt: "2026-07-14T00:00:00.000Z" }], evidence: { entries: [{ kind: "observation" }], artifacts: [{ id: "artifact-1" }] }, result: { status: "succeeded" } },
    busy: false, error: undefined, refreshStatus: vi.fn(), newSession: vi.fn(), observe: vi.fn(), executeAction: vi.fn(), assertState: vi.fn(), approve: vi.fn(), reject: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  }),
}));

it("T122 evidence UI exposes results and has no standalone Model Run", () => {
  render(<ComputerUseDebuggerPage />);
  expect(screen.getAllByText("Example Domain").length).toBeGreaterThan(0);
  expect(screen.getByText(/invocation-1/)).toBeInTheDocument();
  expect(screen.getAllByText(/artifact-1/).length).toBeGreaterThan(0);
  expect(screen.getByRole("img")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "settings.microApps.computerUseDebugger.modelRun.run" })).not.toBeInTheDocument();
  fs.mkdirSync(path.resolve(process.cwd(), "..", ".test-artifact", "computer-use-acceptance", "desktop"), { recursive: true });
  fs.writeFileSync(path.resolve(process.cwd(), "..", ".test-artifact", "computer-use-acceptance", "desktop", "ui-evidence.json"), JSON.stringify({ invocationId: "invocation-1", artifactId: "artifact-1" }, null, 2));
});
