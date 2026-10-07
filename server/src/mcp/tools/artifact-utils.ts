import type { ToolArtifactKind, ToolInvocationContext } from "../core/definitions.js";

type ArtifactLike = {
  kind: string;
  title: string;
  mimeType?: string;
  data?: unknown;
  uri?: string;
  metadata?: Record<string, unknown>;
};

export const emitArtifacts = (
  context: Pick<ToolInvocationContext, "addArtifact">,
  artifacts: ArtifactLike[],
) => {
  for (const artifact of artifacts) {
    context.addArtifact({
      kind: artifact.kind as ToolArtifactKind,
      title: artifact.title,
      ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
      ...(artifact.data !== undefined ? { data: artifact.data } : {}),
      ...(artifact.uri ? { uri: artifact.uri } : {}),
      ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
    });
  }
};
