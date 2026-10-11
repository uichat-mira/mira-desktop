import { writeStructuredLog } from "@/logger";
import { collectTaskModelText } from "@/services/task-model.service.js";
import {
  resolveCapabilityCascade,
  type CapabilityResolutionDocument,
  type CapabilityResolutionResult,
  type ResolveCapabilityCascadeInput,
  type SemanticCapabilityResolver,
} from "./capability-resolution.js";

/**
 * Cheap production semantic Resolver.
 *
 * It reuses the existing bounded task-model route (default AgentTask/Task
 * model, V4.1 Flash by default) instead of introducing a new provider route.
 * The prompt is intentionally tiny: the cascade has already narrowed the space
 * to a bounded shortlist, so this is one low-token classification call and
 * never the recursive multi-call resolution the #243 POC used.
 */
export const createTaskModelCapabilityResolver = (
  capabilities: readonly CapabilityResolutionDocument[] = [],
): SemanticCapabilityResolver => {
  const capabilityById = new Map(
    capabilities.map((capability) => [capability.capabilityId, capability]),
  );

  return async ({ query, candidates }) => {
    if (candidates.length === 0) return undefined;

    const prompt = [
      "Resolve one ambiguous capability request to exactly one capability id.",
      "Reply with only the chosen capability id, or NONE when none applies.",
      `Request: ${query}`,
      "Candidates:",
      ...candidates.map((candidate) => {
        const capability = capabilityById.get(candidate.capabilityId);
        const compactDescription = capability?.description
          ? Array.from(capability.description).slice(0, 180).join("")
          : "";
        return [
          "- id=" + candidate.capabilityId,
          capability?.title ? "title=" + capability.title : "",
          capability?.domain ? "domain=" + capability.domain : "",
          capability?.tags.length
            ? "tags=" + capability.tags.join(",")
            : "",
          compactDescription ? "description=" + compactDescription : "",
          "evidence=" + candidate.reason,
        ]
          .filter(Boolean)
          .join(" | ");
      }),
    ].join("\n");

    let output: string;
    try {
      output = await collectTaskModelText(
        [{ role: "user", content: prompt }],
        { maxTokens: 64, temperature: 0, purpose: "capability_resolution" },
      );
    } catch (error) {
      writeStructuredLog("warn", {
        scope: "capability-resolution",
        event: "semantic-resolver-failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const normalized = output.trim().toLowerCase();
    if (!normalized) return undefined;

    const unwrapped = normalized
      .replace(/^\`+|\`+$/g, "")
      .trim();
    if (unwrapped === "none") return undefined;

    const candidateById = new Map(
      candidates.map((candidate) => [
        candidate.capabilityId.toLowerCase(),
        candidate.capabilityId,
      ]),
    );
    return candidateById.get(unwrapped);
  };
};

export interface ProgressiveCapabilitySearchInput
  extends Omit<ResolveCapabilityCascadeInput, "capabilities"> {
  readonly capabilities: readonly CapabilityResolutionDocument[];
}

/**
 * Progressive Resolution entry point. It runs the deterministic cascade first
 * and only spends the cheap semantic model route when deterministic evidence is
 * genuinely ambiguous. Callers may inject a custom resolver for tests or for a
 * different budget card.
 */
export const resolveProgressiveCapabilitySearch = (
  input: ProgressiveCapabilitySearchInput,
): Promise<CapabilityResolutionResult> =>
  resolveCapabilityCascade({
    ...input,
    semanticResolver:
      input.semanticResolver ?? createTaskModelCapabilityResolver(input.capabilities),
  });
