// @vitest-environment jsdom
import React, { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NavigationCardTabs, {
  resolveNavigationCardTabsWindow,
} from "../NavigationCardTabs";

const tabs = [
  {
    value: "chat" as const,
    label: "对话工作台",
    icon: <span>🧭</span>,
  },
  {
    value: "settings" as const,
    label: "运行设置",
    icon: <span>⚙️</span>,
  },
] as const;

type LayoutState = {
  availableWidth: number;
  tabWidths: number[];
};

let layout: LayoutState = { availableWidth: 0, tabWidths: [] };
const resizeObservers = new Set<ResizeObserverCallback>();

class MockResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {
    resizeObservers.add(this.callback);
  }

  unobserve() {}

  disconnect() {
    resizeObservers.delete(this.callback);
  }
}

function createRect(width: number): DOMRect {
  return {
    width,
    height: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function installLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const element = this as HTMLElement;
    const measureIndex = element.getAttribute("data-navigation-card-tabs-measure-item");
    if (measureIndex !== null) {
      return createRect(layout.tabWidths[Number(measureIndex)] ?? 0);
    }
    if (element.getAttribute("role") === "tablist") {
      return createRect(layout.availableWidth);
    }
    return createRect(0);
  });
}

function updateLayout(nextLayout: LayoutState) {
  layout = nextLayout;
  act(() => {
    Array.from(resizeObservers).forEach((callback) => {
      callback([], {
        observe: () => {},
        unobserve: () => {},
        disconnect: () => {},
      } as unknown as ResizeObserver);
    });
  });
}

function makeTabs(count: number, labelPrefix = "工具") {
  return Array.from({ length: count }, (_, index) => ({
    value: `tool-${index}`,
    label: `${labelPrefix} ${index}`,
    icon: <span>{index}</span>,
  }));
}

