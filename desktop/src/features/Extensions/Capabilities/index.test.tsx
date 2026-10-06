// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCapabilityGroups,
  filterCapabilityGroups,
} from "./components/CapabilitiesSidebar";
import CapabilitiesPage from "./index";

const runCase = vi.fn();
const runSelectedCase = vi.fn();
const selectTool = vi.fn();
const selectCase = vi.fn();
const resolveApproval = vi.fn();
const runTerminalContinuation = vi.fn();
const runTerminalStatus = vi.fn();
const runTerminalStop = vi.fn();

const capabilities = {
  canOpenManual: true,
  cases: [
    {
      id: "core-approval-boundary",
      toolId: "write",
      title: "写入审批边界",
      purpose: "确认真实 Policy 边界。",
      expectedObservation: "Awaiting Approval",
      args: {
        path: ".test-artifact/capabilities/approval-probe.txt",
      },
      group: "Native",
    },
  ],
  isLoading: false,
  isResolvingApproval: false,
  isSelectionLocked: false,
  loadError: null,
  readiness: {
    state: "ready" as const,
    reason: "前置条件已满足，可以运行。",
  },
  terminalContinuation: null as null | {
    continuationId: string;
    nextOutputOffset: number;
    outputLimitBytes?: number;
  },
  terminalSessionId: null as string | null,
  terminalSummary: null as null | {
    command?: string;
    cwd?: string;
    sessionId?: string;
    state?: "running" | "completed" | "failed" | "cancelled";
    continuationId?: string;
    continuationAvailable?: boolean;
    nextOutputOffset?: number;
    outputLimitBytes?: number;
  },
  runState: {
    isRunning: false,
    invocationId: "inv-approval",
    invocation: {
      id: "inv-approval",
      toolId: "write",
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
      toolId: "write",
      startedAt: "2026-10-05T00:00:00.000Z",
      spans: [],
    },
    transportError: null,
  },
  selectedCase: {
    id: "core-approval-boundary",
    toolId: "write",
    title: "写入审批边界",
    purpose: "确认真实 Policy 边界。",
    expectedObservation: "Awaiting Approval",
    args: {
      path: ".test-artifact/capabilities/approval-probe.txt",
      dryRun: true,
    },
    group: "Native",
  },
  selectedTool: {
    id: "write",
    title: "Write",
    description: "Write workspace files.",
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
  runTerminalContinuation,
  runTerminalStatus,
  runTerminalStop,
  selectCase,
  selectTool,
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "settings.development.capabilities.groups.read.label": "Read",
      "settings.development.capabilities.groups.read.description": "Read and inspect workspace content.",
      "settings.development.capabilities.groups.mutation.label": "Mutation",
      "settings.development.capabilities.groups.mutation.description": "Create and modify workspace content.",
      "settings.development.capabilities.groups.terminal.label": "Terminal",
      "settings.development.capabilities.groups.terminal.description": "Run governed terminal operations.",
      "settings.development.capabilities.groups.webSearch.label": "Web Search",
      "settings.development.capabilities.groups.webSearch.description": "Search and fetch web content.",
      "settings.development.capabilities.console.toolRun": "tool run",
      "settings.development.capabilities.console.status": "status",
      "settings.development.capabilities.console.scope": "scope",
      "settings.development.capabilities.consoleTabs.trace": "Trace",
      "settings.development.capabilities.consoleTabs.source": "Source",
      "settings.development.capabilities.actions.toolDetails": "工具详情",
      "settings.development.capabilities.catalogKind.native": "Native",
      "settings.development.capabilities.catalogKind.extension": "Extension",
      "settings.development.capabilities.caseGroups.extension": "External MCP",
    } as Record<string, string>)[key] ?? key,
  }),
}));

vi.mock("./hooks/useCapabilities", () => ({
  useCapabilities: () => capabilities,
}));

