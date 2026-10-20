import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Ellipsis } from "lucide-react";
import DropdownMenu from "./DropdownMenu";

export interface NavigationCardTab<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

interface NavigationCardTabsProps<T extends string> {
  tabs: NavigationCardTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  activeTabStyle?: "default" | "plain";
}

const TAB_GAP_PX = 4;
const WIDE_MAX_VISIBLE_TABS = 5;
const MEDIUM_MAX_VISIBLE_TABS = 4;
// Container width, not the global viewport, decides the wide display cap.
// Nested pages and right-side actions also consume horizontal space.
const WIDE_CONTAINER_MIN_WIDTH = 720;
const OVERFLOW_MENU_LABEL = "More tabs";

export interface NavigationCardTabsWindow {
  start: number;
  count: number;
  hasOverflow: boolean;
}

export function getNavigationCardTabsMaxVisible(containerWidth: number) {
  return containerWidth >= WIDE_CONTAINER_MIN_WIDTH
    ? WIDE_MAX_VISIBLE_TABS
    : MEDIUM_MAX_VISIBLE_TABS;
}

export function resolveNavigationCardTabsWindow({
  tabWidths,
  containerWidth,
  overflowTriggerWidth,
  selectedIndex,
}: {
  tabWidths: number[];
  containerWidth: number;
  overflowTriggerWidth: number;
  selectedIndex: number;
}): NavigationCardTabsWindow {
  const total = tabWidths.length;
  if (total === 0) {
    return { start: 0, count: 0, hasOverflow: false };
  }

  const maxVisible = getNavigationCardTabsMaxVisible(containerWidth);
  const widthAt = (index: number) => Math.max(0, tabWidths[index] ?? 0);
  const sumWidths = (from: number, to: number) => {
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      sum += widthAt(index) + (index > from ? TAB_GAP_PX : 0);
    }
    return sum;
  };

  const activeIndex = selectedIndex >= 0 && selectedIndex < total ? selectedIndex : 0;

  let start = 0;
  if (activeIndex >= maxVisible) {
    start = Math.min(activeIndex - maxVisible + 1, Math.max(0, total - maxVisible));
  }
  const maxCount = Math.min(maxVisible, total - start);

  if (start === 0 && total <= maxVisible && sumWidths(0, total) <= containerWidth) {
    return { start: 0, count: total, hasOverflow: false };
  }

  const availableWidth = Math.max(
    0,
    containerWidth - Math.max(0, overflowTriggerWidth) - TAB_GAP_PX,
  );
  let count = 0;
  let usedWidth = 0;
  while (count < maxCount) {
    const nextWidth =
      usedWidth + (count > 0 ? TAB_GAP_PX : 0) + widthAt(start + count);
    if (nextWidth > availableWidth) {
      break;
    }
    usedWidth = nextWidth;
    count += 1;
  }

  if (count === 0) {
    // Not even one tab fits next to the overflow control. Keep the active tab
    // reachable instead of rendering an empty rail.
    const focusIndex =
      activeIndex >= start && activeIndex < start + maxCount ? activeIndex : start;
    return { start: focusIndex, count: 1, hasOverflow: total > 1 };
  }

  const end = start + count;
  if (activeIndex < start || activeIndex >= end) {
    // Width pressure pushed the selected tab outside the first fit window, so
    // move the window to keep the active tab visible.
    return { start: activeIndex, count: 1, hasOverflow: total > 1 };
  }

  return {
    start,
    count,
    hasOverflow: start > 0 || end < total,
  };
}

function getTabLabelText(label: React.ReactNode): string {
  if (label === null || label === undefined || typeof label === "boolean") {
    return "";
  }
  if (typeof label === "string" || typeof label === "number") {
    return String(label);
  }
  if (Array.isArray(label)) {
    return label.map(getTabLabelText).join("");
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(label)) {
    return getTabLabelText(label.props.children);
  }
  return "";
}

function getTabMenuLabel<T extends string>(tab: NavigationCardTab<T>) {
  return getTabLabelText(tab.label).replace(/\s+/g, " ").trim() || tab.value;
}

