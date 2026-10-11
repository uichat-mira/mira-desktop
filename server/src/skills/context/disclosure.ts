import type {
  LoadedSkillResource,
  SkillContent,
  SkillResource,
  SkillResourceKind,
} from "./types.js";

/**
 * Progressive Skill and Resource visibility over an Agent-scoped view.
 *
 * This deliberately mirrors the Harness Capability View disclosure semantics
 * (a scope can narrow what the Agent currently sees but can never grant
 * authority) without collapsing Tool, Skill and Resource into one universal
 * interface. Each surface keeps its own domain contract and its own disclosure
 * stages:
 *
 *   Tool:     metadata -> schema
 *   Skill:    name/description -> body
 *   Resource: URI/metadata -> content
 *
 * A Skill visibility view is a projection snapshot. It carries visibility only:
 * SkillExecutionManifest (`allowedTools`, `runtimeBindings`), Harness Tool
 * eligibility, Policy and Approval stay outside the view, so disclosing a Skill
 * body or Resource content can never widen what the Agent may actually execute.
 * Resource content is only read through an explicit materialization over the
 * current disclosure stage, preserving selective Resource reads.
 */
export type SkillDisclosure = "hidden" | "summary" | "body";
export type ResourceDisclosure = "hidden" | "metadata" | "content";

/** Same scope-kind vocabulary the Harness Capability View uses, so a Skill Child
 * can own an independent scoped visibility state without sharing its module. */
export type SkillVisibilityScopeKind = "main_agent" | "skill_child";

export interface CreateSkillVisibilityScopeInput {
  scopeId: string;
  /**
   * Optional discoverability envelope. It limits which Skills this scope may
   * surface at all. Independent of any Parent-visible Skill snapshot so a Child
   * ceiling can be represented without equalling the Parent view.
   */
  discoverableSkillIds?: readonly string[];
  /** Highest Skill disclosure this scope may reach. Defaults to "body". */
  maxSkillDisclosure?: SkillDisclosure;
  /** Highest Resource disclosure this scope may reach. Defaults to "content". */
  maxResourceDisclosure?: ResourceDisclosure;
}

export interface SkillVisibilityScope {
  readonly scopeId: string;
  readonly kind: SkillVisibilityScopeKind;
  readonly discoverableSkillIds?: readonly string[];
  readonly maxSkillDisclosure: SkillDisclosure;
  readonly maxResourceDisclosure: ResourceDisclosure;
}

/**
 * Visibility source for one Skill. Only the fields needed to project the
 * summary stage are accepted; `SkillManifest` is assignable because it carries
 * id/name/description/version. Any execution authority fields a real manifest
 * contains are intentionally never projected into the view.
 */
export interface SkillVisibilitySkillSource {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly resources?: readonly SkillResource[];
}

export interface ResourceVisibilityEntry {
  readonly uri: string;
  readonly skillId: string;
  readonly name: string;
  readonly kind: SkillResourceKind;
  readonly description?: string;
  readonly discoverable: boolean;
  readonly disclosure: ResourceDisclosure;
}

export interface SkillVisibilityEntry {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly discoverable: boolean;
  readonly disclosure: SkillDisclosure;
  readonly resources: ReadonlyMap<string, Readonly<ResourceVisibilityEntry>>;
}

export interface SkillVisibilityView {
  readonly scopeId: string;
  readonly scopeKind: SkillVisibilityScopeKind;
  readonly maxSkillDisclosure: SkillDisclosure;
  readonly maxResourceDisclosure: ResourceDisclosure;
  readonly skills: ReadonlyMap<string, Readonly<SkillVisibilityEntry>>;
}

export interface ProjectSkillVisibilityViewInput {
  readonly scope: SkillVisibilityScope;
  readonly skills: readonly SkillVisibilitySkillSource[];
  /**
   * Requested initial Skill disclosure per Skill. It is clamped by the scope
   * ceiling, so it cannot disclose a Skill the scope keeps hidden.
   */
  readonly requestedSkillDisclosure?: ReadonlyMap<string, SkillDisclosure>;
  /**
   * Requested initial Resource disclosure, keyed by `resourceDisclosureKey`.
   * Clamped by the scope Resource ceiling and by Skill discoverability.
   */
  readonly requestedResourceDisclosure?: ReadonlyMap<string, ResourceDisclosure>;
  /**
   * Requested discoverability per Skill. It can suppress an otherwise
   * discoverable Skill but cannot override the scope envelope.
   */
  readonly requestedDiscoverable?: ReadonlyMap<string, boolean>;
}

