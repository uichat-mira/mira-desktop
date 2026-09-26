export function formatEvaluationKnowledgeBaseLabel(
  knowledgeBaseId?: string | null,
  knowledgeBaseName?: string | null,
) {
  if (!knowledgeBaseId) {
    return null;
  }

  // Prefer the human-readable knowledge base name when available.
  return knowledgeBaseName?.trim() || knowledgeBaseId;
}