export default function NavigationCardTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
  activeTabStyle = "default",
}: NavigationCardTabsProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const overflowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const widthCacheRef = useRef(new Map<string, number>());
  const [tabWindow, setTabWindow] = useState<NavigationCardTabsWindow | null>(null);
  const [measureAll, setMeasureAll] = useState(true);
  const [resizeTick, setResizeTick] = useState(0);

  const tabsKey = tabs.map((tab) => tab.value).join("\u0000");
  const showAllTabs = measureAll || tabWindow === null;
  const visibleTabs = showAllTabs
    ? tabs
    : tabs.slice(tabWindow.start, tabWindow.start + tabWindow.count);
  const visibleKey = visibleTabs.map((tab) => tab.value).join("\u0000");
  const visibleValues = new Set(visibleTabs.map((tab) => tab.value));
  const overflowTabs = tabs.filter((tab) => !visibleValues.has(tab.value));
  const hasOverflow = !showAllTabs && tabWindow.hasOverflow && overflowTabs.length > 0;

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      setResizeTick((tick) => tick + 1);
    });
    observer.observe(list);
    triggerRefs.current.forEach((node) => {
      if (node) {
        observer.observe(node);
      }
    });
    if (overflowTriggerRef.current) {
      observer.observe(overflowTriggerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [tabsKey, visibleKey]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const containerWidth = list.getBoundingClientRect().width;
    if (containerWidth <= 0) {
      // Layout is not measurable yet (for example in jsdom). Keep the legacy
      // single-row rail instead of collapsing every tab into the menu.
      setMeasureAll(false);
      setTabWindow((previous) =>
        previous && previous.start === 0 && previous.count === tabs.length
          ? previous
          : { start: 0, count: tabs.length, hasOverflow: false },
      );
      return;
    }

    const widths = tabs.map((tab) => {
      const node = triggerRefs.current.get(tab.value);
      const measured = node?.getBoundingClientRect().width ?? 0;
      if (measured > 0) {
        widthCacheRef.current.set(tab.value, measured);
      }
      return measured > 0 ? measured : widthCacheRef.current.get(tab.value) ?? 0;
    });

    if (!measureAll && widths.some((width) => width <= 0)) {
      // New tabs (or tabs that became visible again) need a real layout pass
      // before their widths can participate in the fit calculation.
      setMeasureAll(true);
      return;
    }

    const selectedIndex = tabs.findIndex((tab) => tab.value === value);
    const overflowTriggerWidth =
      overflowTriggerRef.current?.getBoundingClientRect().width ?? 0;
    const nextWindow = resolveNavigationCardTabsWindow({
      tabWidths: widths,
      containerWidth,
      overflowTriggerWidth,
      selectedIndex,
    });

    setMeasureAll(false);
    setTabWindow((previous) =>
      previous &&
      previous.start === nextWindow.start &&
      previous.count === nextWindow.count &&
      previous.hasOverflow === nextWindow.hasOverflow
        ? previous
        : nextWindow,
    );
  }, [tabs, value, measureAll, resizeTick]);

  return (
    <Tabs.Root value={value} onValueChange={(nextValue) => onChange(nextValue as T)}>
      <Tabs.List
        ref={listRef}
        aria-label="Navigation tabs"
        className={[
          className,
          "relative flex min-w-0 items-end gap-1 overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:border-b after:border-border/80",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {visibleTabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            ref={(node) => {
              if (node) {
                triggerRefs.current.set(tab.value, node);
              } else {
                triggerRefs.current.delete(tab.value);
              }
            }}
            value={tab.value}
            aria-label={typeof tab.label === "string" ? tab.label : undefined}
            className={[
              "group relative -mb-px flex shrink-0 items-center gap-2 rounded-t-ui-panel border px-3.5 py-2.5 text-sm text-text-secondary transition-all outline-none",
              "border-transparent bg-transparent hover:border-border/70 hover:bg-surface-secondary hover:text-text-primary",
              "focus-visible:z-20 focus-visible:border-primary/30 focus-visible:bg-surface-primary focus-visible:text-text-primary focus-visible:ring-2 focus-visible:ring-primary/20",
              "data-[state=active]:z-10 data-[state=active]:border-border data-[state=active]:border-b-transparent data-[state=active]:text-text-primary",
              activeTabStyle === "plain"
                ? "data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:z-20 data-[state=active]:after:h-0.5 data-[state=active]:after:content-[''] data-[state=active]:after:bg-surface-primary"
                : "data-[state=active]:bg-surface-primary data-[state=active]:shadow-shadow-sm",
            ].join(" ")}
          >
            {tab.icon ? (
              <span
                aria-hidden="true"
                className={[
                  "flex h-4 w-4 items-center justify-center text-icon-secondary transition-colors",
                  "group-data-[state=active]:text-primary group-focus-visible:text-primary",
                ].join(" ")}
              >
                {tab.icon}
              </span>
            ) : null}
            <span className="max-w-[14rem] truncate font-medium">{tab.label}</span>
          </Tabs.Trigger>
        ))}

        <DropdownMenu
          align="end"
          items={overflowTabs.map((tab) => ({
            id: tab.value,
            label: getTabMenuLabel(tab),
            leadingIcon: tab.icon,
            checked: tab.value === value,
          }))}
          onSelect={(item) => {
            if (hasOverflow) {
              onChange(item.id as T);
            }
          }}
          trigger={
            <button
              ref={overflowTriggerRef}
              type="button"
              aria-label={OVERFLOW_MENU_LABEL}
              title={OVERFLOW_MENU_LABEL}
              aria-hidden={hasOverflow ? undefined : true}
              disabled={!hasOverflow}
              className={[
                "relative z-10 -mb-px flex h-9 w-8 shrink-0 items-center justify-center rounded-ui-control text-icon-secondary outline-none transition-colors",
                "hover:bg-surface-secondary hover:text-text-primary focus-visible:text-text-primary focus-visible:ring-2 focus-visible:ring-primary/20",
                hasOverflow ? "" : "pointer-events-none invisible absolute right-0 top-0",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Ellipsis className="h-4 w-4 rotate-90" aria-hidden="true" />
            </button>
          }
        />
      </Tabs.List>
    </Tabs.Root>
  );
}