export interface SkillSummary {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  /** Disclosure stage this summary was projected from. Never "hidden". */
  readonly disclosure: Extract<SkillDisclosure, "summary" | "body">;
}

export interface SkillBodyDisclosure {
  readonly skillId: string;
  readonly disclosure: "body";
  readonly body: string;
}

export interface ResourceMetadata {
  readonly uri: string;
  readonly skillId: string;
  readonly name: string;
  readonly kind: SkillResourceKind;
  readonly description?: string;
  /** Disclosure stage this metadata was projected from. Never "hidden". */
  readonly disclosure: Extract<ResourceDisclosure, "metadata" | "content">;
}

export interface ResourceContentDisclosure {
  readonly uri: string;
  readonly disclosure: "content";
  readonly content: string;
}

export type SkillDisclosureTransitionReason =
  | "promoted"
  | "already-disclosed"
  | "blocked-ceiling"
  | "blocked-not-discoverable"
  | "unknown-skill";

export type ResourceDisclosureTransitionReason =
  | "promoted"
  | "already-disclosed"
  | "blocked-ceiling"
  | "blocked-not-discoverable"
  | "unknown-resource";

export interface SkillDisclosureTransition {
  readonly skillId: string;
  readonly from: SkillDisclosure;
  readonly to: SkillDisclosure;
  readonly reason: SkillDisclosureTransitionReason;
  readonly bodyMaterialized: boolean;
}

export interface ResourceDisclosureTransition {
  readonly uri: string;
  readonly from: ResourceDisclosure;
  readonly to: ResourceDisclosure;
  readonly reason: ResourceDisclosureTransitionReason;
  readonly contentMaterialized: boolean;
}

export interface PromoteSkillBodyResult {
  readonly view: SkillVisibilityView;
  readonly transition: SkillDisclosureTransition;
  readonly body?: SkillBodyDisclosure;
}

export interface PromoteResourceContentResult {
  readonly view: SkillVisibilityView;
  readonly transition: ResourceDisclosureTransition;
  readonly content?: ResourceContentDisclosure;
}

export interface SkillVisibilityTraceEntry {
  readonly skillId: string;
  readonly discoverable: boolean;
  readonly disclosure: SkillDisclosure;
  readonly summaryDisclosed: boolean;
  readonly bodyDisclosed: boolean;
  readonly resourceCount: number;
  readonly resourceMetadataDisclosedCount: number;
  readonly resourceContentDisclosedCount: number;
}

export interface SkillVisibilityTrace {
  readonly scopeId: string;
  readonly scopeKind: SkillVisibilityScopeKind;
  readonly entries: SkillVisibilityTraceEntry[];
  readonly summaryDisclosedCount: number;
  readonly bodyDisclosedCount: number;
  readonly hiddenCount: number;
  readonly resourceMetadataDisclosedCount: number;
  readonly resourceContentDisclosedCount: number;
}

const SKILL_DISCLOSURE_RANK: Record<SkillDisclosure, number> = {
  hidden: 0,
  summary: 1,
  body: 2,
};

const RESOURCE_DISCLOSURE_RANK: Record<ResourceDisclosure, number> = {
  hidden: 0,
  metadata: 1,
  content: 2,
};

export const resourceDisclosureKey = (skillId: string, uri: string): string =>
  `${skillId}\u0000${uri}`;

const clampSkillDisclosure = (
  requested: SkillDisclosure,
  ceiling: SkillDisclosure,
): SkillDisclosure =>
  SKILL_DISCLOSURE_RANK[requested] <= SKILL_DISCLOSURE_RANK[ceiling]
    ? requested
    : ceiling;

const clampResourceDisclosure = (
  requested: ResourceDisclosure,
  ceiling: ResourceDisclosure,
): ResourceDisclosure =>
  RESOURCE_DISCLOSURE_RANK[requested] <= RESOURCE_DISCLOSURE_RANK[ceiling]
    ? requested
    : ceiling;

const freezeReadonlyMap = <Key, Value>(
  source: ReadonlyMap<Key, Value>,
): ReadonlyMap<Key, Value> => {
  const snapshot = new Map(source);
  let readonlyMap: ReadonlyMap<Key, Value>;
  readonlyMap = Object.freeze({
    get size() {
      return snapshot.size;
    },
    get: (key: Key) => snapshot.get(key),
    has: (key: Key) => snapshot.has(key),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    forEach: (
      callbackfn: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
      thisArg?: unknown,
    ) => {
      snapshot.forEach((value, key) => {
        callbackfn.call(thisArg, value, key, readonlyMap);
      });
    },
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  });
  return readonlyMap;
};