function ControlledTabs({
  items,
  initialValue,
}: {
  items: ReturnType<typeof makeTabs>;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  return <NavigationCardTabs tabs={items} value={value} onChange={setValue} />;
}

beforeEach(() => {
  layout = { availableWidth: 0, tabWidths: [] };
  resizeObservers.clear();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  installLayout();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveNavigationCardTabsWindow", () => {
  it("keeps at most 5 tabs on wide containers and 4 on medium containers", () => {
    expect(
      resolveNavigationCardTabsWindow({
        availableWidth: 900,
        tabWidths: Array.from({ length: 8 }, () => 110),
        selectedIndex: 0,
      }),
    ).toMatchObject({ start: 0, end: 5, hasOverflow: true });

    expect(
      resolveNavigationCardTabsWindow({
        availableWidth: 500,
        tabWidths: Array.from({ length: 8 }, () => 100),
        selectedIndex: 0,
      }),
    ).toMatchObject({ start: 0, end: 4, hasOverflow: true });
  });

  it("keeps shrinking with the available width instead of forcing a tab", () => {
    expect(
      resolveNavigationCardTabsWindow({
        availableWidth: 180,
        tabWidths: Array.from({ length: 8 }, () => 120),
        selectedIndex: 0,
      }),
    ).toMatchObject({ start: 0, end: 1, hasOverflow: true });

    expect(
      resolveNavigationCardTabsWindow({
        availableWidth: 150,
        tabWidths: [260, 260],
        selectedIndex: 0,
      }),
    ).toMatchObject({ start: 0, end: 1, hasOverflow: true });

    expect(
      resolveNavigationCardTabsWindow({
        availableWidth: 60,
        tabWidths: [260, 260],
        selectedIndex: 0,
      }),
    ).toMatchObject({ start: 0, end: 0, hasOverflow: true });
  });

  it("shifts the visible window to include the selected tab", () => {
    expect(
      resolveNavigationCardTabsWindow({
        availableWidth: 500,
        tabWidths: Array.from({ length: 8 }, () => 120),
        selectedIndex: 6,
      }),
    ).toMatchObject({ start: 4, end: 7, hasOverflow: true });
  });

  it("expands again when the container grows", () => {
    const tabWidths = Array.from({ length: 8 }, () => 120);
    const narrow = resolveNavigationCardTabsWindow({
      availableWidth: 180,
      tabWidths,
      selectedIndex: 0,
    });
    const restored = resolveNavigationCardTabsWindow({
      availableWidth: 900,
      tabWidths,
      selectedIndex: 0,
    });

    expect(narrow.end - narrow.start).toBe(1);
    expect(restored.end - restored.start).toBe(5);
  });
});

describe("NavigationCardTabs", () => {
  it("renders the tab rail", () => {
    render(<NavigationCardTabs tabs={tabs} value="chat" onChange={() => {}} />);

    expect(screen.getByRole("tablist", { name: "Navigation tabs" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "对话工作台" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "运行设置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "对话工作台" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches the active card when a tab is clicked", async () => {
    const handleChange = vi.fn();
    render(<NavigationCardTabs tabs={tabs} value="chat" onChange={handleChange} />);

    await userEvent.click(screen.getByRole("tab", { name: "运行设置" }));

    expect(handleChange).toHaveBeenCalledWith("settings");
  });

  it("does not emit a change when the active tab is clicked again", async () => {
    const handleChange = vi.fn();
    render(<NavigationCardTabs tabs={tabs} value="chat" onChange={handleChange} />);

    await userEvent.click(screen.getByRole("tab", { name: "对话工作台" }));

    expect(handleChange).not.toHaveBeenCalled();
  });

  it("supports a transparent active tab style", () => {
    render(
      <NavigationCardTabs
        tabs={tabs}
        value="chat"
        onChange={() => {}}
        activeTabStyle="plain"
      />,
    );

    expect(screen.getByRole("tab", { name: "对话工作台" })).toHaveClass(
      "data-[state=active]:bg-transparent",
      "data-[state=active]:shadow-none",
      "data-[state=active]:after:bg-surface-primary",
      "data-[state=active]:after:h-0.5",
    );
  });

  it("collapses overflow tabs into the borderless vertical menu", async () => {
    const manyTabs = makeTabs(8);
    layout = { availableWidth: 900, tabWidths: Array.from({ length: 8 }, () => 120) };
    const { container } = render(
      <NavigationCardTabs tabs={manyTabs} value="tool-0" onChange={() => {}} />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    const trigger = screen.getByRole("button", { name: "More navigation tabs" });
    expect(trigger).toHaveClass("border-0", "bg-transparent");
    expect(trigger.querySelector("svg")).toHaveClass("rotate-90");
    expect(container.querySelector(".overflow-x-auto")).toBeNull();

    await userEvent.click(trigger);

    expect(screen.getByRole("menuitemradio", { name: "工具 5" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "工具 7" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: "工具 0" })).not.toBeInTheDocument();
  });

  it("shrinks and truncates a single visible tab at extreme widths", () => {
    const longTabs = [
      { value: "tool-0", label: "一个非常非常非常非常非常非常长的工具名称" },
      { value: "tool-1", label: "另一个同样非常非常非常长的工具名称" },
    ];
    layout = { availableWidth: 150, tabWidths: [260, 260] };
    render(<NavigationCardTabs tabs={longTabs} value="tool-0" onChange={() => {}} />);

    const visibleTabs = screen.getAllByRole("tab");
    expect(visibleTabs).toHaveLength(1);
    expect(visibleTabs[0]).toHaveClass("min-w-0", "shrink");
    expect(visibleTabs[0]).toHaveTextContent("一个非常非常非常非常非常非常长的工具名称");
    expect(
      within(visibleTabs[0]).getByText("一个非常非常非常非常非常非常长的工具名称"),
    ).toHaveClass("truncate");
    expect(screen.getByRole("button", { name: "More navigation tabs" })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toHaveClass("overflow-hidden");
    expect(screen.getByRole("tablist")).not.toHaveClass("overflow-x-auto");
  });

  it("keeps only the menu when even the minimum control area cannot fit", () => {
    layout = { availableWidth: 60, tabWidths: [260, 260] };
    render(<NavigationCardTabs tabs={makeTabs(2)} value="tool-0" onChange={() => {}} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "More navigation tabs" })).toBeInTheDocument();
  });

  it("marks the selected folded tab in the menu", async () => {
    layout = { availableWidth: 60, tabWidths: [260, 260] };
    render(<NavigationCardTabs tabs={makeTabs(2)} value="tool-1" onChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "More navigation tabs" }));

    expect(screen.getByRole("menuitemradio", { name: "工具 1" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "工具 0" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("folds and expands again when the container is resized", () => {
    layout = { availableWidth: 900, tabWidths: Array.from({ length: 8 }, () => 120) };
    render(<NavigationCardTabs tabs={makeTabs(8)} value="tool-0" onChange={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(5);

    updateLayout({ availableWidth: 180, tabWidths: Array.from({ length: 8 }, () => 120) });
    expect(screen.getAllByRole("tab")).toHaveLength(1);

    updateLayout({ availableWidth: 900, tabWidths: Array.from({ length: 8 }, () => 120) });
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });

  it("updates the fold window when tabs are added or removed", () => {
    layout = { availableWidth: 500, tabWidths: Array.from({ length: 8 }, () => 100) };
    const fourTabs = makeTabs(4);
    const eightTabs = makeTabs(8);
    const { rerender } = render(
      <NavigationCardTabs tabs={fourTabs} value="tool-0" onChange={() => {}} />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "More navigation tabs" })).not.toBeInTheDocument();

    rerender(<NavigationCardTabs tabs={eightTabs} value="tool-0" onChange={() => {}} />);

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "More navigation tabs" })).toBeInTheDocument();

    rerender(<NavigationCardTabs tabs={fourTabs} value="tool-0" onChange={() => {}} />);

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "More navigation tabs" })).not.toBeInTheDocument();
  });

  it("keeps the selected tab visible and follows external value changes", () => {
    const manyTabs = makeTabs(8);
    layout = { availableWidth: 500, tabWidths: Array.from({ length: 8 }, () => 120) };
    const { rerender } = render(
      <NavigationCardTabs tabs={manyTabs} value="tool-6" onChange={() => {}} />,
    );

    expect(screen.getByRole("tab", { name: "工具 6" })).toHaveAttribute("aria-selected", "true");

    rerender(<NavigationCardTabs tabs={manyTabs} value="tool-7" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "工具 7" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "工具 7" })).toBeInTheDocument();
  });

  it("switches from a folded tab selected through the dropdown", async () => {
    const manyTabs = makeTabs(8);
    layout = { availableWidth: 500, tabWidths: Array.from({ length: 8 }, () => 120) };
    render(<ControlledTabs items={manyTabs} initialValue="tool-6" />);

    expect(screen.getByRole("tab", { name: "工具 6" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: "More navigation tabs" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "工具 0" }));

    expect(screen.getByRole("tab", { name: "工具 0" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "More navigation tabs" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "工具 7" }));

    expect(screen.getByRole("tab", { name: "工具 7" })).toHaveAttribute("aria-selected", "true");
  });

  it("supports keyboard open and Escape close on the overflow trigger", async () => {
    layout = { availableWidth: 200, tabWidths: Array.from({ length: 8 }, () => 100) };
    render(<NavigationCardTabs tabs={makeTabs(8)} value="tool-0" onChange={() => {}} />);

    const trigger = screen.getByRole("button", { name: "More navigation tabs" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "工具 1" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
