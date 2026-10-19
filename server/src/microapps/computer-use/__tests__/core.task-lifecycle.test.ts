import { describe, expect, it } from "vitest";
import * as computerUse from "@/microapps/computer-use/index.js";

// Regression guard for AGT-020: task lifecycle and planning orchestration were
// retired with the dedicated Computer Use model/route surface.
describe("retired Computer Use task lifecycle", () => {
  it("no longer exports task lifecycle or planning orchestration", () => {
    expect("createPlanningComputerUseTask" in computerUse).toBe(false);
    expect("transitionComputerUseTask" in computerUse).toBe(false);
    expect("createComputerUsePlan" in computerUse).toBe(false);
  });
});
