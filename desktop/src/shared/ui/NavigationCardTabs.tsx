import React, { useLayoutEffect, useRef, useState } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import { Check, Ellipsis } from "lucide-react";

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

const TAB_GAP = 4;
const OVERFLOW_TRIGGER_WIDTH = 32;
const MIN_VISIBLE_TAB_WIDTH = 72;
// Container thresholds, not viewport breakpoints: nested layouts and side
// actions reduce the space actually available to the tab strip.
const WIDE_CONTAINER_MIN_WIDTH = 640;
const MEDIUM_CONTAINER_MIN_WIDTH = 400;
const COMPACT_CONTAINER_MIN_WIDTH = 240;
const WIDE_VISIBLE_LIMIT = 5;
const MEDIUM_VISIBLE_LIMIT = 4;
const COMPACT_VISIBLE_LIMIT = 3;
const NARROW_VISIBLE_LIMIT = 2;

export interface NavigationCardTabsWindow {
  start: number;
  end: number;
  hasOverflow: boolean;
}

interface ResolveNavigationCardTabsWindowOptions {
  availableWidth: number;
  tabWidths: number[];
  selectedIndex: number;
  overflowTriggerWidth?: number;
  gap?: number;
  minVisibleTabWidth?: number;
}

function resolveVisibleLimit(availableWidth: number): number {
  if (availableWidth >= WIDE_CONTAINER_MIN_WIDTH) return WIDE_VISIBLE_LIMIT;
  if (availableWidth >= MEDIUM_CONTAINER_MIN_WIDTH) return MEDIUM_VISIBLE_LIMIT;
  if (availableWidth >= COMPACT_CONTAINER_MIN_WIDTH) return COMPACT_VISIBLE_LIMIT;
  return NARROW_VISIBLE_LIMIT;
}

function sumTabWidths(tabWidths: number[], start: number, end: number): number {
  let total = 0;
  for (let index = start; index < end; index += 1) {
    total += tabWidths[index] ?? 0;
  }
  return total;
}

function resolveWindowWidth(
  tabWidths: number[],
  start: number,
  count: number,
  gap: number,
): number {
  if (count <= 0) return 0;
  return sumTabWidths(tabWidths, start, start + count) + gap * (count - 1);
}

/**
 * Resolves which contiguous slice of tabs stays visible for the measured
 * container width. The limits are display ceilings: the fit calculation can
 * always collapse further, down to the overflow trigger alone.
 */
export function resolveNavigationCardTabsWindow({
  availableWidth,
  tabWidths,
  selectedIndex,
  overflowTriggerWidth = OVERFLOW_TRIGGER_WIDTH,
  gap = TAB_GAP,
  minVisibleTabWidth = MIN_VISIBLE_TAB_WIDTH,
}: ResolveNavigationCardTabsWindowOptions): NavigationCardTabsWindow {
  const count = tabWidths.length;
  if (count === 0) {
    return { start: 0, end: 0, hasOverflow: false };
  }

  const safeSelectedIndex = Math.min(Math.max(selectedIndex, 0), count - 1);
  const visibleLimit = resolveVisibleLimit(availableWidth);
  const cappedVisibleCount = Math.min(visibleLimit, count);
  const hasMeasuredLayout =
    Number.isFinite(availableWidth) &&
    availableWidth > 0 &&
    tabWidths.every((width) => Number.isFinite(width) && width > 0);

  if (!hasMeasuredLayout) {
    // Without layout measurements (SSR, hidden containers, jsdom) preserve the
    // original behavior and render the whole strip instead of guessing a fold.
    return { start: 0, end: count, hasOverflow: false };
  }

  if (
    count <= cappedVisibleCount &&
    resolveWindowWidth(tabWidths, 0, count, gap) <= availableWidth
  ) {
    return { start: 0, end: count, hasOverflow: false };
  }

  if (count === 1) {
    return { start: 0, end: 1, hasOverflow: false };
  }

  for (let visibleCount = Math.min(cappedVisibleCount, count - 1); visibleCount >= 1; visibleCount -= 1) {
    const start =
      safeSelectedIndex < visibleCount
        ? 0
        : Math.min(safeSelectedIndex - visibleCount + 1, count - visibleCount);
    const windowWidth =
      resolveWindowWidth(tabWidths, start, visibleCount, gap) + gap + overflowTriggerWidth;

    if (windowWidth <= availableWidth) {
      return { start, end: start + visibleCount, hasOverflow: true };
    }
  }

  // Below this point the measured widths cannot fit even one full tab plus the
  // menu. Keep one tab (the selected one) and let flex shrink + truncation
  // absorb the difference; below the minimum control width, show only the menu.
  if (availableWidth >= overflowTriggerWidth + gap + minVisibleTabWidth) {
    return { start: safeSelectedIndex, end: safeSelectedIndex + 1, hasOverflow: true };
  }

  return { start: 0, end: 0, hasOverflow: true };
}

function areNumberArraysEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function getTabSurfaceClassName(): string {
  return "group relative -mb-px flex items-center gap-2 rounded-t-ui-panel border px-3.5 py-2.5 text-sm text-text-secondary transition-all outline-none";
}

function getTabStateClassName(
  activeTabStyle: NavigationCardTabsProps<string>["activeTabStyle"],
): string {
  return [
    "border-transparent bg-transparent hover:border-border/70 hover:bg-surface-secondary hover:text-text-primary",
    "focus-visible:z-20 focus-visible:border-primary/30 focus-visible:bg-surface-primary focus-visible:text-text-primary focus-visible:ring-2 focus-visible:ring-primary/20",
    "data-[state=active]:z-10 data-[state=active]:border-border data-[state=active]:border-b-transparent data-[state=active]:text-text-primary",
    activeTabStyle === "plain"
      ? "data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:z-20 data-[state=active]:after:h-0.5 data-[state=active]:after:content-[''] data-[state=active]:after:bg-surface-primary"
      : "data-[state=active]:bg-surface-primary data-[state=active]:shadow-shadow-sm",
  ].join(" ");
}

