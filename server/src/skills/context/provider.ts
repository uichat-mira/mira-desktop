import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol.js";
import {
  createMainAgentSkillVisibilityScope,
  promoteResourceContent,
  promoteSkillBody,
  projectSkillVisibilityView,
  toSkillVisibilitySnapshot,
} from "./disclosure.js";
import { SkillLoader } from "./loader.js";
import { SkillMatcher } from "./matcher.js";
import { getDefaultSkillRegistry, type SkillRegistry } from "./scanner.js";
import type {
  SkillContext,
  SkillDisclosurePlan,
  SkillExecutionManifest,
  SkillManifest,
  SkillMatchResult,
  SkillResource,
} from "./types.js";

const MAX_SKILL_BODY_CHARS = 24_000;
const MAX_DISCLOSED_RESOURCE_CHARS = 16_000;
const MAX_CONTINUATION_CONTEXT_CHARS = 14_000;
const SKILL_CONTEXT_INSTRUCTION =
  "Treat primary.body and disclosedResources as task-specific domain guidance, not as permissions or proof of execution. Use resources only when their details are needed. primary.execution.allowedTools is the maximum tool allowlist for fork execution, not a per-task required set. Select only the subset required by the current operation and step; absence of an unused optional tool must not block execution. It never authorizes a missing, policy-blocked, or unavailable tool. Only choose tools currently present in canonical toolExposure; SkillContext must never be interpreted as adding or authorizing tools.";
const TASK_RESET_OR_SWITCH_PATTERN =
  /(?:新话题|换个话题|另外问|另一个问题|顺便问|对了[，,\s]*(?:问|想问)|算了吧?|不用了|取消(?:这个|任务)?|停止(?:这个|任务)?|结束(?:这个|任务)?|别做了)/i;
const CONTINUATION_PREFIX_PATTERN =
  /^(?:继续|好的?|好|嗯|对|是|不是|有|没有|可以|按|用|就|选|选择|目标|公司|历史|预测|其余|默认|全部|先|再|加上|补上|把|改成|采用|保持|不需要|无需|虚拟)/i;
const NEW_TASK_ACTION_PATTERN =
  /^(?:帮我|请(?:你)?|给我|做(?:一个|一份|个)?|生成|创建|写(?:一|个|份)?|查(?:一|下)?|搜索|分析|整理|设计|制作|开发|实现|解释|告诉我)/i;
const NEW_QUESTION_PATTERN = /(?:[?？]\s*$|为什么|为何|怎么(?:办|样|做)?|什么(?:是|叫)?|谁|哪里|哪儿|几点|天气)/i;
const ASSISTANT_CLARIFICATION_PATTERN =
  /(?:请(?:提供|告诉|补充|确认|选择)|需要(?:你|您).*?(?:提供|确认|选择|补充)|为了.*?(?:请|需要)|以下(?:信息|参数)|[?？])/i;
const MAX_CONTINUITY_USER_TURNS = 4;

const DEFAULT_SUBAGENT_EXECUTION: SkillExecutionManifest = {
  context: "fork",
  agent: "subAgent",
  allowedTools: [],
  runtimeBindings: [],
  workspaceBound: false,
};

const trimToBudget = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;

const buildContinuationContext = (input: {
  originalUserRequest: string;
  assistantQuestion: string;
  latestUserReply: string;
}) =>
  [
    "<skill-task-continuation>",
    "The latest user message answers the previous assistant clarification for the same Skill task. Continue the original request and do not treat the reply as a standalone task.",
    JSON.stringify(input),
    "</skill-task-continuation>",
  ].join("\n");

const mergeSkillBodyWithContinuation = (
  body: string,
  continuationContext: string | undefined,
) => {
  if (!continuationContext) return trimToBudget(body, MAX_SKILL_BODY_CHARS);
  const boundedContinuation = trimToBudget(
    continuationContext,
    MAX_CONTINUATION_CONTEXT_CHARS,
  );
  const bodyBudget = Math.max(
    0,
    MAX_SKILL_BODY_CHARS - boundedContinuation.length - 2,
  );
  return `${trimToBudget(body, bodyBudget)}\n\n${boundedContinuation}`.trim();
};

