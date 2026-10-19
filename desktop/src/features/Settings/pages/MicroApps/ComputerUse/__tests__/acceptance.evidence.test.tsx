// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { it, vi } from "vitest";
import ComputerUseStudioPage from "../index";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const runtime = { status: "ready", checkedAt: "2026-10-19T07:00:00.000Z", details: { executablePath: "C:/managed/chrome.exe", inspectedCandidates: [{ source: "managed", channel: "chromium", executablePath: "C:/managed/chrome.exe", version: "1", installedAt: "now" }] } };
vi.mock("../useComputerUseDebuggerState", () => ({
  useComputerUseRuntimeState: () => ({ status: runtime, runtime, busy: false, error: undefined, refreshStatus: vi.fn(), installRuntime: vi.fn() }),
}));

it("renders the runtime-management Studio without a Manual Debug surface", () => {
  render(<ComputerUseStudioPage />);
  expect(screen.getByText("settings.microApps.computerUseRuntime.runtimeCard.title")).toBeInTheDocument();
  expect(screen.getByText("C:/managed/chrome.exe")).toBeInTheDocument();
  expect(screen.queryByText("settings.microApps.computerUseRuntime.manual.title")).not.toBeInTheDocument();
  fs.mkdirSync(path.resolve(process.cwd(), "..", ".test-artifact", "computer-use-acceptance", "desktop"), { recursive: true });
  fs.writeFileSync(path.resolve(process.cwd(), "..", ".test-artifact", "computer-use-acceptance", "desktop", "ui-evidence.json"), JSON.stringify({ surface: "runtime-management", executablePath: "C:/managed/chrome.exe" }, null, 2));
});
