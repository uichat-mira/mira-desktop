"use client";

import { useEffect, useMemo, useState } from "react";
import { Box } from "lucide-react";
import { Mention, MentionsInput } from "@impelsys/react-mentions";
import {
  getWenshuSkillCatalog,
  type WenshuSkillPackageDefinition,
} from "@/shared/api/officeSuiteSkills";
import { getMcpTools, type HarnessToolDefinition } from "@/shared/api/tools";

const explicitSkillDraftPattern = /(^|\s)\$([a-z0-9_-]*)$/i;
const appliedSkillPattern = /@\(([a-z0-9_-]+)\)/gi;
const appliedToolkitPattern = /~\(([a-z0-9_-]+)\)/gi;
const appliedSkillMarkup = "@(__id__)";
const appliedSkillRegex = /@\(([a-z0-9_-]+)\)/;
const appliedToolkitMarkup = "~(__id__)";
const appliedToolkitRegex = /~\(([a-z0-9_-]+)\)/;
const explicitToolkitDraftPattern = /(^|\s)@([^\s]*)$/u;
const composerEditorMaxHeight = "min(240px, 35vh)";

type AgentSkillSuggestion = Pick<
  WenshuSkillPackageDefinition,
  "id" | "name" | "description"
>;

let cachedAgentSkills: AgentSkillSuggestion[] | null = null;
let agentSkillsRequest: Promise<AgentSkillSuggestion[]> | null = null;
type AgentToolkitSuggestion = Pick<
  NonNullable<HarnessToolDefinition["workbench"]>,
  "groupId" | "groupLabel" | "groupDescription" | "icon"
>;
let cachedAgentToolkits: AgentToolkitSuggestion[] | null = null;
let agentToolkitsRequest: Promise<AgentToolkitSuggestion[]> | null = null;

const loadAgentSkills = () => {
  if (cachedAgentSkills) return Promise.resolve(cachedAgentSkills);
  if (!agentSkillsRequest) {
    agentSkillsRequest = getWenshuSkillCatalog()
      .then((catalog) => {
        cachedAgentSkills = catalog.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
        }));
        return cachedAgentSkills;
      })
      .catch((error) => {
        agentSkillsRequest = null;
        throw error;
      });
  }
  return agentSkillsRequest;
};

const loadAgentToolkits = () => {
  if (cachedAgentToolkits) return Promise.resolve(cachedAgentToolkits);
  if (!agentToolkitsRequest) {
    agentToolkitsRequest = getMcpTools()
      .then((tools) => {
        const groups = new Map<string, AgentToolkitSuggestion>();
        tools.forEach((tool) => {
          const workbench = tool.workbench;
          if (workbench && !groups.has(workbench.groupId)) {
            groups.set(workbench.groupId, {
              groupId: workbench.groupId,
              groupLabel: workbench.groupLabel,
              groupDescription: workbench.groupDescription,
              icon: workbench.icon,
            });
          }
        });
        cachedAgentToolkits = [...groups.values()].sort((left, right) =>
          left.groupLabel.localeCompare(right.groupLabel),
        );
        return cachedAgentToolkits;
      })
      .catch((error) => {
        agentToolkitsRequest = null;
        throw error;
      });
  }
  return agentToolkitsRequest;
};

function useSuggestionKeyboard<T>({
  open,
  items,
  query,
  onSelect,
}: {
  open: boolean;
  items: T[];
  query: string | null;
  onSelect: (item: T) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, items.length]);

  useEffect(() => {
    if (!open || items.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.target instanceof HTMLTextAreaElement) ||
        event.isComposing ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter" && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        const selected = items[activeIndex];
        if (selected) onSelect(selected);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, items, onSelect, open]);

  return { activeIndex, setActiveIndex };
}

export const getAgentSkillDraftQuery = (text: string) =>
  explicitSkillDraftPattern.exec(text)?.[2]?.toLowerCase() ?? null;

export const insertExplicitSkill = (text: string, skillId: string) =>
  text.replace(
    explicitSkillDraftPattern,
    (_match, prefix: string) => `${prefix}@(${skillId}) `,
  );

