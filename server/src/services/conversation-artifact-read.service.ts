import fs from "node:fs";
import {
  conversationArtifactService,
  type ConversationArtifactReference,
} from "./conversation-artifact.service.js";

export const readConversationArtifact = (input: {
  id: string;
  threadId: string;
  userId: number;
  storageRoot?: string;
}): { reference: ConversationArtifactReference; contents: Buffer } => {
  const resolved = conversationArtifactService.resolve(input);
  return {
    reference: resolved.reference,
    contents: fs.readFileSync(resolved.absolutePath),
  };
};
