import type { KnowledgeBaseDocumentDetail } from "@/shared/api/knowledgeBase";

const PREVIEW_SAMPLE_COUNT = 10;

export function samplePreviewChunks(
  chunks: KnowledgeBaseDocumentDetail["chunks"],
  sampleCount = PREVIEW_SAMPLE_COUNT,
) {
  if (chunks.length <= sampleCount) {
    return chunks;
  }

  const indices = new Set<number>();
  const step = chunks.length / sampleCount;

  for (let index = 0; index < sampleCount; index += 1) {
    const base = Math.floor(index * step);
    const jitterWindow = Math.max(1, Math.floor(step / 3));
    const jitter = Math.floor(Math.random() * jitterWindow);
    indices.add(Math.min(chunks.length - 1, base + jitter));
  }

  while (indices.size < sampleCount) {
    indices.add(Math.floor(Math.random() * chunks.length));
  }

  return Array.from(indices)
    .sort((left, right) => left - right)
    .map((index) => chunks[index]!);
}
