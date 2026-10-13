import {
  buildCapabilityResolutionDocuments,
  type SemanticCapabilityResolver,
} from "@/harness/candidates-core/capability-resolution.js";
import { createTaskModelCapabilityResolver } from "@/harness/candidates-core/capability-resolution.semantic.js";
import { resolveHarnessCapabilityProfiles } from "@/harness/profiles/index.js";
import { clearHarnessRegistry } from "@/harness/registry.js";
import { resolveAgentTaskProvider } from "@/services/provider-proxy.service/resolution.js";
import { buildResolutionCaseResult, resolutionCaseSpecs } from "./cases.js";
import type {
  AcceptanceCaseResult,
  ProgressiveAcceptanceReport,
} from "./contract.js";
import { REFERENCE_243 } from "./contract.js";
import { buildAcceptanceTool } from "./fixtures.js";

/**
 * Opt-in live-model acceptance entrypoint.
 *
 * This is a test-only evidence harness. Ordinary `pnpm check` and the default
 * deterministic test never call a provider. This route is only entered through
 * the explicit `--live` runner flag and is bounded by `--max-live-calls`.
 *
 * The semantic Resolver is deliberately THE production cheap Resolver
 * (`createTaskModelCapabilityResolver`) so a real model decision is measured,
 * not a mock. Token usage is not exposed by the bounded task-model route, so it
 * is recorded as `null` and must not be presented as measured.
 */
export interface LiveAcceptanceOptions {
  readonly maxLiveCalls: number;
}

/**
 * Fail loudly before making any model call when no Agent/Task provider is
 * configured. Silently substituting a mock would make the live route look
 * green while proving nothing, so an unconfigured provider is a hard stop.
 */
export const assertLiveProviderConfigured = (): {
  readonly providerCode: string;
  readonly model: string;
  readonly modelConfigId: string;
} => {
  try {
    const resolved = resolveAgentTaskProvider("default");
    return {
      providerCode: resolved.providerCode,
      model: resolved.model,
      modelConfigId: resolved.modelConfigId,
    };
  } catch (error) {
    throw new Error(
      "Live progressive acceptance requires a configured Agent/Task provider. " +
        `Provider resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const skippedLiveCase = (
  caseId: string,
  surface: string,
  query: string,
): AcceptanceCaseResult => ({
  caseId,
  surface,
  category: "efficiency",
  evidenceLevel: "resolved-capability",
  query,
  gold: {},
  observed: {},
  metrics: {
    modelCalls: null,
    semanticAttempted: null,
    searchUsed: null,
    authorityViolations: 0,
    tokens: null,
    latencyMs: null,
    resolverLatencyMs: null,
  },
  assertions: [],
  status: "skipped",
  diagnostics: [`live semantic call budget exhausted before "${caseId}"`],
});

export const runLiveAcceptanceMatrix = async (
  options: LiveAcceptanceOptions,
): Promise<ProgressiveAcceptanceReport> => {
  const provider = assertLiveProviderConfigured();
  const cases: AcceptanceCaseResult[] = [];
  let liveCalls = 0;

  for (const spec of resolutionCaseSpecs) {
    const requiresModel = spec.expectedSemanticResolverCalls > 0;
    if (requiresModel && liveCalls >= options.maxLiveCalls) {
      cases.push(skippedLiveCase(spec.caseId, spec.surface, spec.query));
      continue;
    }

    const documents = buildCapabilityResolutionDocuments(
      resolveHarnessCapabilityProfiles(
        spec.tools.map((tool) => buildAcceptanceTool(tool).definition),
      ),
    );
    const productionResolver = createTaskModelCapabilityResolver(documents);
    const resolver: SemanticCapabilityResolver = async (input) => {
      liveCalls += 1;
      return productionResolver(input);
    };

    // Latency is measured inside buildResolutionCaseResult, after the awaited
    // resolver call, so it is never snapshotted before the model call resolves.
    const result = await buildResolutionCaseResult(spec, resolver, {
      live: true,
    });
    cases.push(result);
  }

  clearHarnessRegistry();

  const passed = cases.filter((item) => item.status === "passed").length;
  const failed = cases.filter((item) => item.status === "failed").length;
  const skipped = cases.filter((item) => item.status === "skipped").length;

  return {
    runner: "progressive-resolution-acceptance",
    generatedAt: new Date().toISOString(),
    mode: "live",
    evidenceLevel:
      `production Harness resolution path with the production bounded task-model semantic Resolver (provider=${provider.providerCode} model=${provider.model}); ` +
      "token usage unmeasured by the bounded route; no governed Tool invocation observed",
    evidenceScope: {
      resolutionObserved: true,
      plannerProjectionObserved: false,
      governedExecutionObserved: false,
      modelCallUsageObserved: false,
    },
    corpus: {
      fixtureSource: "311-matrix-analogous",
      note:
        "Analogous #311-matrix fixtures with an explicit per-case gold oracle. The original #243 / Control Room corpus and the 16 gold ids are recorded in comparison.reference but are not present in this repository and were not reconstructed.",
    },
    comparison: REFERENCE_243,
    summary: { total: cases.length, passed, failed, skipped },
    cases,
  };
};
