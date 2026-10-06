export type WorkspaceEditFacade = "primitives" | "apply_patch" | "all";

export const resolveWorkspaceEditFacadeForModel = (
  modelHint?: string,
): Exclude<WorkspaceEditFacade, "all"> => {
  const model = modelHint?.trim().toLowerCase();
  if (!model) {
    return "primitives";
  }

  // Only opt in model identifiers that explicitly advertise Codex-style patch
  // behavior. Unknown/general GPT model families stay on the primitive facade;
  // a false negative preserves capability, while a false positive can expose a
  // grammar the model was never validated to use.
  const patchFriendly = model.includes("codex");

  return patchFriendly ? "apply_patch" : "primitives";
};