function NavigationCardTabContent({
  tab,
}: {
  tab: NavigationCardTab<string>;
}) {
  return (
    <>
      {tab.icon ? (
        <span
          aria-hidden="true"
          className={[
            "flex h-4 w-4 shrink-0 items-center justify-center text-icon-secondary transition-colors",
            "group-data-[state=active]:text-primary group-focus-visible:text-primary",
          ].join(" ")}
        >
          {tab.icon}
        </span>
      ) : null}
      <span className="min-w-0 max-w-[14rem] truncate font-medium">{tab.label}</span>
    </>
  );
}

export default function NavigationCardTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
  activeTabStyle = "default",
}: NavigationCardTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const measureKey = tabs.map((tab) => tab.value).join("\u0000");
  const [measurement, setMeasurement] = useState<{
    availableWidth: number;
    tabWidths: number[];
  }>({ availableWidth: 0, tabWidths: [] });

  useLayoutEffect(() => {
    const list = listRef.current;
    const measure = measureRef.current;
    if (!list || !measure) return;

    const readLayout = () => {
      const availableWidth = list.getBoundingClientRect().width;
      const tabWidths = Array.from(measure.children).map(
        (child) => child.getBoundingClientRect().width,
      );

      setMeasurement((current) => {
        if (
          current.availableWidth === availableWidth &&
          areNumberArraysEqual(current.tabWidths, tabWidths)
        ) {
          return current;
        }
        return { availableWidth, tabWidths };
      });
    };

    readLayout();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(readLayout);
    observer.observe(list);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [measureKey]);

  const selectedIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );
  const measuredTabWidths = tabs.map((_, index) => measurement.tabWidths[index] ?? 0);
  const tabWindow = resolveNavigationCardTabsWindow({
    availableWidth: measurement.availableWidth,
    tabWidths: measuredTabWidths,
    selectedIndex,
  });

  const visibleTabs = tabs.slice(tabWindow.start, tabWindow.end);
  const hiddenTabs = tabs.filter(
    (_, index) => index < tabWindow.start || index >= tabWindow.end,
  );
  const tabSurfaceClassName = getTabSurfaceClassName();
  const tabStateClassName = getTabStateClassName(activeTabStyle);

  return (
    <Tabs.Root value={value} onValueChange={(nextValue) => onChange(nextValue as T)}>
      <Tabs.List
        ref={listRef}
        aria-label="Navigation tabs"
        className={[
          className,
          "relative flex items-end gap-1 overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:border-b after:border-border/80",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {visibleTabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            aria-label={typeof tab.label === "string" ? tab.label : undefined}
            className={[
              tabSurfaceClassName,
              tabStateClassName,
              "min-w-0 shrink",
            ].join(" ")}
          >
            <NavigationCardTabContent tab={tab} />
          </Tabs.Trigger>
        ))}

        {hiddenTabs.length > 0 ? (
          <DropdownMenuPrimitive.Root modal={false}>
            <DropdownMenuPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label="More navigation tabs"
                title="More navigation tabs"
                className={[
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-ui-control border-0 bg-transparent text-icon-secondary outline-none transition-colors",
                  "hover:bg-surface-secondary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary/20",
                  "data-[state=open]:bg-surface-secondary data-[state=open]:text-text-primary",
                ].join(" ")}
              >
                <Ellipsis className="h-4 w-4 rotate-90" aria-hidden="true" />
              </button>
            </DropdownMenuPrimitive.Trigger>

            <DropdownMenuPrimitive.Portal>
              <DropdownMenuPrimitive.Content
                align="end"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                className="z-[260] min-w-[12rem] max-w-[18rem] overflow-hidden rounded-ui-overlay border border-border bg-surface-elevated p-1 shadow-shadow-lg"
              >
                <DropdownMenuPrimitive.RadioGroup
                  value={value}
                  onValueChange={(nextValue) => onChange(nextValue as T)}
                >
                  {hiddenTabs.map((tab) => (
                    <DropdownMenuPrimitive.RadioItem
                      key={tab.value}
                      value={tab.value}
                      aria-label={typeof tab.label === "string" ? tab.label : undefined}
                      className={[
                        "group relative flex w-full cursor-default items-center justify-between gap-3 rounded-ui-control px-2.5 py-2 text-left text-sm text-text-primary outline-none transition-colors",
                        "data-[highlighted]:bg-surface-secondary data-[state=checked]:bg-surface-secondary",
                      ].join(" ")}
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        {tab.icon ? (
                          <span className="shrink-0 text-icon-secondary">{tab.icon}</span>
                        ) : null}
                        <span className="truncate">{tab.label}</span>
                      </span>
                      <DropdownMenuPrimitive.ItemIndicator>
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      </DropdownMenuPrimitive.ItemIndicator>
                    </DropdownMenuPrimitive.RadioItem>
                  ))}
                </DropdownMenuPrimitive.RadioGroup>
              </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
          </DropdownMenuPrimitive.Root>
        ) : null}

        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0 flex w-max gap-1"
        >
          {tabs.map((tab, index) => (
            <span
              key={tab.value}
              data-navigation-card-tabs-measure-item={index}
              className={[tabSurfaceClassName, tabStateClassName, "shrink-0"].join(" ")}
            >
              <NavigationCardTabContent tab={tab as NavigationCardTab<string>} />
            </span>
          ))}
        </div>
      </Tabs.List>
    </Tabs.Root>
  );
}
