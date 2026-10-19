import type { ToolDefinition } from "../../mcp/core/definitions.js";
import {
  buildCapabilityResolutionDocuments,
  resolveCapabilityCascade,
} from "../candidates-core/capability-resolution.js";
import type { HarnessCapabilityProfile } from "./types.js";

const INTERNAL_PROFILE_BLUEPRINTS: Array<{
  id: string;
  title: string;
  description: string;
  domain: ToolDefinition["domain"];
  tags: string[];
  preferredToolId?: string;
  supportingToolIds: string[];
  aliases?: string[];
  schemaSelection?: "group" | "concrete";
  actionProfileId?: string;
  actionProfileTitle?: string;
  actionProfileDescription?: string;
  workbench?: HarnessCapabilityProfile["workbench"];
}> = [
  {
    id: "workspace_lookup",
    title: "Workspace Lookup",
    description:
      "Inspect workspace paths and contents when local file context is relevant to the current task.",
    domain: "read",
    tags: ["workspace", "read", "list", "directory", "glob", "pattern", "lookup", "locate", "search", "grep", "symbol", "reference", "open"],
    supportingToolIds: ["glob", "grep", "list", "read"],
  },
  {
    id: "codebase_understanding",
    title: "Codebase Understanding",
    description:
      "Explore codebase architecture, affected areas, and cross-file relationships through the controlled CodeGraph wrapper.",
    domain: "read",
    tags: [
      "codebase",
      "architecture",
      "dependency",
      "impact",
      "flow",
      "codegraph",
      "explore",
    ],
    preferredToolId: "codebase_explore",
    supportingToolIds: ["codebase_explore"],
  },
  {
    id: "workspace_edit",
    title: "Workspace Edit",
    description:
      "Modify workspace files or path identity when governed local file mutation is relevant.",
    domain: "edit",
    tags: ["workspace", "edit", "write", "replace", "delete", "move", "rename"],
    supportingToolIds: ["write", "edit", "delete", "move", "apply_patch"],
  },
  {
    id: "web",
    title: "Web",
    description: "Access public web information: discover relevant public sources or retrieve a known public URL.",
    domain: "web_search",
    tags: ["web", "search", "public", "current", "realtime", "research", "internet", "fetch", "url", "retrieve", "page"],
    preferredToolId: "web_search",
    supportingToolIds: ["web_search", "web_fetch"],
  },
  {
    id: "browser",
    title: "Browser",
    description: "Inspect and operate an isolated Playwright automation session in a Mira-managed browser, returning structured page evidence.",
    domain: "browser_action",
    tags: ["browser", "managed-browser", "mira-managed-browser", "isolated-session", "automation-session", "playwright", "website", "webpage", "page", "open", "visit", "navigate", "title", "inspect", "computer-use", "snapshot", "screenshot", "click", "fill", "press", "select", "scroll", "wait", "observe", "act", "assert", "网页", "页面", "打开", "访问", "截图", "点击", "填写", "等待", "滚动", "断言"],
    // `browser` owns the whole Managed Browser Tool catalog for first-level
    // capability discovery, workbench grouping and readiness/eligibility. Schema
    // disclosure is opt-in concrete so selecting the capability selects only the
    // task-relevant atomic Tool schema instead of eager-expanding all of them.
    supportingToolIds: [
      "browser_navigate",
      "browser_wait_for",
      "browser_snapshot",
      "browser_screenshot",
      "browser_click",
      "browser_fill",
      "browser_press_key",
      "browser_select_option",
      "browser_scroll",
      "browser_observe",
      "browser_act",
      "browser_assert",
    ],
    schemaSelection: "concrete",
    // Temporary compatibility until AGT-012 / #365 performs the explicit legacy
    // cutover. `browser_computer_use` stays resolvable and reconciles to the same
    // Managed Browser Tools; it is not a second capability or Tool family.
    aliases: ["browser_computer_use"],
    workbench: {
      label: "智控",
      description: "Playwright / Managed Browser 浏览器自动化工具。",
      order: 50,
      icon: "mouse-pointer",
    },
  },
  {
    id: "browser_attached",
    title: "Attached Browser",
    description:
      "Observe and operate the user's already-connected browser, including existing tabs and authenticated web sessions.",
    domain: "browser_action",
    tags: [
      "browser",
      "attached-browser",
      "current-browser",
      "existing-tab",
      "authenticated-session",
      "chrome",
      "webpage",
      "网页",
      "当前页面",
      "当前浏览器",
      "已登录",
    ],
    preferredToolId: "browser_attached_look",
    supportingToolIds: [
      "browser_attached_look",
      "browser_attached_browse",
      "browser_attached_act",
      "browser_attached_transfer",
    ],
    workbench: {
      label: "触界",
      description: "通过 Chrome Extension 操作用户已连接的真实浏览器。",
      order: 60,
      icon: "globe",
    },
  },
  {
    id: "external_expert",
    title: "External Expert",
    description:
      "Ask the user's connected external expert for a second opinion and return the advice as evidence for Mira.",
    domain: "external_expert",
    tags: [
      "external-expert",
      "expert-advice",
      "consult",
      "问策",
      "专家",
      "第二意见",
      "咨询建议",
    ],
    preferredToolId: "ask_external_expert",
    supportingToolIds: ["ask_external_expert"],
  },
  {
    id: "news_research",
    title: "News Research",
    description: "Search the locally collected News Hub cache from configured news feeds and sources.",
    domain: "web_search",
    tags: ["news", "local-news", "news-hub", "feed", "rss", "headline", "资讯", "新闻", "订阅源"],
    preferredToolId: "news_search",
    supportingToolIds: ["news_search"],
  },
  {
    id: "mail_reading",
    title: "Mail Reading",
    description: "Search and inspect the current user's locally cached mail.",
    domain: "mail",
    tags: ["mail", "email", "inbox", "邮件", "收件箱", "未读", "附件"],
    preferredToolId: "mail_query",
    supportingToolIds: ["mail_query"],
  },
  {
    id: "terminal_execution",
    title: "Terminal Execution",
    description: "Run local terminal commands or inspect command output in the workspace runtime.",
    domain: "terminal",
    tags: ["terminal", "command", "shell", "process"],
    preferredToolId: "terminal",
    supportingToolIds: ["terminal"],
    actionProfileId: "terminal_execute_command",
    actionProfileTitle: "Terminal Execute Command",
    actionProfileDescription: "Execute a controlled terminal command through the managed terminal runtime.",
  },
];

