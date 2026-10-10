/**
 * Isolated research POC for issue #243: a reusable progressive resolution loop
 * over the current Harness Registry / Exposure / capability-profile contract.
 *
 * This module is deliberately NOT wired into the production Planner, Harness
 * exposure resolver, candidate ranking, or MCP adapter. It exists so a
 * deterministic test can compare the current baseline exposure against layered
 * capability disclosure and an optional Tool Search resolver while reusing the
 * real registry eligibility semantics.
 *
 * Design rules encoded here (from the #243 contract):
 * - capability descriptions stay coarse; tool metadata/schema stays precise;
 * - a distinct configurable resolution budget (default 8) is consumed only by
 *   additional capability resolution/disclosure, never by tool execution;
 * - budget exhaustion never means task completion;
 * - disclosure is schema/visibility only and never grants invocation authority.
 */
import type { ToolDefinition } from "../../mcp/core/definitions.js";
import { resolveHarnessToolExposure } from "../exposure-core/index.js";
import type { HarnessExposurePolicyInput } from "../exposure-core/types.js";
import { resolveHarnessCapabilityProfiles } from "../profiles/index.js";
import { listToolDefinitions } from "../registry.js";

export const PROGRESSIVE_RESOLUTION_BUDGET_DEFAULT = 8;
export const PROGRESSIVE_TOOL_SEARCH_DEFAULT_LIMIT = 3;

export type ProgressiveDisclosureOutcome =
  | "disclosed"
  | "already_disclosed"
  | "not_found"
  | "unavailable"
  | "not_authorized"
  | "budget_exhausted";

export interface ProgressiveCapabilityCatalogEntry {
  capabilityId: string;
  title: string;
  description: string;
  domain: string;
  source: "internal" | "external";
  tags: string[];
}

export interface ProgressiveToolSummary {
  toolId: string;
  capabilityId: string;
  title: string;
  description: string;
  domain: string;
  source: "internal" | "external";
  tags: string[];
}

export interface ProgressiveToolDisclosure extends ProgressiveToolSummary {
  inputSchema: Record<string, unknown>;
  /**
   * Explicit marker that this disclosure is visibility-only. Selecting the tool
   * for execution still has to pass the normal Normalize / Policy / Approval /
   * Harness path; the resolver never executes.
   */
  declarationOnly: true;
}

export interface ProgressiveToolSearchCandidate {
  toolId: string;
  capabilityId: string;
  title: string;
  score: number;
}

export interface ProgressiveResolutionState {
  resolutionBudget: number;
  resolutionStepsUsed: number;
  resolutionBudgetRemaining: number;
  disclosedCapabilityIds: string[];
  disclosedToolIds: string[];
  schemaDeclaredToolIds: string[];
}

export interface ProgressiveResolutionResult {
  outcome: ProgressiveDisclosureOutcome;
  consumedResolutionStep: boolean;
  state: ProgressiveResolutionState;
  reason: string;
  capability?: ProgressiveCapabilityCatalogEntry;
  tools: ProgressiveToolSummary[];
  searchCandidates?: ProgressiveToolSearchCandidate[];
  schemaDeclaredTool?: ProgressiveToolDisclosure;
}

export interface ProgressiveResolutionSessionInput {
  exposure: HarnessExposurePolicyInput;
  resolutionBudget?: number;
  /** Tool ids whose full schema is eager (Universal Core). */
  eagerToolIds?: string[];
  /**
   * Simulated readiness gaps: a capability that is registered and authorized
   * but whose runtime is not currently available (e.g. degraded MCP runtime).
   */
  unavailableCapabilityIds?: string[];
  unavailableToolIds?: string[];
}

interface CatalogCapability {
  summary: ProgressiveCapabilityCatalogEntry;
  eligibleToolIds: string[];
  blockedToolIds: string[];
  eagerOnly: boolean;
  unavailable: boolean;
  blockReason?: string;
}

const EXTERNAL_NOT_AUTHORIZED_FRAGMENT = "not explicitly enabled";

const toBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

