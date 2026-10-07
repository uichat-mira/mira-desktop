// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToolsSettings from "./index";

const runSelectedTool = vi.fn();
const saveWebSearchConfig = vi.fn();
const selectGroup = vi.fn();
const selectTool = vi.fn();
const setArgsDraft = vi.fn();
const hookCapture = vi.hoisted(() => ({
  initialHandoff: undefined as unknown,
}));

const workbench = {
  activeCase: null,
  activeGroupId: "web_search",
  argsDraft: "{}",
  artifacts: [],
  events: [],
  filteredTools: [{ id: "web_search", title: "Web Search" }],
  groupSummaries: [{ id: "web_search", label: "Web", count: 1 }],
  isRunning: false,
  isSelectingWorkspace: false,
  isWorkspaceLoading: false,
  requiresWorkspace: false,
  runError: null,
  runStatus: "idle",
  selectedTool: {
    id: "web_search",
    title: "Web Search",
    description: "Search the web",
    domain: "web_search",
    capabilities: { requiresApproval: false },
  },
  terminalSummary: null,
  trace: null,
  webSearchConfig: { apiKey: "key", baseUrl: "http://localhost", maxResults: 5 },
  workspaceRootInput: "",
  workspaceSelection: null,
  runSelectedTool,
  saveWebSearchConfig,
  selectGroup,
  selectTool,
  setArgsDraft,
  setWebSearchConfig: vi.fn(),
  setWorkspaceRootInput: vi.fn(),
  updateWorkspaceRoot: vi.fn(),
};

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./hooks/useToolsWorkbench", () => ({
  useToolsWorkbench: (initialHandoff: unknown) => {
    hookCapture.initialHandoff = initialHandoff;
    return workbench;
  },
}));
vi.mock("../../components/SettingsPageLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("./components/ToolsSidebar", () => ({ default: ({ onSelectGroup }: { onSelectGroup: (id: string) => void }) => <button onClick={() => onSelectGroup("web_search")}>sidebar</button> }));
vi.mock("./components/ToolsWorkbenchPanel", () => ({ default: () => <div>workspace panel</div> }));
vi.mock("./components/ToolsTracePanel", () => ({ default: () => <div>trace panel</div> }));
vi.mock("./components/ToolsPackagePanel", () => ({
  default: ({ onOpenArgsModal, onRun, onSelectTool }: { onOpenArgsModal: () => void; onRun: () => void; onSelectTool: (id: string) => void }) => (
    <div><button onClick={onOpenArgsModal}>config</button><button onClick={onRun}>run</button><button onClick={() => onSelectTool("web_search")}>tool</button></div>
  ),
}));

function renderToolsSettings(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/settings/tools", state }]}>
      <ToolsSettings />
    </MemoryRouter>,
  );
}

describe("ToolsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookCapture.initialHandoff = undefined;
  });

  it("wires sidebar, tool selection, and execution", async () => {
    const user = userEvent.setup();
    renderToolsSettings();
    await user.click(screen.getByRole("button", { name: "sidebar" }));
    await user.click(screen.getByRole("button", { name: "tool" }));
    await user.click(screen.getByRole("button", { name: "run" }));
    expect(selectGroup).toHaveBeenCalledWith("web_search");
    expect(selectTool).toHaveBeenCalledWith("web_search");
    expect(runSelectedTool).toHaveBeenCalledOnce();
  });

  it("passes a valid Capability handoff into the existing workbench", () => {
    const handoff = {
      toolId: "read",
      args: { path: "README.md" },
    };

    renderToolsSettings({ capabilitiesHandoff: handoff });

    expect(hookCapture.initialHandoff).toEqual(handoff);
  });

  it.each([
    null,
    [],
    {},
    { capabilitiesHandoff: [] },
    { capabilitiesHandoff: { toolId: 7, args: {} } },
    { capabilitiesHandoff: { toolId: "read", args: null } },
    { capabilitiesHandoff: { toolId: "read", args: [] } },
  ])("rejects malformed Capability handoff state %#", (state) => {
    renderToolsSettings(state);

    expect(hookCapture.initialHandoff).toBeNull();
  });

  it("opens web-search configuration and saves it on confirmation", async () => {
    const user = userEvent.setup();
    renderToolsSettings();
    await user.click(screen.getByRole("button", { name: "config" }));
    expect(screen.getByText("Web Search")).toBeInTheDocument();
    expect(screen.getByDisplayValue("key")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.actions.confirm" }));
    expect(saveWebSearchConfig).toHaveBeenCalledOnce();
    expect(screen.queryByText("Web Search")).not.toBeInTheDocument();
  });
});