const createFallbackProfile = (
  definition: ToolDefinition,
): HarnessCapabilityProfile => ({
  id: definition.id,
  title: definition.title,
  description: definition.description,
  domain: definition.domain,
  source: definition.source,
  tags: definition.tags,
  inputSchema: definition.inputSchema,
  sourceLabel: definition.sourceLabel,
  preferredToolId: definition.id,
  supportingToolIds: [definition.id],
});

export const resolveHarnessCapabilityProfiles = (
  definitions: ToolDefinition[],
): HarnessCapabilityProfile[] => {
  const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));
  const consumed = new Set<string>();
  const profiles: HarnessCapabilityProfile[] = [];

  for (const blueprint of INTERNAL_PROFILE_BLUEPRINTS) {
    const matchedToolIds = blueprint.supportingToolIds.filter((toolId) => definitionMap.has(toolId));
    if (
      matchedToolIds.length === 0 ||
      (blueprint.preferredToolId && !definitionMap.has(blueprint.preferredToolId))
    ) {
      continue;
    }

    matchedToolIds.forEach((toolId) => consumed.add(toolId));
    profiles.push({
      id: blueprint.id,
      title: blueprint.title,
      description: blueprint.description,
      domain: blueprint.domain,
      source: "internal",
      tags: blueprint.tags,
      ...(blueprint.preferredToolId ? { preferredToolId: blueprint.preferredToolId } : {}),
      supportingToolIds: matchedToolIds,
      ...(blueprint.aliases ? { aliases: blueprint.aliases } : {}),
      ...(blueprint.schemaSelection ? { schemaSelection: blueprint.schemaSelection } : {}),
      ...(blueprint.workbench ? { workbench: blueprint.workbench } : {}),
      ...(blueprint.actionProfileId
        ? {
            actionProfileId: blueprint.actionProfileId,
            actionProfileTitle: blueprint.actionProfileTitle,
            actionProfileDescription: blueprint.actionProfileDescription,
          }
        : {}),
    });
  }

  for (const definition of definitions) {
    if (consumed.has(definition.id)) {
      continue;
    }
    profiles.push(createFallbackProfile(definition));
  }

  return profiles;
};

/**
 * Generic opt-in concrete schema-selection seam.
 *
 * A Profile with `schemaSelection: "concrete"` still owns every supporting Tool
 * for first-level capability/product discovery, workbench grouping, readiness
 * and eligibility, but selecting that capability must not eager-materialize the
 * whole grouped catalog. The same deterministic-first #301 cascade is reused
 * over the profile's own concrete Tools without injecting a semantic Resolver,
 * so this adds no model roundtrip; only the selected Tool schema(s) are
 * disclosed. Every other Profile keeps the existing grouped behavior.
 *
 * The returned ids are canonical Tool ids. Readiness, discoverability and
 * execution authority remain owned by the existing Harness capability-view /
 * Policy / Approval path; this function changes schema-disclosure selection only.
 */
export const resolveCapabilitySchemaToolIds = async (input: {
  capabilityId: string;
  query: string;
  profiles: readonly HarnessCapabilityProfile[];
  definitions: readonly ToolDefinition[];
}): Promise<readonly string[]> => {
  const profile = input.profiles.find(
    (candidate) => candidate.id === input.capabilityId,
  );
  if (!profile) return [input.capabilityId];
  if (profile.schemaSelection !== "concrete") {
    return [...profile.supportingToolIds];
  }

  const supporting = new Set(profile.supportingToolIds);
  const supportingDefinitions = input.definitions.filter((definition) =>
    supporting.has(definition.id),
  );
  if (supportingDefinitions.length <= 1) {
    return supportingDefinitions.map((definition) => definition.id);
  }

  const resolution = await resolveCapabilityCascade({
    query: input.query,
    capabilities: buildCapabilityResolutionDocuments(
      supportingDefinitions.map((definition) =>
        createConcreteToolProfile(definition),
      ),
    ),
  });
  if (
    resolution.selectedCapabilityId &&
    supporting.has(resolution.selectedCapabilityId)
  ) {
    return [resolution.selectedCapabilityId];
  }

  // Deterministic evidence did not confidently select one concrete Tool. Keep
  // the turn bounded by disclosing nothing new rather than guessing or
  // eager-expanding the catalog; the whole capability still stays discoverable
  // as compact metadata.
  return [];
};

const createConcreteToolProfile = (
  definition: ToolDefinition,
): HarnessCapabilityProfile => ({
  id: definition.id,
  title: definition.title,
  description: definition.description,
  domain: definition.domain,
  source: definition.source,
  tags: [...definition.tags],
  preferredToolId: definition.id,
  supportingToolIds: [definition.id],
});