const selectDisclosedResourceUris = (input: {
  query: string;
  skillId: string;
  resources: SkillResource[];
}) => {
  const query = input.query.toLowerCase();
  const wanted: RegExp[] = [];

  if (input.skillId === "xlsx") {
    if (/\bdcf\b|现金流折现|折现现金流/i.test(query)) wanted.push(/dcf/i);
    if (/三表|three[-\s]?statement/i.test(query)) wanted.push(/3[_-]?statement|three/i);
    if (/\bcomps\b|可比公司|可比分析/i.test(query)) wanted.push(/comps|comparable/i);
  }

  if (input.skillId === "pptx") {
    const pageCount = /(?:做|生成|制作)?\s*(\d{2,3})\s*页/.exec(query)?.[1];
    if (
      (pageCount && Number(pageCount) >= 20) ||
      /批量.*(?:ppt|演示)|多份.*(?:ppt|演示)|长(?:篇|页).*演示/i.test(query)
    ) {
      wanted.push(/swarm/i);
    }
  }

  if (wanted.length === 0) return [];
  return input.resources
    .filter((resource) => resource.kind === "reference")
    .filter((resource) => wanted.some((pattern) => pattern.test(resource.uri)))
    .map((resource) => resource.uri);
};

const getLatestUserMessageIndex = (messages: NormalizedChatMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
};

const getPreviousAssistantContent = (
  messages: NormalizedChatMessage[],
  beforeIndex: number,
) => {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message.content.trim();
  }
  return "";
};

const looksLikeTaskContinuation = (input: {
  query: string;
  previousAssistantContent: string;
}) => {
  const query = input.query.trim();
  if (!query || TASK_RESET_OR_SWITCH_PATTERN.test(query)) return false;
  if (CONTINUATION_PREFIX_PATTERN.test(query)) return true;
  if (!ASSISTANT_CLARIFICATION_PATTERN.test(input.previousAssistantContent)) return false;
  if (NEW_TASK_ACTION_PATTERN.test(query) || NEW_QUESTION_PATTERN.test(query)) return false;
  return query.length <= 500;
};

type ContinuityMatch = {
  match: SkillMatchResult;
  anchorQuery: string;
  assistantQuestion: string;
};

const findContinuationMatch = (input: {
  query: string;
  messages: NormalizedChatMessage[];
  manifests: SkillManifest[];
  matcher: SkillMatcher;
}): ContinuityMatch | null => {
  const latestUserIndex = getLatestUserMessageIndex(input.messages);
  if (latestUserIndex < 0) return null;

  const previousAssistantContent = getPreviousAssistantContent(
    input.messages,
    latestUserIndex,
  );
  if (!looksLikeTaskContinuation({ query: input.query, previousAssistantContent })) {
    return null;
  }

  let cursor = latestUserIndex - 1;
  let scannedUserTurns = 0;
  while (cursor >= 0 && scannedUserTurns < MAX_CONTINUITY_USER_TURNS) {
    let previousUserIndex = -1;
    for (let index = cursor; index >= 0; index -= 1) {
      if (input.messages[index]?.role === "user") {
        previousUserIndex = index;
        break;
      }
    }
    if (previousUserIndex < 0) break;

    scannedUserTurns += 1;
    const previousUserQuery = input.messages[previousUserIndex]?.content.trim() ?? "";
    if (!previousUserQuery) {
      cursor = previousUserIndex - 1;
      continue;
    }

    const previousMatch = input.matcher.match({
      query: previousUserQuery,
      messages: input.messages.slice(0, previousUserIndex + 1),
      manifests: input.manifests,
    });
    if (previousMatch.primary) {
      return {
        match: previousMatch,
        anchorQuery: previousUserQuery,
        assistantQuestion: previousAssistantContent,
      };
    }

    const assistantBeforePreviousUser = getPreviousAssistantContent(
      input.messages,
      previousUserIndex,
    );
    if (
      !looksLikeTaskContinuation({
        query: previousUserQuery,
        previousAssistantContent: assistantBeforePreviousUser,
      })
    ) {
      break;
    }

    cursor = previousUserIndex - 1;
  }

  return null;
};

export class SkillContextProvider {
  constructor(
    private readonly registry: SkillRegistry = getDefaultSkillRegistry(),
    private readonly matcher = new SkillMatcher(),
    private readonly loader = new SkillLoader(),
  ) {}