const freezeResourceEntry = (
  entry: ResourceVisibilityEntry,
): Readonly<ResourceVisibilityEntry> =>
  Object.freeze({
    ...entry,
  });

const freezeSkillEntry = (entry: {
  skillId: string;
  name: string;
  description: string;
  version: string;
  discoverable: boolean;
  disclosure: SkillDisclosure;
  resources: ReadonlyMap<string, Readonly<ResourceVisibilityEntry>>;
}): Readonly<SkillVisibilityEntry> =>
  Object.freeze({
    ...entry,
    resources: freezeReadonlyMap(entry.resources),
  });

const createView = (input: {
  scopeId: string;
  scopeKind: SkillVisibilityScopeKind;
  maxSkillDisclosure: SkillDisclosure;
  maxResourceDisclosure: ResourceDisclosure;
  skills: ReadonlyMap<string, Readonly<SkillVisibilityEntry>>;
}): SkillVisibilityView =>
  Object.freeze({
    scopeId: input.scopeId,
    scopeKind: input.scopeKind,
    maxSkillDisclosure: input.maxSkillDisclosure,
    maxResourceDisclosure: input.maxResourceDisclosure,
    skills: freezeReadonlyMap(input.skills),
  });

const createScope = (
  kind: SkillVisibilityScopeKind,
  input: CreateSkillVisibilityScopeInput,
): SkillVisibilityScope => ({
  scopeId: input.scopeId,
  kind,
  ...(input.discoverableSkillIds
    ? { discoverableSkillIds: [...input.discoverableSkillIds] }
    : {}),
  maxSkillDisclosure: input.maxSkillDisclosure ?? "body",
  maxResourceDisclosure: input.maxResourceDisclosure ?? "content",
});

export const createMainAgentSkillVisibilityScope = (
  input: CreateSkillVisibilityScopeInput,
): SkillVisibilityScope => createScope("main_agent", input);

export const createSkillChildSkillVisibilityScope = (
  input: CreateSkillVisibilityScopeInput,
): SkillVisibilityScope => createScope("skill_child", input);

export const projectSkillVisibilityView = (
  input: ProjectSkillVisibilityViewInput,
): SkillVisibilityView => {
  const { scope } = input;
  const discoverableEnvelope = scope.discoverableSkillIds
    ? new Set(scope.discoverableSkillIds)
    : undefined;

  const skills = new Map<string, Readonly<SkillVisibilityEntry>>();
  for (const source of input.skills) {
    const withinEnvelope =
      !discoverableEnvelope || discoverableEnvelope.has(source.id);
    const discoveryRequested =
      input.requestedDiscoverable?.get(source.id) ?? true;
    const discoverable = withinEnvelope && discoveryRequested;

    const requestedDisclosure =
      input.requestedSkillDisclosure?.get(source.id) ??
      (discoverable ? "summary" : "hidden");
    const disclosure = discoverable
      ? clampSkillDisclosure(requestedDisclosure, scope.maxSkillDisclosure)
      : "hidden";

    const resources = new Map<string, Readonly<ResourceVisibilityEntry>>();
    for (const resource of source.resources ?? []) {
      const requestedResourceDisclosure =
        input.requestedResourceDisclosure?.get(
          resourceDisclosureKey(source.id, resource.uri),
        ) ?? (discoverable ? "metadata" : "hidden");
      const resourceDisclosure = discoverable
        ? clampResourceDisclosure(
            requestedResourceDisclosure,
            scope.maxResourceDisclosure,
          )
        : "hidden";

      resources.set(
        resource.uri,
        freezeResourceEntry({
          uri: resource.uri,
          skillId: source.id,
          name: resource.name,
          kind: resource.kind,
          ...(resource.description ? { description: resource.description } : {}),
          discoverable,
          disclosure: resourceDisclosure,
        }),
      );
    }

    skills.set(
      source.id,
      freezeSkillEntry({
        skillId: source.id,
        name: source.name,
        description: source.description,
        version: source.version,
        discoverable,
        disclosure,
        resources,
      }),
    );
  }

  return createView({
    scopeId: scope.scopeId,
    scopeKind: scope.kind,
    maxSkillDisclosure: scope.maxSkillDisclosure,
    maxResourceDisclosure: scope.maxResourceDisclosure,
    skills,
  });
};

