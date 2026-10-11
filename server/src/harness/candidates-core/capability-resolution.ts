import type { HarnessCapabilityProfile } from "../profiles/index.js";

/**
 * Deterministic-first capability resolution cascade over compact capability
 * metadata.
 *
 * Preferred order:
 *
 *   exact canonical match
 *     -> capability/domain structural match
 *     -> deterministic lexical (BM25-style) lookup
 *     -> genuine ambiguity
 *     -> cheap semantic Resolver
 *
 * Tool Search is a fallback inside Progressive Resolution, not a mandatory
 * preflight. This module only decides which capability best matches a request;
 * it never executes a Tool, never materializes a schema, and never grants
 * authority. Readiness still comes from Harness runtime-readiness and every
 * invocation still flows through Normalize / Policy / Approval / Harness.
 *
 * The semantic stage is injectable so callers can supply the cheap production
 * model route (see `capability-resolution.semantic.ts`) and so tests can count
 * model calls without touching a provider.
 */

export type CapabilityResolutionPath =
  | "exact"
  | "structural"
  | "lexical"
  | "semantic"
  | "ambiguous"
  | "none";

export interface CapabilityResolutionDocument {
  readonly capabilityId: string;
  readonly title: string;
  readonly description: string;
  readonly domain: string;
  readonly tags: readonly string[];
  readonly toolIds: readonly string[];
  readonly aliases: readonly string[];
}

export interface CapabilityResolutionCandidate {
  readonly capabilityId: string;
  readonly score: number;
  readonly reason: string;
}

/**
 * Resolution budget seam. It intentionally models only the semantic model calls
 * a resolution pass may spend so the final #301 budget card can cap it without
 * changing the cascade shape.
 */
export interface CapabilityResolutionBudget {
  readonly maxSemanticCalls?: number;
}

export type SemanticCapabilityResolver = (input: {
  readonly query: string;
  readonly candidates: readonly CapabilityResolutionCandidate[];
}) => Promise<string | undefined>;

export interface ResolveCapabilityCascadeInput {
  readonly query: string;
  readonly capabilities: readonly CapabilityResolutionDocument[];
  /** Exact known capability or tool id that bypasses search entirely. */
  readonly knownCapabilityId?: string;
  readonly semanticResolver?: SemanticCapabilityResolver;
  readonly budget?: CapabilityResolutionBudget;
  readonly minLexicalScore?: number;
  readonly lexicalAmbiguityMargin?: number;
  readonly maxSemanticCandidates?: number;
}

export interface CapabilityResolutionTrace {
  readonly query: string;
  readonly path: CapabilityResolutionPath;
  readonly modelCalls: number;
  readonly semanticAttempted: boolean;
  readonly ambiguous: boolean;
  readonly deterministicCandidates: readonly CapabilityResolutionCandidate[];
  readonly selectedCapabilityId: string | null;
  readonly domainHint: string | null;
  readonly selectedDomain: string | null;
  readonly wrongDomainRecovered: boolean;
  readonly reason: string;
  readonly semanticError?: string;
}

export interface CapabilityResolutionResult {
  readonly path: CapabilityResolutionPath;
  readonly selectedCapabilityId: string | null;
  readonly candidates: readonly CapabilityResolutionCandidate[];
  readonly trace: CapabilityResolutionTrace;
}

export const DEFAULT_MIN_LEXICAL_SCORE = 1.2;
export const DEFAULT_LEXICAL_AMBIGUITY_MARGIN = 0.5;
export const DEFAULT_MAX_SEMANTIC_CANDIDATES = 8;
export const DEFAULT_MAX_SEMANTIC_CALLS = 1;

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const CANONICAL_SPLIT_PATTERN = /[^\p{L}\p{N}_]+/u;
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;

const CONTENT_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "for",
  "and",
  "or",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "is",
  "are",
  "be",
  "please",
  "me",
  "my",
  "this",
  "that",
  "it",
  "i",
  "you",
  "we",
  "do",
  "does",
  "run",
  "use",
  "using",
]);

const cjkExpansions = (token: string): string[] => {
  if (!CJK_PATTERN.test(token)) return [];
  const chars = Array.from(token);
  const grams: string[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    grams.push(char);
    const next = chars[index + 1];
    if (next) grams.push(`${char}${next}`);
  }
  return grams;
};

