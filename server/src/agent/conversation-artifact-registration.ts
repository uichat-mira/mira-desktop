import {
  conversationArtifactService,
  ConversationArtifactError,
  type ConversationArtifactReference,
} from "@/services/conversation-artifact.service.js";
import { getSqlite } from "@/db/index.js";
import type { ConversationWorkdirOutputDeclaration } from "./types.js";

/**
 * Registers only outputs explicitly declared as final by the Agent runtime.
 * Workdir files are never discovered or promoted implicitly.
 */
export const registerConversationWorkdirOutputs = (input: {
  threadId: string;
  userId: number;
  storageRoot?: string;
  declarations?: ConversationWorkdirOutputDeclaration[];
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
          "Conversation Workdir output declaration is invalid",
        );
      }

      if (declaration.lifecycle === "temporary") {
        continue;
      }

      artifacts.push(
        conversationArtifactService.register({
          threadId: input.threadId,
          userId: input.userId,
          storageRoot: input.storageRoot,
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
