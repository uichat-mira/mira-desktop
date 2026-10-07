import { describe, expect, it } from "vitest";
import { resolveWorkspaceEditFacadeForModel } from "./edit-facade.js";

describe("workspace edit facade materialization", () => {
  it.each([
    ["openai/gpt-5.3-codex", "apply_patch"],
    ["codex-mini-latest", "apply_patch"],
    ["gpt-5.6-codex", "apply_patch"],
    ["gpt-3.5-turbo", "primitives"],
    ["gpt-4o", "primitives"],
    ["gpt-4.1", "primitives"],
    ["gpt-5.6", "primitives"],
    ["gpt-5-turbo", "primitives"],
    ["gpt-oss-120b", "primitives"],
    ["oss-120b", "primitives"],
    ["claude-sonnet-4", "primitives"],
    [undefined, "primitives"],
  ] as const)("maps %s to %s", (model, expected) => {
    expect(resolveWorkspaceEditFacadeForModel(model)).toBe(expected);
  });
});