export const getSkillVisibilityEntry = (
  view: SkillVisibilityView,
  skillId: string,
): SkillVisibilityEntry | undefined => view.skills.get(skillId);

export const getResourceVisibilityEntry = (
  view: SkillVisibilityView,
  skillId: string,
  uri: string,
): ResourceVisibilityEntry | undefined =>
  view.skills.get(skillId)?.resources.get(uri);

export const listSkillIdsAtDisclosure = (
  view: SkillVisibilityView,
  disclosure: SkillDisclosure,
): string[] =>
  [...view.skills.values()]
    .filter((entry) => entry.disclosure === disclosure)
    .map((entry) => entry.skillId);

/**
 * Project the summary stage for every discoverable Skill at the summary or body
 * stage. It never includes the Skill body, so every matched Skill can stay
 * name/description-only until the body is explicitly promoted.
 */
export const projectSkillSummaries = (
  view: SkillVisibilityView,
): SkillSummary[] =>
  [...view.skills.values()]
    .filter((entry) => entry.discoverable && entry.disclosure !== "hidden")
    .map((entry) => ({
      skillId: entry.skillId,
      name: entry.name,
      description: entry.description,
      version: entry.version,
      disclosure: entry.disclosure as "summary" | "body",
    }));

/**
 * Project Resource metadata/URI for every discoverable Resource at the metadata
 * or content stage. It never includes Resource content, so a Resource listing
 * stays lightweight until its content is explicitly materialized.
 */
export const projectResourceMetadata = (
  view: SkillVisibilityView,
  skillId?: string,
): ResourceMetadata[] => {
  const projected: ResourceMetadata[] = [];
  for (const skill of view.skills.values()) {
    if (skillId && skill.skillId !== skillId) continue;
    for (const entry of skill.resources.values()) {
      if (!entry.discoverable || entry.disclosure === "hidden") continue;
      projected.push({
        uri: entry.uri,
        skillId: entry.skillId,
        name: entry.name,
        kind: entry.kind,
        ...(entry.description ? { description: entry.description } : {}),
        disclosure: entry.disclosure as "metadata" | "content",
      });
    }
  }
  return projected;
};

/**
 * Returns a new view with one Skill's disclosure changed. Disclosure may move
 * between "hidden", "summary" and "body", but a Skill that is not discoverable
 * in this scope stays hidden. The view can narrow visibility; it can never
 * manufacture discoverability or authority.
 */
export const withSkillDisclosure = (
  view: SkillVisibilityView,
  skillId: string,
  disclosure: SkillDisclosure,
): SkillVisibilityView => {
  const entry = view.skills.get(skillId);
  if (!entry) return view;

  const nextDisclosure = entry.discoverable
    ? clampSkillDisclosure(disclosure, view.maxSkillDisclosure)
    : "hidden";
  if (nextDisclosure === entry.disclosure) return view;

  const skills = new Map(view.skills);
  skills.set(skillId, freezeSkillEntry({ ...entry, disclosure: nextDisclosure }));
  return createView({
    scopeId: view.scopeId,
    scopeKind: view.scopeKind,
    maxSkillDisclosure: view.maxSkillDisclosure,
    maxResourceDisclosure: view.maxResourceDisclosure,
    skills,
  });
};

/**
 * Returns a new view with one Resource's disclosure changed. A Resource whose
 * owning Skill is not discoverable in this scope stays hidden.
 */
export const withResourceDisclosure = (
  view: SkillVisibilityView,
  skillId: string,
  uri: string,
  disclosure: ResourceDisclosure,
): SkillVisibilityView => {
  const entry = view.skills.get(skillId);
  if (!entry) return view;
  const resource = entry.resources.get(uri);
  if (!resource) return view;

  const nextDisclosure = resource.discoverable
    ? clampResourceDisclosure(disclosure, view.maxResourceDisclosure)
    : "hidden";
  if (nextDisclosure === resource.disclosure) return view;

  const resources = new Map(entry.resources);
  resources.set(uri, freezeResourceEntry({ ...resource, disclosure: nextDisclosure }));
  const skills = new Map(view.skills);
  skills.set(skillId, freezeSkillEntry({ ...entry, resources }));
  return createView({
    scopeId: view.scopeId,
    scopeKind: view.scopeKind,
    maxSkillDisclosure: view.maxSkillDisclosure,
    maxResourceDisclosure: view.maxResourceDisclosure,
    skills,
  });
};