/** Tokenize free text for lexical search, expanding CJK runs into n-grams. */
export const tokenizeCapabilityText = (text: string): string[] => {
  const rawTokens = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const tokens = new Set<string>();
  for (const token of rawTokens) {
    tokens.add(token);
    for (const gram of cjkExpansions(token)) tokens.add(gram);
  }
  return [...tokens];
};

/**
 * Tokenize for canonical identity matching. Underscores are preserved so a
 * canonical id such as `web_search` stays one token.
 */
export const tokenizeCanonicalText = (text: string): string[] =>
  text
    .toLowerCase()
    .split(CANONICAL_SPLIT_PATTERN)
    .filter((token) => token.length > 0);

const contentTokens = (text: string): string[] =>
  tokenizeCapabilityText(text).filter(
    (token) =>
      token.length > 1 &&
      !CONTENT_STOPWORDS.has(token) &&
      !/^\p{N}+$/u.test(token),
  );

const normalizeKey = (value: string) => value.trim().toLowerCase();

export const buildCapabilityResolutionDocuments = (
  profiles: readonly HarnessCapabilityProfile[],
): CapabilityResolutionDocument[] =>
  profiles.map((profile) => ({
    capabilityId: profile.id,
    title: profile.title,
    description: profile.description,
    domain: profile.domain,
    tags: [...profile.tags],
    toolIds: [...profile.supportingToolIds],
    aliases: [profile.id, ...profile.supportingToolIds],
  }));

const canonicalKeysOf = (
  document: CapabilityResolutionDocument,
): string[] => [document.capabilityId, ...document.aliases, ...document.toolIds];

const findExactCandidates = (input: {
  query: string;
  capabilities: readonly CapabilityResolutionDocument[];
  knownCapabilityId?: string;
}): CapabilityResolutionCandidate[] => {
  if (input.knownCapabilityId) {
    const key = normalizeKey(input.knownCapabilityId);
    const document = input.capabilities.find((candidate) =>
      canonicalKeysOf(candidate).some((value) => normalizeKey(value) === key),
    );
    return document
      ? [
          {
            capabilityId: document.capabilityId,
            score: 1,
            reason: `exact known capability "${input.knownCapabilityId}"`,
          },
        ]
      : [];
  }

  const trimmedQuery = normalizeKey(input.query);
  if (!trimmedQuery) return [];
  const queryTokens = new Set(tokenizeCanonicalText(input.query));
  const matches: CapabilityResolutionCandidate[] = [];

  for (const document of input.capabilities) {
    // Only explicit compound identifiers (e.g. `web_search`) count as an exact
    // canonical mention. Generic single-word Tool names such as `read` or
    // `write` stay with structural/lexical resolution so a sentence that
    // happens to contain them cannot collapse a multi-domain request.
    const canonicalHit = canonicalKeysOf(document).find(
      (value) =>
        value.includes("_") && queryTokens.has(normalizeKey(value)),
    );
    if (canonicalHit) {
      matches.push({
        capabilityId: document.capabilityId,
        score: 1,
        reason: `query names canonical capability "${canonicalHit}"`,
      });
      continue;
    }
    if (normalizeKey(document.title) === trimmedQuery) {
      matches.push({
        capabilityId: document.capabilityId,
        score: 1,
        reason: `query equals capability title "${document.title}"`,
      });
    }
  }

  return matches;
};

const structuralTokenSet = (
  document: CapabilityResolutionDocument,
): Set<string> =>
  new Set([
    ...tokenizeCapabilityText(document.domain),
    ...document.tags.flatMap((tag) => tokenizeCapabilityText(tag)),
  ]);

