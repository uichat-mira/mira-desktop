export type WorkspaceEditFacade = "primitives" | "apply_patch" | "all";

export const resolveWorkspaceEditFacadeForModel = (
  modelHint?: string,
): Exclude<WorkspaceEditFacade, "all"> => {
  const model = modelHint?.trim().toLowerCase();
  if (!model) {
    return "primitives";
  }

  // Follow the mature OpenCode materialization principle: newer GPT/Codex
  // model families get the compound patch facade, while GPT-4, OSS and
  // unrelated model families keep the primitive edit vocabulary.
  const patchFriendly =
    model.includes("codex") ||
    (model.includes("gpt-") &&
      !model.includes("gpt-4") &&
      !model.includes("oss"));

  return patchFriendly ? "apply_patch" : "primitives";
};