export const resolveExplicitSkillsForSubmission = (text: string) => {
  const resolvedSkills = text.replace(
    appliedSkillPattern,
    (_match, skillId: string) => `$${skillId}`,
  );
  if (!appliedToolkitPattern.test(resolvedSkills)) return resolvedSkills;
  appliedToolkitPattern.lastIndex = 0;
  return resolvedSkills
    .replace(appliedToolkitPattern, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

export const getExplicitToolkitIds = (text: string) =>
  [...text.matchAll(appliedToolkitPattern)].map((match) => match[1]).filter(Boolean);

export const insertExplicitToolkit = (text: string, groupId: string) =>
  text.replace(
    explicitToolkitDraftPattern,
    (_match, prefix: string) => `${prefix}${appliedToolkitMarkup.replace("__id__", groupId)} `,
  );

function useAgentSkills(active: boolean) {
  const [skills, setSkills] = useState<AgentSkillSuggestion[]>([]);

  useEffect(() => {
    if (!active || skills.length > 0) return;

    let disposed = false;
    void loadAgentSkills()
      .then((loadedSkills) => {
        if (!disposed) setSkills(loadedSkills);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [active, skills.length]);

  return skills;
}

export function AgentSkillComposerEditor({
  text,
  placeholder,
  disabled,
  onChange,
  onSubmit,
  onPasteFiles,
}: {
  text: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPasteFiles: (files: File[]) => void | Promise<void>;
}) {
  const skills = useAgentSkills(true);
  const [toolkits, setToolkits] = useState<AgentToolkitSuggestion[]>([]);
  useEffect(() => {
    let disposed = false;
    void loadAgentToolkits()
      .then((loaded) => {
        if (!disposed) setToolkits(loaded);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);
  const skillNames = useMemo(
    () => new Map(skills.map((skill) => [skill.id, skill.name])),
    [skills],
  );
  const toolkitNames = useMemo(
    () => new Map(toolkits.map((toolkit) => [toolkit.groupId, toolkit.groupLabel])),
    [toolkits],
  );

  return (
    <div
      className="relative min-h-16 overflow-hidden"
      style={{ maxHeight: composerEditorMaxHeight }}
    >
      {!text ? (
        <span className="pointer-events-none absolute left-4 top-2.5 z-10 text-[15px] leading-6 text-cloudy-6">
          {placeholder}
        </span>
      ) : null}
      <MentionsInput
        value={text}
        disabled={disabled}
        aria-label={placeholder}
        onChange={(_event, value) => onChange(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.ctrlKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter(
            (file) => file.type.startsWith("image/"),
          );
          if (files.length > 0) {
            event.preventDefault();
            void onPasteFiles(files);
          }
        }}
        style={{
          control: {
            minHeight: 64,
            maxHeight: composerEditorMaxHeight,
            fontSize: 15,
            lineHeight: "24px",
            color: "rgb(var(--color-text-primary))",
            overflow: "hidden",
          },
          highlighter: {
            minHeight: 64,
            maxHeight: composerEditorMaxHeight,
            padding: "10px 16px",
            border: 0,
            color: "rgb(var(--color-text-primary))",
            zIndex: 1,
            pointerEvents: "none",
            overflow: "hidden",
            substring: {
              visibility: "visible",
            },
          },
          input: {
            minHeight: 64,
            maxHeight: composerEditorMaxHeight,
            padding: "10px 16px",
            border: 0,
            outline: 0,
            color: "transparent",
            caretColor: "rgb(var(--color-text-primary))",
            overflowX: "hidden",
            overflowY: "auto",
            zIndex: 0,
          },
        }}
      >
        <Mention
          trigger="$"
          data={[]}
          markup={appliedSkillMarkup}
          regex={appliedSkillRegex}
          displayTransform={(id) => skillNames.get(id) ?? `$${id}`}
          style={{
            color: "rgb(168 83 55)",
            fontWeight: 600,
          }}
        />
        <Mention
          trigger="@"
          data={[]}
          markup={appliedToolkitMarkup}
          regex={appliedToolkitRegex}
          displayTransform={(id) => toolkitNames.get(id) ?? `@${id}`}
          style={{
            color: "rgb(63 112 145)",
            fontWeight: 600,
          }}
        />
      </MentionsInput>
    </div>
  );
}

export function AgentSkillComposerSuggestion({
  text,
  onSelect,
}: {
  text: string;
  onSelect: (skillId: string) => void;
}) {
  const [skills, setSkills] = useState<AgentSkillSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = getAgentSkillDraftQuery(text);

  useEffect(() => {
    if (query === null || loaded) return;

    let disposed = false;
    setError(null);
    void loadAgentSkills()
      .then((loadedSkills) => {
        if (!disposed) {
          setSkills(loadedSkills);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!disposed) {
          setError("技能列表暂时不可用");
          setLoaded(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, [loaded, query]);

  const matches = useMemo(() => {
    if (query === null) return [];
    return skills
      .filter((skill) => {
        const haystack = `${skill.id} ${skill.name} ${skill.description}`.toLowerCase();
        return haystack.includes(query);
      });
  }, [query, skills]);

  const { activeIndex, setActiveIndex } = useSuggestionKeyboard({
    open: query !== null && loaded && !error,
    items: matches,
    query,
    onSelect: (skill) => onSelect(skill.id),
  });

  if (query === null) return null;
  if (!loaded && !error) return null;

  return (
    <div
      role="listbox"
      aria-label="Agent skills"
      className="max-h-80 overflow-y-auto rounded-ui-control border border-border/70 bg-surface-primary py-1 shadow-sm"
    >
      {error ? <p className="px-3 py-2 text-xs text-text-tertiary">{error}</p> : null}
      {!error && matches.length === 0 ? (
        <p className="px-3 py-2 text-xs text-text-tertiary">没有匹配的技能</p>
      ) : null}
      {matches.map((skill, index) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-label={`使用技能 ${skill.name}`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => onSelect(skill.id)}
          aria-selected={index === activeIndex}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
            index === activeIndex ? "bg-surface-secondary" : "hover:bg-surface-secondary"
          }`}
        >
          <Box className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm text-text-primary">{skill.name}</span>
            <span className="truncate text-xs text-text-tertiary">
              {skill.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function AgentToolkitComposerSuggestion({
  text,
  onSelect,
}: {
  text: string;
  onSelect: (groupId: string) => void;
}) {
  const [toolkits, setToolkits] = useState<AgentToolkitSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = explicitToolkitDraftPattern.exec(text)?.[2]?.toLowerCase() ?? null;

  useEffect(() => {
    if (query === null || loaded) return;
    let disposed = false;
    void loadAgentToolkits()
      .then((loadedToolkits) => {
        if (!disposed) {
          setToolkits(loadedToolkits);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!disposed) {
          setError("工具包列表暂时不可用");
          setLoaded(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [loaded, query]);

  const matches = useMemo(() => {
    if (query === null) return [];
    return toolkits
      .filter((toolkit) =>
        `${toolkit.groupId} ${toolkit.groupLabel} ${toolkit.groupDescription}`
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 8);
  }, [query, toolkits]);

  const { activeIndex, setActiveIndex } = useSuggestionKeyboard({
    open: query !== null && loaded && !error,
    items: matches,
    query,
    onSelect: (toolkit) => onSelect(toolkit.groupId),
  });

  if (query === null) return null;
  if (!loaded && !error) return null;

  return (
    <div
      role="listbox"
      aria-label="Agent toolkits"
      className="max-h-80 overflow-y-auto rounded-ui-control border border-border/70 bg-surface-primary py-1 shadow-sm"
    >
      {error ? <p className="px-3 py-2 text-xs text-text-tertiary">{error}</p> : null}
      {!error && matches.length === 0 ? (
        <p className="px-3 py-2 text-xs text-text-tertiary">没有匹配的工具包</p>
      ) : null}
      {matches.map((toolkit, index) => (
        <button
          key={toolkit.groupId}
          type="button"
          role="option"
          aria-label={`使用工具包 ${toolkit.groupLabel}`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => onSelect(toolkit.groupId)}
          aria-selected={index === activeIndex}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
            index === activeIndex ? "bg-surface-secondary" : "hover:bg-surface-secondary"
          }`}
        >
          <Box className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm text-text-primary">{toolkit.groupLabel}</span>
            <span className="truncate text-xs text-text-tertiary">
              {toolkit.groupDescription}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