const findStructuralCandidates = (input: {
  query: string;
  capabilities: readonly CapabilityResolutionDocument[];
}): {
  candidates: CapabilityResolutionCandidate[];
  confident: boolean;
  coverage: number;
} => {
  const tokens = contentTokens(input.query);
  if (tokens.length === 0) {
    return { candidates: [], confident: false, coverage: 0 };
  }

  const tokenSet = new Set(tokens);
  const covered = new Set<string>();
  const candidates: CapabilityResolutionCandidate[] = [];

  for (const document of input.capabilities) {
    const structural = structuralTokenSet(document);
    const matched = [...tokenSet].filter((token) => structural.has(token));
    if (matched.length === 0) continue;
    matched.forEach((token) => covered.add(token));
    candidates.push({
      capabilityId: document.capabilityId,
      score: matched.length,
      reason: `structural ${document.domain} match on ${matched.join(", ")}`,
    });
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.capabilityId.localeCompare(right.capabilityId),
  );

  const coverage = covered.size / tokenSet.size;
  // Require both adequate coverage and a dominant candidate. A tag/domain that
  // many unrelated capabilities share (for example every read-domain Tool) is
  // not "clear" and must fall through to lexical/semantic resolution.
  const topScore = candidates[0]?.score ?? 0;
  const secondScore = candidates[1]?.score ?? 0;
  const dominant = candidates.length === 1 || topScore > secondScore;
  const confident = candidates.length > 0 && coverage >= 0.5 && dominant;
  return { candidates, confident, coverage };
};

export interface LexicalSearchResult {
  candidates: CapabilityResolutionCandidate[];
  confident: boolean;
  topScore: number;
  secondScore: number;
}

const documentText = (document: CapabilityResolutionDocument): string =>
  [
    document.title,
    document.description,
    document.domain,
    document.tags.join(" "),
    document.toolIds.join(" "),
    document.aliases.join(" "),
  ].join(" ");

/**
 * Deterministic BM25-style lexical lookup over compact capability documents.
 * It needs no vector index and no model, so it is always available as the Tool
 * Search fallback for large or noisy catalogs.
 */
