// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAcceptanceToolGroups,
  filterAcceptanceToolGroups,
} from "./components/AcceptanceToolsSidebar";
import ExtensionsToolsPage from "./index";

const runCase = vi.fn();
const runSelectedCase = vi.fn();
const selectTool = vi.fn();
const selectCase = vi.fn();
const resolveApproval = vi.fn();

const toolLab = {
  canOpenManual: true,
  cases: [
    {
      id: "core-approval-boundary",
      toolId: "write_file",
      title: "写入审批边界",
      purpose: "确认真实 Policy 边界。",
      expectedObservation: "Awaiting Approval",
      args: {
        path: ".test-artifact/tool-lab/approval-probe.txt",
        dryRun: true,
      },
      group: "Core",
    },
  ],
  isLoading: false,
  isResolvingApproval: false,
  loadError: null,
  readiness: {
    state: "ready" as const,
    reason: "前置条件已满足，可以运行。",
  },
  runState: {
    isRunning: false,
    invocationId: "inv-approval",
    invocation: {
      id: "inv-approval",
      toolId: "write_file",
      status: "awaiting_approval" as const,
      args: {},
      approval: {
        required: true as const,
        reason: "Approval required",
        scope: "workspace.write",
      },
      artifacts: [],
    },
    resolutionInvocation: null,
    events: [],
    trace: {
      traceId: "trace-1",
      invocationId: "inv-approval",
      toolId: "write_file",
      startedAt: "2026-10-05T00:00:00.000Z",
      spans: [],
    },
    transportError: null,
  },
  selectedCase: {
    id: "core-approval-boundary",
    toolId: "write_file",
    title: "写入审批边界",
    purpose: "确认真实 Policy 边界。",
    expectedObservation: "Awaiting Approval",
    args: {
      path: ".test-artifact/tool-lab/approval-probe.txt",
      dryRun: true,
    },
    group: "Core",
  },
  selectedTool: {
    id: "write_file",
    title: "Write File",
    description: "Write",
    domain: "edit",
    source: "internal" as const,
    sourceInfo: {
      kind: "native" as const,
      label: "Native",
      settingsPath: "/settings/tools",
    },
    inputSchema: {},
    tags: [],
    capabilities: {
      sideEffect: "local-write" as const,
      requiresApproval: true,
      workspaceBound: true,
    },
  },
  toolCases: [] as unknown[],
  tools: [] as unknown[],
  workspaceSelection: {
    rootPath: "/workspace",
    source: "selected" as const,
  },
  refresh: vi.fn(),
  resolveApproval,
  runCase,
  runSelectedCase,
  selectCase,
  selectTool,
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./hooks/useToolLab", () => ({
  useToolLab: () => toolLab,
}));

describe("ExtensionsToolsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolLab.toolCases = [toolLab.selectedCase];
    toolLab.tools = [toolLab.selectedTool];
    toolLab.readiness = {
      state: "ready" as const,
      reason: "前置条件已满足，可以运行。",
    };
    delete (
      toolLab.runState.invocation.approval as {
        resolution?: unknown;
      }
    ).resolution;
  });

  it("builds one catalog with core capability groups and extension sources", () => {
    const externalTool = {
      ...toolLab.selectedTool,
      id: "mcp:github:list_issues",
      title: "List Issues",
      domain: "external_mcp",
      source: "external" as const,
      sourceLabel: "GitHub",
      sourceInfo: {
        kind: "external_mcp" as const,
        label: "External MCP · GitHub",
        settingsPath: "/settings/mcp",
      },
      externalServerId: "github",
    };

    const groups = buildAcceptanceToolGroups([
      toolLab.selectedTool,
      externalTool,
    ]);

    expect(groups.map((group) => [group.label, group.kind])).toEqual([
      ["Mutation", "core"],
      ["GitHub", "extension"],
    ]);
    expect(filterAcceptanceToolGroups(groups, "core")).toHaveLength(1);
    expect(filterAcceptanceToolGroups(groups, "extension")).toHaveLength(1);
  });

  it("keeps the canonical case input read-only in a detail drawer and exposes the real approval state", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ExtensionsToolsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("写入审批边界")).toBeInTheDocument();
    expect(screen.queryByText(/approval-probe\.txt/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "settings.development.toolLab.actions.viewCase",
      }),
    );

    expect(screen.getAllByText("写入审批边界")).toHaveLength(2);
    expect(screen.getByText(/approval-probe\.txt/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByText("Approval required")).toHaveLength(2);
    expect(screen.getByText("scope :: workspace.write")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "settings.development.toolLab.invocation.awaiting_approval",
      ),
    ).toHaveLength(2);
    expect(screen.queryByText("inv-approval")).not.toBeInTheDocument();
    expect(
      screen.getByText("settings.development.toolLab.consoleTabs.interaction"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(
      screen.queryByText("settings.development.toolLab.catalogKind.core"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("settings.development.toolLab.catalogFilter.core"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Trace")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();

    fireEvent.keyDown(
      screen.getByLabelText(
        "settings.development.toolLab.consoleTabs.interaction",
      ),
      { key: "y" },
    );
    expect(resolveApproval).toHaveBeenCalledWith("approved");
  });

  it("keeps the Tool summary compact and opens raw details only on demand", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ExtensionsToolsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByLabelText("settings.development.toolLab.readiness.ready"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Write", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(
      document.querySelector(
        '[data-tooltip-content="Create and modify workspace content."]',
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "settings.development.toolLab.actions.details",
      }),
    );

    expect(screen.getByText("Write", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Native")).toBeInTheDocument();
  });

  it("does not render navigation buttons in the Tool surface", () => {
    render(
      <MemoryRouter>
        <ExtensionsToolsPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", {
        name: "settings.development.toolLab.actions.settings",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "settings.development.toolLab.actions.manual",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps Unavailable informational without a settings jump button", () => {
    toolLab.readiness = {
      state: "unavailable" as const,
      reason: "未选择 Workspace",
      settingsPath: "/settings/tools",
    };

    render(
      <MemoryRouter>
        <ExtensionsToolsPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", {
        name: "settings.development.toolLab.actions.settings",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("未选择 Workspace").length).toBeGreaterThan(0);
  });

  it("resizes the result pane by drag and caps it at half the viewport", () => {
    render(
      <MemoryRouter>
        <ExtensionsToolsPage />
      </MemoryRouter>,
    );

    const separator = screen.getByRole("separator", {
      name: "settings.development.toolLab.actions.resizeResult",
    });
    const maxBodyHeight = Math.max(140, Math.floor(window.innerHeight * 0.5 - 44));

    expect(separator).toHaveAttribute("aria-valuenow", "260");
    expect(separator).toHaveAttribute(
      "aria-valuemax",
      String(maxBodyHeight),
    );

    fireEvent.pointerDown(separator);
    fireEvent(
      window,
      new MouseEvent("pointermove", { clientY: -1000, bubbles: true }),
    );
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));

    expect(separator).toHaveAttribute(
      "aria-valuenow",
      String(maxBodyHeight),
    );
  });

  it("runs the case directly from its compact card", async () => {
    Object.assign(toolLab.runState.invocation.approval, {
      resolution: {
        decision: "rejected",
        resolvedAt: "2026-10-05T00:00:01.000Z",
      },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ExtensionsToolsPage />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "settings.development.toolLab.actions.run",
      }),
    );

    expect(runCase).toHaveBeenCalledOnce();
    expect(runCase).toHaveBeenCalledWith("core-approval-boundary");
    expect(runSelectedCase).not.toHaveBeenCalled();
  });
});