const tokenize = (value: string): string[] => {
  const lower = value.toLowerCase();
  const tokens: string[] = [];
  for (const segment of lower.split(/[^a-z0-9\u4e00-\u9fff]+/u)) {
    if (!segment) continue;
    if (/^[a-z0-9]+$/.test(segment)) {
      tokens.push(segment);
      continue;
    }
    const chars = Array.from(segment);
    for (let index = 0; index < chars.length; index += 1) {
      tokens.push(chars[index]!);
      if (index + 1 < chars.length) {
        tokens.push(`${chars[index]!}${chars[index + 1]!}`);
      }
    }
  }
  return tokens;
};

const toDocumentTokens = (parts: Array<string | undefined>) =>
  new Set(tokenize(parts.filter(Boolean).join(" ")));

/**
 * Deterministic lexical overlap score. Multi-character (CJK bigram / word)
 * matches weigh more than single-character overlap so gold targets rank ahead
 * of broad domain noise in the synthetic fixtures.
 */
const lexicalScore = (queryTokens: string[], documentTokens: Set<string>) => {
  let score = 0;
  for (const token of queryTokens) {
    if (!documentTokens.has(token)) continue;
    score += token.length >= 2 ? 2 : 0.5;
  }
  return score;
};

const capabilitySummary = (
  profile: ReturnType<typeof resolveHarnessCapabilityProfiles>[number],
): ProgressiveCapabilityCatalogEntry => ({
  capabilityId: profile.id,
  title: profile.title,
  description: profile.description,
  domain: profile.domain,
  source: profile.source,
  tags: profile.tags,
});

const toolSummary = (
  definition: ToolDefinition,
  capabilityId: string,
): ProgressiveToolSummary => ({
  toolId: definition.id,
  capabilityId,
  title: definition.title,
  description: definition.description,
  domain: definition.domain,
  source: definition.source,
  tags: definition.tags,
});

const toDisclosure = (
  definition: ToolDefinition,
  capabilityId: string,
): ProgressiveToolDisclosure => ({
  ...toolSummary(definition, capabilityId),
  inputSchema: definition.inputSchema,
  declarationOnly: true,
});

/**
 * Full-schema byte footprint of a definition set, used as the eager-catalog
 * control. JSON UTF-8 bytes are not provider tokens; they are a structural
 * cost proxy only.
 */
export const measureDefinitionSchemaBytes = (definitions: ToolDefinition[]) =>
  toBytes(
    definitions.map((definition) => ({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
    })),
  );

export const measureJsonBytes = (value: unknown) => toBytes(value);

/**
 * Reusable progressive resolution loop. The session owns disclosure state and
 * the distinct resolution budget; it never executes a tool.
 */
export class ProgressiveResolutionSession {
  private readonly definitionsById = new Map<string, ToolDefinition>();
  private readonly eligibleCapabilities: CatalogCapability[] = [];
  private readonly blockedCapabilities: CatalogCapability[] = [];
  private readonly resolutionBudget: number;
  private readonly eagerToolIds = new Set<string>();
  private readonly disclosedCapabilityIds = new Set<string>();
  private readonly disclosedToolIds = new Set<string>();
  private readonly schemaDeclaredToolIds = new Set<string>();
  private readonly compactSummaries: ProgressiveCapabilityCatalogEntry[] = [];
  private stepsUsed = 0;