export const lexicalSearchCapabilities = (input: {
  query: string;
  capabilities: readonly CapabilityResolutionDocument[];
  minScore?: number;
  ambiguityMargin?: number;
}): LexicalSearchResult => {
  const queryTerms = [...new Set(contentTokens(input.query))];
  const minScore = input.minScore ?? DEFAULT_MIN_LEXICAL_SCORE;
  const margin = input.ambiguityMargin ?? DEFAULT_LEXICAL_AMBIGUITY_MARGIN;
  if (queryTerms.length === 0 || input.capabilities.length === 0) {
    return { candidates: [], confident: false, topScore: 0, secondScore: 0 };
  }

  const documentTokens = input.capabilities.map((document) =>
    tokenizeCapabilityText(documentText(document)),
  );

  const documentFrequency = new Map<string, number>();
  for (const tokens of documentTokens) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const totalDocuments = input.capabilities.length;
  const averageLength =
    documentTokens.reduce((sum, tokens) => sum + tokens.length, 0) /
    (totalDocuments || 1);
  const k1 = 1.2;
  const b = 0.75;

  const idf = (term: string): number => {
    const frequency = documentFrequency.get(term) ?? 0;
    if (frequency === 0) return 0;
    return Math.log(1 + (totalDocuments - frequency + 0.5) / (frequency + 0.5));
  };

  const candidates = input.capabilities
    .map((document, index) => {
      const tokens = documentTokens[index] ?? [];
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      let score = 0;
      for (const term of queryTerms) {
        const termFrequency = frequencies.get(term) ?? 0;
        if (termFrequency === 0) continue;
        const normalization =
          1 - b + b * (tokens.length / (averageLength || 1));
        score +=
          idf(term) *
          ((termFrequency * (k1 + 1)) /
            (termFrequency + k1 * normalization));
      }
      return {
        capabilityId: document.capabilityId,
        score,
        reason: "deterministic lexical (BM25) match",
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.capabilityId.localeCompare(right.capabilityId),
    );

  const topScore = candidates[0]?.score ?? 0;
  const secondScore = candidates[1]?.score ?? 0;
  const confident =
    candidates.length > 0 &&
    topScore >= minScore &&
    (candidates.length === 1 || topScore - secondScore >= margin);

  return { candidates, confident, topScore, secondScore };
};

const mergeShortlist = (
  groups: readonly CapabilityResolutionCandidate[][],
): CapabilityResolutionCandidate[] => {
  const byId = new Map<string, CapabilityResolutionCandidate>();
  for (const group of groups) {
    for (const candidate of group) {
      const existing = byId.get(candidate.capabilityId);
      if (!existing || candidate.score > existing.score) {
        byId.set(candidate.capabilityId, candidate);
      }
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.capabilityId.localeCompare(right.capabilityId),
  );
};

const findDocument = (
  capabilities: readonly CapabilityResolutionDocument[],
  capabilityId: string,
): CapabilityResolutionDocument | undefined =>
  capabilities.find((candidate) => candidate.capabilityId === capabilityId);

const buildResult = (input: {
  path: CapabilityResolutionPath;
  query: string;
  selectedCapabilityId: string | null;
  candidates: readonly CapabilityResolutionCandidate[];
  deterministicCandidates: readonly CapabilityResolutionCandidate[];
  modelCalls: number;
  semanticAttempted: boolean;
  ambiguous: boolean;
  domainHint: string | null;
  selectedDomain: string | null;
  wrongDomainRecovered: boolean;
  reason: string;
  semanticError?: string;
}): CapabilityResolutionResult => ({
  path: input.path,
  selectedCapabilityId: input.selectedCapabilityId,
  candidates: input.candidates,
  trace: {
    query: input.query,
    path: input.path,
    modelCalls: input.modelCalls,
    semanticAttempted: input.semanticAttempted,
    ambiguous: input.ambiguous,
    deterministicCandidates: input.deterministicCandidates,
    selectedCapabilityId: input.selectedCapabilityId,
    domainHint: input.domainHint,
    selectedDomain: input.selectedDomain,
    wrongDomainRecovered: input.wrongDomainRecovered,
    reason: input.reason,
    ...(input.semanticError ? { semanticError: input.semanticError } : {}),
  },
});

export const resolveCapabilityCascade = async (
  input: ResolveCapabilityCascadeInput,
): Promise<CapabilityResolutionResult> => {
  const query = input.query ?? "";

  if (input.capabilities.length === 0) {
    return buildResult({
      path: "none",
      query,
      selectedCapabilityId: null,
      candidates: [],
      deterministicCandidates: [],
      modelCalls: 0,
      semanticAttempted: false,
      ambiguous: false,
      domainHint: null,
      selectedDomain: null,
      wrongDomainRecovered: false,
      reason: "No eligible capability is available in this scope.",
    });
  }

  // 1. Exact canonical match.
  const exactCandidates = findExactCandidates({
    query,
    capabilities: input.capabilities,
    ...(input.knownCapabilityId
      ? { knownCapabilityId: input.knownCapabilityId }
      : {}),
  });
  if (exactCandidates.length === 1) {
    const selected = exactCandidates[0]!;
    const document = findDocument(input.capabilities, selected.capabilityId);
    return buildResult({
      path: "exact",
      query,
      selectedCapabilityId: selected.capabilityId,
      candidates: exactCandidates,
      deterministicCandidates: exactCandidates,
      modelCalls: 0,
      semanticAttempted: false,
      ambiguous: false,
      domainHint: document?.domain ?? null,
      selectedDomain: document?.domain ?? null,
      wrongDomainRecovered: false,
      reason: `Exact canonical match resolved without Tool Search: ${selected.reason}.`,
    });
  }

  // 2. Capability/domain structural match.
  const structural = findStructuralCandidates({
    query,
    capabilities: input.capabilities,
  });
  const domainHint = structural.candidates[0]
    ? (findDocument(input.capabilities, structural.candidates[0].capabilityId)
        ?.domain ?? null)
    : null;
  if (structural.confident && structural.candidates.length > 0) {
    const selected = structural.candidates[0]!;
    return buildResult({
      path: "structural",
      query,
      selectedCapabilityId: selected.capabilityId,
      candidates: structural.candidates,
      deterministicCandidates: structural.candidates,
      modelCalls: 0,
      semanticAttempted: false,
      ambiguous: false,
      domainHint,
      selectedDomain: domainHint,
      wrongDomainRecovered: false,
      reason: `Clear capability/domain structural match resolved without a semantic model call: ${selected.reason}.`,
    });
  }

  // 3. Deterministic lexical BM25 lookup.
  const lexical = lexicalSearchCapabilities({
    query,
    capabilities: input.capabilities,
    ...(input.minLexicalScore !== undefined
      ? { minScore: input.minLexicalScore }
      : {}),
    ...(input.lexicalAmbiguityMargin !== undefined
      ? { ambiguityMargin: input.lexicalAmbiguityMargin }
      : {}),
  });
  if (lexical.confident && lexical.candidates.length > 0) {
    const selected = lexical.candidates[0]!;
    const document = findDocument(input.capabilities, selected.capabilityId);
    return buildResult({
      path: "lexical",
      query,
      selectedCapabilityId: selected.capabilityId,
      candidates: lexical.candidates,
      deterministicCandidates: lexical.candidates,
      modelCalls: 0,
      semanticAttempted: false,
      ambiguous: false,
      domainHint,
      selectedDomain: document?.domain ?? null,
      wrongDomainRecovered: false,
      reason: `Deterministic lexical lookup resolved without vector infrastructure: ${selected.reason}.`,
    });
  }

  // 4. Genuine ambiguity -> cheap semantic Resolver.
  const shortlist = mergeShortlist([
    structural.candidates,
    lexical.candidates,
  ]).slice(0, input.maxSemanticCandidates ?? DEFAULT_MAX_SEMANTIC_CANDIDATES);

  if (shortlist.length === 0) {
    return buildResult({
      path: "none",
      query,
      selectedCapabilityId: null,
      candidates: [],
      deterministicCandidates: [],
      modelCalls: 0,
      semanticAttempted: false,
      ambiguous: false,
      domainHint: null,
      selectedDomain: null,
      wrongDomainRecovered: false,
      reason:
        "No deterministic capability match in the eligible scope; resolution stops transparently.",
    });
  }

  const maxSemanticCalls =
    input.budget?.maxSemanticCalls ?? DEFAULT_MAX_SEMANTIC_CALLS;
  const semanticAttempted = Boolean(
    input.semanticResolver && maxSemanticCalls > 0,
  );
  if (
    semanticAttempted &&
    input.semanticResolver &&
    shortlist.length > 0
  ) {
    try {
      const semanticId = await input.semanticResolver({
        query,
        candidates: shortlist,
      });
      if (
        semanticId &&
        shortlist.some((candidate) => candidate.capabilityId === semanticId)
      ) {
        const document = findDocument(input.capabilities, semanticId);
        const selectedDomain = document?.domain ?? null;
        const wrongDomainRecovered = Boolean(
          domainHint && selectedDomain && domainHint !== selectedDomain,
        );
        const selected = shortlist.find(
          (candidate) => candidate.capabilityId === semanticId,
        )!;
        return buildResult({
          path: "semantic",
          query,
          selectedCapabilityId: semanticId,
          candidates: [
            selected,
            ...shortlist.filter((c) => c.capabilityId !== semanticId),
          ],
          deterministicCandidates: shortlist,
          modelCalls: 1,
          semanticAttempted: true,
          ambiguous: true,
          domainHint,
          selectedDomain,
          wrongDomainRecovered,
          reason: wrongDomainRecovered
            ? `Semantic Resolver recovered an ambiguous request across domains (${domainHint} -> ${selectedDomain}); bounded to one call.`
            : "Semantic Resolver resolved genuine deterministic ambiguity in one bounded call.",
        });
      }
    } catch (error) {
      const semanticError =
        error instanceof Error ? error.message : String(error);
      return buildResult({
        path: "ambiguous",
        query,
        selectedCapabilityId: null,
        candidates: shortlist,
        deterministicCandidates: shortlist,
        modelCalls: 1,
        semanticAttempted: true,
        ambiguous: true,
        domainHint,
        selectedDomain: null,
        wrongDomainRecovered: false,
        reason:
          "Deterministic evidence remained ambiguous and the semantic Resolver failed; Harness will continue with transparent deterministic fallback.",
        semanticError,
      });
    }
  }

  return buildResult({
    path: "ambiguous",
    query,
    selectedCapabilityId: null,
    candidates: shortlist,
    deterministicCandidates: shortlist,
    modelCalls: semanticAttempted && maxSemanticCalls > 0 ? 1 : 0,
    semanticAttempted,
    ambiguous: true,
    domainHint,
    selectedDomain: null,
    wrongDomainRecovered: false,
    reason: semanticAttempted
      ? "Deterministic evidence remained ambiguous and the semantic Resolver returned no usable capability."
      : "Deterministic evidence remained ambiguous; no semantic Resolver is available.",
  });
};