const blockedSkillTransition = (
  entry: SkillVisibilityEntry,
  skillId: string,
): SkillDisclosureTransition => ({
  skillId,
  from: entry.disclosure,
  to: entry.disclosure,
  reason: entry.discoverable ? "blocked-ceiling" : "blocked-not-discoverable",
  bodyMaterialized: false,
});

const blockedResourceTransition = (
  entry: ResourceVisibilityEntry,
  uri: string,
): ResourceDisclosureTransition => ({
  uri,
  from: entry.disclosure,
  to: entry.disclosure,
  reason: entry.discoverable ? "blocked-ceiling" : "blocked-not-discoverable",
  contentMaterialized: false,
});

/**
 * Controlled promotion from the summary stage to the full Skill body stage.
 *
 * Promotion is clamped by discoverability and the scope Skill ceiling, so a
 * Skill the scope keeps hidden can never be lifted to body here. The returned
 * transition is the durable trace/debug evidence for the disclosure change.
 */
export const promoteSkillBody = (input: {
  view: SkillVisibilityView;
  skillId: string;
  contents: readonly SkillContent[];
}): PromoteSkillBodyResult => {
  const entry = getSkillVisibilityEntry(input.view, input.skillId);
  if (!entry) {
    return {
      view: input.view,
      transition: {
        skillId: input.skillId,
        from: "hidden",
        to: "hidden",
        reason: "unknown-skill",
        bodyMaterialized: false,
      },
    };
  }

  const content = input.contents.find(
    (candidate) => candidate.manifest.id === input.skillId,
  );
  if (!content) {
    return {
      view: input.view,
      transition: {
        skillId: input.skillId,
        from: entry.disclosure,
        to: entry.disclosure,
        reason: "unknown-skill",
        bodyMaterialized: false,
      },
    };
  }

  if (entry.disclosure === "body") {
    return {
      view: input.view,
      transition: {
        skillId: input.skillId,
        from: "body",
        to: "body",
        reason: "already-disclosed",
        bodyMaterialized: true,
      },
      body: {
        skillId: input.skillId,
        disclosure: "body",
        body: content.body,
      },
    };
  }

  if (!entry.discoverable || input.view.maxSkillDisclosure !== "body") {
    return {
      view: input.view,
      transition: blockedSkillTransition(entry, input.skillId),
    };
  }

  const nextView = withSkillDisclosure(input.view, input.skillId, "body");
  const promotedEntry = getSkillVisibilityEntry(nextView, input.skillId);
  if (!promotedEntry || promotedEntry.disclosure !== "body") {
    return {
      view: nextView,
      transition: blockedSkillTransition(promotedEntry ?? entry, input.skillId),
    };
  }

  return {
    view: nextView,
    transition: {
      skillId: input.skillId,
      from: entry.disclosure,
      to: "body",
      reason: "promoted",
      bodyMaterialized: true,
    },
    body: {
      skillId: input.skillId,
      disclosure: "body",
      body: content.body,
    },
  };
};

/**
 * Controlled promotion from the Resource metadata stage to the content stage.
 * Content is materialized only for a Resource whose owning Skill and Resource
 * are discoverable in this scope; otherwise the current stage is preserved.
 */