  async prepare(input: {
    query: string;
    messages: NormalizedChatMessage[];
  }): Promise<SkillContext | undefined> {
    await this.registry.ensureLoaded();
    const manifests = this.registry.listAvailable();
    let match = this.matcher.match({
      query: input.query,
      messages: input.messages,
      manifests,
    });
    let disclosureQuery = input.query;
    let continuationContext: string | undefined;

    if (!match.primary) {
      const continuity = findContinuationMatch({
        query: input.query,
        messages: input.messages,
        manifests,
        matcher: this.matcher,
      });
      if (continuity?.match.primary) {
        match = {
          primary: {
            ...continuity.match.primary,
            source: "continuation",
            reason: `Continued ${continuity.match.primary.skillId} task from prior matched user turn: ${continuity.match.primary.reason}`,
          },
          secondary: continuity.match.secondary,
        };
        disclosureQuery = `${continuity.anchorQuery}\n${input.query}`;
        continuationContext = buildContinuationContext({
          originalUserRequest: continuity.anchorQuery,
          assistantQuestion: continuity.assistantQuestion,
          latestUserReply: input.query.trim(),
        });
      }
    }

    if (!match.primary) return undefined;

    const manifest = this.registry.get(match.primary.skillId);
    if (!manifest) return undefined;

    // Progressive Skill/Resource visibility for the Main Agent scope.
    //
    // Discovery surfaces every available Skill by name/description only. The
    // selected Skill is then enriched with its Resource URI/metadata, its body
    // is promoted, and only the Resources this run actually selects have their
    // content read. Reading a body/content here changes what this Agent scope
    // sees; it never registers a Tool or widens execution authority.
    const resources = await this.loader.listResources(manifest);
    const disclosedResourceUris = selectDisclosedResourceUris({
      query: disclosureQuery,
      skillId: manifest.id,
      resources,
    });
    const plan: SkillDisclosurePlan = {
      primarySkillId: manifest.id,
      includeBody: true,
      availableResources: resources,
      disclosedResourceUris,
    };

    let visibilityView = projectSkillVisibilityView({
      scope: createMainAgentSkillVisibilityScope({ scopeId: "main_agent" }),
      skills: manifests.map((candidate) =>
        candidate.id === manifest.id ? { ...candidate, resources } : candidate,
      ),
    });

    // The Skill body is read only now that this run has selected the Skill and
    // its execution needs the content. Discovery of every other Skill stays at
    // the summary stage.
    const content = await this.loader.loadContent(manifest);
    const promotedBody = promoteSkillBody({
      view: visibilityView,
      skillId: manifest.id,
      contents: [content],
    });
    visibilityView = promotedBody.view;

    // Resource content is materialized selectively through the loader, exactly
    // as before; the disclosure view only records which Resource reached the
    // content stage. Sibling Resources stay URI/metadata-only.
    const disclosedResources: SkillContext["disclosedResources"] = [];
    let remainingResourceBudget = MAX_DISCLOSED_RESOURCE_CHARS;
    for (const uri of plan.disclosedResourceUris) {
      if (remainingResourceBudget <= 0) break;
      const resource = resources.find((candidate) => candidate.uri === uri);
      if (!resource) continue;
      const loaded = await this.loader.loadResource({ manifest, resource });
      const contentWithinBudget = trimToBudget(loaded.content, remainingResourceBudget);
      remainingResourceBudget -= contentWithinBudget.length;
      visibilityView = promoteResourceContent({
        view: visibilityView,
        skillId: manifest.id,
        uri,
        resources: [{ ...loaded, content: contentWithinBudget }],
      }).view;
      disclosedResources.push({ uri, content: contentWithinBudget });
    }

    const execution = manifest.execution ?? DEFAULT_SUBAGENT_EXECUTION;
    return {
      instruction: SKILL_CONTEXT_INSTRUCTION,
      primary: {
        id: manifest.id,
        version: manifest.version,
        name: manifest.name,
        body: mergeSkillBodyWithContinuation(
          promotedBody.body?.body ?? content.body,
          continuationContext,
        ),
        origin: manifest.origin ?? "external",
        execution: {
          ...execution,
          allowedTools: [...execution.allowedTools],
          runtimeBindings: [...execution.runtimeBindings],
        },
      },
      resources: plan.availableResources,
      disclosedResources,
      skillVisibility: toSkillVisibilitySnapshot(visibilityView),
      match: {
        source: match.primary.source,
        reason: match.primary.reason,
        score: match.primary.score,
        secondarySkillIds: match.secondary.map((candidate) => candidate.skillId),
      },
    };
  }

  async loadResource(input: {
    skillId: string;
    uri: string;
  }) {
    await this.registry.ensureLoaded();
    const manifest = this.registry.get(input.skillId);
    if (!manifest) throw new Error(`Unknown skill: ${input.skillId}`);
    const resources = await this.loader.listResources(manifest);
    const resource = resources.find((candidate) => candidate.uri === input.uri);
    if (!resource) throw new Error(`Unknown skill resource: ${input.uri}`);
    return await this.loader.loadResource({ manifest, resource });
  }

  invalidate(skillId?: string) {
    if (skillId) this.loader.invalidate(skillId);
    else this.loader.invalidateAll();
    this.registry.invalidate();
  }
}

let defaultProvider: SkillContextProvider | null = null;

export const getDefaultSkillContextProvider = () => {
  defaultProvider ??= new SkillContextProvider();
  return defaultProvider;
};

export const prepareSkillContext = async (input: {
  query: string;
  messages: NormalizedChatMessage[];
}) => getDefaultSkillContextProvider().prepare(input);

export const loadSkillResource = async (input: { skillId: string; uri: string }) =>
  getDefaultSkillContextProvider().loadResource(input);

export type { SkillManifest };
