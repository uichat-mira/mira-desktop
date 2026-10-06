import { resolveHarnessToolCandidatesForTurn } from "@/harness/tool-candidates";
import { resolveAgentEligibleExternalMcpCapabilities } from "@/mcp/external";
import type {
  AgentIntentEmbeddingConfig,
  ToolIntentCandidate,
  ToolIntentResult,
} from "./types";

export const cosineSimilarity = (left: number[], right: number[]) => {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return -1;
  }
  const leftMagnitude = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightMagnitude = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return -1;
  }
  let dotProduct = 0;
  for (let index = 0; index < left.length; index += 1) {
    dotProduct += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return dotProduct / (leftMagnitude * rightMagnitude);
};

export const matchToolCandidatesByEmbedding = async (input: {
  query: string;
  config?: AgentIntentEmbeddingConfig;
  modelHint?: string;
  editFacade?: import("@/harness/edit-facade.js").WorkspaceEditFacade;
}): Promise<ToolIntentResult> => {
  const eligibleExternalToolIds = resolveAgentEligibleExternalMcpCapabilities().map(
    (definition) => definition.id,
  );
  const candidateResolution = await resolveHarnessToolCandidatesForTurn({
    query: input.query,
    source: "agent_intent",
    topK: input.config?.topK,
    minScore: input.config?.minScore,
    allowExternal: true,
    allowedExternalToolIds: eligibleExternalToolIds,
    modelHint: input.modelHint,
    editFacade: input.editFacade,
  });
  const topK = Math.max(1, input.config?.topK ?? 10);
  const topCandidates: ToolIntentCandidate[] = (candidateResolution.toolCandidates ?? [])
    .slice(0, topK);

  return {
    query: input.query,
    topCandidates,
    toolCandidates: candidateResolution.toolCandidates ?? [],
    toolExposure: candidateResolution.toolExposure,
    exposureReasons: candidateResolution.toolExposure.reason,
    ...(candidateResolution.retrievalModel
      ? { retrievalModel: candidateResolution.retrievalModel }
      : {}),
    ...(candidateResolution.rerankModel
      ? { rerankModel: candidateResolution.rerankModel }
      : {}),
  };
};
