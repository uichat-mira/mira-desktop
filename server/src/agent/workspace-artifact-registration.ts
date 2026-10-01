import {
  conversationArtifactService,
  ConversationArtifactError,
  type ConversationArtifactReference,
} from "@/services/conversation-artifact.service.js";
import { getSqlite } from "@/db/index.js";
import type { AgentWorkspaceOutputDeclaration } from "./types.js";

/**
 * Registers only outputs explicitly declared as final by the Agent runtime.
 * Workspace files are never discovered or promoted implicitly.
 *
 * sourceRootPath is the exact workspace root frozen by the AgentRun that
 * produced the output. Artifact read-back must never resolve against whatever
 * Workspace the thread happens to use later.
 */
export const registerAgentWorkspaceOutputs = (input: {
  threadId: string;
  userId: number;
  sourceRootPath: string;
  declarations?: AgentWorkspaceOutputDeclaration[];
}): ConversationArtifactReference[] => {
  const registerBatch = getSqlite().transaction(() => {
    const declarations = input.declarations ?? [];
    const artifacts: ConversationArtifactReference[] = [];

    for (const declaration of declarations) {
      if (
        !declaration ||
        typeof declaration.sourceRelativePath !== "string" ||
        (declaration.lifecycle !== "final" &&
          declaration.lifecycle !== "temporary")
      ) {
        throw new ConversationArtifactError(
          "invalid_source",
          "Agent workspace output declaration is invalid",
        );
      }

      if (declaration.lifecycle === "temporary") continue;

      artifacts.push(
        conversationArtifactService.register({
          threadId: input.threadId,
          userId: input.userId,
          sourceRootPath: input.sourceRootPath,
          sourceRelativePath: declaration.sourceRelativePath,
          lifecycle: "final",
          mimeType: declaration.mimeType,
        }),
      );
    }

    return artifacts;
  });

  return registerBatch();
};