  constructor(input: ProgressiveResolutionSessionInput) {
    this.resolutionBudget =
      input.resolutionBudget ?? PROGRESSIVE_RESOLUTION_BUDGET_DEFAULT;
    for (const toolId of input.eagerToolIds ?? []) {
      this.eagerToolIds.add(toolId);
    }

    const definitions = listToolDefinitions();
    for (const definition of definitions) {
      this.definitionsById.set(definition.id, definition);
    }

    const exposure = resolveHarnessToolExposure(input.exposure);
    const exposedIds = new Set(exposure.exposedToolIds);
    const unavailableCapabilities = new Set(input.unavailableCapabilityIds ?? []);
    const unavailableTools = new Set(input.unavailableToolIds ?? []);

    for (const profile of resolveHarnessCapabilityProfiles(definitions)) {
      const registeredToolIds = profile.supportingToolIds.filter((toolId) =>
        this.definitionsById.has(toolId),
      );
      const eligibleToolIds = registeredToolIds.filter(
        (toolId) => exposedIds.has(toolId) && !unavailableTools.has(toolId),
      );
      const blockedToolIds = registeredToolIds.filter(
        (toolId) => !exposedIds.has(toolId),
      );
      const unavailable = unavailableCapabilities.has(profile.id);
      const blockReason = blockedToolIds
        .map((toolId) => exposure.blockedCapabilityReasons[toolId])
        .find((reason): reason is string => Boolean(reason));

      const catalogCapability: CatalogCapability = {
        summary: capabilitySummary(profile),
        eligibleToolIds,
        blockedToolIds,
        eagerOnly:
          eligibleToolIds.length > 0 &&
          eligibleToolIds.every((toolId) => this.eagerToolIds.has(toolId)),
        unavailable,
        ...(blockReason ? { blockReason } : {}),
      };

      if (eligibleToolIds.length > 0) {
        this.eligibleCapabilities.push(catalogCapability);
        this.compactSummaries.push(catalogCapability.summary);
      } else if (blockedToolIds.length > 0) {
        this.blockedCapabilities.push(catalogCapability);
      }
    }

    for (const definition of definitions) {
      if (this.eagerToolIds.has(definition.id)) {
        this.schemaDeclaredToolIds.add(definition.id);
      }
    }
  }

  get state(): ProgressiveResolutionState {
    return {
      resolutionBudget: this.resolutionBudget,
      resolutionStepsUsed: this.stepsUsed,
      resolutionBudgetRemaining: Math.max(
        0,
        this.resolutionBudget - this.stepsUsed,
      ),
      disclosedCapabilityIds: [...this.disclosedCapabilityIds],
      disclosedToolIds: [...this.disclosedToolIds],
      schemaDeclaredToolIds: [...this.schemaDeclaredToolIds],
    };
  }

  /** Coarse capability/domain catalog plus eager core, no tool schemas. */
  compactCatalog(): ProgressiveCapabilityCatalogEntry[] {
    return [...this.compactSummaries];
  }

  initialContextBytes(): number {
    const eagerDefinitions = [...this.eagerToolIds]
      .map((toolId) => this.definitionsById.get(toolId))
      .filter((definition): definition is ToolDefinition => Boolean(definition));
    return toBytes({
      core: eagerDefinitions.map((definition) => ({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
      })),
      catalog: this.compactSummaries,
    });
  }

  disclosedContextBytes(): number {
    const disclosed = [...this.schemaDeclaredToolIds]
      .map((toolId) => this.definitionsById.get(toolId))
      .filter((definition): definition is ToolDefinition => Boolean(definition));
    return toBytes({
      core: disclosed.map((definition) => ({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
      })),
      catalog: this.compactSummaries,
    });
  }