describe("CapabilitiesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilities.cases = [
      {
        id: "core-approval-boundary",
        toolId: "write",
        title: "写入审批边界",
        purpose: "确认真实 Policy 边界。",
        expectedObservation: "Awaiting Approval",
        args: {
          path: ".test-artifact/capabilities/approval-probe.txt",
        },
        group: "Native",
      },
    ];
    capabilities.selectedTool = {
      id: "write",
      title: "Write",
      description: "Write workspace files.",
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
    };
    capabilities.selectedCase = {
      ...capabilities.cases[0],
      args: {
        path: ".test-artifact/capabilities/approval-probe.txt",
        dryRun: true,
      },
    };
    capabilities.toolCases = [capabilities.selectedCase];
    capabilities.tools = [capabilities.selectedTool];
    selectTool.mockImplementation((toolId: string) => {
      const nextTool = capabilities.tools.find((tool) => tool.id === toolId) ?? null;
      capabilities.selectedTool = nextTool;
      capabilities.toolCases = capabilities.cases.filter((item) => item.toolId === toolId);
      capabilities.selectedCase = capabilities.toolCases[0] ?? null;
    });
    capabilities.readiness = {
      state: "ready" as const,
      reason: "前置条件已满足，可以运行。",
    };
    capabilities.terminalContinuation = null;
    capabilities.terminalSessionId = null;
    capabilities.terminalSummary = null;
    delete (
      capabilities.runState.invocation.approval as {
        resolution?: unknown;
      }
    ).resolution;
  });

  it("builds one catalog with native capability groups and extension sources", () => {
    const externalTool = {
      ...capabilities.selectedTool,
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

    const groups = buildCapabilityGroups([
      capabilities.selectedTool,
      externalTool,
    ]);

    expect(groups.map((group) => [group.label, group.kind])).toEqual([
      ["Mutation", "native"],
      ["GitHub", "extension"],
    ]);
    expect(filterCapabilityGroups(groups, "native")).toHaveLength(1);
    expect(filterCapabilityGroups(groups, "extension")).toHaveLength(1);
  });

  it("localizes native group metadata instead of rendering runtime locale text", () => {
    const groups = buildCapabilityGroups(
      [{
        ...capabilities.selectedTool,
        workbench: {
          groupId: "read",
          groupLabel: "阅读",
          groupDescription: "读取工具。",
          groupOrder: 10,
          icon: "file-search",
        },
      }],
      (key) => ({
        "settings.development.capabilities.groups.read.label": "Read",
        "settings.development.capabilities.groups.read.description": "Read and inspect workspace content.",
      }[key] ?? key),
    );

    expect(groups[0]).toMatchObject({
      label: "Read",
      description: "Read and inspect workspace content.",
    });
  });

  it("exposes source filters for all, native, and extensions", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    const filter = screen.getByRole("combobox");
    await user.click(filter);

    expect(
      screen.getByRole("option", {
        name: "settings.development.capabilities.catalogFilter.all",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "settings.development.capabilities.catalogFilter.native",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "settings.development.capabilities.catalogFilter.extension",
      }),
    ).toBeInTheDocument();
  });


  it("updates rendered tools and cases when switching between native and extension sources", async () => {
    const nativeTool = capabilities.selectedTool;
    const extensionTool = {
      ...nativeTool,
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
    const extensionCase = {
      ...capabilities.selectedCase,
      id: "external-mcp-github-list_issues",
      toolId: extensionTool.id,
      title: "列出 GitHub Issue",
      group: "External MCP",
    };
    capabilities.tools = [nativeTool, extensionTool];
    capabilities.cases = [capabilities.selectedCase, extensionCase];
    capabilities.toolCases = [capabilities.selectedCase];

    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("写入审批边界")).toBeInTheDocument();
    expect(screen.queryByText("列出 GitHub Issue")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", {
      name: "settings.development.capabilities.catalogFilter.extension",
    }));
    rerender(<MemoryRouter><CapabilitiesPage /></MemoryRouter>);

    expect(screen.getByText("列出 GitHub Issue")).toBeInTheDocument();
    expect(screen.queryByText("写入审批边界")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", {
      name: "settings.development.capabilities.catalogFilter.native",
    }));
    rerender(<MemoryRouter><CapabilitiesPage /></MemoryRouter>);

    expect(screen.getByText("写入审批边界")).toBeInTheDocument();
    expect(screen.queryByText("列出 GitHub Issue")).not.toBeInTheDocument();
  });

  it("hides a stale native selection when the active source filter has no tools", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("写入审批边界")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(
      screen.getByRole("option", {
        name: "settings.development.capabilities.catalogFilter.extension",
      }),
    );

    expect(screen.queryByText("写入审批边界")).not.toBeInTheDocument();
    expect(
      screen.getByText("settings.development.capabilities.noMatchingTools"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.development.capabilities.noCases"),
    ).toBeInTheDocument();
    const emptyMain = screen.getByText("settings.development.capabilities.noCases").closest("main");
    expect(emptyMain).not.toBeNull();
    expect(emptyMain?.querySelector('[class*="rounded"], [class*="border"], [class*="shadow"]')).toBeNull();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", {
      name: "settings.development.capabilities.catalogFilter.all",
    }));

    expect(screen.getByText("写入审批边界")).toBeInTheDocument();
    expect(screen.queryByText("settings.development.capabilities.noCases")).not.toBeInTheDocument();
  });

  it("keeps the canonical case input read-only in a detail drawer and exposes the real approval state", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("写入审批边界")).toBeInTheDocument();
    expect(screen.queryByText(/approval-probe\.txt/)).not.toBeInTheDocument();

    const approveButton = screen.getByRole("button", {
      name: "[Y] settings.development.capabilities.approvalTui.approve",
    });
    await waitFor(() => expect(approveButton).toHaveFocus());

    await user.click(
      screen.getByRole("button", {
        name: "settings.development.capabilities.actions.viewCase",
      }),
    );

    expect(screen.getAllByText("写入审批边界")).toHaveLength(2);
    expect(screen.getByText(/approval-probe\.txt/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByText("Approval required")).toHaveLength(2);
    expect(screen.getByText("scope :: workspace.write")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "settings.development.capabilities.invocation.awaiting_approval",
      ),
    ).toHaveLength(2);
    expect(screen.queryByText("inv-approval")).not.toBeInTheDocument();
    expect(
      screen.getByText("settings.development.capabilities.consoleTabs.interaction"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Native")).not.toBeInTheDocument();
    expect(
      screen.queryByText("settings.development.capabilities.catalogKind.native"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("settings.development.capabilities.catalogFilter.native"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Trace")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();

    const rejectButton = screen.getByRole("button", {
      name: "[N] settings.development.capabilities.approvalTui.reject",
    });

    fireEvent.keyDown(approveButton, { key: "y" });
    expect(resolveApproval).toHaveBeenCalledWith("approved");

    fireEvent.keyDown(rejectButton, { key: "n" });
    expect(resolveApproval).toHaveBeenCalledWith("rejected");
    requestAnimationFrameSpy.mockRestore();
  });

  it("keeps the Tool summary compact and opens raw details only on demand", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByLabelText("settings.development.capabilities.readiness.ready"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Write workspace files.", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(
      document.querySelector(
        '[data-tooltip-content="Create and modify workspace content."]',
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "工具详情",
      }),
    );

    expect(screen.getByText("Write workspace files.", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Native")).toBeInTheDocument();
  });

  it("shows persistent Terminal controls on the sidebar Capability surface", async () => {
    const user = userEvent.setup();
    const terminalTool = {
      ...capabilities.selectedTool,
      id: "terminal",
      title: "Terminal",
      domain: "terminal",
      capabilities: {
        sideEffect: "process" as const,
        requiresApproval: true,
        workspaceBound: true,
        longRunning: true,
      },
    };
    const terminalCase = {
      ...capabilities.selectedCase,
      id: "terminal-persistent-start",
      toolId: "terminal",
      title: "持久任务",
      group: "Terminal",
    };
    capabilities.tools = [terminalTool];
    capabilities.cases = [terminalCase];
    capabilities.toolCases = [terminalCase];
    capabilities.selectedTool = terminalTool;
    capabilities.selectedCase = terminalCase;
    capabilities.terminalContinuation = {
      continuationId: "continuation-1",
      nextOutputOffset: 12,
      outputLimitBytes: 4096,
    };
    capabilities.terminalSessionId = "session-1";
    capabilities.terminalSummary = {
      command: "node persistent.js",
      cwd: "/workspace",
      sessionId: "session-1",
      state: "running",
      continuationId: "continuation-1",
      continuationAvailable: true,
      nextOutputOffset: 12,
      outputLimitBytes: 4096,
    };

    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("session :: session-1")).toBeInTheDocument();
    expect(screen.getByText("state :: running")).toBeInTheDocument();

    await user.click(screen.getByRole("button", {
      name: "settings.development.capabilities.actions.continueOutput",
    }));
    await user.click(screen.getByRole("button", {
      name: "settings.development.capabilities.actions.inspectStatus",
    }));
    await user.click(screen.getByRole("button", {
      name: "settings.development.capabilities.actions.stopTerminal",
    }));

    expect(runTerminalContinuation).toHaveBeenCalledOnce();
    expect(runTerminalStatus).toHaveBeenCalledOnce();
    expect(runTerminalStop).toHaveBeenCalledOnce();
  });

  it("keeps persistent Terminal controls renderable when the latest status has no summary", () => {
    const terminalTool = {
      ...capabilities.selectedTool,
      id: "terminal",
      title: "Terminal",
      domain: "terminal",
      capabilities: {
        sideEffect: "process" as const,
        requiresApproval: true,
        workspaceBound: true,
        longRunning: true,
      },
    };
    const terminalCase = {
      ...capabilities.selectedCase,
      id: "terminal-persistent-start",
      toolId: "terminal",
      title: "持久任务",
      group: "Terminal",
    };
    capabilities.tools = [terminalTool];
    capabilities.cases = [terminalCase];
    capabilities.toolCases = [terminalCase];
    capabilities.selectedTool = terminalTool;
    capabilities.selectedCase = terminalCase;
    capabilities.terminalSessionId = "session-1";
    capabilities.terminalContinuation = {
      continuationId: "continuation-1",
      nextOutputOffset: 24,
      outputLimitBytes: 4096,
    };
    capabilities.terminalSummary = null;

    expect(() =>
      render(
        <MemoryRouter>
          <CapabilitiesPage />
        </MemoryRouter>,
      ),
    ).not.toThrow();

    expect(screen.getByText("session :: session-1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "settings.development.capabilities.actions.continueOutput",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "settings.development.capabilities.actions.inspectStatus",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "settings.development.capabilities.actions.stopTerminal",
      }),
    ).toBeEnabled();
  });

  it("does not render navigation buttons in the Tool surface", () => {
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", {
        name: "settings.development.capabilities.actions.settings",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "settings.development.capabilities.actions.manual",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps Unavailable informational without a settings jump button", () => {
    capabilities.readiness = {
      state: "unavailable" as const,
      reason: "未选择 Workspace",
      settingsPath: "/settings/tools",
    };

    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", {
        name: "settings.development.capabilities.actions.settings",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("未选择 Workspace").length).toBeGreaterThan(0);
  });

  it("resizes the result pane by drag and caps it at half the viewport", () => {
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    const resizeSlider = screen.getByRole("slider", {
      name: "settings.development.capabilities.actions.resizeResult",
    });
    const maxBodyHeight = Math.max(140, Math.floor(window.innerHeight * 0.5 - 44));

    expect(resizeSlider).toHaveAttribute("aria-valuenow", "260");
    expect(resizeSlider).toHaveAttribute(
      "aria-valuemax",
      String(maxBodyHeight),
    );

    fireEvent.keyDown(resizeSlider, { key: "ArrowUp" });
    expect(resizeSlider).toHaveAttribute("aria-valuenow", "276");

    fireEvent.pointerDown(resizeSlider);
    fireEvent(
      window,
      new MouseEvent("pointermove", { clientY: -1000, bubbles: true }),
    );
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));

    expect(resizeSlider).toHaveAttribute(
      "aria-valuenow",
      String(maxBodyHeight),
    );
  });

  it("runs the case directly from its compact card", async () => {
    Object.assign(capabilities.runState.invocation.approval, {
      resolution: {
        decision: "rejected",
        resolvedAt: "2026-10-05T00:00:01.000Z",
      },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "settings.development.capabilities.actions.run",
      }),
    );

    expect(runCase).toHaveBeenCalledOnce();
    expect(runCase).toHaveBeenCalledWith("core-approval-boundary");
    expect(runSelectedCase).not.toHaveBeenCalled();
  });

  it("removes row separators from the main TUI output", () => {
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    const interactionRegion = screen.getByRole("region", {
      name: "settings.development.capabilities.consoleTabs.interaction",
    });
    expect(interactionRegion.querySelectorAll('[class*="border-b"]').length).toBe(0);
  });

  it("does not render the acceptance cases heading", () => {
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText("settings.development.capabilities.cases"),
    ).not.toBeInTheDocument();
    const casesSection = screen.getByText("写入审批边界").closest("section");
    expect(casesSection?.firstElementChild).not.toHaveClass("items-center");
  });

  it("keeps the tool tabs visible while scrolling and uses three case columns from medium widths", () => {
    const additionalCases = [
      {
        ...capabilities.selectedCase,
        id: "case-two",
        title: "第二个验收用例",
      },
      {
        ...capabilities.selectedCase,
        id: "case-three",
        title: "第三个验收用例",
      },
    ];
    capabilities.toolCases = [capabilities.selectedCase, ...additionalCases];

    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tablist").parentElement?.parentElement?.parentElement).toHaveClass(
      "sticky",
      "top-0",
    );
    expect(screen.getByText("写入审批边界").closest('[class*="grid"]')).toHaveClass(
      "md:grid-cols-3",
    );
  });
});
