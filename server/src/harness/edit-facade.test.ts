import { describe, expect, it } from "vitest";
import { resolveWorkspaceEditFacadeForModel } from "./edit-facade.js";

describe("workspace edit facade materialization", () => {
  it.each([
    ["gpt-5.6", "apply_patch"],
    ["openai/gpt-5.3-codex", "apply_patch"],
    ["codex-mini-latest", "apply_patch"],
    ["gpt-4.1", "primitives"],
    ["gpt-oss-120b", "primitives"],
    ["claude-sonnet-4", "primitives"],
    [undefined, "primitives"],
  ] as const)("maps %s to %s", (model, expected) => {
    expect(resolveWorkspaceEditFacadeForModel(model)).toBe(expected);
  });
});