export const promoteResourceContent = (input: {
  view: SkillVisibilityView;
  skillId: string;
  uri: string;
  resources: readonly LoadedSkillResource[];
}): PromoteResourceContentResult => {
  const skillEntry = getSkillVisibilityEntry(input.view, input.skillId);
  const entry = skillEntry?.resources.get(input.uri);
  if (!skillEntry || !entry) {
    return {
      view: input.view,
      transition: {
        uri: input.uri,
        from: "hidden",
        to: "hidden",
        reason: "unknown-resource",
        contentMaterialized: false,
      },
    };
  }

  const loaded = input.resources.find(
    (candidate) =>
      candidate.uri === input.uri && candidate.skillId === input.skillId,
  );
  if (!loaded) {
    return {
      view: input.view,
      transition: {
        uri: input.uri,
        from: entry.disclosure,
        to: entry.disclosure,
        reason: "unknown-resource",
        contentMaterialized: false,
      },
    };
  }

  if (entry.disclosure === "content") {
    return {
      view: input.view,
      transition: {
        uri: input.uri,
        from: "content",
        to: "content",
        reason: "already-disclosed",
        contentMaterialized: true,
      },
      content: {
        uri: input.uri,
        disclosure: "content",
        content: loaded.content,
      },
    };
  }

  if (!entry.discoverable || input.view.maxResourceDisclosure !== "content") {
    return {
      view: input.view,
      transition: blockedResourceTransition(entry, input.uri),
    };
  }

  const nextView = withResourceDisclosure(
    input.view,
    input.skillId,
    input.uri,
    "content",
  );
  const promotedEntry = getResourceVisibilityEntry(
    nextView,
    input.skillId,
    input.uri,
  );
  if (!promotedEntry || promotedEntry.disclosure !== "content") {
    return {
      view: nextView,
      transition: blockedResourceTransition(promotedEntry ?? entry, input.uri),
    };
  }

  return {
    view: nextView,
    transition: {
      uri: input.uri,
      from: entry.disclosure,
      to: "content",
      reason: "promoted",
      contentMaterialized: true,
    },
    content: {
      uri: input.uri,
      disclosure: "content",
      content: loaded.content,
    },
  };
};

/**
 * Read the full Skill body at its current disclosure stage. A Skill that is not
 * discoverable or that is still at summary returns `undefined` instead of
 * leaking its body; promotion must happen explicitly through `promoteSkillBody`.
 */
export const materializeSkillBody = (
  view: SkillVisibilityView,
  skillId: string,
  contents: readonly SkillContent[],
): SkillBodyDisclosure | undefined => {
  const entry = getSkillVisibilityEntry(view, skillId);
  if (!entry || !entry.discoverable || entry.disclosure !== "body") {
    return undefined;
  }
  const content = contents.find((candidate) => candidate.manifest.id === skillId);
  if (!content) return undefined;
  return { skillId, disclosure: "body", body: content.body };
};

/**
 * Read Resource content at its current disclosure stage. Metadata-only
 * Resources return `undefined` instead of leaking content, preserving selective
 * Resource reads.
 */
export const materializeResourceContent = (
  view: SkillVisibilityView,
  skillId: string,
  uri: string,
  resources: readonly LoadedSkillResource[],
): ResourceContentDisclosure | undefined => {
  const entry = getResourceVisibilityEntry(view, skillId, uri);
  if (!entry || !entry.discoverable || entry.disclosure !== "content") {
    return undefined;
  }
  const loaded = resources.find(
    (candidate) => candidate.uri === uri && candidate.skillId === skillId,
  );
  if (!loaded) return undefined;
  return { uri, disclosure: "content", content: loaded.content };
};

/**
 * Inspectable visibility trace. It keeps Skill summary disclosure, Skill body
 * disclosure, Resource metadata disclosure and Resource content disclosure
 * distinguishable, so trace/debug output can tell "the model saw this Skill
 * exists" apart from "the model saw its body" without flattening the domains.
 */
export const describeSkillVisibility = (
  view: SkillVisibilityView,
): SkillVisibilityTrace => {
  const entries: SkillVisibilityTraceEntry[] = [...view.skills.values()].map(
    (entry) => {
      const resourceMetadataDisclosedCount = [...entry.resources.values()].filter(
        (resource) => resource.disclosure !== "hidden",
      ).length;
      const resourceContentDisclosedCount = [...entry.resources.values()].filter(
        (resource) => resource.disclosure === "content",
      ).length;
      return {
        skillId: entry.skillId,
        discoverable: entry.discoverable,
        disclosure: entry.disclosure,
        summaryDisclosed: entry.disclosure !== "hidden",
        bodyDisclosed: entry.disclosure === "body",
        resourceCount: entry.resources.size,
        resourceMetadataDisclosedCount,
        resourceContentDisclosedCount,
      };
    },
  );

  return {
    scopeId: view.scopeId,
    scopeKind: view.scopeKind,
    entries,
    summaryDisclosedCount: entries.filter((entry) => entry.summaryDisclosed)
      .length,
    bodyDisclosedCount: entries.filter((entry) => entry.bodyDisclosed).length,
    hiddenCount: entries.filter((entry) => entry.disclosure === "hidden").length,
    resourceMetadataDisclosedCount: entries.reduce(
      (total, entry) => total + entry.resourceMetadataDisclosedCount,
      0,
    ),
    resourceContentDisclosedCount: entries.reduce(
      (total, entry) => total + entry.resourceContentDisclosedCount,
      0,
    ),
  };
};