  private findCapability(query: string, pool: CatalogCapability[]) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return undefined;
    let best: { capability: CatalogCapability; score: number } | undefined;
    for (const capability of pool) {
      const score = lexicalScore(
        queryTokens,
        toDocumentTokens([
          capability.summary.title,
          capability.summary.capabilityId,
          capability.summary.description,
          capability.summary.domain,
          capability.summary.tags.join(" "),
        ]),
      );
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { capability, score };
      }
    }
    return best?.capability;
  }

  private negativeOutcome(
    capability: CatalogCapability,
  ): "unavailable" | "not_authorized" {
    if (capability.unavailable) return "unavailable";
    const reason = capability.blockReason ?? "";
    if (
      reason.includes(EXTERNAL_NOT_AUTHORIZED_FRAGMENT) ||
      capability.summary.source === "external"
    ) {
      return "not_authorized";
    }
    return "unavailable";
  }

  private result(
    outcome: ProgressiveDisclosureOutcome,
    consumedResolutionStep: boolean,
    reason: string,
    extra?: Partial<ProgressiveResolutionResult>,
  ): ProgressiveResolutionResult {
    return {
      outcome,
      consumedResolutionStep,
      reason,
      state: this.state,
      tools: [],
      ...extra,
    };
  }

  private exhausted() {
    return this.stepsUsed >= this.resolutionBudget;
  }

  resolveCapability(query: string): ProgressiveResolutionResult {
    const capability =
      this.findCapability(query, this.eligibleCapabilities) ??
      this.findCapability(query, this.blockedCapabilities);
    if (!capability) {
      return this.result(
        "not_found",
        false,
        "No known capability matches the resolution request.",
      );
    }

    if (capability.unavailable) {
      return this.result(
        "unavailable",
        false,
        `${capability.summary.capabilityId} is known but its runtime is unavailable.`,
        { capability: capability.summary },
      );
    }

    if (capability.eligibleToolIds.length === 0) {
      const outcome = this.negativeOutcome(capability);
      return this.result(
        outcome,
        false,
        `${capability.summary.capabilityId} is registered but not exposed to the Planner.`,
        { capability: capability.summary },
      );
    }

    if (
      this.disclosedCapabilityIds.has(capability.summary.capabilityId) ||
      capability.eagerOnly
    ) {
      return this.result(
        "already_disclosed",
        false,
        `${capability.summary.capabilityId} is already disclosed.`,
        { capability: capability.summary },
      );
    }

    if (this.exhausted()) {
      return this.result(
        "budget_exhausted",
        false,
        `Resolution budget of ${this.resolutionBudget} steps is exhausted; continue with already-disclosed capability or surface the gap.`,
      );
    }

    this.stepsUsed += 1;
    this.disclosedCapabilityIds.add(capability.summary.capabilityId);
    for (const toolId of capability.eligibleToolIds) {
      this.disclosedToolIds.add(toolId);
    }

    return this.result(
      "disclosed",
      true,
      `Resolved capability ${capability.summary.capabilityId}; disclosed tool metadata only.`,
      {
        capability: capability.summary,
        tools: capability.eligibleToolIds
          .map((toolId) => {
            const definition = this.definitionsById.get(toolId);
            return definition
              ? toolSummary(definition, capability.summary.capabilityId)
              : undefined;
          })
          .filter((value): value is ProgressiveToolSummary => Boolean(value)),
      },
    );
  }

  /**
   * Optional Tool Search resolver inside the same loop. Ranks eligible tools by
   * lexical overlap and returns metadata for further disclosure; it never
   * declares a schema and never executes.
   */
  searchTools(
    query: string,
    options?: { limit?: number; capabilityId?: string },
  ): ProgressiveResolutionResult {
    const scoped = options?.capabilityId
      ? this.eligibleCapabilities.find(
          (entry) => entry.summary.capabilityId === options.capabilityId,
        )
      : undefined;
    if (options?.capabilityId && !scoped) {
      const blocked = this.blockedCapabilities.find(
        (entry) => entry.summary.capabilityId === options.capabilityId,
      );
      if (blocked) {
        const outcome = this.negativeOutcome(blocked);
        return this.result(
          outcome,
          false,
          `${blocked.summary.capabilityId} is not exposed for Agent access.`,
          { capability: blocked.summary },
        );
      }
      return this.result("not_found", false, `Unknown capability ${options.capabilityId}.`);
    }

    const entity = scoped ?? this.findCapability(query, this.eligibleCapabilities);
    if (!entity) {
      const blocked = this.findCapability(query, this.blockedCapabilities);
      if (blocked) {
        const outcome = this.negativeOutcome(blocked);
        return this.result(
          outcome,
          false,
          `${blocked.summary.capabilityId} is registered but not exposed to the Planner.`,
          { capability: blocked.summary },
        );
      }
      return this.result(
        "not_found",
        false,
        "Tool Search found no matching capability or tool.",
      );
    }

    const queryTokens = tokenize(query);
    const ranked = entity.eligibleToolIds
      .map((toolId) => {
        const definition = this.definitionsById.get(toolId);
        if (!definition) return undefined;
        const score = lexicalScore(
          queryTokens,
          toDocumentTokens([
            definition.title,
            definition.id,
            definition.description,
            definition.domain,
            definition.tags.join(" "),
          ]),
        );
        return {
          toolId,
          title: definition.title,
          capabilityId: entity.summary.capabilityId,
          score,
        } satisfies ProgressiveToolSearchCandidate;
      })
      .filter(
        (candidate): candidate is ProgressiveToolSearchCandidate =>
          Boolean(candidate) && candidate!.score > 0,
      )
      .sort((left, right) => right.score - left.score);

    if (ranked.length === 0) {
      return this.result(
        "not_found",
        false,
        "Tool Search found no eligible tool for the request.",
      );
    }

    const limit = options?.limit ?? PROGRESSIVE_TOOL_SEARCH_DEFAULT_LIMIT;
    const candidates = ranked.slice(0, limit);
    const newlyDisclosed = candidates.filter(
      (candidate) => !this.disclosedToolIds.has(candidate.toolId),
    );

    if (newlyDisclosed.length === 0) {
      return this.result(
        "already_disclosed",
        false,
        "Tool Search candidates were already disclosed.",
        { capability: entity.summary, searchCandidates: candidates },
      );
    }

    if (this.exhausted()) {
      return this.result(
        "budget_exhausted",
        false,
        `Resolution budget of ${this.resolutionBudget} steps is exhausted; Tool Search cannot expand more detail.`,
      );
    }

    for (const candidate of newlyDisclosed) {
      this.disclosedToolIds.add(candidate.toolId);
    }

    this.stepsUsed += 1;

    return this.result(
      "disclosed",
      true,
      "Tool Search disclosed candidate tool metadata; schema and execution remain separate.",
      {
        capability: entity.summary,
        searchCandidates: candidates,
        tools: candidates.map((candidate) => {
          const definition = this.definitionsById.get(candidate.toolId)!;
          return toolSummary(definition, candidate.capabilityId);
        }),
      },
    );
  }

  /**
   * Declare the full model-facing schema of one concrete tool. Still
   * declaration-only; this is where the resolver stops and normal planning
   * continues.
   */
  declareToolSchema(toolId: string): ProgressiveResolutionResult {
    const definition = this.definitionsById.get(toolId);
    if (!definition) {
      return this.result("not_found", false, `Unknown tool ${toolId}.`);
    }

    const owningCapability = this.eligibleCapabilities.find((entry) =>
      entry.eligibleToolIds.includes(toolId),
    );

    if (!owningCapability) {
      const blockedBy = this.blockedCapabilities.find((entry) =>
        entry.blockedToolIds.includes(toolId),
      );
      if (blockedBy) {
        const outcome = this.negativeOutcome(blockedBy);
        return this.result(
          outcome,
          false,
          `${toolId} is registered but not exposed to the Planner.`,
          { capability: blockedBy.summary },
        );
      }
      return this.result(
        "not_found",
        false,
        `${toolId} is not part of the current eligible exposure.`,
      );
    }

    if (owningCapability.unavailable) {
      return this.result(
        "unavailable",
        false,
        `${toolId} belongs to an unavailable runtime.`,
        { capability: owningCapability.summary },
      );
    }

    if (this.schemaDeclaredToolIds.has(toolId)) {
      return this.result(
        "already_disclosed",
        false,
        `${toolId} schema is already declared.`,
        {
          capability: owningCapability.summary,
          schemaDeclaredTool: toDisclosure(
            definition,
            owningCapability.summary.capabilityId,
          ),
        },
      );
    }

    if (this.exhausted()) {
      return this.result(
        "budget_exhausted",
        false,
        `Resolution budget of ${this.resolutionBudget} steps is exhausted; continue with the tools already disclosed.`,
      );
    }

    this.stepsUsed += 1;
    this.schemaDeclaredToolIds.add(toolId);
    this.disclosedToolIds.add(toolId);
    this.disclosedCapabilityIds.add(owningCapability.summary.capabilityId);

    return this.result(
      "disclosed",
      true,
      `${toolId} schema declared; execution authority is unchanged.`,
      {
        capability: owningCapability.summary,
        schemaDeclaredTool: toDisclosure(
          definition,
          owningCapability.summary.capabilityId,
        ),
      },
    );
  }
}
