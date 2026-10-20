// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
});

const OVERFLOW_WIDTH = 32;
const TAB_WIDTH = 100;

const manyTabs = Array.from({ length: 6 }, (_, index) => ({
  value: `tab-${index + 1}`,
  label: `Tab ${index + 1}`,
  icon: <span aria-hidden="true">{index + 1}</span>,
}));

const observers: Array<{
  callback: ResizeObserverCallback;
  disconnected: boolean;
}> = [];

class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push({ callback, disconnected: false });
  }

  observe() {}

  unobserve() {}

  disconnect() {
    const observer = observers.find((entry) => entry.callback === this.callback);
    if (observer) {
      observer.disconnected = true;
    }
  }
}

function rect(width: number): DOMRect {
  return {
    width,
    height: 40,
    top: 0,
    left: 0,
    right: width,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("NavigationCardTabs responsive overflow", () => {
  let containerWidth = 960;

  beforeEach(() => {
    observers.length = 0;
    containerWidth = 960;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.getAttribute("role") === "tablist") {
          return rect(containerWidth);
        }
        if (this.getAttribute("aria-label") === "More tabs") {
          return rect(OVERFLOW_WIDTH);
        }
        if (this.getAttribute("role") === "tab") {
          return rect(TAB_WIDTH);
        }
        return rect(0);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function resizeTo(width: number) {
    containerWidth = width;
    act(() => {
      observers.forEach(({ callback, disconnected }) => {
        if (!disconnected) {
          callback([], {} as ResizeObserver);
        }
      });
    });
  }

  it("caps the wide layout at five visible tabs and collapses the rest", async () => {
    render(<NavigationCardTabs tabs={manyTabs} value="tab-1" onChange={() => {}} />);

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.queryByRole("tab", { name: "Tab 6" })).not.toBeInTheDocument();

    const overflowTrigger = screen.getByRole("button", { name: "More tabs" });
    expect(overflowTrigger).not.toHaveClass("border", "bg-surface-primary");

    await userEvent.click(overflowTrigger);

    expect(screen.getByRole("menuitem", { name: "Tab 6" })).toBeInTheDocument();
  });

  it("caps the medium layout at four tabs and further collapses on narrow containers", () => {
    containerWidth = 480;
    render(<NavigationCardTabs tabs={manyTabs} value="tab-1" onChange={() => {}} />);

    expect(screen.getAllByRole("tab")).toHaveLength(4);

    resizeTo(300);
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    resizeTo(960);
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });

  it("does not render the overflow control when every tab fits", () => {
    containerWidth = 480;
    render(<NavigationCardTabs tabs={manyTabs.slice(0, 3)} value="tab-1" onChange={() => {}} />);

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "More tabs" })).not.toBeInTheDocument();
  });

  it("switches to a collapsed tab through the overflow menu", async () => {
    containerWidth = 480;
    const handleChange = vi.fn();
    render(<NavigationCardTabs tabs={manyTabs} value="tab-1" onChange={handleChange} />);

    await userEvent.click(screen.getByRole("button", { name: "More tabs" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Tab 5" })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Tab 6" }));

    expect(handleChange).toHaveBeenCalledWith("tab-6");
  });

  it("keeps an externally selected overflow tab visible", () => {
    containerWidth = 480;
    const { rerender } = render(
      <NavigationCardTabs tabs={manyTabs} value="tab-6" onChange={() => {}} />,
    );

    expect(screen.getByRole("tab", { name: "Tab 6" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);

    rerender(<NavigationCardTabs tabs={manyTabs} value="tab-1" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Tab 1" })).toBeInTheDocument();
  });

  it("measures newly added tabs and collapses removed tabs", () => {
    const { rerender } = render(
      <NavigationCardTabs tabs={manyTabs} value="tab-1" onChange={() => {}} />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(5);

    const sevenTabs = [
      ...manyTabs,
      { value: "tab-7", label: "Tab 7", icon: <span aria-hidden="true">7</span> },
    ];
    rerender(<NavigationCardTabs tabs={sevenTabs} value="tab-1" onChange={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(5);

    rerender(
      <NavigationCardTabs tabs={manyTabs.slice(0, 4)} value="tab-1" onChange={() => {}} />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "More tabs" })).not.toBeInTheDocument();
  });

  it("opens and closes the overflow menu from the keyboard", async () => {
    containerWidth = 480;
    render(<NavigationCardTabs tabs={manyTabs} value="tab-1" onChange={() => {}} />);

    const trigger = screen.getByRole("button", { name: "More tabs" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");

    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });
});

describe("resolveNavigationCardTabsWindow", () => {
  it("keeps the selected tab visible when it falls outside the first fit window", () => {
    const result = resolveNavigationCardTabsWindow({
      tabWidths: [100, 100, 100, 100, 100, 100],
      containerWidth: 480,
      overflowTriggerWidth: OVERFLOW_WIDTH,
      selectedIndex: 5,
    });

    expect(result.start + result.count).toBe(6);
    expect(result.count).toBe(4);
    expect(result.hasOverflow).toBe(true);
  });

  it("stops fitting when a long label would cross the available width", () => {
    const result = resolveNavigationCardTabsWindow({
      tabWidths: [80, 200, 80, 200, 80, 80],
      containerWidth: 400,
      overflowTriggerWidth: OVERFLOW_WIDTH,
      selectedIndex: 0,
    });

    expect(result).toEqual({ start: 0, count: 2, hasOverflow: true });
  });
});
