import {
  Blocks,
  BookOpenText,
  CircleHelp,
  FilePenLine,
  Globe2,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import Badge from "@/shared/ui/Badge";
import Tooltip from "@/shared/ui/Tooltip";
import { UChatOverflowTooltip } from "@/shared/uchat/ui/UChatOverflowTooltip";
import type { CapabilityTool } from "../types";

export type CapabilityGroupKind = "native" | "extension";
export type CapabilityGroupFilter = "all" | CapabilityGroupKind;

export type CapabilityGroup = {
  id: string;
  label: string;
  description: string;
  icon: string;
  kind: CapabilityGroupKind;
  order: number;
  tools: CapabilityTool[];
};

const groupIcons: Record<string, LucideIcon> = {
  "file-search": BookOpenText,
  read: BookOpenText,
  pencil: FilePenLine,
  edit: FilePenLine,
  mutation: FilePenLine,
  globe: Globe2,
  web_search: Globe2,
  terminal: SquareTerminal,
  external_mcp: Blocks,
};

const fallbackNativeGroups: Record<
  string,
  Pick<CapabilityGroup, "id" | "label" | "description" | "icon" | "order">
> = {
  read: {
    id: "read",
    label: "Read",
    description: "Read and inspect workspace content.",
    icon: "file-search",
    order: 10,
  },
  edit: {
    id: "mutation",
    label: "Mutation",
    description: "Create and modify workspace content.",
    icon: "pencil",
    order: 20,
  },
  terminal: {
    id: "terminal",
    label: "Terminal",
    description: "Run governed terminal operations.",
    icon: "terminal",
    order: 30,
  },
  web_search: {
    id: "web",
    label: "Web",
    description: "Search and fetch web content.",
    icon: "globe",
    order: 40,
  },
};

const nativeGroupTranslationKeys: Record<string, string> = {
  read: "read",
  mutation: "mutation",
  edit: "mutation",
  terminal: "terminal",
  web: "webSearch",
  web_search: "webSearch",
};

type CapabilityGroupTranslator = (key: string) => string;

const getNativeGroup = (
  tool: CapabilityTool,
  translate?: CapabilityGroupTranslator,
) => {
  const group = tool.workbench
    ? {
        id: tool.workbench.groupId,
        label: tool.workbench.groupLabel,
        description: tool.workbench.groupDescription,
        icon: tool.workbench.icon,
        order: tool.workbench.groupOrder,
      }
    : fallbackNativeGroups[tool.domain] ?? {
        id: tool.domain || "other",
        label: tool.domain || "Other",
        description: tool.description,
        icon: tool.domain || "wrench",
        order: Number.MAX_SAFE_INTEGER,
      };

  const translationKey = nativeGroupTranslationKeys[group.id];
  if (!translate || !translationKey) return group;

  return {
    ...group,
    label: translate(`settings.development.capabilities.groups.${translationKey}.label`),
    description: translate(
      `settings.development.capabilities.groups.${translationKey}.description`,
    ),
  };
};

export function buildCapabilityGroups(
  tools: CapabilityTool[],
  translate?: CapabilityGroupTranslator,
): CapabilityGroup[] {
  const groups = new Map<string, CapabilityGroup>();

  tools.forEach((tool) => {
    if (tool.source === "external") {
      const sourceId =
        tool.externalServerId ?? tool.sourceLabel ?? tool.sourceInfo.label;
      const id = `extension:${sourceId}`;
      const existing = groups.get(id);

      if (existing) {
        existing.tools.push(tool);
        return;
      }

      groups.set(id, {
        id,
        label: tool.sourceLabel ?? tool.sourceInfo.label.replace(/^External MCP · /u, ""),
        description: tool.sourceInfo.label,
        icon: "external_mcp",
        kind: "extension",
        order: Number.MAX_SAFE_INTEGER,
        tools: [tool],
      });
      return;
    }

    const native = getNativeGroup(tool, translate);
    const id = `native:${native.id}`;
    const existing = groups.get(id);

    if (existing) {
      existing.tools.push(tool);
      return;
    }

    groups.set(id, {
      ...native,
      id,
      kind: "native",
      tools: [tool],
    });
  });

  return [...groups.values()].sort((left, right) => {
    if (left.kind === right.kind) {
      return left.order - right.order || left.label.localeCompare(right.label);
    }
    return left.kind === "native" ? -1 : 1;
  });
}

export function filterCapabilityGroups(
  groups: CapabilityGroup[],
  filter: CapabilityGroupFilter,
) {
  return filter === "all"
    ? groups
    : groups.filter((group) => group.kind === filter);
}

type CapabilitiesSidebarProps = {
  groups: CapabilityGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  emptyLabel: string;
};

export default function CapabilitiesSidebar({
  groups,
  selectedGroupId,
  onSelectGroup,
  emptyLabel,
}: CapabilitiesSidebarProps) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("settings.development.capabilities.labels.toolGroups")}
      className="stable-scrollbar flex min-h-0 flex-col overflow-y-auto border-r border-border pr-3"
    >
      {groups.length > 0 ? (
        <ul className="divide-y divide-border pb-2">
          {groups.map((group) => {
            const Icon = groupIcons[group.icon] ?? Wrench;
            const isActive = group.id === selectedGroupId;

            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => onSelectGroup(group.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 ${
                    isActive
                      ? "border-l-primary bg-surface-soft"
                      : "border-l-transparent hover:bg-surface-secondary"
                  }`}
                >
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-ui-control ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "bg-surface-secondary text-icon-secondary"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <UChatOverflowTooltip text={group.label} placement="right">
                      <div className="min-w-0 truncate text-sm font-medium text-text-primary">
                        {group.label}
                      </div>
                    </UChatOverflowTooltip>
                    <Tooltip text={group.description} placement="right">
                      <span className="inline-flex shrink-0 items-center text-text-tertiary">
                        <CircleHelp className="h-3.5 w-3.5" />
                      </span>
                    </Tooltip>
                  </div>
                  {group.kind === "extension" ? (
                    <Badge variant="primary" className="justify-self-end">
                      {t("settings.development.capabilities.catalogKind.extension")}
                    </Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-3 py-8 text-center text-sm text-text-secondary">
          {emptyLabel}
        </div>
      )}
    </nav>
  );
}
